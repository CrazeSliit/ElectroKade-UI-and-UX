/* ElectroKade.lk — page transitions & scroll-reveal.
   Loaded synchronously in <head> so it can watch React render the page into #app. */
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var inFrame = window.top !== window;
  var root = document.documentElement;
  if (reduce) return;
  // Browsers with cross-document View Transitions animate navigation natively over http(s).
  var native = 'onpagereveal' in window && /^https?:$/.test(location.protocol);
  root.classList.add('ek-motion');
  if (!inFrame && !native) root.classList.add('ek-enter');

  /* ---------------- Scroll reveal ---------------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(onSeen, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  var CARD = '.ek-card';
  var BLOCK = '#app section, #app h1, #app h2';

  function skip(el) {
    // never animate chrome that should feel instant: headers, navs, fixed/sticky bars, overlays
    return !!el.closest('header, nav, footer, .ek-hero, [role="dialog"], [aria-modal="true"]') ||
           /fixed|sticky/.test(el.style.position);
  }
  function tag(el, scale) {
    if (el.__ekrv || skip(el)) return;
    el.__ekrv = 1;
    el.classList.add('ek-rv');
    if (scale) el.classList.add('ek-rv-scale');
    // stagger siblings that arrive together (product grids, category tiles)
    var p = el.parentElement, i = 0;
    if (p) for (var c = p.firstElementChild; c && c !== el; c = c.nextElementSibling) if (c.__ekrv) i++;
    el.style.transitionDelay = Math.min(i, 8) * 55 + 'ms';
    if (io) io.observe(el); else el.classList.add('ek-in');
  }
  function scan(node) {
    if (!io || node.nodeType !== 1 || !node.closest || !node.closest('#app')) return;
    var cards = node.matches(CARD) ? [node] : node.querySelectorAll(CARD);
    for (var i = 0; i < cards.length; i++) tag(cards[i], true);
    var blocks = node.matches(BLOCK) ? [node] : node.querySelectorAll(BLOCK);
    for (var j = 0; j < blocks.length; j++) {
      var b = blocks[j];
      // sections full of cards: let the cards do the moving
      if (b.tagName === 'SECTION' && b.querySelector(CARD)) continue;
      tag(b, false);
    }
  }
  function onSeen(entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      io.unobserve(el);
      el.classList.add('ek-in');
      // once settled, drop the delay so hover/press feel instant again
      setTimeout(function () { el.style.transitionDelay = ''; el.classList.remove('ek-rv', 'ek-rv-scale'); }, 1100);
    });
  }
  if (io) {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++)
        for (var n = muts[i].addedNodes, k = 0; k < n.length; k++) scan(n[k]);
    }).observe(root, { childList: true, subtree: true });
  }

  /* ---------------- Cart badge pop on "Add to cart" ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button');
    if (!b || !/add to cart/i.test(b.textContent)) return;
    var badge = document.querySelector('a[href*="Cart"] span[style*="position: absolute"]');
    [b, badge].forEach(function (el) {
      if (!el) return;
      el.classList.remove('ek-pop'); void el.offsetWidth; el.classList.add('ek-pop');
    });
  });

  /* ---------------- Page leave ---------------- */
  if (inFrame) return;
  var leaving = false;

  document.addEventListener('click', function (e) {
    if (native || leaving || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(href)) return;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin && location.protocol !== 'file:') return;
    if (url.protocol !== location.protocol) return;
    if (url.pathname === location.pathname && url.hash) return; // in-page anchor
    e.preventDefault();
    leave(url.href);
  });

  function leave(href) {
    leaving = true;
    if (!document.querySelector('.ek-progress')) {
      var bar = document.createElement('div'); bar.className = 'ek-progress'; document.body.appendChild(bar);
    }
    root.classList.add('ek-leaving');
    setTimeout(function () { location.href = href; }, 220);
  }

  // Coming back via the back button restores a frozen page: undo the leave state.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    leaving = false;
    root.classList.remove('ek-leaving');
  });
})();
