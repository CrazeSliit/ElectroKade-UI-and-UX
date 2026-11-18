/* ElectroKade.lk — digital warranty QR + OTP recovery.
 *
 * FRONT-END DEMO. This site has no server, so warranty records live in
 * localStorage and the OTP is generated in the browser and shown as a
 * "demo SMS" toast. For production, move registerOrder / sendOtp / verifyOtp
 * to your backend (store records in a DB, send the code through an SMS
 * gateway, verify server-side, and sign the QR payload with a server secret).
 * Plug a real sender in with:  EKW.smsSender = function (phone, text) { ... }
 */
(function () {
  'use strict';

  var KEY = 'ek_warranties_v1';
  var OTP_KEY = 'ek_otp_v1';
  var OTP_TTL = 5 * 60 * 1000;      // code valid for 5 minutes
  var OTP_RESEND = 30 * 1000;       // wait 30s before resending
  var OTP_MAX_TRIES = 5;
  var SALT = 'ek-wr-2026';          // demo only — a real signature needs a server-side secret

  /* ---------- storage ---------- */
  function readJSON(store, key, fallback) {
    try { var v = JSON.parse(store.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJSON(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
  }
  function all() { return readJSON(localStorage, KEY, []); }
  function saveAll(list) { writeJSON(localStorage, KEY, list); }

  /* ---------- helpers ---------- */
  function normPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.indexOf('94') === 0 && d.length === 11) d = d.slice(2);
    if (d.charAt(0) === '0') d = d.slice(1);
    return /^7\d{8}$/.test(d) ? '+94' + d : null;   // Sri Lankan mobile numbers
  }
  function fmtPhone(p) { return p ? p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '+94 $1 $2 $3') : ''; }
  function maskPhone(p) { return p ? p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '+94 $1 ••• $3') : ''; }

  function hash(s) {                       // FNV-1a, 32-bit, twice for a longer digest
    function f(str, seed) {
      var h = seed >>> 0;
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(36);
    }
    return (f(s, 2166136261) + f(s.split('').reverse().join(''), 3332325) ).toUpperCase();
  }
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
  }
  function addMonths(iso, m) {
    var d = new Date(iso + 'T00:00:00');
    var day = d.getDate();
    d.setMonth(d.getMonth() + m);
    if (d.getDate() !== day) d.setDate(0);  // clamp e.g. 31 Jan + 1 mo
    return d;
  }
  function fmtDate(d) {
    if (typeof d === 'string') d = new Date(d + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function maskName(n) {
    var parts = String(n || '').trim().split(/\s+/);
    return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1].charAt(0) + '.' : parts[0] || '';
  }

  /* ---------- warranty records ---------- */
  function status(w) {
    var exp = addMonths(w.start, w.months);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var days = Math.round((exp - today) / 86400000);
    return { expires: exp, daysLeft: days, active: days >= 0 };
  }

  // The QR carries a compact, checksummed copy of the record so it can be
  // verified on any device (the records themselves only live in this browser).
  function payload(w) {
    var d = { i: w.id, o: w.orderNo, p: w.product, v: w.variant, s: w.serial, t: w.start, m: w.months, n: maskName(w.customer) };
    var json = JSON.stringify(d);
    return { d: b64urlEncode(json), c: hash(json + SALT).slice(0, 8) };
  }
  function verifyUrl(w) {
    var p = payload(w);
    var base = location.href.replace(/[^/]*([?#].*)?$/, '');
    return base + 'warranty.html?d=' + p.d + '&c=' + p.c;
  }
  function decode(d, c) {
    try {
      var json = b64urlDecode(d);
      var o = JSON.parse(json);
      var ok = hash(json + SALT).slice(0, 8) === c;
      return { ok: ok, w: { id: o.i, orderNo: o.o, product: o.p, variant: o.v, serial: o.s, start: o.t, months: o.m, customer: o.n } };
    } catch (e) { return { ok: false, w: null }; }
  }

  function serialFor(orderNo, idx, item) {
    var h = hash(orderNo + '|' + idx + '|' + item.sku);
    return (item.serialPrefix || 'EK') + h.replace(/[^A-Z0-9]/g, '').slice(0, 10);
  }

  // Creates one warranty per unit bought. Safe to call repeatedly.
  function registerOrder(order) {
    var list = all();
    var phone = normPhone(order.phone);
    var made = [];
    var n = 0;
    order.items.forEach(function (item) {
      for (var q = 0; q < (item.qty || 1); q++) {
        n++;
        var id = 'WR-' + order.orderNo.replace(/^EK-/, '') + '-' + (n < 10 ? '0' : '') + n;
        var existing = list.filter(function (w) { return w.id === id; })[0];
        if (existing) { made.push(existing); continue; }
        var w = {
          id: id, orderNo: order.orderNo, customer: order.customer, phone: phone,
          product: item.name, variant: item.variant || '', image: item.image || '',
          serial: serialFor(order.orderNo, n, item), months: item.months, start: order.date
        };
        list.push(w); made.push(w);
      }
    });
    saveAll(list);
    return made;
  }
  function byPhone(phone) {
    var p = normPhone(phone);
    return all().filter(function (w) { return w.phone === p; });
  }

  /* ---------- OTP ---------- */
  function randomCode() {
    var a = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return String(a[0] % 1000000).padStart(6, '0');
  }
  function otpState() { return readJSON(sessionStorage, OTP_KEY, null); }

  // Returns { ok, retryIn, error }. Always reports success for a valid number
  // so the form doesn't reveal which numbers have warranties.
  function sendOtp(phone) {
    var p = normPhone(phone);
    if (!p) return { ok: false, error: 'Enter a valid Sri Lankan mobile number, e.g. 071 555 0182.' };
    var st = otpState();
    var now = Date.now();
    if (st && st.phone === p && now - st.sentAt < OTP_RESEND) {
      return { ok: false, retryIn: Math.ceil((OTP_RESEND - (now - st.sentAt)) / 1000), error: 'Please wait before requesting a new code.' };
    }
    var code = randomCode();
    writeJSON(sessionStorage, OTP_KEY, { phone: p, h: hash(code + p + SALT), exp: now + OTP_TTL, sentAt: now, tries: 0 });
    var has = byPhone(p).length > 0;
    var text = 'ElectroKade: ' + code + ' is your code to recover your warranty QR. It expires in 5 minutes. Never share this code.';
    if (has) EKW.smsSender(p, text, code);
    else EKW.smsSender(p, null, null);
    return { ok: true, phone: p, retryIn: OTP_RESEND / 1000 };
  }

  // Returns { ok, warranties, error, triesLeft }.
  function verifyOtp(phone, code) {
    var p = normPhone(phone);
    var st = otpState();
    if (!st || st.phone !== p) return { ok: false, error: 'Request a code first.' };
    if (Date.now() > st.exp) return { ok: false, error: 'This code has expired. Tap “Resend code”.' };
    if (st.tries >= OTP_MAX_TRIES) return { ok: false, error: 'Too many wrong attempts. Request a new code.' };
    if (hash(String(code) + p + SALT) !== st.h) {
      st.tries++; writeJSON(sessionStorage, OTP_KEY, st);
      var left = OTP_MAX_TRIES - st.tries;
      return { ok: false, triesLeft: left, error: left > 0 ? 'That code isn’t right. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' : 'Too many wrong attempts. Request a new code.' };
    }
    try { sessionStorage.removeItem(OTP_KEY); } catch (e) {}
    return { ok: true, warranties: byPhone(p) };
  }

  /* ---------- demo SMS delivery ---------- */
  function toast(html, ms) {
    var t = document.createElement('div');
    t.className = 'ekw-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = html;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    var close = function () { t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 300); };
    t.addEventListener('click', close);
    setTimeout(close, ms || 12000);
  }
  function demoSms(phone, text, code) {
    if (!code) {
      toast('<b>Demo note</b><span>No warranties are registered to ' + esc(fmtPhone(phone)) + ', so no SMS was sent. The form still says “sent” so it can’t be used to look up numbers.</span>');
      return;
    }
    toast('<b>Demo SMS to ' + esc(fmtPhone(phone)) + '</b><span>' + esc(text) + '</span><code>' + code + '</code>', 30000);
  }

  /* ---------- QR rendering ---------- */
  function renderQR(el, text, size) {
    el.innerHTML = '';
    if (!window.QRCode) { el.textContent = 'QR unavailable'; return null; }
    new window.QRCode(el, { text: text, width: size, height: size, colorDark: '#0F1419', colorLight: '#FFFFFF', correctLevel: window.QRCode.CorrectLevel.M });
    el.removeAttribute('title');
    return el.querySelector('canvas');
  }

  function wrapText(ctx, text, maxW) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  // Builds a printable PNG warranty card and downloads it.
  function downloadCard(w) {
    var tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(tmp);
    var qr = renderQR(tmp, verifyUrl(w), 520);
    var W = 720, H = 1060, pad = 56;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    var st = status(w);
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#0F1419'; x.fillRect(0, 0, W, 120);
    x.fillStyle = '#FFFFFF'; x.font = '800 34px "Open Sans", Arial, sans-serif'; x.fillText('ElectroKade.lk', pad, 70);
    x.fillStyle = '#7FE3BD'; x.font = '700 18px "Open Sans", Arial, sans-serif'; x.fillText('DIGITAL WARRANTY CARD', pad, 98);
    if (qr) x.drawImage(qr, (W - 520) / 2, 150, 520, 520);
    var y = 720;
    x.fillStyle = '#0F1419'; x.font = '800 28px "Open Sans", Arial, sans-serif';
    wrapText(x, w.product, W - pad * 2).slice(0, 2).forEach(function (l) { x.fillText(l, pad, y); y += 36; });
    x.fillStyle = '#536471'; x.font = '400 20px "Open Sans", Arial, sans-serif';
    if (w.variant) { x.fillText(w.variant, pad, y); y += 30; }
    y += 16;
    var rows = [['Serial no.', w.serial], ['Warranty ID', w.id], ['Order', w.orderNo], ['Valid', fmtDate(w.start) + ' – ' + fmtDate(st.expires)]];
    rows.forEach(function (r) {
      x.fillStyle = '#536471'; x.font = '600 19px "Open Sans", Arial, sans-serif'; x.fillText(r[0], pad, y);
      x.fillStyle = '#0F1419'; x.font = '700 20px "Open Sans", Arial, sans-serif'; x.fillText(r[1], pad + 170, y);
      y += 34;
    });
    x.fillStyle = '#536471'; x.font = '400 16px "Open Sans", Arial, sans-serif';
    x.fillText('Show this QR at any ElectroKade service point. Lost it? Recover it at', pad, H - 46);
    x.fillText('electrokade.lk/warranty.html with the OTP sent to your phone.', pad, H - 24);
    tmp.remove();
    var a = document.createElement('a');
    a.download = 'ElectroKade-warranty-' + w.id + '.png';
    a.href = c.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- warranty card markup (shared by confirmation + recovery pages) ---------- */
  var ICON_SHIELD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>';
  var ICON_DL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>';
  var ICON_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

  function cardsHTML(list) {
    return list.map(function (w, i) {
      var st = status(w);
      return '<article class="ekw-card">' +
        '<div class="ekw-qr" data-qr="' + i + '" role="img" aria-label="Warranty QR code for ' + esc(w.product) + '"></div>' +
        '<div class="ekw-info">' +
          '<div class="ekw-name">' + esc(w.product) + '</div>' +
          (w.variant ? '<div class="ekw-muted">' + esc(w.variant) + '</div>' : '') +
          '<dl class="ekw-dl">' +
            '<dt>Serial</dt><dd class="ekw-mono">' + esc(w.serial) + '</dd>' +
            '<dt>Warranty ID</dt><dd class="ekw-mono">' + esc(w.id) + '</dd>' +
            '<dt>Valid until</dt><dd>' + fmtDate(st.expires) + '</dd>' +
          '</dl>' +
          '<span class="ekw-badge' + (st.active ? '' : ' is-expired') + '">' + ICON_SHIELD + (st.active ? w.months + '-month warranty · active' : 'Expired') + '</span>' +
          '<div class="ekw-actions">' +
            '<button type="button" class="ekw-btn ekw-btn-dark" data-dl="' + i + '">' + ICON_DL + 'Download</button>' +
            '<a class="ekw-btn ekw-btn-ghost" data-open="' + i + '" target="_blank" rel="noopener">' + ICON_OPEN + 'Open</a>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }
  function hydrateCards(root, list) {
    list.forEach(function (w, i) {
      renderQR(root.querySelector('[data-qr="' + i + '"]'), verifyUrl(w), 132);
      root.querySelector('[data-open="' + i + '"]').href = verifyUrl(w);
      root.querySelector('[data-dl="' + i + '"]').addEventListener('click', function () { downloadCard(w); });
    });
  }

  /* ---------- confirmation page section ---------- */
  function whenReady(selector, cb) {
    var el = document.querySelector(selector);
    if (el) return cb(el);
    var mo = new MutationObserver(function () {
      var e = document.querySelector(selector);
      if (e) { mo.disconnect(); cb(e); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function mountConfirmation(order) {
    var list = registerOrder(order);
    whenReady('#ek-warranty-slot', function (slot) {
      slot.className = 'ekw-section';
      slot.innerHTML =
        '<div class="ekw-head">' +
          '<div><h2>Your warranty QR cards (' + list.length + ')</h2>' +
          '<p>One QR per device. Show it at any ElectroKade service point for warranty claims — no paper invoice needed. Download them now and keep them safe.</p></div>' +
        '</div>' +
        '<div class="ekw-grid">' + cardsHTML(list) + '</div>' +
        '<div class="ekw-lost">' + ICON_SHIELD + '<span>Lost your QR? Get it back any time with an OTP sent to <b>' + esc(maskPhone(normPhone(order.phone))) + '</b>.</span> <a href="warranty.html">Recover warranty QR</a></div>';
      hydrateCards(slot, list);
    });
  }

  var EKW = window.EKW = {
    normPhone: normPhone, fmtPhone: fmtPhone, maskPhone: maskPhone, fmtDate: fmtDate, esc: esc,
    all: all, byPhone: byPhone, registerOrder: registerOrder, status: status,
    verifyUrl: verifyUrl, decode: decode, renderQR: renderQR, downloadCard: downloadCard,
    sendOtp: sendOtp, verifyOtp: verifyOtp, cardsHTML: cardsHTML, hydrateCards: hydrateCards,
    mountConfirmation: mountConfirmation, toast: toast, smsSender: demoSms,
    ICON_SHIELD: ICON_SHIELD
  };

  // The order shown on the confirmation pages (static demo data).
  EKW.DEMO_ORDER = {
    orderNo: 'EK-2611-48213', customer: 'Nimal Perera', phone: '+94 71 555 0182', date: '2026-11-16',
    items: [
      { sku: 'SM-A556E', name: 'Samsung Galaxy A55 5G (8GB / 256GB)', variant: 'Awesome Ice Blue', qty: 1, months: 12, serialPrefix: 'R5CX', image: 'assets/products/galaxy-a55.webp' },
      { sku: 'JBL-TB2', name: 'JBL Tune Beam 2 ANC True Wireless Earbuds', variant: 'Black', qty: 1, months: 12, serialPrefix: 'JB', image: 'assets/products/jbl-tune-beam-2.webp' },
      { sku: 'A1289', name: 'Anker PowerCore 20,000mAh 22.5W Power Bank', variant: 'Black', qty: 2, months: 18, serialPrefix: 'AK', image: 'assets/products/anker-powercore-20000.webp' }
    ]
  };
})();
