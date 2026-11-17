/* Home hero carousel: arrows, dots, autoplay, swipe, keyboard.
   Works on markup React renders from the page template; it only toggles classes
   that React never changes, so the page's own re-renders leave it alone. */
(function () {
  var DELAY = 6000;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function parts(hero) {
    return {
      slides: hero.querySelectorAll('.ek-hero-slide'),
      dots: hero.querySelectorAll('.ek-hero-dot')
    };
  }
  function current(hero) {
    var s = parts(hero).slides;
    for (var i = 0; i < s.length; i++) if (s[i].classList.contains('is-active')) return i;
    return 0;
  }
  function go(hero, to) {
    var p = parts(hero), n = p.slides.length;
    if (!n) return;
    to = (to + n) % n;
    for (var i = 0; i < n; i++) {
      var on = i === to;
      p.slides[i].classList.toggle('is-active', on);
      p.slides[i].setAttribute('aria-hidden', on ? 'false' : 'true');
      if (p.dots[i]) {
        p.dots[i].classList.remove('is-active');
        p.dots[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    // re-trigger the dot progress fill
    if (p.dots[to]) { void p.dots[to].offsetWidth; p.dots[to].classList.add('is-active'); }
    hero.__last = Date.now();
  }

  // Clicks: arrows and dots (event delegation; nodes are rendered by React later)
  document.addEventListener('click', function (e) {
    var hero = e.target.closest && e.target.closest('.ek-hero');
    if (!hero) return;
    var btn = e.target.closest('button');
    if (!btn) return;
    var label = btn.getAttribute('aria-label') || '';
    if (/previous slide/i.test(label)) go(hero, current(hero) - 1);
    else if (/next slide/i.test(label)) go(hero, current(hero) + 1);
    else if (btn.classList.contains('ek-hero-dot')) go(hero, Array.prototype.indexOf.call(parts(hero).dots, btn));
  });

  // Keyboard: left/right arrows while focus is inside the carousel
  document.addEventListener('keydown', function (e) {
    var hero = e.target.closest && e.target.closest('.ek-hero');
    if (!hero || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    go(hero, current(hero) + (e.key === 'ArrowRight' ? 1 : -1));
  });

  // Swipe (touch + mouse drag)
  var sx = null, sy = null, swHero = null;
  document.addEventListener('pointerdown', function (e) {
    swHero = e.target.closest && e.target.closest('.ek-hero');
    if (swHero) { sx = e.clientX; sy = e.clientY; }
  });
  document.addEventListener('pointerup', function (e) {
    if (!swHero || sx === null) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      go(swHero, current(swHero) + (dx < 0 ? 1 : -1));
      swHero.__swiped = Date.now();
    }
    sx = sy = swHero = null;
  });
  // a swipe that ends on a link shouldn't also open it
  document.addEventListener('click', function (e) {
    var hero = e.target.closest && e.target.closest('.ek-hero');
    if (hero && hero.__swiped && Date.now() - hero.__swiped < 400 && e.target.closest('a')) {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);

  // Pause on hover / focus
  function pausedState(e, on) {
    var hero = e.target.closest && e.target.closest('.ek-hero');
    if (!hero) return;
    hero.__paused = on;
    hero.classList.toggle('is-paused', on);
    if (!on) hero.__last = Date.now() - hero.__elapsed;
    else hero.__elapsed = Date.now() - (hero.__last || Date.now());
  }
  document.addEventListener('mouseover', function (e) { if (e.target.closest && e.target.closest('.ek-hero') && !e.target.closest('.ek-hero').__paused) pausedState(e, true); });
  document.addEventListener('mouseout', function (e) {
    var hero = e.target.closest && e.target.closest('.ek-hero');
    if (hero && !(e.relatedTarget && hero.contains(e.relatedTarget))) pausedState(e, false);
  });
  document.addEventListener('focusin', function (e) { if (e.target.closest && e.target.closest('.ek-hero')) pausedState(e, true); });
  document.addEventListener('focusout', function (e) {
    var hero = e.target.closest && e.target.closest('.ek-hero');
    if (hero && !(e.relatedTarget && hero.contains(e.relatedTarget))) pausedState(e, false);
  });

  // Autoplay
  if (reduce) {
    document.documentElement.style.setProperty('--ek-hero-delay', '0s');
    return;
  }
  document.documentElement.style.setProperty('--ek-hero-delay', DELAY / 1000 + 's');
  setInterval(function () {
    if (document.hidden) return;
    var heroes = document.querySelectorAll('.ek-hero');
    for (var i = 0; i < heroes.length; i++) {
      var h = heroes[i];
      if (!h.__last) { h.__last = Date.now(); continue; }
      if (h.__paused) continue;
      if (Date.now() - h.__last >= DELAY) go(h, current(h) + 1);
    }
  }, 250);
})();
