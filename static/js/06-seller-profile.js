"use strict";

  /* =========================================================
     SOTUVCHI PROFILI
  ==========================================================*/
  function openSellerProfile(sellerName, fromAdmin){
    sellerProfileFromAdmin = !!fromAdmin;
    var mine = listings.filter(function(l){ return l.seller===sellerName; });
    var meta = allProfilesDirectory.filter(function(p){ return p.username===sellerName; })[0];
    if(!mine.length && !meta) return; // truly unknown seller, nothing to show
    var vipCount = mine.filter(function(l){ return l.vip; }).length;
    var topCount = mine.filter(function(l){ return l.top && !l.vip; }).length;
    var regularCount = mine.length - vipCount - topCount;
    var role = mine.length ? mine[0].ownerRole : (meta ? meta.role : 'Foydalanuvchi');

    document.getElementById('sellerProfileContent').innerHTML =
      '<div class="seller-head-card"><div class="owner-avatar">'+sellerName.charAt(0).toUpperCase()+'</div>' +
      '<div><div class="owner-name" style="font-size:19px;">'+sellerName+((meta && meta.verified) ? VERIFIED_TICK_HTML : '')+'</div><div class="owner-role">'+role+'</div></div></div>' +
      '<div class="seller-stats">' +
        '<div class="sstat"><div class="n">'+mine.length+'</div><div class="l">Jami e\'lonlar</div></div>' +
        '<div class="sstat"><div class="n">'+regularCount+'</div><div class="l">Oddiy e\'lonlar</div></div>' +
        '<div class="sstat vip"><div class="n">'+vipCount+'</div><div class="l">VIP e\'lonlar</div></div>' +
        '<div class="sstat top"><div class="n">'+topCount+'</div><div class="l">TOP e\'lonlar</div></div>' +
      '</div><h3 style="margin-bottom:14px;">Barcha e\'lonlari</h3><div class="grid" id="sellerListingsGrid" style="padding:0;"></div>';

    var gridWrap = document.getElementById('sellerListingsGrid');
    gridWrap.innerHTML = mine.length ? mine.map(function(l){
      return '<div class="listing" data-id="'+l.id+'"><div class="thumb"><img src="'+l.img+'" alt="">' +
        (l.top ? '<div class="top-badge">▲ TOP</div>' : '') + '<div class="type-badge">'+trValue(l.type)+'</div></div>' +
        '<div class="body"><div class="price">'+formatPrice(l)+'</div><div class="desc">'+l.title+', '+trValue(l.district)+'</div>' +
        '<div class="meta"><span>'+(l.vip?'★ VIP':(l.top?'▲ TOP':'Oddiy'))+'</span></div></div></div>';
    }).join('') : '<div class="empty-note">Hali e\'lon joylamagan.</div>';
    gridWrap.querySelectorAll('[data-id]').forEach(function(el){
      el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), sellerProfileFromAdmin); });
    });
    showPage('pageSellerProfile');
  }
  function returnFromSellerProfile(){
    if(sellerProfileFromAdmin){ showPage('pageAdmin'); renderAdmin(); } else { showPage('pageHome'); renderPublic(); updateUrl('/'); }
  }

