"use strict";

  /* =========================================================
     DIZAYN: KURSOR
  ==========================================================*/
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
