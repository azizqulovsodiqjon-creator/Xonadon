"use strict";

  /* =========================================================
     DIZAYN: BOSH SAHIFA SARLAVHASI YOZILISHI VA KURSOR
  ==========================================================*/
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The hero title types itself out, letter by letter, on every page load
  // and again after a language switch. The three spans keep whatever text
  // applyLang() put in them - this only hides it and reveals it again.
  var heroTypeRun = 0;
  function typeHeroTitle(){
    var parts = ['heroTitle1', 'heroTitle2', 'heroTitleEm'].map(function(id){ return document.getElementById(id); });
    if(parts.some(function(el){ return !el; }) || prefersReducedMotion) return;
    var run = ++heroTypeRun;
    var texts = parts.map(function(el){ return el.textContent; });
    var oldCaret = document.querySelector('.hero-title .type-caret');
    if(oldCaret) oldCaret.remove();
    var caret = document.createElement('span');
    caret.className = 'type-caret';
    caret.setAttribute('aria-hidden', 'true');
    parts.forEach(function(el){ el.textContent = ''; });
    // Screen readers get the whole title at once, not letter by letter.
    parts[0].parentNode.setAttribute('aria-label', texts[0] + ' ' + texts[1] + ' ' + texts[2]);

    var part = 0, pos = 0;
    function step(){
      if(run !== heroTypeRun) return;  // a newer run (language switch) took over
      if(part >= parts.length) return;  // done - the caret stays and blinks
      pos++;
      parts[part].textContent = texts[part].slice(0, pos);
      parts[part].after(caret);
      if(pos >= texts[part].length){ part++; pos = 0; }
      setTimeout(step, part > 0 && pos === 0 ? 220 : 70);
    }
    step();
  }
  if(typeof applyLang === 'function'){
    var applyLangBeforeTyping = applyLang;
    applyLang = function(){
      applyLangBeforeTyping.apply(this, arguments);
      typeHeroTitle();
    };
  }
  typeHeroTitle();

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
