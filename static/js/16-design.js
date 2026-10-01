"use strict";

  /* =========================================================
     DIZAYN: BOSH SAHIFA SARLAVHASI YOZILISHI VA KURSOR
  ==========================================================*/
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The hero title types itself out letter by letter, waits 10 seconds,
  // erases itself and types the same slogan in the next language - Uzbek,
  // English, Russian, round and round - starting from the page language.
  // Only the slogan rotates; the rest of the page stays in the chosen
  // language, and screen readers always get it in that language.
  var HERO_LANGS = ['UZ', 'EN', 'RU'];
  var HERO_HOLD_MS = 10000;
  var heroTypeRun = 0;
  function heroTexts(lang){
    var d = (typeof t !== 'undefined' && t[lang]) || {};
    return [d.hero_title_1 || '', d.hero_title_2 || '', d.hero_title_em || ''];
  }
  function heroParts(){
    return ['heroTitle1', 'heroTitle2', 'heroTitleEm'].map(function(id){ return document.getElementById(id); });
  }
  function startHeroTitleLoop(){
    var parts = heroParts();
    if(parts.some(function(el){ return !el; })) return;
    var pageLang = (typeof currentLang !== 'undefined' && HERO_LANGS.indexOf(currentLang) !== -1) ? currentLang : 'UZ';
    parts[0].parentNode.setAttribute('aria-label', heroTexts(pageLang).join(' '));
    if(prefersReducedMotion) return;
    var run = ++heroTypeRun;
    var langIdx = HERO_LANGS.indexOf(pageLang);
    var oldCaret = document.querySelector('.hero-title .type-caret');
    if(oldCaret) oldCaret.remove();
    var caret = document.createElement('span');
    caret.className = 'type-caret';
    caret.setAttribute('aria-hidden', 'true');

    function later(ms, fn){ setTimeout(function(){ if(run === heroTypeRun) fn(); }, ms); }
    function typeText(texts, done){
      parts.forEach(function(el){ el.textContent = ''; });
      var part = 0, pos = 0;
      (function step(){
        while(part < parts.length && !texts[part]) part++;
        if(part >= parts.length){ done(); return; }
        pos++;
        parts[part].textContent = texts[part].slice(0, pos);
        parts[part].after(caret);
        var finishedPart = pos >= texts[part].length;
        if(finishedPart){ part++; pos = 0; }
        later(finishedPart ? 220 : 70, step);
      })();
    }
    function eraseText(done){
      (function step(){
        var last = -1;
        parts.forEach(function(el, i){ if(el.textContent) last = i; });
        if(last < 0){ done(); return; }
        parts[last].textContent = parts[last].textContent.slice(0, -1);
        parts[last].after(caret);
        later(30, step);
      })();
    }
    (function cycle(){
      typeText(heroTexts(HERO_LANGS[langIdx]), function(){
        later(HERO_HOLD_MS, function(){
          eraseText(function(){
            langIdx = (langIdx + 1) % HERO_LANGS.length;
            later(350, cycle);
          });
        });
      });
    })();
  }
  if(typeof applyLang === 'function'){
    var applyLangBeforeTyping = applyLang;
    applyLang = function(){
      applyLangBeforeTyping.apply(this, arguments);
      startHeroTitleLoop();
    };
  }
  startHeroTitleLoop();

  // Custom cursor: a small dot that follows the mouse exactly plus a ring
  // that trails it and grows over anything clickable. Mouse/trackpad only -
  // phones and tablets keep their normal touch behaviour.
  (function(){
    var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if(!finePointer) return;
    document.documentElement.classList.add('custom-cursor');
    var dot = document.createElement('div'), ring = document.createElement('div');
    dot.className = 'cursor-dot';
    ring.className = 'cursor-ring';
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    var x = -100, y = -100, rx = -100, ry = -100, animating = false;
    var CLICKABLE = 'a, button, [role="button"], .listing, .vip-card, .pill, .option-row, label, select, .leaflet-marker-icon';
    function render(){
      rx += (x - rx) * (prefersReducedMotion ? 1 : 0.2);
      ry += (y - ry) * (prefersReducedMotion ? 1 : 0.2);
      ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
      if(Math.abs(x - rx) > 0.1 || Math.abs(y - ry) > 0.1){ requestAnimationFrame(render); }
      else { animating = false; }
    }
    document.addEventListener('mousemove', function(e){
      x = e.clientX; y = e.clientY;
      dot.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      document.body.classList.add('cursor-on');
      var overClickable = !!(e.target.closest && e.target.closest(CLICKABLE));
      var overField = !!(e.target.closest && e.target.closest('input, textarea'));
      document.body.classList.toggle('cursor-hover', overClickable);
      // Text fields keep the normal I-beam caret; hide ours over them.
      dot.style.visibility = ring.style.visibility = overField ? 'hidden' : '';
      if(!animating){ animating = true; requestAnimationFrame(render); }
    }, {passive: true});
    document.addEventListener('mousedown', function(){ document.body.classList.add('cursor-down'); });
    document.addEventListener('mouseup', function(){ document.body.classList.remove('cursor-down'); });
    document.documentElement.addEventListener('mouseleave', function(){ document.body.classList.remove('cursor-on'); });
  })();
