"use strict";

  /* =========================================================
     HOME: VIP + oddiy grid
  ==========================================================*/
  function renderPublic(){
    var heroStat = document.getElementById('heroStatListings');
    if(heroStat) heroStat.textContent = listings.length || '—';
    var vipWrap = document.getElementById('vipScroll');
    var regWrap = document.getElementById('regularGrid');
    var filtered = listings.filter(function(l){ return matchesFilters(l, filterState); });
    var vip = filtered.filter(function(l){ return l.vip; });
    var regular = filtered.filter(function(l){ return !l.vip; });
    // TOP listings always show ahead of plain ones in the grid, even if
    // they were posted more recently than a TOP one (recency within each
    // group is preserved since sort() is stable).
    regular.sort(function(a,b){ return (b.top?1:0) - (a.top?1:0); });

    vipWrap.innerHTML = vip.length ? vip.map(function(l){
      return '<button class="vip-card" data-id="' + l.id + '">' +
        '<img src="' + l.img + '" alt="">' +
        '<div class="grad"></div>' +
        '<div class="vip-badge">★ VIP</div>' +
        (filterState.owner ? '<div class="owner-badge" style="top:44px;">' + displayName(l.seller) + '</div>' : '') +
        '<div class="vip-info"><div class="vip-price">' + formatPrice(l) + '</div>' +
        '<div class="vip-place">' + l.title + ' · ' + trValue(l.district) + '</div></div>' +
      '</button>';
    }).join('') : '<div class="empty-note">Hozircha VIP e\'lon yo\'q.</div>';

    if(!regular.length){
      regWrap.innerHTML = '<div class="empty-note">Hech qanday e\'lon topilmadi. Filtrlarni o\'zgartirib ko\'ring.</div>';
    } else {
      regWrap.innerHTML = regular.map(function(l){
        return '<button class="listing" data-id="' + l.id + '">' +
          '<div class="thumb"><img src="' + l.img + '" alt="">' +
            (l.sold ? '<div class="sold-sticker">SOTILDI</div>' : '') +
            (l.top ? '<div class="top-badge">▲ TOP</div>' : '') +
            // Shown only while the "Egasi" filter is on, so buyers can
            // see at a glance whose listing each card is - stacked below
            // the TOP badge when both apply, so they never overlap.
            (filterState.owner ? '<div class="owner-badge" style="top:' + (l.top ? '44px' : '12px') + ';">' + displayName(l.seller) + '</div>' : '') +
            '<div class="type-badge">' + trValue(l.type) + '</div>' +
          '</div>' +
          '<div class="body"><div class="price">' + formatPrice(l) + '</div>' +
          '<div class="desc">' + l.title + ', ' + trValue(l.district) + '</div>' +
          '<div class="meta"><span>' + l.seller + (isSellerVerified(l.seller) ? VERIFIED_TICK_HTML : '') + '</span></div></div>' +
        '</button>';
      }).join('');
    }

    document.getElementById('regularCount').textContent = regular.length;

    var cards = [];
    vipWrap.querySelectorAll('[data-id]').forEach(function(el){ cards.push(el); });
    regWrap.querySelectorAll('[data-id]').forEach(function(el){ cards.push(el); });
    cards.forEach(function(el){
      el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), false); });
    });
  }

