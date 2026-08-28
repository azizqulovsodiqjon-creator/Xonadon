(function(){
  "use strict";

  // Global xato aniqlash - har qanday JS xatosini konsolga chiqaradi
  window.addEventListener('error', function(e){
    console.error('GLOBAL XATO:', e.message, '| Fayl:', e.filename, '| Qator:', e.lineno);
  });

  /* =========================================================
     MA'LUMOTLAR BAZASI
  ==========================================================*/
  var listings = [];
  var nextListingId = 1;
  var adminTab = "listings";
  var lastPage = "pageHome";
  var currentMap = null, mapInitToken = 0;
  var currentLang = "UZ";
  var isLoggedIn = false, pendingAction = null;
  // /panel/ is the hidden admin-only entry point: it must NEVER reveal
  // the public site (not behind the login modal, not after closing it,
  // not after logging out) - only the login form, or the admin panel
  // once actually logged in.
  var PANEL_ROUTE = location.pathname.replace(/\/+$/, '') === '/panel';
  var currentProfile = null; // the full Profile record (id/phone/username/...) for the logged-in user
  // Global price display currency - у.е or so'm, independent of what
  // currency each individual listing was actually posted in. See
  // formatOnePrice() below, which does the actual conversion.
  var displayCurrency = (function(){ try{ return localStorage.getItem('displayCurrency') || 'ye'; }catch(e){ return 'ye'; } })();
  var usdUzsRate = null;
  var CURRENCY_RATE_API = '/api/currency-rate/';
  function loadCurrencyRate(cb){
    fetch(CURRENCY_RATE_API).then(function(r){ return r.json(); }).then(function(d){
      if(d.ok && d.rate) usdUzsRate = d.rate;
      if(cb) cb();
    }).catch(function(err){ console.error('currency rate xato:', err); if(cb) cb(); });
  }
  var TELEGRAM_START_API = '/api/telegram/start/';
  var TELEGRAM_STATUS_API = '/api/telegram/status/';
  var TELEGRAM_VERIFY_API = '/api/telegram/verify/';
  var GOOGLE_AUTH_API = '/api/auth/google/';
  var SIMPLE_REGISTER_API = '/api/auth/simple-register/';
  var telegramVerifyToken = null, telegramDeepLink = null, telegramPollTimer = null;
  function stopTelegramPoll(){
    if(telegramPollTimer){ clearInterval(telegramPollTimer); telegramPollTimer = null; }
  }
  var sellerProfileFromAdmin = false;

  var filterState = {type:'all', owner:false, mortgage:false, lastWeek:false, lastMonth:false, deal:null, search:'', priceMin:null, priceMax:null, rooms:null, district:null};
  var API_BASE = '/api/listings/';
  var LISTING_IMAGES_API = '/api/listing-images/';
  function recordListingView(id){
    // Only count once per BROWSER (localStorage, not sessionStorage) -
    // closing the tab/app and opening the same listing again shouldn't
    // keep incrementing the view count every single time.
    var seen;
    try{ seen = JSON.parse(localStorage.getItem('xonadonViewedIds') || '[]'); }catch(e){ seen = []; }
    if(seen.indexOf(id) !== -1) return;
    seen.push(id);
    // Cap how many ids we remember so this can't grow forever for a
    // heavy browser - drop the oldest once it gets large.
    if(seen.length > 2000) seen = seen.slice(seen.length - 2000);
    try{ localStorage.setItem('xonadonViewedIds', JSON.stringify(seen)); }catch(e){}
    fetch(API_BASE + id + '/view_hit/', {method:'POST'}).catch(function(err){ console.error('view_hit xato:', err); });
  }
  function likeListing(id, cb){
    fetch(API_BASE + id + '/like/', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username: myUsername()})
    }).then(function(r){ return r.json(); }).then(function(data){
      if(data.ok && !data.alreadyLiked) myLikedIds.push(id);
      if(cb) cb(data.likes_count, data.alreadyLiked);
    }).catch(function(err){ console.error('like xato:', err); });
  }
  var myLikedIds = [];
  function loadMyLikes(cb){
    if(!isLoggedIn){ myLikedIds = []; if(cb) cb(); return; }
    fetch(MY_LIKES_API + '?username=' + encodeURIComponent(myUsername()))
      .then(function(r){ return r.json(); })
      .then(function(data){ myLikedIds = (data.listingIds || []); if(cb) cb(); })
      .catch(function(err){ console.error('my likes xato:', err); if(cb) cb(); });
  }
  var PROFILE_API = '/api/profiles/';
  var MY_LIKES_API = '/api/likes/mine/';
  var PROFILES_DIRECTORY_API = '/api/profiles/directory/';
  var ADMIN_LOGIN_API = '/api/admin/login/';
  var ADMIN_LOGOUT_API = '/api/admin/logout/';
  var SEND_MESSAGE_API = '/api/messages/send/';
  var MESSAGE_THREAD_API = '/api/messages/thread/';
  var MESSAGE_CONVERSATIONS_API = '/api/messages/conversations/';
  var SUBMIT_VERIFICATION_API = '/api/verification/submit/';
  var VERIFICATION_STATUS_API = '/api/verification/status/';
  var ADMIN_VERIFICATION_REQUESTS_API = '/api/admin/verification-requests/';
  var viewMode = 'grid';
  var allProfilesDirectory = []; // every registered user (username/full_name/role) - no phone
  var currentThreadWith = null;
  function myUsername(){ return document.getElementById('profileUsername').textContent.trim(); }

  // Django's CSRF cookie, read so write requests (POST/PATCH/DELETE) can
  // send it back as the X-CSRFToken header - required once a session is
  // authenticated (admin login/logout/delete).
  function getCookie(name){
    var match = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return match ? decodeURIComponent(match[1]) : null;
  }
  function csrfHeaders(extra){
    var h = extra || {};
    var token = getCookie('csrftoken');
    if(token) h['X-CSRFToken'] = token;
    return h;
  }

  /* =========================================================
     KICHIK YORDAMCHI FUNKSIYALAR
  ==========================================================*/
  function toast(msg){
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(function(){ t.classList.remove('show'); }, 2200);
  }
  function openModal(id){ document.getElementById(id).classList.add('show'); }
  function closeModal(id){ document.getElementById(id).classList.remove('show'); }
  function findListing(id){ for(var i=0;i<listings.length;i++){ if(listings[i].id===id) return listings[i]; } return null; }
  // A buyer's "qidiryapman" listing has no photos of its own - shown
  // instead of a broken/empty <img> wherever a listing's photo goes.
  var WANTED_PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
    '<rect width="200" height="200" fill="#e9ebf0"/>' +
    '<circle cx="85" cy="85" r="42" fill="none" stroke="#a3a9b8" stroke-width="10"/>' +
    '<line x1="116" y1="116" x2="156" y2="156" stroke="#a3a9b8" stroke-width="10" stroke-linecap="round"/>' +
    '</svg>'
  );
  function mapListing(item){
    var imgs = (item.images && item.images.length) ? item.images.map(function(im){ return im.image; }) : [];
    var isWanted = !!item.is_wanted;
    return {
      id: item.id, price: item.price, currency: item.currency || 'ye', title: item.title, desc: item.desc,
      district: item.district, lat: item.lat, lng: item.lng, rooms: item.rooms,
      area: item.area, floor: item.floor, type: item.type, typeKey: item.type_key,
      repair: item.repair, condition: item.condition, phone: item.phone,
      seller: item.seller, ownerRole: item.owner_role, owner: item.owner,
      mortgage: item.mortgage, daysAgo: 0, deal: item.deal, vip: item.vip, top: item.top,
      sold: item.sold, viewsCount: item.views_count || 0, likesCount: item.likes_count || 0,
      photos: imgs.length ? imgs : (isWanted ? [WANTED_PLACEHOLDER_IMG] : []),
      img: imgs.length ? imgs[0] : (isWanted ? WANTED_PLACEHOLDER_IMG : ''),
      voiceNote: item.voice_note ? {id: item.voice_note.id, url: item.voice_note.audio} : null,
      isWanted: isWanted
    };
  }
  function loadListings(cb){
    fetch(API_BASE).then(function(r){ return r.json(); }).then(function(data){
      listings = data.map(mapListing);
      if(cb){ cb(); } else { renderPublic(); }
    }).catch(function(err){ console.error('loadListings xato:', err); toast("Yuklashda xato yuz berdi."); });
  }
  function showPage(id){
    var pages = document.querySelectorAll('.page');
    for(var i=0;i<pages.length;i++){ pages[i].classList.remove('show'); }
    document.getElementById(id).classList.add('show');
    window.scrollTo(0,0);
    setMobileTab(id === 'pageHome' ? 'Home' : id === 'pagePost' ? 'Post' : id === 'pageMyProfile' ? 'Profile' : null);
  }
  // Keeps the mobile bottom tab bar's highlighted icon in sync with
  // whatever page/section is actually showing - name is one of
  // 'Home'/'Search'/'Post'/'Messages'/'Profile', or null to clear all
  // (browsing a listing detail, admin, etc. - none of the 5 tabs apply).
  function setMobileTab(name){
    document.querySelectorAll('.mtab').forEach(function(t){ t.classList.remove('active'); });
    if(name){
      var el = document.getElementById('mtab' + name);
      if(el) el.classList.add('active');
    }
  }
  function priceNum(str){ return parseInt(String(str).replace(/\s/g,''),10) || 0; }
  function getPhotos(l){ return (l.photos && l.photos.length) ? l.photos : [l.img, l.img2, l.img3].filter(Boolean); }
  function displayName(handle){ return handle.replace(/_/g,' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); }); }
  function formatOnePrice(sourceCur, value){
    // The header currency toggle (у.е / so'm) overrides how EVERY price
    // displays, regardless of which currency it was actually posted in -
    // 'usd' and 'ye' are both always treated as 1:1 with each other
    // locally (the standard Uzbekistan real-estate convention), so only
    // so'm<->у.е ever needs the live CBU rate to convert.
    var num = parseFloat(String(value).replace(/[^\d.]/g,'')) || 0;
    var usdEquivalent = (sourceCur === 'uzs') ? (usdUzsRate ? num / usdUzsRate : num) : num;
    if(displayCurrency === 'uzs'){
      var som = (sourceCur === 'uzs') ? num : (usdUzsRate ? usdEquivalent * usdUzsRate : num);
      return Math.round(som).toLocaleString('ru-RU') + " so'm";
    }
    var rounded = Math.round(usdEquivalent * 100) / 100;
    return (rounded % 1 === 0 ? rounded : rounded.toFixed(2)) + ' у.е';
  }
  function formatPrice(l){
    var cur = (l && l.currency) || 'ye';
    if(l && l.isWanted){
      // A buyer's listing stores its budget as "min~max" in the same
      // `price` field (see PRICE_RANGE_SEP) - show it as a range instead
      // of a single number.
      var parts = String(l.price || '').split(PRICE_RANGE_SEP);
      if(parts.length === 2) return formatOnePrice(cur, parts[0]) + ' – ' + formatOnePrice(cur, parts[1]);
    }
    return formatOnePrice(cur, l.price);
  }
  var VERIFIED_TICK_HTML = ' <span class="verified-tick" title="Tasdiqlangan">✓</span>';
  function isSellerVerified(username){
    var meta = allProfilesDirectory.filter(function(p){ return p.username===username; })[0];
    return !!(meta && meta.verified);
  }

  function sellersSummary(){
    var map = {};
    listings.forEach(function(l){
      if(!map[l.seller]) map[l.seller] = {name:l.seller, count:0, vip:0, top:0, regular:0, role:l.ownerRole};
      map[l.seller].count++;
      if(l.vip) map[l.seller].vip++;
      else if(l.top) map[l.seller].top++;
      else map[l.seller].regular++;
    });
    return Object.keys(map).map(function(k){ return map[k]; });
  }
  function loadProfilesDirectory(cb){
    fetch(PROFILES_DIRECTORY_API).then(function(r){ return r.json(); }).then(function(data){
      allProfilesDirectory = data;
      if(cb) cb();
    }).catch(function(err){ console.error('profiles directory xato:', err); if(cb) cb(); });
  }
  // Every registered user should show up in "Profil qidirish", whether or
  // not they've posted a listing yet - merge the listing-derived stats
  // with the full user directory (0 e'lon for those with none).
  function combinedSellers(){
    var map = {};
    sellersSummary().forEach(function(s){ map[s.name] = s; });
    allProfilesDirectory.forEach(function(p){
      if(!map[p.username]){
        map[p.username] = {name:p.username, count:0, vip:0, top:0, regular:0, role:p.role};
      }
    });
    return Object.keys(map).map(function(k){ return map[k]; });
  }

  /* =========================================================
     FILTRLASH
  ==========================================================*/
  function matchesFilters(p, state){
    if(state.deal && p.deal !== state.deal) return false;
    if(state.type !== 'all' && p.typeKey !== state.type) return false;
    if(state.owner && !p.owner) return false;
    if(state.mortgage && !p.mortgage) return false;
    if(state.lastWeek && p.daysAgo > 7) return false;
    if(state.lastMonth && p.daysAgo > 30) return false;
    if(state.priceMin != null && priceNum(p.price) < state.priceMin) return false;
    if(state.priceMax != null && priceNum(p.price) > state.priceMax) return false;
    if(state.rooms != null && (!p.rooms || p.rooms < state.rooms)) return false;
    if(state.district && p.district !== state.district) return false;
    if(state.search){
      var q = state.search.toLowerCase();
      var hay = (p.title + ' ' + p.district + ' ' + p.desc).toLowerCase();
      if(hay.indexOf(q) === -1) return false;
    }
    return true;
  }

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

  /* =========================================================
     UY TAFSILOTLARI SAHIFASI
  ==========================================================*/
  var galleryPhotos = [], galleryIndex = 0;
  var detailRouteLine = null;

  function floorRows(l){
    var dict = t[currentLang] || t.UZ;
    if(l.floor && l.floor.indexOf('/') !== -1){
      var parts = l.floor.split('/');
      return '<div class="info-row"><span class="il">' + dict.floor_label + '</span><span class="iv">' + parts[0] + '</span></div>' +
             '<div class="info-row"><span class="il">' + dict.floors_total_label + '</span><span class="iv">' + parts[1] + '</span></div>';
    }
    return '<div class="info-row"><span class="il">' + dict.floor_label + '</span><span class="iv">' + (l.floor || '—') + '</span></div>';
  }

  var currentDetailListing = null; // {id, fromAdmin} while pageDetail is showing - lets applyLang() below refresh its translated text without re-opening it (which would double-count the view)
  function openDetail(id, fromAdmin, isTranslationRefresh){
    var l = findListing(id);
    if(!l) return;
    lastPage = fromAdmin ? 'pageAdmin' : 'pageHome';
    currentDetailListing = {id: id, fromAdmin: fromAdmin};
    galleryPhotos = getPhotos(l);
    galleryIndex = 0;
    if(!isTranslationRefresh){
      l.viewsCount++; // reflect this open immediately, before rendering
    }
    var dict = t[currentLang] || t.UZ;
    var roomsRow = l.rooms ? '<div class="info-row"><span class="il">' + dict.rooms_count + '</span><span class="iv">' + l.rooms + '</span></div>' : '';
    // Calling/messaging yourself makes no sense - hide those two
    // buttons entirely when the viewer owns this listing.
    var isOwnListing = !!(l.seller && myUsername() && l.seller === myUsername());

    document.getElementById('detailContent').innerHTML =
      '<div class="detail-top-row">' +
        '<div style="position:relative;">' +
          (l.sold ? '<div class="sold-sticker">SOTILDI</div>' : '') +
          '<div class="gallery-main"><img id="galleryMainImg" src="' + galleryPhotos[0] + '" alt="">' +
            (galleryPhotos.length > 1 ? '<button class="gallery-arrow prev" id="galleryPrev">‹</button><button class="gallery-arrow next" id="galleryNext">›</button><div class="gallery-counter" id="galleryCounter">1/' + galleryPhotos.length + '</div>' : '') +
          '</div>' +
          (galleryPhotos.length > 1 ? '<div class="gallery-thumbs" id="galleryThumbs">' + galleryPhotos.map(function(src,i){ return '<img data-i="'+i+'" src="'+src+'" class="'+(i===0?'active':'')+'">'; }).join('') + '</div>' : '') +
        '</div>' +
        '<div class="detail-actions-panel">' +
          '<div class="action-tags">' +
            (l.vip ? '<span class="detail-tag gold">★ VIP</span>' : '') +
            (l.top ? '<span class="detail-tag top">▲ TOP</span>' : '') +
            '<span class="detail-tag">' + trValue(l.type) + '</span>' +
          '</div>' +
          '<div class="view-like-row"><span class="view-count">👁 ' + l.viewsCount + ' ko\'rildi</span><button class="like-btn" id="detailLikeBtn"' + (myLikedIds.indexOf(l.id)!==-1 ? ' disabled' : '') + '>' + (myLikedIds.indexOf(l.id)!==-1 ? '❤️' : '🤍') + ' <span id="detailLikeCount">' + l.likesCount + '</span></button></div>' +
          (isOwnListing ? '' : '<div class="action-btns-row"><button class="action-btn outline" id="msgSellerBtn">' + dict.msg_seller + '</button><button class="action-btn filled" id="callSellerBtn">' + dict.call_seller + '</button></div>') +
        '</div>' +
      '</div>' +
      '<div class="detail-title-block">' +
        '<div class="detail-price">' + formatPrice(l) + '</div>' +
        '<div class="detail-title">' + l.title + '</div>' +
        '<div class="location-row"><span class="pin">📍</span>' + trValue(l.district) + '</div>' +
      '</div>' +
      '<div class="detail-section"><h3>' + dict.desc + '</h3><div class="detail-desc-text">' + l.desc + '</div></div>' +
      (l.voiceNote ? '<div class="detail-section"><h3>🎤 Ovozli xabar</h3><audio controls src="' + l.voiceNote.url + '" style="width:100%;"></audio></div>' : '') +
      '<div class="detail-section"><div class="info-list">' +
        '<div class="info-row"><span class="il">' + dict.posted_by + '</span><span class="iv">' + trValue(l.ownerRole) + '</span></div>' +
        '<div class="info-row"><span class="il">' + dict.property_type + '</span><span class="iv">' + trValue(l.type) + '</span></div>' +
        // A buyer's "qidiryapman" listing has no rooms/floor/area/repair
        // of its own to show - it's a budget, not a property.
        (l.isWanted ? '' : (roomsRow + floorRows(l) +
        '<div class="info-row"><span class="il">' + dict.area_label + '</span><span class="iv">' + l.area + '</span></div>' +
        '<div class="info-row"><span class="il">' + dict.repair_label + '</span><span class="iv">' + trValue(l.repair) + '</span></div>')) +
      '</div></div>' +
      '<div class="detail-section">' +
        '<div class="section-head-row"><h3 style="margin:0;">' + dict.location + '</h3></div>' +
        '<div class="location-row2"><span class="pin">📍</span>' + trValue(l.district) + '</div>' +
        '<div class="map-box" id="detailMap"></div>' +
        '<div class="map-caption">Jizzax viloyati xaritasida taxminiy joylashuv ko\'rsatilgan.</div>' +
        '<button class="action-btn filled" id="detailRouteBtn" style="margin-top:12px;width:100%;">' + dict.show_route + '</button>' +
      '</div>' +
      '<div class="owner-card">' +
        '<div class="owner-avatar">' + l.seller.charAt(0).toUpperCase() + '</div>' +
        '<div><div class="owner-name">' + l.seller + (isSellerVerified(l.seller) ? VERIFIED_TICK_HTML : '') + '</div><div class="owner-role">' + trValue(l.ownerRole) + '</div></div>' +
        '<button class="owner-contact-btn" id="viewSellerProfileBtn">' + dict.view_profile + '</button>' +
      '</div>' +
      '<div class="similar-section" id="similarSection"></div>';

    showPage('pageDetail');
    initDetailMap(l);
    initGallery();
    renderSimilarListings(l);
    if(!isTranslationRefresh){
      recordListingView(l.id);
    }

    var likeBtn = document.getElementById('detailLikeBtn');
    if(likeBtn){
      likeBtn.addEventListener('click', function(){
        if(likeBtn.disabled) return;
        requireAuth(function(){
          likeBtn.disabled = true;
          likeBtn.innerHTML = '❤️ <span id="detailLikeCount">' + (l.likesCount + 1) + '</span>';
          likeListing(l.id, function(newCount){
            l.likesCount = (newCount != null) ? newCount : l.likesCount + 1;
            document.getElementById('detailLikeCount').textContent = l.likesCount;
          });
        });
      });
    }

    var vBtn = document.getElementById('viewSellerProfileBtn');
    if(vBtn){ vBtn.addEventListener('click', function(){ openSellerProfile(l.seller, fromAdmin); }); }

    var callBtn = document.getElementById('callSellerBtn');
    if(callBtn){
      callBtn.addEventListener('click', function(){
        if(l.phone){
          toast("Telefon: " + l.phone);
          callBtn.textContent = l.phone;
          window.location.href = 'tel:' + l.phone;
        } else { toast("Telefon raqami ko'rsatilmagan."); }
      });
    }
    var msgBtn = document.getElementById('msgSellerBtn');
    if(msgBtn){
      msgBtn.addEventListener('click', function(){
        requireAuth(function(){ openMessageThread(l.seller); });
      });
    }
    var detailRouteBtn = document.getElementById('detailRouteBtn');
    if(detailRouteBtn){
      detailRouteBtn.addEventListener('click', function(){
        if(!currentMap){ toast("Xarita hali yuklanmadi."); return; }
        routeTargetListing = l;
        detailRouteBtn.textContent = "Joylashuv aniqlanmoqda...";
        startLiveLocation(function(){
          if(userLat == null){ toast("Joylashuvingiz aniqlanmadi. Brauzer ruxsatini tekshiring."); detailRouteBtn.textContent = "Yo'nalishni ko'rsatish"; return; }
          updateUserMarkerOnMap(currentMap);
          detailRouteBtn.textContent = "Yo'nalish qidirilmoqda...";
          fetchRoute(userLat, userLng, l.lat, l.lng, function(coords, km){
            if(detailRouteLine){ currentMap.removeLayer(detailRouteLine); }
            detailRouteLine = L.polyline(coords, {color:'#fdf90e', weight:6, opacity:0.9}).addTo(currentMap);
            currentMap.fitBounds(detailRouteLine.getBounds(), {padding:[40,40]});
            detailRouteBtn.textContent = "Masofa: " + km + " km";
          }, function(){
            toast("Yo'nalishni topib bo'lmadi.");
            detailRouteBtn.textContent = "Yo'nalishni ko'rsatish";
          });
        });
      });
    }
  }

  function initGallery(){
    var prevBtn = document.getElementById('galleryPrev'), nextBtn = document.getElementById('galleryNext');
    if(prevBtn) prevBtn.addEventListener('click', function(){ goToPhoto(galleryIndex-1); });
    if(nextBtn) nextBtn.addEventListener('click', function(){ goToPhoto(galleryIndex+1); });
    var thumbs = document.getElementById('galleryThumbs');
    if(thumbs){ thumbs.querySelectorAll('img').forEach(function(t){ t.addEventListener('click', function(){ goToPhoto(Number(this.getAttribute('data-i'))); }); }); }
  }
  function goToPhoto(i){
    if(i<0) i = galleryPhotos.length-1;
    if(i>=galleryPhotos.length) i = 0;
    galleryIndex = i;
    document.getElementById('galleryMainImg').src = galleryPhotos[i];
    var counter = document.getElementById('galleryCounter');
    if(counter) counter.textContent = (i+1)+'/'+galleryPhotos.length;
    var thumbs = document.getElementById('galleryThumbs');
    if(thumbs){ thumbs.querySelectorAll('img').forEach(function(t){ t.classList.toggle('active', Number(t.getAttribute('data-i'))===i); }); }
  }

  function renderSimilarListings(l){
    var wrap = document.getElementById('similarSection');
    if(!wrap) return;
    var basePrice = priceNum(l.price), baseArea = l.area || 0;
    var scored = listings.filter(function(o){ return o.id !== l.id; }).map(function(o){
      var pd = Math.abs(priceNum(o.price)-basePrice)/(basePrice||1);
      var ad = Math.abs((o.area||0)-baseArea)/(baseArea||1);
      return {item:o, score:pd+ad};
    }).sort(function(a,b){ return a.score-b.score; }).slice(0,4).map(function(s){ return s.item; });
    if(!scored.length){ wrap.innerHTML=''; return; }
    wrap.innerHTML = '<h3>Narxi va maydoniga o\'xshash uylar</h3><div class="similar-scroll">' +
      scored.map(function(o){
        return '<button class="similar-card" data-id="'+o.id+'"><div class="thumb"><img src="'+o.img+'" alt=""></div>' +
          '<div class="body"><div class="price">'+formatPrice(o)+'</div><div class="desc">'+o.title+', '+o.district+'</div></div></button>';
      }).join('') + '</div>';
    wrap.querySelectorAll('[data-id]').forEach(function(el){
      el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), lastPage==='pageAdmin'); });
    });
  }

  function initDetailMap(l){
    if(currentMap){ try{ currentMap.remove(); }catch(e){} currentMap=null; }
    detailRouteLine = null;
    mapInitToken++;
    var myToken = mapInitToken;
    setTimeout(function(){
      if(myToken !== mapInitToken) return;
      var mapEl = document.getElementById('detailMap');
      if(!mapEl) return;
      if(typeof L === 'undefined'){ mapEl.innerHTML = '<div class="map-fallback">Xarita kutubxonasi yuklanmadi.</div>'; return; }
      try{
        currentMap = L.map(mapEl, {scrollWheelZoom:false, minZoom:8, maxBounds:JIZZAX_BOUNDS, maxBoundsViscosity:1.0}).setView([l.lat,l.lng],13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:18}).addTo(currentMap);
        L.marker([l.lat,l.lng]).addTo(currentMap).bindPopup(l.title+'<br>'+trValue(l.district)).openPopup();
        setTimeout(function(){ if(currentMap) currentMap.invalidateSize(); },200);
      }catch(err){ mapEl.innerHTML = '<div class="map-fallback">Xaritani yuklab bo\'lmadi.</div>'; }
    },60);
  }

  function returnFromDetail(){
    if(currentMap){ try{ currentMap.remove(); }catch(e){} currentMap=null; }
    stopLiveLocationIfUnused();
    if(lastPage==='pageAdmin'){ showPage('pageAdmin'); renderAdmin(); } else { showPage('pageHome'); renderPublic(); }
  }

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
    if(sellerProfileFromAdmin){ showPage('pageAdmin'); renderAdmin(); } else { showPage('pageHome'); renderPublic(); }
  }

  /* =========================================================
     XABARLAR (ichki xabarlashish)
  ==========================================================*/
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function formatMsgTime(iso){
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('uz-UZ', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
  }
  function renderThreadMessages(list){
    var me = myUsername();
    var wrap = document.getElementById('threadMessages');
    if(!list.length){ wrap.innerHTML = '<div class="empty-note">Hozircha xabar yo\'q. Birinchi bo\'lib yozing!</div>'; return; }
    wrap.innerHTML = list.map(function(m){
      var mine = m.sender === me;
      return '<div class="msg-bubble ' + (mine?'mine':'theirs') + '">' + escapeHtml(m.text) +
        '<span class="msg-time">' + formatMsgTime(m.created_at) + '</span></div>';
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }
  function openMessageThread(otherUsername){
    currentThreadWith = otherUsername;
    document.getElementById('threadWithName').innerHTML = escapeHtml(displayName(otherUsername)) + (isSellerVerified(otherUsername) ? VERIFIED_TICK_HTML : '');
    document.getElementById('threadInput').value = '';
    document.getElementById('threadMessages').innerHTML = '<div class="empty-note">Yuklanmoqda...</div>';
    var panels = document.querySelectorAll('.side-panel.open');
    panels.forEach(function(p){ p.classList.remove('open'); });
    document.getElementById('messageThreadPanel').classList.add('open');
    document.getElementById('backdrop').classList.add('open');
    fetch(MESSAGE_THREAD_API + '?me=' + encodeURIComponent(myUsername()) + '&with=' + encodeURIComponent(otherUsername))
      .then(function(r){ return r.json(); })
      .then(function(list){ renderThreadMessages(list); updateNotifBadge(); })
      .catch(function(err){ console.error('message thread xato:', err); toast('Xabarlarni yuklashda xato yuz berdi.'); });
  }
  function sendThreadMessage(){
    var input = document.getElementById('threadInput');
    var text = input.value.trim();
    if(!text || !currentThreadWith) return;
    fetch(SEND_MESSAGE_API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify({sender: myUsername(), receiver: currentThreadWith, text: text})
    }).then(function(r){ return r.json(); }).then(function(){
      input.value = '';
      openMessageThread(currentThreadWith);
    }).catch(function(err){ console.error('send message xato:', err); toast("Xabar yuborishda xato yuz berdi."); });
  }
  function renderConversationsList(targetId){
    var wrap = document.getElementById(targetId || 'xabarlarList');
    if(!wrap) return;
    fetch(MESSAGE_CONVERSATIONS_API + '?me=' + encodeURIComponent(myUsername()))
      .then(function(r){ return r.json(); })
      .then(function(list){
        if(!list.length){ wrap.innerHTML = '<div class="empty-state"><div class="emoji-box">💬</div><p>Hozircha xabarlar yo\'q</p></div>'; return; }
        wrap.innerHTML = list.map(function(c){
          return '<div class="conv-row" data-with="' + c.username + '">' +
            '<div class="ps-avatar"></div>' +
            '<div style="flex:1;"><div class="conv-name-row"><span class="ps-name">' + displayName(c.username) + (isSellerVerified(c.username) ? VERIFIED_TICK_HTML : '') + '</span>' +
              (c.unread ? '<span class="conv-unread">' + c.unread + '</span>' : '') + '</div>' +
            '<div class="conv-preview">' + escapeHtml(c.lastText || '') + '</div></div></div>';
        }).join('');
        wrap.querySelectorAll('[data-with]').forEach(function(row){
          // openMessageThread already closes every open side-panel itself.
          row.addEventListener('click', function(){ openMessageThread(this.getAttribute('data-with')); });
        });
      }).catch(function(err){ console.error('conversations xato:', err); });
  }
  function updateNotifBadge(){
    var badge = document.getElementById('notifBadge');
    if(!badge || !isLoggedIn) return;
    fetch(MESSAGE_CONVERSATIONS_API + '?me=' + encodeURIComponent(myUsername()))
      .then(function(r){ return r.json(); })
      .then(function(list){
        var total = list.reduce(function(sum, c){ return sum + (c.unread || 0); }, 0);
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.classList.toggle('hidden', total === 0);
      }).catch(function(err){ console.error('notif badge xato:', err); });
  }

  /* =========================================================
     TO'LIQ XARITA KO'RINISHI
  ==========================================================*/
  var fullMap = null, fullMapToken = 0;
  var userLat = null, userLng = null, userMarker = null, routeLine = null;
  var geoWatchId = null, routeTargetListing = null;

  function fetchRoute(fromLat, fromLng, toLat, toLng, onSuccess, onError){
    var url = 'https://router.project-osrm.org/route/v1/driving/' + fromLng + ',' + fromLat + ';' + toLng + ',' + toLat + '?overview=full&geometries=geojson';
    fetch(url).then(function(r){ return r.json(); }).then(function(data){
      if(data && data.routes && data.routes.length){
        var route = data.routes[0];
        var coords = route.geometry.coordinates.map(function(c){ return [c[1], c[0]]; });
        var km = (route.distance / 1000).toFixed(1);
        onSuccess(coords, km);
      } else {
        onError();
      }
    }).catch(function(err){ console.error('Marshrut xatosi:', err); onError(); });
  }

  function updateUserMarkerOnMap(mapObj){
    if(!mapObj || userLat == null) return;
    if(userMarker){ try{ mapObj.removeLayer(userMarker); }catch(e){} }
    var icon = L.divIcon({className:'', html:'<div class="user-location-pin"></div>', iconSize:[16,16]});
    userMarker = L.marker([userLat, userLng], {icon:icon}).addTo(mapObj).bindPopup('Siz shu yerdasiz');
  }

  function startLiveLocation(cb){
    if(!navigator.geolocation){ if(cb) cb(); return; }
    if(geoWatchId != null){ if(userLat != null && cb) cb(); return; }
    geoWatchId = navigator.geolocation.watchPosition(function(pos){
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      if(fullMap){ updateUserMarkerOnMap(fullMap); }
      if(currentMap){ updateUserMarkerOnMap(currentMap); }
      if(routeTargetListing && (fullMap || currentMap)){
        var activeMap = fullMap || currentMap;
        fetchRoute(userLat, userLng, routeTargetListing.lat, routeTargetListing.lng, function(coords, km){
          if(fullMap){
            if(routeLine){ fullMap.removeLayer(routeLine); }
            routeLine = L.polyline(coords, {color:'#fdf90e', weight:6, opacity:0.9}).addTo(fullMap);
            toast("Masofa: " + km + " km");
          }
          if(currentMap){
            if(detailRouteLine){ currentMap.removeLayer(detailRouteLine); }
            detailRouteLine = L.polyline(coords, {color:'#fdf90e', weight:6, opacity:0.9}).addTo(currentMap);
            var btn = document.getElementById('detailRouteBtn');
            if(btn) btn.textContent = "Masofa: " + km + " km";
          }
        }, function(){});
      }
      if(cb){ cb(); cb = null; }
    }, function(err){ console.error('Joylashuv xatosi:', err); if(cb){ cb(); cb = null; } }, {enableHighAccuracy:true, maximumAge:5000});
  }

  function requestUserLocation(cb){ startLiveLocation(cb); }

  function drawRouteToListing(l){
    routeTargetListing = l;
    toast("Joylashuvingiz aniqlanmoqda...");
    startLiveLocation(function(){
      if(userLat == null){ toast("Joylashuvingiz aniqlanmadi. Brauzer ruxsatini tekshiring."); return; }
      fetchRoute(userLat, userLng, l.lat, l.lng, function(coords, km){
        if(routeLine){ fullMap.removeLayer(routeLine); routeLine = null; }
        routeLine = L.polyline(coords, {color:'#fdf90e', weight:6, opacity:0.9}).addTo(fullMap);
        toast("Masofa: " + km + " km");
        fullMap.fitBounds(routeLine.getBounds(), {padding:[50,50]});
      }, function(){
        toast("Yo'nalishni topib bo'lmadi.");
      });
    });
  }

  function doMapSearch(){
    var q = document.getElementById('mapSearchInput').value.trim();
    if(!q || !fullMap) return;
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q + ', Jizzax, Uzbekiston'))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if(data && data.length){
          fullMap.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 15);
        } else {
          toast("Joy topilmadi.");
        }
      }).catch(function(err){ console.error('Qidiruv xatosi:', err); toast("Qidirishda xato yuz berdi."); });
  }

  function openMapFull(){
    showPage('pageMapFull');
    fullMapToken++;
    var myToken = fullMapToken;
    routeTargetListing = null;
    setTimeout(function(){
      if(myToken !== fullMapToken) return;
      if(fullMap){ try{ fullMap.remove(); }catch(e){} fullMap=null; }
      var el = document.getElementById('mapFull');
      if(!el || typeof L === 'undefined') return;
      fullMap = L.map(el, {minZoom:9, maxBounds:JIZZAX_BOUNDS, maxBoundsViscosity:1.0}).setView(JIZZAX_CENTER, 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:'© OpenStreetMap', maxZoom:18}).addTo(fullMap);
      var visible = listings.filter(function(l){ return matchesFilters(l, filterState); });
      visible.forEach(function(l){
        var icon = L.divIcon({className:'', html:'<div class="leaflet-price-pin">'+formatPrice(l)+'</div>', iconSize:[0,0]});
        var m = L.marker([l.lat, l.lng], {icon:icon}).addTo(fullMap);
        var popupEl = document.createElement('div');
        popupEl.innerHTML = '<b>'+l.title+'</b><br>'+trValue(l.district)+'<br><span class="map-popup-link" data-a="detail">Batafsil</span> · <span class="map-popup-link" data-a="route">Yo\'nalish</span>';
        popupEl.querySelector('[data-a="detail"]').addEventListener('click', function(){ openDetail(l.id, false); });
        popupEl.querySelector('[data-a="route"]').addEventListener('click', function(){ drawRouteToListing(l); });
        m.bindPopup(popupEl);
      });
      startLiveLocation(function(){ updateUserMarkerOnMap(fullMap); });
      setTimeout(function(){ if(fullMap) fullMap.invalidateSize(); }, 100);
    }, 60);
  }

  function stopLiveLocationIfUnused(){
    if(!fullMap && !currentMap && geoWatchId != null){
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
      userLat = null; userLng = null;
      routeTargetListing = null;
    }
  }

  /* =========================================================
     ADMIN
  ==========================================================*/
  function loginAdmin(e){
    e.preventDefault();
    var u = document.getElementById('a_user').value, p = document.getElementById('a_pass').value;
    var errBox = document.getElementById('loginError');
    var btn = document.getElementById('adminLoginForm').querySelector('button[type="submit"]');
    if(btn) btn.disabled = true;
    fetch(ADMIN_LOGIN_API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify({username: u, password: p})
    }).then(function(r){ return r.json().then(function(data){ return {status:r.status, data:data}; }); })
      .then(function(res){
        if(res.status === 200 && res.data.ok){
          errBox.style.display='none'; closeModal('adminLoginModal');
          document.getElementById('adminLoginForm').reset();
          if(res.data.isSuperAdmin){
            showPage('pageAdmin'); renderAdmin();
          } else {
            showPage('pageAdminStats'); renderAdminStatsOnly();
          }
        } else {
          errBox.textContent = (res.data && res.data.error) || "Login yoki parol noto'g'ri.";
          errBox.style.display='block';
        }
      })
      .catch(function(err){ console.error('loginAdmin xato:', err); errBox.textContent = "Ulanishda xato yuz berdi."; errBox.style.display='block'; })
      .finally(function(){ if(btn) btn.disabled = false; });
  }
  function logoutAdmin(){
    fetch(ADMIN_LOGOUT_API, {method:'POST', credentials:'same-origin', headers: csrfHeaders()})
      .catch(function(err){ console.error('logoutAdmin xato:', err); })
      .finally(function(){
        if(PANEL_ROUTE){
          // Logging out on /panel/ must land back on the login form, not
          // the public site - this URL never shows the site, logged in
          // or not.
          document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('show'); });
          openModal('adminLoginModal');
          return;
        }
        showPage('pageHome'); renderPublic();
      });
  }
  function renderAdminStatsOnly(targetId){
    var wrap = document.getElementById(targetId || 'statsAdminContent');
    wrap.innerHTML = '<div class="empty-admin">Yuklanmoqda...</div>';
    fetch('/api/admin/stats/', {credentials:'same-origin'}).then(function(r){
      // A non-200 (e.g. a session/permission hiccup) still has a JSON
      // body, just not the stats shape - without this check it used to
      // render straight through as "undefined" / "$NaN" everywhere
      // instead of a clear error.
      if(!r.ok){ throw new Error('admin stats HTTP ' + r.status); }
      return r.json();
    }).then(function(s){
      var sellerRows = (s.sellers || []).map(function(row){
        var paidHtml = (row.top_count || row.vip_count)
          ? (row.top_count ? ('TOP: ' + row.top_count + " ta (" + formatUsd(row.top_value_cents||0) + ')') : '') +
            (row.top_count && row.vip_count ? ' · ' : '') +
            (row.vip_count ? ('VIP: ' + row.vip_count + " ta (" + formatUsd(row.vip_value_cents||0) + ')') : '')
          : "pullik e'lon yo'q";
        return '<div class="queue-row"><div class="queue-info">' +
          '<div class="qdesc">' + displayName(row.seller) + '</div>' +
          '<div class="qseller">' + row.listing_count + " ta e'lon · 👁 " + (row.total_views||0) + " ko'rish · 🤍 " + (row.total_likes||0) + ' layk · ' + paidHtml + '</div>' +
          '</div></div>';
      }).join('') || '<div class="empty-admin">Hozircha sotuvchi yo\'q.</div>';
      var soldRows = (s.soldListingsDetail || []).map(function(row){
        return '<div class="queue-row"><div class="queue-info">' +
          '<div class="qdesc">' + row.title + ' · ' + row.district + '</div>' +
          '<div class="qseller">' + displayName(row.seller) + ' · ' + row.price + '</div>' +
          '</div></div>';
      }).join('') || '<div class="empty-admin">Hozircha sotilgan uy yo\'q.</div>';
      wrap.innerHTML =
        '<div class="admin-stats">' +
          '<div class="astat"><div class="n">' + s.totalListings + '</div><div class="l">Jami e\'lonlar</div></div>' +
          '<div class="astat"><div class="n">' + s.soldListings + '</div><div class="l">Sotilgan uylar</div></div>' +
          '<div class="astat"><div class="n">' + s.paidListingsBought + '</div><div class="l">Pullik (TOP/VIP) e\'lonlar</div></div>' +
          '<div class="astat"><div class="n">' + (s.totalViews||0) + '</div><div class="l">Jami ko\'rishlar</div></div>' +
          '<div class="astat"><div class="n">' + (s.totalLikes||0) + '</div><div class="l">Jami layklar</div></div>' +
        '</div>' +
        '<div class="admin-stats">' +
          '<div class="astat"><div class="n">' + ((s.tierBreakdown&&s.tierBreakdown.top) ? s.tierBreakdown.top.count : 0) + '</div><div class="l">TOP e\'lonlar (qiymati ' + formatUsd((s.tierBreakdown&&s.tierBreakdown.top) ? s.tierBreakdown.top.revenueCents : 0) + ')</div></div>' +
          '<div class="astat"><div class="n">' + ((s.tierBreakdown&&s.tierBreakdown.vip) ? s.tierBreakdown.vip.count : 0) + '</div><div class="l">VIP e\'lonlar (qiymati ' + formatUsd((s.tierBreakdown&&s.tierBreakdown.vip) ? s.tierBreakdown.vip.revenueCents : 0) + ')</div></div>' +
        '</div>' +
        '<div class="admin-stats">' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsToday) + '</div><div class="l">Kunlik daromad</div></div>' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsWeek) + '</div><div class="l">Haftalik daromad</div></div>' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsMonth) + '</div><div class="l">Oylik daromad</div></div>' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsAllTime) + '</div><div class="l">Jami daromad</div></div>' +
        '</div>' +
        '<h3 style="margin:18px 0 10px;">Sotilgan uylar (jami narx: ' + (s.soldListingsTotalPriceNumber||0).toLocaleString('ru-RU') + ')</h3>' + soldRows +
        '<h3 style="margin:18px 0 10px;">Profillar</h3>' + sellerRows;
    }).catch(function(err){
      console.error('admin stats xato:', err);
      wrap.innerHTML = '<div class="empty-admin">Statistikani yuklashda xato yuz berdi.</div>';
    });
  }
  function setAdminTab(tab){
    adminTab = tab;
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tab')===tab); });
    renderAdmin();
  }
  function renderAdminStats(){
    var vipCount = listings.filter(function(l){ return l.vip; }).length;
    var topCount = listings.filter(function(l){ return l.top; }).length;
    var totalViews = listings.reduce(function(sum,l){ return sum + (l.viewsCount||0); }, 0);
    var totalLikes = listings.reduce(function(sum,l){ return sum + (l.likesCount||0); }, 0);
    // Total registered profiles (allProfilesDirectory), not just sellers
    // who've posted a listing - a "profiles" count should include
    // everyone who signed up, listing or not.
    document.getElementById('adminStats').innerHTML =
      '<div class="astat"><div class="n">'+listings.length+'</div><div class="l">Jami e\'lonlar</div></div>' +
      '<div class="astat"><div class="n">'+vipCount+'</div><div class="l">VIP e\'lonlar</div></div>' +
      '<div class="astat"><div class="n">'+topCount+'</div><div class="l">TOP e\'lonlar</div></div>' +
      '<div class="astat"><div class="n">'+allProfilesDirectory.length+'</div><div class="l">Profillar ro\'yxati</div></div>' +
      '<div class="astat"><div class="n">'+totalViews+'</div><div class="l">Jami ko\'rishlar</div></div>' +
      '<div class="astat"><div class="n">'+totalLikes+'</div><div class="l">Jami layklar</div></div>';
  }
  function renderAdmin(){
    renderAdminStats();
    var wrap = document.getElementById('adminContent');
    if(adminTab==='stats'){
      // Same rich statistics the stats-only admin sees - the full admin
      // (988912) shouldn't need a separate login to see them too.
      renderAdminStatsOnly('adminContent');
      return;
    }
    if(adminTab==='profiles'){
      // Tasdiqlash used to be its own tab - now it renders inline on
      // whichever profile has a pending request, so there's one place
      // to look instead of two. Needs three fetches merged together:
      // the profile list itself, who's waiting on verification, and
      // (from the stats endpoint, already computed there) each
      // profile's listing/view/like/payment totals.
      wrap.innerHTML =
        '<input type="text" id="profileSearchInput" placeholder="ID, username yoki ism bo\'yicha qidirish..." style="width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--line);margin-bottom:14px;font-family:inherit;font-size:14px;background:var(--card);color:var(--ink);">' +
        '<div id="profileListBody"><div class="empty-admin">Yuklanmoqda...</div></div>';
      Promise.all([
        fetch(PROFILE_API).then(function(r){ return r.json(); }),
        fetch(ADMIN_VERIFICATION_REQUESTS_API, {credentials:'same-origin'}).then(function(r){ return r.json(); }),
        fetch('/api/admin/stats/', {credentials:'same-origin'}).then(function(r){ return r.json(); })
      ]).then(function(results){
        var profiles = results[0], verifReqs = results[1], stats = results[2];
        var verifByUsername = {};
        verifReqs.forEach(function(v){ verifByUsername[v.username] = v; });
        var statsByUsername = {};
        (stats.sellers || []).forEach(function(s){ statsByUsername[s.seller] = s; });
        renderAdminProfilesList(profiles, verifByUsername, statsByUsername, '');
        document.getElementById('profileSearchInput').addEventListener('input', function(){
          renderAdminProfilesList(profiles, verifByUsername, statsByUsername, this.value.trim().toLowerCase());
        });
      }).catch(function(err){
        console.error('admin profiles xato:', err);
        var body = document.getElementById('profileListBody');
        if(body) body.innerHTML = '<div class="empty-admin">Yuklashda xato yuz berdi.</div>';
      });
      return;
    }
    if(!listings.length){ wrap.innerHTML = '<div class="empty-admin">Hozircha e\'lon yo\'q.</div>'; return; }
    wrap.innerHTML = listings.map(function(l){
      return '<div class="queue-row" data-open="'+l.id+'"><img src="'+l.img+'" alt="">' +
        '<div class="queue-info"><div class="qprice">'+formatPrice(l)+(l.sold?' · <span style="color:var(--red);">SOTILDI</span>':'')+'</div>' +
        '<div class="qdesc">'+l.title+' · '+l.district+' · '+l.type+'</div>' +
        '<div class="qseller">'+l.seller+' · 👁 '+l.viewsCount+' · 🤍 '+l.likesCount+'</div></div>' +
        '<div class="queue-actions">' +
          '<button class="qbtn" data-action="sold" data-id="'+l.id+'" data-sold="'+(l.sold?'1':'0')+'">'+(l.sold?'Sotilmagan deb belgilash':'Sotildi deb belgilash')+'</button>' +
          '<button class="qbtn del" data-action="delete" data-id="'+l.id+'">O\'chirish</button>' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('[data-open]').forEach(function(row){ row.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-open')), true); }); });
    wrap.querySelectorAll('[data-action="delete"]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        deleteListing(Number(this.getAttribute('data-id')));
      });
    });
    wrap.querySelectorAll('[data-action="sold"]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = Number(this.getAttribute('data-id'));
        var nextSold = this.getAttribute('data-sold') !== '1';
        toggleListingSold(id, nextSold);
      });
    });
  }
  function renderAdminProfilesList(profiles, verifByUsername, statsByUsername, query){
    var body = document.getElementById('profileListBody');
    if(!body) return;
    var filtered = profiles.filter(function(p){
      if(!query) return true;
      return String(p.public_id||'') === query || String(p.id) === query ||
        (p.username||'').toLowerCase().indexOf(query)!==-1 ||
        (p.full_name||'').toLowerCase().indexOf(query)!==-1;
    });
    if(!filtered.length){ body.innerHTML = '<div class="empty-admin">Hech narsa topilmadi.</div>'; return; }
    body.innerHTML = filtered.map(function(p){
      var v = verifByUsername[p.username];
      var s = statsByUsername[p.username] || {listing_count:0, total_views:0, total_likes:0, top_count:0, vip_count:0, top_value_cents:0, vip_value_cents:0};
      var verifHtml = v ?
        '<div class="verify-inline" style="width:100%;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">' +
          '<div style="font-size:12.5px;font-weight:700;color:var(--accent2);margin-bottom:8px;">Tasdiqlash kutilmoqda</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
            '<img src="'+v.idPhoto+'" alt="ID" style="width:80px;height:64px;border-radius:8px;object-fit:cover;">' +
            '<img src="'+v.selfiePhoto+'" alt="Selfie" style="width:80px;height:64px;border-radius:8px;object-fit:cover;">' +
          '</div>' +
          '<button class="qbtn" data-decide="approve" data-vid="'+v.id+'">Tasdiqlash</button> ' +
          '<button class="qbtn del" data-decide="reject" data-vid="'+v.id+'">Rad etish</button>' +
        '</div>' : '';
      // TOP/VIP shown separately (each tier's own price × how many of
      // their listings are currently at that tier) rather than one
      // lumped total - a listing that reached a tier without an audited
      // payment (seeded/demo data, or predating PaymentEvent tracking)
      // still shows a real amount here instead of $0.00.
      var paidHtml = (s.top_count || s.vip_count)
        ? (s.top_count ? ('TOP: ' + s.top_count + " ta (" + formatUsd(s.top_value_cents||0) + ')') : '') +
          (s.top_count && s.vip_count ? ' · ' : '') +
          (s.vip_count ? ('VIP: ' + s.vip_count + " ta (" + formatUsd(s.vip_value_cents||0) + ')') : '')
        : "pullik e'lon yo'q";
      return '<div class="profile-row" data-seller="'+p.username+'" style="cursor:pointer;flex-wrap:wrap;">' +
        '<div class="profile-avatar">'+(p.full_name || p.username).charAt(0).toUpperCase()+'</div>' +
        '<div class="profile-info"><div class="profile-name">'+(p.full_name || p.username)+(p.verified?VERIFIED_TICK_HTML:'')+'</div>' +
        '<div class="profile-meta">ID: '+(p.public_id||p.id)+' · '+(p.phone || p.email || '—')+' · '+p.role+'</div></div>' +
        '<div class="profile-count">'+s.listing_count+" ta e'lon · 👁 "+(s.total_views||0)+' · 🤍 '+(s.total_likes||0)+' · '+paidHtml+'</div>' +
        '<button class="qbtn" data-discount="'+p.id+'" data-username="'+p.username+'" style="flex-shrink:0;">Chegirma berish</button>' +
        '<button class="qbtn del" data-delprofile="'+p.id+'" data-username="'+p.username+'" style="flex-shrink:0;">O\'chirish</button>' +
        '<div class="discount-form hidden" id="discountForm-'+p.id+'" style="width:100%;"></div>' +
        verifHtml +
      '</div>';
    }).join('');

    body.querySelectorAll('[data-seller]').forEach(function(row){
      row.addEventListener('click', function(e){
        if(e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
        openSellerProfile(this.getAttribute('data-seller'), true);
      });
    });
    body.querySelectorAll('[data-delprofile]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-delprofile');
        var username = this.getAttribute('data-username');
        if(!confirm("'" + username + "' profilini butunlay o'chirmoqchimisiz? Bu amalni orqaga qaytarib bo'lmaydi.")) return;
        fetch('/api/profiles/' + id + '/', {method: 'DELETE', credentials: 'same-origin', headers: csrfHeaders()})
          .then(function(r){
            if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
            if(r.status === 204 || r.ok){
              toast("Profil o'chirildi.");
              renderAdmin();
            } else {
              toast("O'chirishda xato yuz berdi.");
            }
          }).catch(function(err){ console.error('delete profile xato:', err); toast("Xato yuz berdi."); });
      });
    });
    body.querySelectorAll('[data-decide]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-vid');
        var decision = this.getAttribute('data-decide');
        fetch(ADMIN_VERIFICATION_REQUESTS_API + id + '/decide/', {
          method: 'POST', credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify({decision: decision})
        }).then(function(r){
          if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
          toast(decision === 'approve' ? "Profil tasdiqlandi." : "So'rov rad etildi.");
          renderAdmin();
        }).catch(function(err){ console.error('verification decide xato:', err); toast("Xato yuz berdi."); });
      });
    });
    body.querySelectorAll('[data-discount]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var pid = this.getAttribute('data-discount');
        var username = this.getAttribute('data-username');
        var formEl = document.getElementById('discountForm-'+pid);
        var wasOpen = !formEl.classList.contains('hidden');
        document.querySelectorAll('.discount-form').forEach(function(f){ f.classList.add('hidden'); f.innerHTML=''; });
        if(wasOpen) return;
        formEl.classList.remove('hidden');
        formEl.innerHTML =
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">' +
            '<select class="disc-tier" style="padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);"><option value="top">TOP</option><option value="vip">VIP</option></select>' +
            '<input type="text" inputmode="numeric" class="disc-percent" placeholder="Foiz (masalan 30)" style="width:150px;padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);">' +
            '<button type="button" class="qbtn" data-send-discount="1">Yuborish</button>' +
          '</div>';
        formEl.querySelector('[data-send-discount]').addEventListener('click', function(ev){
          ev.stopPropagation();
          var tier = formEl.querySelector('.disc-tier').value;
          var percent = parseInt(formEl.querySelector('.disc-percent').value, 10);
          if(!percent || percent < 1 || percent > 100){ alert("1 dan 100 gacha foiz kiriting."); return; }
          fetch('/api/admin/discounts/', {
            method: 'POST', credentials: 'same-origin',
            headers: csrfHeaders({'Content-Type': 'application/json'}),
            body: JSON.stringify({profile_id: pid, tier: tier, percent: percent})
          }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
            .then(function(res){
              if(res.status === 200 && res.data.ok){
                toast(username + "ga " + percent + "% " + tier.toUpperCase() + " chegirma berildi.");
                formEl.classList.add('hidden'); formEl.innerHTML = '';
              } else {
                alert((res.data && res.data.error) || "Xato yuz berdi.");
              }
            }).catch(function(err){ console.error('discount xato:', err); alert("Xato yuz berdi."); });
        });
      });
    });
  }
  function deleteListing(id){
    fetch(API_BASE + id + '/', {method:'DELETE', credentials:'same-origin', headers: csrfHeaders()})
      .then(function(r){
        if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
        loadListings(function(){ renderAdmin(); });
        toast("E'lon o'chirildi.");
      })
      .catch(function(err){ console.error('deleteListing xato:', err); toast("O'chirishda xato yuz berdi."); });
  }
  function toggleListingSold(id, sold){
    fetch(API_BASE + id + '/mark-sold/', {
      method: 'POST', credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify({sold: sold})
    }).then(function(r){
      if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
      loadListings(function(){ renderAdmin(); });
      toast(sold ? "E'lon sotilgan deb belgilandi." : "E'lon sotilmagan deb belgilandi.");
    }).catch(function(err){ console.error('toggleListingSold xato:', err); toast("Xato yuz berdi."); });
  }

  /* =========================================================
     TIL ALMASHTIRISH
  ==========================================================*/
  var t = {
    UZ:{sotuv:"Sotuv", ijara:"Ijara", kunlik:"Kunlik", search:"Qidirish... (nomi, hudud)", post_ad:"E'lon joylash", admin:"Admin", on_map:"Xaritada", filters:"Filtrlar", type_all:"Barcha turlar", kvartira:"Kvartira", hovli:"Hovli/dacha", tijorat:"Tijorat binolari", yer:"Yer", owner:"Egasi", mortgage:"Ipotekaga mumkin", last_week:"Oxirgi hafta", last_month:"Oxirgi oy",
      desc:"Tavsif", posted_by:"Kim joylashtirdi", property_type:"Mulk turi", rooms_count:"Xonalar soni", area_label:"Maydon, m²", repair_label:"Ta'mir", location:"Joylashuv", show_route:"Yo'nalishni ko'rsatish", msg_seller:"Sotuvchiga yozing", call_seller:"Qo'ng'iroq qilish", view_profile:"Profilni ko'rish", floor_label:"Qavat", floors_total_label:"Uyning qavatlari soni",
      hero_eyebrow:"To'g'ridan-to'g'ri egasidan, tekshirilgan e'lonlar", hero_title_1:"Uyingiz bor.", hero_title_2:"Topilishi", hero_title_em:"qoldi.", hero_sub:"Jizzax viloyati bo'ylab kvartira, hovli, tijorat binosi va yer e'lonlari — bitta manzilda. Admin tomonidan tasdiqlangan, ishonchli sotuvchilardan.", hero_browse:"E'lonlarni ko'rish", hero_stat_listings:"Faol e'lon", hero_stat_districts:"Tuman qamrovi", hero_chip:"Admin tasdiqlagan"},
    RU:{sotuv:"Продажа", ijara:"Аренда", kunlik:"Посуточно", search:"Поиск... (название, район)", post_ad:"Разместить объявление", admin:"Админ", on_map:"На карте", filters:"Фильтры", type_all:"Все типы", kvartira:"Квартира", hovli:"Дом/дача", tijorat:"Коммерческая", yer:"Земля", owner:"От собственника", mortgage:"Ипотека возможна", last_week:"За неделю", last_month:"За месяц",
      desc:"Описание", posted_by:"Кто разместил", property_type:"Тип недвижимости", rooms_count:"Количество комнат", area_label:"Площадь, м²", repair_label:"Ремонт", location:"Расположение", show_route:"Показать маршрут", msg_seller:"Написать продавцу", call_seller:"Позвонить", view_profile:"Смотреть профиль", floor_label:"Этаж", floors_total_label:"Этажность дома",
      hero_eyebrow:"Напрямую от собственника, проверенные объявления", hero_title_1:"Ваш дом есть.", hero_title_2:"Осталось", hero_title_em:"найти его.", hero_sub:"Квартиры, дома, коммерческая недвижимость и земля по всей Джизакской области — в одном месте. Проверено администрацией, от надёжных продавцов.", hero_browse:"Смотреть объявления", hero_stat_listings:"Активных объявлений", hero_stat_districts:"Районов охвачено", hero_chip:"Подтверждено админом"},
    EN:{sotuv:"Sale", ijara:"Rent", kunlik:"Daily", search:"Search... (title, district)", post_ad:"Post an ad", admin:"Admin", on_map:"On map", filters:"Filters", type_all:"All types", kvartira:"Apartment", hovli:"House/dacha", tijorat:"Commercial", yer:"Land", owner:"By owner", mortgage:"Mortgage OK", last_week:"Last week", last_month:"Last month",
      desc:"Description", posted_by:"Posted by", property_type:"Property type", rooms_count:"Rooms", area_label:"Area, m²", repair_label:"Renovation", location:"Location", show_route:"Show route", msg_seller:"Message seller", call_seller:"Call", view_profile:"View profile", floor_label:"Floor", floors_total_label:"Total floors",
      hero_eyebrow:"Straight from the owner, verified listings", hero_title_1:"Your home is out there.", hero_title_2:"Finding it is", hero_title_em:"the easy part.", hero_sub:"Apartments, houses, commercial spaces and land across Jizzax region — all in one place. Admin-verified, from trusted sellers.", hero_browse:"Browse listings", hero_stat_listings:"Active listings", hero_stat_districts:"Districts covered", hero_chip:"Admin verified"}
  };
  // listings themselves are stored in Uzbek (type/district/repair/
  // condition are fixed enum-like values, not free text) - this maps
  // those exact Uzbek strings to RU/EN so a listing's own words also
  // switch with the language picker, not just the surrounding UI chrome.
  var TYPE_TO_DICT_KEY = {'Kvartira':'kvartira', 'Hovli/dacha':'hovli', 'Tijorat binolari':'tijorat', 'Yer':'yer'};
  var VALUE_TRANSLATIONS = {
    'Jizzax shahri': {RU:'г. Джизак', EN:'Jizzax city'},
    'Arnasoy tumani': {RU:'Арнасайский район', EN:'Arnasoy district'},
    'Baxmal tumani': {RU:'Бахмальский район', EN:'Baxmal district'},
    "Do'stlik tumani": {RU:'Дустликский район', EN:"Do'stlik district"},
    'Forish tumani': {RU:'Форишский район', EN:'Forish district'},
    "G'allaorol tumani": {RU:'Галляаральский район', EN:"G'allaorol district"},
    "Mirzacho'l tumani": {RU:'Мирзачульский район', EN:"Mirzacho'l district"},
    'Paxtakor tumani': {RU:'Пахтакорский район', EN:'Paxtakor district'},
    'Sh. Rashidov tumani': {RU:'р-н Ш. Рашидова', EN:'Sh. Rashidov district'},
    'Yangiobod tumani': {RU:'Янгиабадский район', EN:'Yangiobod district'},
    'Zafarobod tumani': {RU:'Зафарабадский район', EN:'Zafarobod district'},
    'Zarbdor tumani': {RU:'Зарбдарский район', EN:'Zarbdor district'},
    'Zomin tumani': {RU:'Зааминский район', EN:'Zomin district'},
    'Evroremont': {RU:'Евроремонт', EN:'Euro renovation'},
    "O'rtacha": {RU:'Средний', EN:'Average'},
    "Ta'mirsiz": {RU:'Без ремонта', EN:'No renovation'},
    "Ikkinchi qo'l": {RU:'Вторичка', EN:'Second-hand'},
    'Yangi bino': {RU:'Новостройка', EN:'New building'},
    'Uy egasi': {RU:'Собственник', EN:'Owner'},
    'Xaridor': {RU:'Покупатель', EN:'Buyer'},
    'Ishonchli sotuvchi': {RU:'Надёжный продавец', EN:'Trusted seller'}
  };
  function trValue(uzText){
    if(currentLang === 'UZ' || !uzText) return uzText;
    var typeKey = TYPE_TO_DICT_KEY[uzText];
    if(typeKey) return t[currentLang][typeKey];
    var entry = VALUE_TRANSLATIONS[uzText];
    return (entry && entry[currentLang]) || uzText;
  }
  function applyLang(lang){
    currentLang = lang;
    document.getElementById('langCode').textContent = lang;
    var dict = t[lang];
    document.querySelectorAll('#segment button[data-deal]').forEach(function(b){ b.textContent = dict[b.getAttribute('data-deal')]; });
    document.getElementById('searchInput').setAttribute('placeholder', dict.search);
    // Both buttons have a leading text node + a trailing arrow-icon
    // <span> (see .cta-arrow) - touch only the text node, or .textContent
    // would wipe the icon out.
    document.getElementById('heroEyebrowText').textContent = dict.hero_eyebrow;
    document.getElementById('heroTitle1').textContent = dict.hero_title_1;
    document.getElementById('heroTitle2').textContent = dict.hero_title_2;
    document.getElementById('heroTitleEm').textContent = dict.hero_title_em;
    document.getElementById('heroSub').textContent = dict.hero_sub;
    document.getElementById('heroBrowseBtn').textContent = dict.hero_browse;
    document.getElementById('heroStatListingsLabel').textContent = dict.hero_stat_listings;
    document.getElementById('heroStatDistrictsLabel').textContent = dict.hero_stat_districts;
    document.getElementById('heroChipText').textContent = dict.hero_chip;
    ['postAdBtn', 'heroPostBtn'].forEach(function(id){
      var btn = document.getElementById(id);
      if(btn && btn.firstChild) btn.firstChild.textContent = dict.post_ad;
    });
    document.querySelector('#mapBtn').childNodes[1] ? (document.querySelector('#mapBtn').lastChild.textContent = dict.on_map) : null;
    document.querySelector('#filtersBtn').lastChild.textContent = ' ' + dict.filters;
    if(filterState.type === 'all'){ document.getElementById('typeLabel').textContent = dict.type_all; }
    var typeMap = {all:dict.type_all, kvartira:dict.kvartira, hovli:dict.hovli, tijorat:dict.tijorat, yer:dict.yer};
    document.querySelectorAll('#typeDropdown button').forEach(function(b){ b.textContent = typeMap[b.getAttribute('data-type')]; });
    document.querySelector('[data-filter="owner"]').lastChild.textContent = ' ' + dict.owner;
    document.querySelector('[data-filter="mortgage"]').lastChild.textContent = ' ' + dict.mortgage;
    document.querySelector('[data-filter="lastWeek"]').lastChild.textContent = ' ' + dict.last_week;
    document.querySelector('[data-filter="lastMonth"]').lastChild.textContent = ' ' + dict.last_month;
    // The listing chrome above is UI-only, but each listing's own words
    // (type/district/repair) are stored in Uzbek - re-render whatever's
    // currently on screen so switching language actually retranslates
    // them too, not just the surrounding buttons/labels.
    renderPublic();
    if(currentDetailListing && document.getElementById('pageDetail').classList.contains('show')){
      openDetail(currentDetailListing.id, currentDetailListing.fromAdmin, true);
    }
  }

  /* =========================================================
     E'LON JOYLASH VIZARDI
  ==========================================================*/
  var postDeal = 'sotuv', postRole = '', postCat = '', postTypeKey = 'kvartira', postRepair = "Ta'mirni tanlang", postCondition = "Yangi bino", postMortgage = false, postCurrency = 'ye';
  var postIsBuyer = false; // true for "Sotib olaman"/"Ijaraga olaman" - a buyer's budget-range "qidiryapman" listing, not a seller's
  var PRICE_RANGE_SEP = '~'; // packs a buyer's min/max budget into the single `price` string field: "min~max"
  var postVoiceNoteId = null, postVoiceNoteUrl = null;
  var VOICE_NOTES_API = '/api/voice-notes/';
  var MAX_VOICE_NOTE_SECONDS = 60;
  var voiceRecorder = null, voiceRecorderStream = null, voiceRecorderChunks = [], voiceRecorderTimer = null;
  var postPhotos = [];
  var postLocationMap = null, postLocationMarker = null;
  var JIZZAX_CENTER = [40.1158, 67.8422];
  // Roughly the Jizzax viloyati bounding box (with a little padding), used
  // to keep every map on the site locked to the region instead of letting
  // people zoom/pan out to see the whole of Uzbekistan.
  var JIZZAX_BOUNDS = [[39.55, 66.25], [40.75, 68.95]];
  var postTier = 'regular';
  var editingListingId = null; // set while editing an existing listing (Saqlash instead of pay+post)

  function openEditListing(l){
    editingListingId = l.id;
    postCurrency = l.currency || 'ye';
    postVoiceNoteId = l.voiceNote ? l.voiceNote.id : null;
    postVoiceNoteUrl = l.voiceNote ? l.voiceNote.url : null;
    renderVoiceRecorder();
    postDeal = l.deal || 'sotuv';
    postTypeKey = l.typeKey || 'kvartira';
    postCat = l.type || 'Kvartira';
    postRepair = l.repair || "Ta'mirni tanlang";
    postCondition = l.condition || "Yangi bino";
    postTier = l.vip ? 'vip' : (l.top ? 'top' : 'regular');
    postMortgage = !!l.mortgage;
    postIsBuyer = !!l.isWanted;
    // Existing photos are already linked to this listing in the DB -
    // only NEW ones added during this edit need an imageId to link.
    postPhotos = (l.photos || []).map(function(url){ return {url: url, imageId: null, uploading: false, existing: true}; });

    showPage('pagePost');
    renderUploadThumbs();
    document.getElementById('uploadCount').textContent = postPhotos.length + '/10';
    document.getElementById('postTitle').value = l.title || '';
    document.getElementById('postDesc').value = l.desc || '';
    document.getElementById('postPhone').value = l.phone || '+998';
    if(postIsBuyer){
      var rangeParts = String(l.price || '').split(PRICE_RANGE_SEP);
      document.getElementById('postPriceMin').value = rangeParts[0] || '';
      document.getElementById('postPriceMax').value = rangeParts[1] || '';
    } else {
      document.getElementById('postPrice').value = l.price || '';
    }
    var floorParts = String(l.floor || '').split('/');
    document.getElementById('postFloor').value = floorParts[0] === '—' ? '' : (floorParts[0] || '');
    document.getElementById('postFloorsTotal').value = floorParts[1] || '';
    document.getElementById('postArea').value = l.area || '';
    document.getElementById('postRooms').value = l.rooms || '';
    document.getElementById('postRepair').value = postRepair;
    document.getElementById('postDistrict').value = l.district || '';
    document.getElementById('condToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-c')===postCondition); });
    document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', (b.getAttribute('data-m')==='1')===postMortgage); });
    updateMortgageFieldVisibility();
    updateConditionFieldVisibility();
    updatePropertyTypeOptions();
    updateLandFieldVisibility();
    updateBuyerFieldVisibility();
    renderUpgradeTierBox(l);
    document.getElementById('currencyToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-currency')===postCurrency); });
    document.getElementById('priceRangeCurrencyToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-currency')===postCurrency); });
    document.getElementById('tierToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-tier')===postTier); });
    document.getElementById('paymentSummary').classList.add('hidden');
    var editBtn = document.getElementById('finishPostBtn');
    editBtn.textContent = 'Saqlash';
    editBtn.disabled = false;
    showPostStep(3);
  }

  // Moved out of init() - openEditListing() (above) needs to call these
  // too, and it's defined at this outer scope, not inside init(). They
  // only touch DOM-by-id and the outer postDeal/postMortgage state, so
  // living here works identically for both callers.
  function updateMortgageFieldVisibility(){
    // Mortgage only makes sense when a seller is selling outright, not
    // for rentals (ijara/kunlik) and not for a buyer's "qidiryapman"
    // listing - hide the field for those, and make sure a stale
    // "ipotekaga mumkin" pick from before switching away never rides
    // along in the payload.
    var applies = postDeal === 'sotuv' && !postIsBuyer;
    document.getElementById('mortgageField').classList.toggle('hidden', !applies);
    if(!applies){
      postMortgage = false;
      document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-m')==='0'); });
    }
  }
  function updateConditionFieldVisibility(){
    // "Holati" (Ikkinchi qo'l / Yangi bino) only makes sense for a
    // seller's outright sale, not for rentals and not for a buyer's
    // "qidiryapman" listing - hide it there.
    document.getElementById('conditionField').classList.toggle('hidden', postDeal !== 'sotuv' || postIsBuyer);
  }
  function updatePropertyTypeOptions(){
    // "Tijorat binolari" and "Yer" aren't offered for daily rentals
    // (kunlik) - hide those two option rows in that case.
    var hide = postDeal === 'kunlik';
    document.getElementById('typeRowTijorat').classList.toggle('hidden', hide);
    document.getElementById('typeRowYer').classList.toggle('hidden', hide);
  }
  function updateLandFieldVisibility(){
    // "Yer" (land) has no repair, room count, or floor - those fields
    // only make sense for a building. Same story for a buyer's
    // "qidiryapman" listing (see updateBuyerFieldVisibility) - hide them
    // for either case. The values stay whatever they were (harmless,
    // unused/hidden), so switching back restores them with no extra
    // bookkeeping.
    var hideBuildingFields = postTypeKey === 'yer' || postIsBuyer;
    document.getElementById('repairField').classList.toggle('hidden', hideBuildingFields);
    document.getElementById('roomsField').classList.toggle('hidden', hideBuildingFields);
    document.getElementById('floorsRow').classList.toggle('hidden', hideBuildingFields);
  }
  function updateBuyerFieldVisibility(){
    // A buyer posting "Sotib olaman"/"Ijaraga olaman" isn't showing off
    // a property they own - they're stating what they're looking for
    // and a budget. Strip the form down to match (see the reference
    // "qidiryapman" listing form): no photos, no area - just a budget
    // range instead of one exact price. updateMortgageFieldVisibility/
    // updateConditionFieldVisibility/updateLandFieldVisibility (above)
    // already fold postIsBuyer into their own checks for the fields
    // they own; this handles the rest.
    document.getElementById('imagesUploadBox').classList.toggle('hidden', postIsBuyer);
    document.getElementById('areaField').classList.toggle('hidden', postIsBuyer);
    document.getElementById('priceField').classList.toggle('hidden', postIsBuyer);
    document.getElementById('priceRangeField').classList.toggle('hidden', !postIsBuyer);
    // Buyer flow submits straight from step3 (no TOP/VIP/payment step),
    // so the button at the bottom of step3 acts as the real "post it"
    // button there, not a "continue to the next step" one - relabel to
    // match. Not touched at all while editing (editBtn owns the label then).
    if(!editingListingId){
      document.getElementById('postContinueBtn').textContent = postIsBuyer ? "E'lon joylash" : 'Davom etish';
    }
  }
  function getPostPrice(){
    if(postIsBuyer){
      var min = document.getElementById('postPriceMin').value.trim();
      var max = document.getElementById('postPriceMax').value.trim();
      return (min && max) ? (min + PRICE_RANGE_SEP + max) : '';
    }
    return document.getElementById('postPrice').value.trim();
  }
  function validatePostForm(){
    var title = document.getElementById('postTitle').value.trim();
    var price = getPostPrice();
    var area = document.getElementById('postArea').value.trim();
    var district = document.getElementById('postDistrict').value;
    if(!title || !price || !district || (!postIsBuyer && !area)){
      return postIsBuyer
        ? "Iltimos, sarlavha, narx oralig'i va tumanni to'ldiring."
        : "Iltimos, sarlavha, narx, maydon va tumanni to'ldiring.";
    }
    if(postIsBuyer) return null; // no photos/floor to check for a buyer's listing
    if(!postPhotos.length && !editingListingId) return "Iltimos, kamida bitta rasm qo'shing.";
    if(postPhotos.some(function(p){ return p.uploading; })) return "Rasmlar hali yuklanmoqda, biroz kuting.";
    if(postPhotos.some(function(p){ return p.failed; })) return "Ba'zi rasmlar yuklanmadi (⚠️ belgili). Iltimos, ularni olib tashlang yoki qayta yuklang.";
    var floorValCheck = parseInt(document.getElementById('postFloor').value.trim(), 10);
    var floorsTotalCheck = parseInt(document.getElementById('postFloorsTotal').value.trim(), 10);
    if(!isNaN(floorValCheck) && !isNaN(floorsTotalCheck) && floorValCheck > floorsTotalCheck){
      return "Qavat raqami (" + floorValCheck + ") uyning umumiy qavatlar sonidan (" + floorsTotalCheck + ") oshmasligi kerak.";
    }
    return null;
  }
  function buildPostPayload(){
    var title = document.getElementById('postTitle').value.trim();
    var district = document.getElementById('postDistrict').value;
    var pos = postLocationMarker ? postLocationMarker.getLatLng() : {lat:JIZZAX_CENTER[0], lng:JIZZAX_CENTER[1]};
    var seller = document.getElementById('profileUsername').textContent.trim() || 'yangi_foydalanuvchi';
    var phone = document.getElementById('postPhone').value.trim();
    var desc = document.getElementById('postDesc').value.trim() || (title + '.');
    var base = {
      price: getPostPrice(), currency: postCurrency, voice_note_id: postVoiceNoteId,
      title: title, district: district, lat: pos.lat, lng: pos.lng,
      type: postCat || 'Kvartira', type_key: postTypeKey, phone: phone, desc: desc,
      seller: seller, deal: postDeal,
    };
    if(postIsBuyer){
      // A buyer's "qidiryapman" listing - just what/where/budget, none
      // of the seller-only property details, always free/oddiy.
      return Object.assign(base, {
        rooms: null, area: 0, floor: '', repair: '', condition: '',
        owner_role: 'Xaridor', owner: false, mortgage: false,
        vip: false, top: false, is_wanted: true, image_ids: []
      });
    }
    var area = document.getElementById('postArea').value.trim();
    var floorsTotal = document.getElementById('postFloorsTotal').value.trim();
    var floorVal = document.getElementById('postFloor').value.trim() || '—';
    return Object.assign(base, {
      rooms: parseInt(document.getElementById('postRooms').value.trim(), 10) || null,
      area: parseInt(area,10) || 0,
      floor: floorsTotal ? (floorVal + '/' + floorsTotal) : floorVal,
      repair: postRepair === "Ta'mirni tanlang" ? '' : postRepair,
      condition: postCondition, owner_role: 'Uy egasi', owner: true, mortgage: postMortgage,
      vip: postTier === 'vip', top: postTier === 'top', is_wanted: false,
      // Photos were already uploaded (compressed, stored server-side)
      // the moment they were picked - this just tells whichever
      // endpoint ends up creating/updating the Listing which
      // already-uploaded images to attach to it.
      image_ids: newlyUploadedImageIds()
    });
  }
  function submitPostPayload(btn){
    var payload = buildPostPayload();

    if(editingListingId){
      btn.disabled = true;
      btn.textContent = 'Saqlanmoqda...';
      fetch(API_BASE + editingListingId + '/', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify(payload)
      }).then(function(r){ return r.json(); }).then(function(updated){
        var savedId = editingListingId;
        editingListingId = null;
        document.getElementById('paymentSummary').classList.remove('hidden');
        loadListings(function(){
          toast("E'lon yangilandi!");
          openDetail(savedId, false);
        });
      }).catch(function(err){
        console.error('edit save xato:', err);
        alert("Saqlashda xato yuz berdi.");
        btn.disabled = false;
        btn.textContent = 'Saqlash';
      });
      return;
    }

    if(postIsBuyer || !isPaidTier()){
      // Regular listings (and every buyer "qidiryapman" listing, always
      // free/oddiy) skip Stripe entirely.
      btn.disabled = true;
      btn.textContent = 'Joylanmoqda...';
      fetch(API_BASE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify(payload)
      }).then(function(r){ return r.json(); }).then(function(newListing){
        loadListings(function(){
          renderPublic();
          toast("E'lon joylandi!");
          openDetail(newListing.id, false);
        });
      }).catch(function(err){
        console.error('free post xato:', err);
        alert("E'lonni saqlashda xato yuz berdi.");
        btn.disabled = false;
        btn.textContent = postIsBuyer ? 'Davom etish' : "E'lon joylash";
      });
      return;
    }

    if(postPayMethod === 'balance'){
      var neededCents = paymentInfo.prices ? paymentInfo.prices[postTier] : null;
      if(neededCents != null && myBalanceCents() < neededCents){
        alert("Balansingizda yetarli mablag' yo'q. Iltimos, balansni to'ldiring yoki karta orqali to'lang.");
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Joylanmoqda...';
      fetch(LISTING_FROM_BALANCE_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({tier: postTier, profile_id: currentProfile.id, listing: payload})
      }).then(function(r){ return r.json().then(function(data){ return {status:r.status, data:data}; }); })
        .then(function(res){
          if(res.status === 200 && res.data.ok && res.data.listing){
            if(res.data.profile) applyProfile(res.data.profile);
            loadListings(function(){
              renderPublic();
              toast("Balansdan to'landi, e'lon joylandi!");
              openDetail(res.data.listing.id, false);
            });
          } else {
            alert((res.data && res.data.error) || "To'lovda xato yuz berdi.");
            btn.disabled = false;
            btn.textContent = "Balansdan to'lash va joylash";
          }
        })
        .catch(function(err){
          console.error('balance post xato:', err);
          alert("To'lovda xato yuz berdi.");
          btn.disabled = false;
          btn.textContent = "Balansdan to'lash va joylash";
        });
      return;
    }

    btn.disabled = true;
    btn.textContent = "Yo'naltirilmoqda...";
    fetch(CHECKOUT_SESSION_API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify({tier: postTier, listing: payload})
    }).then(function(r){ return r.json().then(function(data){ return {status:r.status, data:data}; }); })
      .then(function(res){
        if(res.status === 200 && res.data.ok && res.data.url){
          window.location.href = res.data.url; // off to Stripe Checkout
        } else {
          alert((res.data && res.data.error) || "To'lovni boshlashda xato yuz berdi.");
          btn.disabled = false;
          btn.textContent = "To'lov qilish va joylash";
        }
      })
      .catch(function(err){
        console.error('submitPostPayload xato:', err);
        alert("To'lovni boshlashda xato yuz berdi.");
        btn.disabled = false;
        btn.textContent = "To'lov qilish va joylash";
      });
  }

  /* =========================================================
     REKLAMA QILISH - tahrirlashda mavjud e'lonni yuqori
     darajaga o'tkazish (oddiy->top/vip, top->vip)
  ==========================================================*/
  var TIER_ORDER = {regular: 0, top: 1, vip: 2};
  function upgradeTierPriceLabel(tier){
    var cents = paymentInfo.prices ? paymentInfo.prices[tier] : null;
    var labels = {top: 'TOP', vip: 'VIP'};
    return labels[tier] + ' — ' + (cents != null ? formatUsd(cents) : '—');
  }
  function renderUpgradeTierBox(l){
    var field = document.getElementById('upgradeTierField');
    var body = document.getElementById('upgradeTierBody');
    if(!field || !body) return;
    if(l.isWanted){
      // A buyer's "qidiryapman" listing always stays oddiy - no TOP/VIP.
      field.classList.add('hidden');
      body.innerHTML = '';
      return;
    }
    var currentTier = l.vip ? 'vip' : (l.top ? 'top' : 'regular');
    var options = ['top', 'vip'].filter(function(t){ return TIER_ORDER[t] > TIER_ORDER[currentTier]; });
    if(!options.length){
      // Already VIP - nothing higher to offer.
      field.classList.add('hidden');
      body.innerHTML = '';
      return;
    }
    field.classList.remove('hidden');
    var listingId = l.id;
    var selectedTier = null, payMethod = 'card';
    body.innerHTML =
      '<div class="toggle-row" id="upgradeTierToggle">' +
        options.map(function(t){ return '<button type="button" data-tier="'+t+'">'+upgradeTierPriceLabel(t)+'</button>'; }).join('') +
      '</div>' +
      '<div id="upgradeTierPayRow" class="hidden">' +
        '<div class="toggle-row" style="margin:10px 0;" id="upgradeTierPayMethod">' +
          '<button type="button" class="sel" data-method="card">💳 Karta orqali</button>' +
          '<button type="button" data-method="balance">👛 Balansdan (<span id="upgradeBalanceAmount">' + formatUsd(myBalanceCents()) + '</span>)</button>' +
        '</div>' +
        '<button type="button" class="btn-full-black" id="upgradeConfirmBtn" style="margin-top:0;">To\'lov qilish</button>' +
      '</div>';
    body.querySelectorAll('#upgradeTierToggle button').forEach(function(b){
      b.addEventListener('click', function(){
        body.querySelectorAll('#upgradeTierToggle button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        selectedTier = this.getAttribute('data-tier');
        document.getElementById('upgradeTierPayRow').classList.remove('hidden');
      });
    });
    body.querySelectorAll('#upgradeTierPayMethod button').forEach(function(b){
      b.addEventListener('click', function(){
        body.querySelectorAll('#upgradeTierPayMethod button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        payMethod = this.getAttribute('data-method');
      });
    });
    document.getElementById('upgradeConfirmBtn').addEventListener('click', function(){
      if(!selectedTier){ toast("Avval turni tanlang."); return; }
      var seller = document.getElementById('profileUsername').textContent.trim();
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Yuborilmoqda...';
      if(payMethod === 'balance'){
        var needed = paymentInfo.prices ? paymentInfo.prices[selectedTier] : null;
        if(needed != null && myBalanceCents() < needed){
          alert("Balansingizda yetarli mablag' yo'q.");
          btn.disabled = false; btn.textContent = "To'lov qilish";
          return;
        }
        fetch(API_BASE + listingId + '/upgrade-tier/balance/', {
          method: 'POST', credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify({tier: selectedTier, seller: seller, profile_id: currentProfile ? currentProfile.id : null})
        }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
          .then(function(res){
            if(res.status === 200 && res.data.ok){
              if(res.data.profile) applyProfile(res.data.profile);
              loadListings(function(){
                renderPublic();
                toast("Balansdan to'landi, e'lon " + (selectedTier==='vip'?'VIP':'TOP') + "'ga o'tkazildi!");
                openDetail(listingId, false);
              });
            } else {
              alert((res.data && res.data.error) || "Xato yuz berdi.");
              btn.disabled = false; btn.textContent = "To'lov qilish";
            }
          }).catch(function(err){
            console.error('upgrade balance xato:', err);
            alert("Xato yuz berdi.");
            btn.disabled = false; btn.textContent = "To'lov qilish";
          });
        return;
      }
      fetch(API_BASE + listingId + '/upgrade-tier/checkout/', {
        method: 'POST', credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({tier: selectedTier, seller: seller})
      }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
        .then(function(res){
          if(res.status === 200 && res.data.ok && res.data.url){
            window.location.href = res.data.url; // off to Stripe Checkout
          } else {
            alert((res.data && res.data.error) || "To'lovni boshlashda xato yuz berdi.");
            btn.disabled = false; btn.textContent = "To'lov qilish";
          }
        }).catch(function(err){
          console.error('upgrade checkout xato:', err);
          alert("Xato yuz berdi.");
          btn.disabled = false; btn.textContent = "To'lov qilish";
        });
    });
  }

  /* =========================================================
     TO'LOV (Stripe) - e'lon joylash pullik
  ==========================================================*/
  var PAYMENT_CONFIG_API = '/api/payments/config/';
  var CHECKOUT_SESSION_API = '/api/payments/create-checkout-session/';
  var CONFIRM_PAYMENT_API = '/api/payments/confirm/';
  var BALANCE_TOPUP_API = '/api/payments/create-balance-topup-session/';
  var CONFIRM_BALANCE_API = '/api/payments/confirm-balance/';
  var LISTING_FROM_BALANCE_API = '/api/payments/create-listing-from-balance/';
  var paymentInfo = {configured:false, currency:'usd', prices:{regular:400, top:800, vip:1600}};
  var postPayMethod = 'card'; // 'card' (Stripe) or 'balance'

  function loadPaymentConfig(cb){
    fetch(PAYMENT_CONFIG_API).then(function(r){ return r.json(); }).then(function(data){
      paymentInfo = data;
      updatePaymentSummary();
      if(cb) cb();
    }).catch(function(err){ console.error('payment config xato:', err); if(cb) cb(); });
  }
  function formatUsd(cents){ return '$' + (cents/100).toFixed(2); }
  function isPaidTier(){ return postTier === 'top' || postTier === 'vip'; }
  function myBalanceCents(){ return (currentProfile && currentProfile.balance_cents) || 0; }
  function tierInfoText(tier){
    var lifecycle = paymentInfo.lifecycle ? paymentInfo.lifecycle[tier] : null;
    var counts = paymentInfo.activeCounts || {};
    var stageLabels = {vip:'VIP', top:'TOP', regular:'oddiy'};
    var lifecycleText = '';
    if(lifecycle && lifecycle.length){
      var parts = lifecycle.map(function(pair){ return pair[1] + ' kun ' + stageLabels[pair[0]]; });
      var totalDays = lifecycle.reduce(function(sum,pair){ return sum + pair[1]; }, 0);
      lifecycleText = 'Muddat: ' + parts.join(' → ') + ' (jami ' + totalDays + ' kun), keyin avtomatik o\'chadi.';
    }
    var countText = 'Hozir ' + (counts[tier] != null ? counts[tier] : 0) + ' ta e\'lon ' + stageLabels[tier] + ' holatda.';
    var discountText = '';
    var discountPercent = paymentInfo.discounts ? paymentInfo.discounts[tier] : null;
    if(discountPercent && (tier === 'top' || tier === 'vip')){
      discountText = ' 🎁 Sizda ' + stageLabels[tier] + ' uchun ' + discountPercent + '% chegirma bor!';
    }
    return lifecycleText + ' ' + countText + discountText;
  }
  function updatePaymentSummary(){
    var amountEl = document.getElementById('paymentAmount');
    var finishBtn = document.getElementById('finishPostBtn');
    var methodToggle = document.getElementById('postPayMethodToggle');
    var tierInfoEl = document.getElementById('tierInfo');
    if(tierInfoEl) tierInfoEl.textContent = tierInfoText(postTier);
    if(!amountEl || !finishBtn) return;
    if(!isPaidTier()){
      amountEl.textContent = 'Bepul';
      if(methodToggle) methodToggle.classList.add('hidden');
    } else {
      var cents = paymentInfo.prices ? paymentInfo.prices[postTier] : null;
      // An admin-granted discount (see TierDiscount / admin_create_discount)
      // knocks a % off - shown as the original price struck through next
      // to the real, discounted one, so it's obvious something changed.
      var discountPercent = paymentInfo.discounts ? paymentInfo.discounts[postTier] : null;
      if(cents != null && discountPercent){
        var finalCents = Math.round(cents * (100 - discountPercent) / 100);
        amountEl.innerHTML = '<span style="text-decoration:line-through;opacity:0.5;font-size:0.7em;margin-right:6px;">' + formatUsd(cents) + '</span>' +
          formatUsd(finalCents) + ' <span style="color:var(--red);font-weight:800;font-size:0.65em;">-' + discountPercent + '%</span>';
      } else {
        amountEl.textContent = (cents != null) ? formatUsd(cents) : '—';
      }
      if(methodToggle) methodToggle.classList.remove('hidden');
      var balEl = document.getElementById('postPayBalanceAmount');
      if(balEl) balEl.textContent = formatUsd(myBalanceCents());
    }
    if(!editingListingId){
      if(!isPaidTier()){
        finishBtn.textContent = "E'lon joylash";
      } else if(postPayMethod === 'balance'){
        finishBtn.textContent = "Balansdan to'lash va joylash";
      } else {
        finishBtn.textContent = "To'lov qilish va joylash";
      }
    }
  }

  function renderUploadThumbs(){
    var wrap = document.getElementById('uploadThumbs');
    wrap.innerHTML = postPhotos.map(function(p, i){
      var state = p.uploading ? ' uploading' : (p.failed ? ' upload-failed' : '');
      return '<div class="upload-thumb'+state+'"><img src="'+p.url+'" alt="">' +
        (p.uploading ? '<span class="upload-spinner">⏳</span>' : '') +
        (p.failed ? '<span class="upload-spinner" title="Yuklanmadi">⚠️</span>' : '') +
        '<button type="button" class="rm" data-i="'+i+'">✕</button></div>';
    }).join('');
    wrap.querySelectorAll('.rm').forEach(function(btn){
      btn.addEventListener('click', function(){
        var i = Number(this.getAttribute('data-i'));
        postPhotos.splice(i,1);
        renderUploadThumbs();
        document.getElementById('uploadCount').textContent = postPhotos.length + '/10';
      });
    });
    document.getElementById('uploadTile').style.display = postPhotos.length >= 10 ? 'none' : 'flex';
  }
  function renderVoiceRecorder(){
    var box = document.getElementById('voiceRecorderBox');
    if(!box) return;
    if(postVoiceNoteUrl){
      box.innerHTML =
        '<audio controls src="'+postVoiceNoteUrl+'" style="width:100%;margin-bottom:10px;"></audio>' +
        '<div style="display:flex;gap:10px;">' +
          '<button type="button" class="qbtn" id="voiceReRecordBtn">🔁 Qayta yozish</button>' +
          '<button type="button" class="qbtn del" id="voiceRemoveBtn">🗑 O\'chirish</button>' +
        '</div>';
      document.getElementById('voiceReRecordBtn').addEventListener('click', startVoiceRecording);
      document.getElementById('voiceRemoveBtn').addEventListener('click', function(){
        postVoiceNoteId = null;
        postVoiceNoteUrl = null;
        renderVoiceRecorder();
      });
      return;
    }
    box.innerHTML = '<button type="button" class="btn-full-outline" id="voiceRecordBtn" style="margin-top:0;">🎤 Ovozli xabar yozish</button>';
    document.getElementById('voiceRecordBtn').addEventListener('click', startVoiceRecording);
  }
  function startVoiceRecording(){
    var box = document.getElementById('voiceRecorderBox');
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined'){
      toast("Bu qurilma/brauzer ovoz yozishni qo'llamaydi.");
      return;
    }
    navigator.mediaDevices.getUserMedia({audio: true}).then(function(stream){
      voiceRecorderStream = stream;
      voiceRecorderChunks = [];
      var mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      voiceRecorder = mimeType ? new MediaRecorder(stream, {mimeType: mimeType}) : new MediaRecorder(stream);
      voiceRecorder.addEventListener('dataavailable', function(e){ if(e.data && e.data.size) voiceRecorderChunks.push(e.data); });
      voiceRecorder.addEventListener('stop', function(){
        stream.getTracks().forEach(function(t){ t.stop(); });
        clearInterval(voiceRecorderTimer);
        var blob = new Blob(voiceRecorderChunks, {type: voiceRecorder.mimeType || 'audio/webm'});
        if(!blob.size){ renderVoiceRecorder(); return; }
        uploadVoiceNote(blob);
      });
      voiceRecorder.start();
      var startedAt = Date.now();
      box.innerHTML = '<button type="button" class="btn-full-black" id="voiceStopBtn" style="margin-top:0;background:var(--red);">⏹ To\'xtatish (<span id="voiceTimer">0:00</span>)</button>';
      document.getElementById('voiceStopBtn').addEventListener('click', function(){ voiceRecorder.stop(); });
      voiceRecorderTimer = setInterval(function(){
        var secs = Math.floor((Date.now()-startedAt)/1000);
        var label = document.getElementById('voiceTimer');
        if(label) label.textContent = Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');
        if(secs >= MAX_VOICE_NOTE_SECONDS){ voiceRecorder.stop(); }
      }, 250);
    }).catch(function(err){
      console.error('mic xato:', err);
      toast("Mikrofonga ruxsat berilmadi.");
    });
  }
  function uploadVoiceNote(blob){
    var box = document.getElementById('voiceRecorderBox');
    box.innerHTML = '<div class="empty-note">Yuklanmoqda...</div>';
    var localUrl = URL.createObjectURL(blob);
    var fd = new FormData();
    fd.append('audio', blob, 'voice.webm');
    fetch(VOICE_NOTES_API, {method:'POST', body: fd})
      .then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
      .then(function(res){
        if(res.status !== 200 || !res.data.ok){
          var msg = (res.status === 429)
            ? "Juda ko'p urinish, biroz kuting va qayta urinib ko'ring."
            : ((res.data && res.data.error) || "Ovozli xabarni yuklashda xato yuz berdi.");
          toast(msg);
          postVoiceNoteId = null; postVoiceNoteUrl = null;
          renderVoiceRecorder();
          return;
        }
        postVoiceNoteId = res.data.voiceNoteId;
        postVoiceNoteUrl = localUrl;
        renderVoiceRecorder();
      }).catch(function(err){
        console.error('voice note upload xato:', err);
        toast("Ovozli xabarni yuklashda xato yuz berdi.");
        postVoiceNoteId = null; postVoiceNoteUrl = null;
        renderVoiceRecorder();
      });
  }
  function uploadPhotoFile(file, entry){
    var fd = new FormData();
    fd.append('images', file);
    fetch(LISTING_IMAGES_API, {method:'POST', body: fd})
      .then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
      .then(function(res){
        var data = res.data;
        if(data.ok && data.imageIds && data.imageIds.length){
          entry.imageId = data.imageIds[0];
        } else {
          entry.failed = true;
          // Silent failure here is exactly how photos used to go
          // missing without the user noticing (the small ⚠️ on the
          // thumbnail is easy to miss) - surface it right away. The
          // server's own message (size/format/rate-limit) is more
          // accurate than a single hardcoded guess.
          var msg = (res.status === 429)
            ? "Juda ko'p rasm ketma-ket yuklandi, biroz kuting va qayta urinib ko'ring."
            : ((data && data.error) || "Bitta rasm yuklanmadi. Uni olib tashlang yoki boshqasini tanlang.");
          toast(msg);
        }
        entry.uploading = false;
        renderUploadThumbs();
      })
      .catch(function(err){
        console.error('rasm yuklashda xato:', err);
        entry.uploading = false;
        entry.failed = true;
        toast("Bitta rasm yuklanmadi. Internetni tekshirib, qayta urinib ko'ring.");
        renderUploadThumbs();
      });
  }
  function newlyUploadedImageIds(){
    return postPhotos.filter(function(p){ return p.imageId && !p.existing; }).map(function(p){ return p.imageId; });
  }

  function initPostLocationMap(){
    if(postLocationMap){ setTimeout(function(){ postLocationMap.invalidateSize(); },60); return; }
    setTimeout(function(){
      var el = document.getElementById('postLocationMap');
      if(!el || typeof L === 'undefined') return;
      postLocationMap = L.map(el, {scrollWheelZoom:false, minZoom:9, maxBounds:JIZZAX_BOUNDS, maxBoundsViscosity:1.0}).setView(JIZZAX_CENTER, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:'© OpenStreetMap', maxZoom:18}).addTo(postLocationMap);
      postLocationMarker = L.marker(JIZZAX_CENTER, {draggable:true}).addTo(postLocationMap);
      postLocationMap.on('click', function(e){ postLocationMarker.setLatLng(e.latlng); });
      setTimeout(function(){ postLocationMap.invalidateSize(); }, 60);
      // Center on the user's real current location if they allow it,
      // instead of always defaulting to the Jizzax city center. This
      // marks it with its own small fixed dot - separate from the
      // draggable property pin - so it stays visible even after the
      // property pin gets moved somewhere else (they're not always the
      // same place: posting a listing for a house you don't currently
      // live in/near is normal).
      if(navigator.geolocation){
        navigator.geolocation.getCurrentPosition(function(pos){
          var latlng = [pos.coords.latitude, pos.coords.longitude];
          var meIcon = L.divIcon({className:'my-location-dot', html:'<span></span>', iconSize:[16,16], iconAnchor:[8,8]});
          L.marker(latlng, {icon: meIcon, interactive:false, keyboard:false, zIndexOffset:-100})
            .addTo(postLocationMap)
            .bindTooltip("Sizning joylashuvingiz");
          postLocationMarker.setLatLng(latlng); // property pin still starts here, for convenience - drag it to the real spot
          postLocationMap.setView(latlng, 14);
        }, function(){ /* denied/unavailable - keep the default Jizzax center */ }, {enableHighAccuracy:true, timeout:8000});
      }
    }, 60);
  }
  function showPostStep(n){
    [1,2,3,4].forEach(function(i){ document.getElementById('postStep'+i).classList.toggle('hidden', i!==n); });
    if(n===3){ initPostLocationMap(); }
    if(n===4){
      // Re-fetch payment config WITH this poster's username so any
      // admin-granted TierDiscount for them comes back too (the app-init
      // load at loadPaymentConfig() has no username yet at that point).
      var uname = document.getElementById('profileUsername').textContent.trim();
      fetch(PAYMENT_CONFIG_API + '?username=' + encodeURIComponent(uname)).then(function(r){ return r.json(); }).then(function(data){
        paymentInfo = data;
        updatePaymentSummary();
      }).catch(function(err){ console.error('payment config (discount) xato:', err); updatePaymentSummary(); });
    }
  }

  /* =========================================================
     AUTH FLOW (telefon + kod, demo)
  ==========================================================*/
  function applyProfile(p){
    if(!p || !p.username){ console.error('applyProfile: invalid profile', p); return; }
    currentProfile = p;
    document.getElementById('profileFullName').innerHTML = escapeHtml(p.full_name || '') + (p.verified ? VERIFIED_TICK_HTML : '');
    document.getElementById('profileUsername').textContent = p.username;
    var idEl = document.getElementById('profileIdDisplay');
    if(idEl) idEl.textContent = 'ID: ' + (p.public_id || p.id);
    document.getElementById('profilePhoneDisplay').textContent = p.phone || '';
    document.getElementById('balancePhone').textContent = p.phone || '';
    var balEl = document.getElementById('balanceAmount');
    if(balEl) balEl.textContent = formatUsd(p.balance_cents || 0);
    var av = document.getElementById('myAvatar');
    av.textContent = (p.full_name || p.username || 'M').charAt(0).toUpperCase();
    updateNotifBadge();
    updatePaymentSummary();
    loadMyLikes();
  }
  function saveLoginToStorage(p){
    try{ localStorage.setItem('xonadonProfile', JSON.stringify(p)); }catch(e){}
  }
  function loadLoginFromStorage(){
    try{
      var raw = localStorage.getItem('xonadonProfile');
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  }
  function clearLoginStorage(){
    try{ localStorage.removeItem('xonadonProfile'); }catch(e){}
  }
  function requireAuth(action){
    if(isLoggedIn){ action(); return; }
    pendingAction = action;
    document.getElementById('authGate').classList.remove('hidden');
  }
  function closeAllAuth(){
    document.getElementById('authGate').classList.add('hidden');
    document.getElementById('authPhoneScreen').classList.add('hidden');
    document.getElementById('otpMethodModal').classList.add('hidden');
    document.getElementById('authCodeScreen').classList.add('hidden');
    document.getElementById('authProfileScreen').classList.add('hidden');
    stopTelegramPoll();
    resetOtpMethodModalUI();
  }
  function resetOtpMethodModalUI(){
    var introText = document.getElementById('otpIntroText');
    var waitingText = document.getElementById('otpWaitingText');
    var tgBtn = document.getElementById('otpTelegramBtn');
    if(introText) introText.classList.remove('hidden');
    if(waitingText) waitingText.classList.add('hidden');
    if(tgBtn){ tgBtn.classList.remove('hidden'); tgBtn.disabled = false; }
  }

  /* =========================================================
     TASHQI YUKLASH: HAMMA TUGMALARNI ULASH
  ==========================================================*/
  document.addEventListener('DOMContentLoaded', init);
  if(document.readyState !== 'loading') init();

  function init(){
    try{

    document.getElementById('tierToggle').querySelectorAll('button').forEach(function(b){
      b.classList.toggle('sel', b.getAttribute('data-tier')==='regular');
      b.addEventListener('click', function(){
        document.getElementById('tierToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postTier = this.getAttribute('data-tier');
        updatePaymentSummary();
      });
    });

    document.getElementById('postPayMethodToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('postPayMethodToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postPayMethod = this.getAttribute('data-method');
        updatePaymentSummary();
      });
    });

    loadListings();
    loadProfilesDirectory();
    loadPaymentConfig();
    loadCurrencyRate(function(){ renderPublic(); }); // re-render once the real rate is in, in case so'm display was already selected
    initGoogleSignIn();
    document.getElementById('langCode').textContent = 'UZ';

    document.getElementById('logoHome').addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });

    // Hero buttons just proxy the real ones - same auth/scroll behavior,
    // no duplicated logic.
    document.getElementById('heroPostBtn').addEventListener('click', function(){ document.getElementById('postAdBtn').click(); });
    document.getElementById('heroBrowseBtn').addEventListener('click', function(){
      var target = document.querySelector('.vip-section') || document.querySelector('.toolbar');
      if(target) target.scrollIntoView({behavior:'smooth', block:'start'});
    });

    document.getElementById('searchInput').addEventListener('input', function(e){
      filterState.search = e.target.value.trim();
      renderPublic();
    });

    var langBtn = document.getElementById('langBtn'), langMenu = document.getElementById('langMenu');
    langBtn.addEventListener('click', function(e){ e.stopPropagation(); langMenu.classList.toggle('open'); });
    langMenu.querySelectorAll('button').forEach(function(b){ b.addEventListener('click', function(){ applyLang(this.getAttribute('data-lang')); langMenu.classList.remove('open'); }); });

    var currencyBtn = document.getElementById('currencyBtn'), currencyMenu = document.getElementById('currencyMenu');
    currencyMenu.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-currency') === displayCurrency); });
    currencyBtn.addEventListener('click', function(e){ e.stopPropagation(); currencyMenu.classList.toggle('open'); });
    currencyMenu.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        displayCurrency = this.getAttribute('data-currency');
        try{ localStorage.setItem('displayCurrency', displayCurrency); }catch(e){}
        currencyMenu.querySelectorAll('button').forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        currencyMenu.classList.remove('open');
        renderPublic(); // re-render every visible price in the new currency
      });
    });

    document.getElementById('darkToggle').addEventListener('click', function(){
      document.body.classList.toggle('dark');
      this.classList.toggle('mode-active');
    });

    document.querySelectorAll('#segment button').forEach(function(b){
      b.addEventListener('click', function(){
        document.querySelectorAll('#segment button').forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        filterState.deal = this.getAttribute('data-deal');
        renderPublic();
      });
    });

    document.querySelectorAll('.view-controls .view-btn').forEach(function(b){
      b.addEventListener('click', function(){
        document.querySelectorAll('.view-controls .view-btn').forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        var grid = document.getElementById('regularGrid');
        grid.classList.remove('view-grid','view-list','view-compact');
        grid.classList.add('view-'+this.getAttribute('data-view'));
      });
    });

    document.getElementById('mapBtn').addEventListener('click', openMapFull);
    document.getElementById('mapSearchBtn').addEventListener('click', doMapSearch);
    document.getElementById('mapSearchInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ doMapSearch(); } });
    document.getElementById('openYandexMapBtn').addEventListener('click', function(){
      var center = fullMap ? fullMap.getCenter() : {lat: JIZZAX_CENTER[0], lng: JIZZAX_CENTER[1]};
      var zoom = fullMap ? fullMap.getZoom() : 10;
      // Yandex Maps takes ll as "longitude,latitude" (reversed from Leaflet's lat/lng).
      var url = 'https://yandex.com/maps/?ll=' + center.lng + ',' + center.lat + '&z=' + zoom;
      window.open(url, '_blank', 'noopener');
    });
    document.getElementById('mapFullBackBtn').addEventListener('click', function(){
      if(fullMap){ try{ fullMap.remove(); }catch(e){} fullMap=null; }
      stopLiveLocationIfUnused();
      showPage('pageHome'); renderPublic();
    });

    var typePill = document.getElementById('propertyTypePill'), typeDropdown = document.getElementById('typeDropdown');
    typePill.addEventListener('click', function(e){ e.stopPropagation(); typeDropdown.classList.toggle('open'); typePill.classList.toggle('open'); });
    typeDropdown.querySelectorAll('button').forEach(function(opt){
      opt.addEventListener('click', function(){
        typeDropdown.querySelectorAll('button').forEach(function(o){ o.classList.remove('active'); });
        this.classList.add('active');
        document.getElementById('typeLabel').textContent = this.textContent;
        typePill.classList.toggle('selected', this.getAttribute('data-type')!=='all');
        filterState.type = this.getAttribute('data-type');
        renderPublic();
        typeDropdown.classList.remove('open'); typePill.classList.remove('open');
      });
    });

    document.querySelectorAll('#filterPillsRow .pill[data-toggle]').forEach(function(p){
      p.addEventListener('click', function(){
        this.classList.toggle('selected');
        filterState[this.getAttribute('data-filter')] = this.classList.contains('selected');
        renderPublic();
      });
    });

    document.addEventListener('click', function(){
      langMenu.classList.remove('open');
      currencyMenu.classList.remove('open');
      typeDropdown.classList.remove('open'); typePill.classList.remove('open');
    });

    var backdrop = document.getElementById('backdrop');
    var panels = ['profileSearchPanel','notifPanel','filtersPanel','editProfilePanel','messageThreadPanel','myLikesPanel'];
    function openPanel(id){ closeAllPanels(); document.getElementById(id).classList.add('open'); backdrop.classList.add('open'); }
    function closeAllPanels(){ panels.forEach(function(p){ document.getElementById(p).classList.remove('open'); }); backdrop.classList.remove('open'); }
    backdrop.addEventListener('click', closeAllPanels);
    document.querySelectorAll('[data-close]').forEach(function(b){ b.addEventListener('click', closeAllPanels); });

    function renderSellerSearch(filter){
      var list = document.getElementById('psList');
      var sellers = combinedSellers().filter(function(s){ return s.name.toLowerCase().indexOf(filter.toLowerCase())>-1; });
      list.innerHTML = sellers.map(function(s){
        return '<div class="ps-row" data-seller="'+s.name+'"><div class="ps-avatar"></div>' +
          '<div><div class="ps-name">'+displayName(s.name)+(isSellerVerified(s.name)?VERIFIED_TICK_HTML:'')+'</div><div class="ps-handle">@'+s.name+' · '+s.count+' e\'lon</div></div></div>';
      }).join('');
      document.getElementById('psCountNum').textContent = sellers.length;
      list.querySelectorAll('[data-seller]').forEach(function(row){
        row.addEventListener('click', function(){ closeAllPanels(); openSellerProfile(this.getAttribute('data-seller'), false); });
      });
    }
    document.getElementById('profileSearchBtn').addEventListener('click', function(){
      renderSellerSearch('');
      openPanel('profileSearchPanel');
      loadProfilesDirectory(function(){ renderSellerSearch(document.getElementById('psInput').value || ''); });
    });
    document.getElementById('psInput').addEventListener('input', function(e){ renderSellerSearch(e.target.value); });
    document.getElementById('notifBtn').addEventListener('click', function(){
      requireAuth(function(){
        renderConversationsList('notifMessagesList');
        openPanel('notifPanel');
      });
    });

    function renderMyLikesPanel(){
      var wrap = document.getElementById('myLikesList');
      var mine = listings.filter(function(l){ return myLikedIds.indexOf(l.id) !== -1; });
      if(!mine.length){
        wrap.innerHTML = '<div class="empty-state"><div class="emoji-box">🤍</div><p>Hali hech qanday e\'longa layk bosmagansiz</p></div>';
        return;
      }
      wrap.innerHTML = mine.map(function(l){
        return '<div class="listing" data-id="'+l.id+'"><div class="thumb"><img src="'+l.img+'" alt=""></div>' +
          '<div class="body"><div class="price">'+formatPrice(l)+'</div><div class="desc">'+l.title+', '+trValue(l.district)+'</div></div></div>';
      }).join('');
      wrap.querySelectorAll('[data-id]').forEach(function(el){
        el.addEventListener('click', function(){ closeAllPanels(); openDetail(Number(this.getAttribute('data-id')), false); });
      });
    }
    document.getElementById('myLikesBtn').addEventListener('click', function(){
      requireAuth(function(){
        loadMyLikes(function(){
          renderMyLikesPanel();
          openPanel('myLikesPanel');
        });
      });
    });

    document.getElementById('filtersBtn').addEventListener('click', function(){ openPanel('filtersPanel'); });
    document.getElementById('applyFiltersBtn').addEventListener('click', function(){
      var pf = document.getElementById('priceFromInput').value.trim();
      var pt = document.getElementById('priceToInput').value.trim();
      var rooms = document.getElementById('roomsInput').value.trim();
      filterState.priceMin = pf ? parseInt(pf,10) : null;
      filterState.priceMax = pt ? parseInt(pt,10) : null;
      filterState.rooms = rooms ? parseInt(rooms,10) || null : null;
      filterState.district = document.getElementById('filterDistrict').value || null;
      closeAllPanels();
      renderPublic();
      toast('Filtrlar qo\'llandi.');
    });
    document.getElementById('resetFiltersBtn').addEventListener('click', function(){
      document.getElementById('priceFromInput').value='';
      document.getElementById('priceToInput').value='';
      document.getElementById('roomsInput').value='';
      document.getElementById('filterDistrict').value='';
      filterState.priceMin=null; filterState.priceMax=null; filterState.rooms=null; filterState.district=null;
      renderPublic();
    });

    document.getElementById('adminLoginForm').addEventListener('submit', loginAdmin);
    document.getElementById('loginCloseBtn').addEventListener('click', function(){
      // On /panel/, the login modal is the only thing on screen - closing
      // it must not fall through to the public site underneath.
      if(PANEL_ROUTE) return;
      closeModal('adminLoginModal');
    });
    // No admin button anywhere on the site anymore - the only way in is
    // knowing the hidden /panel/ URL. That route shows ONLY the login
    // modal - the public homepage underneath is hidden, not just covered.
    if(PANEL_ROUTE){
      document.getElementById('pageHome').classList.remove('show');
      openModal('adminLoginModal');
    }
    document.getElementById('adminLogoutBtn').addEventListener('click', logoutAdmin);
    document.getElementById('statsAdminLogoutBtn').addEventListener('click', logoutAdmin);
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(function(b){ b.addEventListener('click', function(){ setAdminTab(this.getAttribute('data-tab')); }); });
    document.querySelectorAll('.overlay').forEach(function(ov){
      ov.addEventListener('click', function(e){
        if(e.target!==ov) return;
        // Same rule as the close-x: on /panel/, clicking the backdrop of
        // the login modal must not reveal the public site.
        if(PANEL_ROUTE && ov.id==='adminLoginModal') return;
        ov.classList.remove('show');
      });
    });

    document.getElementById('detailBackBtn').addEventListener('click', returnFromDetail);
    document.getElementById('sellerProfileBackBtn').addEventListener('click', returnFromSellerProfile);

    document.querySelectorAll('[data-info]').forEach(function(link){
      link.addEventListener('click', function(e){ e.preventDefault(); showPage(this.getAttribute('data-info')); });
    });
    ['aloqaBackBtn','yordamBackBtn','reklamaBackBtn','ofertaBackBtn'].forEach(function(id){
      var b = document.getElementById(id);
      if(b) b.addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });
    });

    document.getElementById('avatarBtn').addEventListener('click', function(){
      requireAuth(function(){ showPage('pageMyProfile'); switchProfileSub('profil'); renderMyListings(); });
    });
    document.getElementById('myProfileBackBtn').addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });

    // ---- mobil pastki panel (faqat telefon ekranida ko'rinadi) ----
    var mtabHomeBtn = document.getElementById('mtabHome');
    if(mtabHomeBtn) mtabHomeBtn.addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });
    var mtabSearchBtn = document.getElementById('mtabSearch');
    if(mtabSearchBtn) mtabSearchBtn.addEventListener('click', function(){
      showPage('pageHome'); renderPublic(); setMobileTab('Search');
      var si = document.getElementById('searchInput');
      if(si){ si.scrollIntoView({block:'center'}); si.focus(); }
    });
    var mtabPostBtn = document.getElementById('mtabPost');
    if(mtabPostBtn) mtabPostBtn.addEventListener('click', function(){ document.getElementById('postAdBtn').click(); });
    var mtabMessagesBtn = document.getElementById('mtabMessages');
    if(mtabMessagesBtn) mtabMessagesBtn.addEventListener('click', function(){
      requireAuth(function(){
        showPage('pageMyProfile');
        document.querySelectorAll('.profile-nav-item[data-sub]').forEach(function(i){ i.classList.remove('active'); });
        var navItem = document.querySelector('.profile-nav-item[data-sub="xabarlar"]');
        if(navItem) navItem.classList.add('active');
        switchProfileSub('xabarlar');
        setMobileTab('Messages');
      });
    });
    var mtabProfileBtn = document.getElementById('mtabProfile');
    if(mtabProfileBtn) mtabProfileBtn.addEventListener('click', function(){
      requireAuth(function(){ showPage('pageMyProfile'); switchProfileSub('profil'); renderMyListings(); setMobileTab('Profile'); });
    });
    document.querySelectorAll('.profile-nav-item[data-sub]').forEach(function(item){
      item.addEventListener('click', function(){
        document.querySelectorAll('.profile-nav-item[data-sub]').forEach(function(i){ i.classList.remove('active'); });
        this.classList.add('active');
        switchProfileSub(this.getAttribute('data-sub'));
      });
    });
    function switchProfileSub(sub){
      ['profil','balans','xabarlar','tasdiqlash'].forEach(function(s){ document.getElementById('sub-'+s).classList.toggle('hidden', s!==sub); });
      if(sub === 'xabarlar'){ renderConversationsList(); }
      if(sub === 'tasdiqlash'){ renderVerifyBox(); }
    }
    function renderVerifyBox(){
      var box = document.getElementById('verifyBoxContent');
      var username = myUsername();
      box.innerHTML = '<div class="empty-note">Yuklanmoqda...</div>';
      fetch(VERIFICATION_STATUS_API + '?username=' + encodeURIComponent(username))
        .then(function(r){ return r.json(); })
        .then(function(s){
          if(s.verified){
            box.innerHTML = '<div class="badge">✓</div><h3>Profilingiz tasdiqlangan</h3>' +
              '<p style="color:rgba(var(--ink-rgb),0.6);font-size:13.5px;">Ismingiz yonida tasdiqlash belgisi ko\'rinadi.</p>';
            return;
          }
          if(s.pending){
            box.innerHTML = '<div class="badge">⏳</div><h3>Ko\'rib chiqilmoqda</h3>' +
              '<p style="color:rgba(var(--ink-rgb),0.6);font-size:13.5px;">Hujjatlaringiz yuborildi, admin tez orada ko\'rib chiqadi.</p>';
            return;
          }
          box.innerHTML =
            '<div class="badge">✓</div>' +
            '<h3>Profilingizni tasdiqlang</h3>' +
            '<p style="color:rgba(var(--ink-rgb),0.6);font-size:13.5px;margin-bottom:20px;">Ismingiz yonida belgi paydo bo\'ladi — foydalanuvchilar sizga ko\'proq ishonadi.</p>' +
            '<div style="display:flex;gap:14px;text-align:left;">' +
              '<div style="flex:1;">' +
                '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">📄 Pasport/ID rasmi</div>' +
                '<div class="upload-tile" id="verifyIdTile" style="width:100%;height:110px;font-size:26px;">📄</div>' +
                '<input type="file" id="verifyIdInput" accept="image/*" class="hidden">' +
              '</div>' +
              '<div style="flex:1;">' +
                '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">🤳 Hujjatli selfie</div>' +
                '<div class="upload-tile" id="verifySelfieTile" style="width:100%;height:110px;font-size:26px;">🤳</div>' +
                '<input type="file" id="verifySelfieInput" accept="image/*" class="hidden">' +
              '</div>' +
            '</div>' +
            '<button class="btn-full-black" id="verifySubmitBtn" style="margin-top:18px;">Yuborish</button>';

          var idFile = null, selfieFile = null;
          function wireTile(tileId, inputId, onPick){
            var tile = document.getElementById(tileId);
            var input = document.getElementById(inputId);
            tile.addEventListener('click', function(){ input.click(); });
            input.addEventListener('change', function(e){
              var f = e.target.files[0];
              if(!f) return;
              onPick(f);
              tile.style.backgroundImage = 'url(' + URL.createObjectURL(f) + ')';
              tile.style.backgroundSize = 'cover';
              tile.style.backgroundPosition = 'center';
              tile.textContent = '';
            });
          }
          wireTile('verifyIdTile', 'verifyIdInput', function(f){ idFile = f; });
          wireTile('verifySelfieTile', 'verifySelfieInput', function(f){ selfieFile = f; });

          document.getElementById('verifySubmitBtn').addEventListener('click', function(){
            if(!idFile || !selfieFile){ toast("Iltimos, ikkala rasmni ham tanlang."); return; }
            var btn = this;
            btn.disabled = true; btn.textContent = 'Yuborilmoqda...';
            var fd = new FormData();
            fd.append('username', username);
            fd.append('id_photo', idFile);
            fd.append('selfie_photo', selfieFile);
            fetch(SUBMIT_VERIFICATION_API, {method:'POST', body: fd})
              .then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
              .then(function(res){
                if(res.status !== 200 || !res.data.ok){
                  toast((res.data && res.data.error) || "Yuborishda xato yuz berdi.");
                  btn.disabled = false; btn.textContent = 'Yuborish';
                  return;
                }
                toast("Yuborildi! Admin ko'rib chiqadi.");
                renderVerifyBox();
              }).catch(function(err){
                console.error('verify submit xato:', err);
                toast("Yuborishda xato yuz berdi.");
                btn.disabled = false; btn.textContent = 'Yuborish';
              });
          });
        }).catch(function(err){
          console.error('verify status xato:', err);
          box.innerHTML = '<div class="empty-note">Yuklashda xato yuz berdi.</div>';
        });
    }
    document.getElementById('threadSendBtn').addEventListener('click', sendThreadMessage);
    document.getElementById('threadInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ sendThreadMessage(); } });
    document.getElementById('logoutBtn').addEventListener('click', function(){ isLoggedIn=false; clearLoginStorage(); showPage('pageHome'); renderPublic(); });

    function renderMyListings(){
      var username = document.getElementById('profileUsername').textContent.trim();
      var mine = listings.filter(function(l){ return l.seller === username; });
      document.getElementById('myAdsCount').textContent = mine.length;
      document.getElementById('myViewsCount').textContent = mine.reduce(function(sum,l){ return sum + (l.viewsCount||0); }, 0);
      document.getElementById('myLikesCount').textContent = mine.reduce(function(sum,l){ return sum + (l.likesCount||0); }, 0);
      // Sold listings vanish from `listings` the instant they're marked
      // sold (no grace period), so the count comes from the server's
      // sold-snapshot history instead of filtering `mine` locally.
      fetch('/api/listings/my-sold-count/?seller=' + encodeURIComponent(username))
        .then(function(r){ return r.json(); })
        .then(function(d){ document.getElementById('mySoldCount').textContent = d.soldCount || 0; })
        .catch(function(){ document.getElementById('mySoldCount').textContent = 0; });
      var box = document.getElementById('myProfileTabContent');
      if(!mine.length){
        box.innerHTML = '<div class="empty-state"><div class="emoji-box">🏠</div><p>Sizda hali e\'lonlar yo\'q</p></div>';
        return;
      }
      box.innerHTML = '<div class="grid" style="padding:16px 0;">' + mine.map(function(l){
        return '<div class="listing" data-id="'+l.id+'"><div class="thumb"><img src="'+l.img+'" alt=""></div>' +
          '<div class="body"><div class="price">'+formatPrice(l)+'</div><div class="desc">'+l.title+'</div>' +
          '<div class="meta" style="gap:8px;"><button type="button" class="qbtn" data-edit="'+l.id+'">Tahrirlash</button>' +
          '<button type="button" class="qbtn del" data-delmine="'+l.id+'">O\'chirish</button></div></div></div>';
      }).join('') + '</div>';
      box.querySelectorAll('[data-id]').forEach(function(el){ el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), false); }); });
      box.querySelectorAll('[data-edit]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          var l = findListing(Number(this.getAttribute('data-edit')));
          if(l) openEditListing(l);
        });
      });
      box.querySelectorAll('[data-delmine]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          var id = Number(this.getAttribute('data-delmine'));
          if(!confirm("E'lonni o'chirishni tasdiqlaysizmi?")) return;
          fetch(API_BASE + id + '/', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: csrfHeaders({'Content-Type': 'application/json'}),
            body: JSON.stringify({seller: username})
          }).then(function(r){
            if(r.status === 403){ toast("Bu e'lonni o'chirishga ruxsatingiz yo'q."); return; }
            loadListings(function(){ renderMyListings(); toast("E'lon o'chirildi."); });
          }).catch(function(err){ console.error('delete mine xato:', err); toast("O'chirishda xato yuz berdi."); });
        });
      });
    }
    function renderTanlanganTab(){
      var box = document.getElementById('myProfileTabContent');
      box.innerHTML = '<div class="empty-admin">Yuklanmoqda...</div>';
      loadMyLikes(function(){
        var mine = listings.filter(function(l){ return myLikedIds.indexOf(l.id) !== -1; });
        if(!mine.length){
          box.innerHTML = '<div class="empty-state"><div class="emoji-box">⭐</div><p>Sevimlilar ro\'yxati bo\'sh</p></div>';
          return;
        }
        box.innerHTML = '<div class="grid" style="padding:16px 0;">' + mine.map(function(l){
          return '<div class="listing" data-id="'+l.id+'"><div class="thumb"><img src="'+l.img+'" alt=""></div>' +
            '<div class="body"><div class="price">'+formatPrice(l)+'</div><div class="desc">'+l.title+'</div></div></div>';
        }).join('') + '</div>';
        box.querySelectorAll('[data-id]').forEach(function(el){
          el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), false); });
        });
      });
    }
    document.querySelectorAll('.profile-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        document.querySelectorAll('.profile-tab').forEach(function(t){ t.classList.remove('active'); });
        this.classList.add('active');
        if(this.getAttribute('data-ptab')==='elonlar'){ renderMyListings(); }
        else { renderTanlanganTab(); }
      });
    });

    document.getElementById('editProfileBtn').addEventListener('click', function(){
      document.getElementById('editFullNameInput').value = document.getElementById('profileFullName').textContent.trim();
      document.getElementById('editUsernameInput').value = document.getElementById('profileUsername').textContent.trim();
      document.getElementById('editPhoneInput').value = document.getElementById('profilePhoneDisplay').textContent.trim();
      openPanel('editProfilePanel');
    });
    document.getElementById('saveProfileBtn').addEventListener('click', function(){
      var fullName = document.getElementById('editFullNameInput').value.trim();
      var username = document.getElementById('editUsernameInput').value.trim();
      var phone = document.getElementById('editPhoneInput').value.trim();
      if(!fullName || !username){ alert("Iltimos, ism va foydalanuvchi nomini to'ldiring."); return; }
      if(phone.replace(/\D/g,'').length < 9){ alert("Iltimos, telefon raqamni to'liq kiriting."); return; }
      if(!currentProfile || !currentProfile.id){ alert("Profil topilmadi. Iltimos, qayta kiring."); return; }

      var saveBtn = this;
      saveBtn.disabled = true;
      fetch(PROFILE_API + currentProfile.id + '/', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({full_name: fullName, username: username, phone: phone})
      }).then(function(r){ return r.json(); }).then(function(updated){
        // Persist for real - this used to only touch the DOM, so a page
        // reload (or messaging under 'me') would silently revert to the
        // old username, which is exactly why messages could look like
        // they never reached the right person.
        applyProfile(updated);
        saveLoginToStorage(updated);
        closeAllPanels();
        renderMyListings();
        toast('Profil yangilandi.');
      }).catch(function(err){
        console.error('save profile xato:', err);
        alert("Profilni saqlashda xato yuz berdi.");
      }).finally(function(){ saveBtn.disabled = false; });
    });

    document.querySelectorAll('#quickAmounts button').forEach(function(b){
      b.addEventListener('click', function(){
        document.querySelectorAll('#quickAmounts button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        document.getElementById('amountInput').value = this.getAttribute('data-v');
      });
    });
    document.getElementById('topUpBtn').addEventListener('click', function(){
      if(!currentProfile || !currentProfile.id){ alert("Profil topilmadi. Iltimos, qayta kiring."); return; }
      if(!paymentInfo.configured){ alert("To'lov tizimi hali sozlanmagan."); return; }
      var raw = document.getElementById('amountInput').value.trim();
      var usd = parseFloat(raw.replace(',', '.'));
      if(!usd || isNaN(usd) || usd < 1){ alert("Iltimos, kamida $1 miqdorida summa kiriting."); return; }
      var cents = Math.round(usd * 100);
      var btn = this;
      btn.disabled = true;
      btn.textContent = "Yo'naltirilmoqda...";
      fetch(BALANCE_TOPUP_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({profile_id: currentProfile.id, amount_cents: cents})
      }).then(function(r){ return r.json().then(function(data){ return {status:r.status, data:data}; }); })
        .then(function(res){
          if(res.status === 200 && res.data.ok && res.data.url){
            window.location.href = res.data.url;
          } else {
            alert((res.data && res.data.error) || "To'lovni boshlashda xato yuz berdi.");
            btn.disabled = false;
            btn.textContent = "Stripe orqali to'ldirish";
          }
        })
        .catch(function(err){
          console.error('topUpBtn xato:', err);
          alert("To'lovni boshlashda xato yuz berdi.");
          btn.disabled = false;
          btn.textContent = "Stripe orqali to'ldirish";
        });
    });
    document.getElementById('postAdBtn').addEventListener('click', function(){
      requireAuth(function(){
        showPage('pagePost');
        editingListingId = null;
        postTier = 'regular';
        postPayMethod = 'card';
        document.getElementById('postPayMethodToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-method')==='card'); });
        document.getElementById('tierToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-tier')==='regular'); });
        document.getElementById('paymentSummary').classList.remove('hidden');
        var finishBtn = document.getElementById('finishPostBtn');
        finishBtn.textContent = "E'lon joylash";
        finishBtn.disabled = false;
        postRole=''; postCat=''; postDeal='sotuv'; postTypeKey='kvartira'; postRepair="Ta'mirni tanlang"; postCondition="Yangi bino"; postMortgage=false; postCurrency='ye'; postIsBuyer=false;
        document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-m')==='0'); });
        updateMortgageFieldVisibility();
        updateConditionFieldVisibility();
        updatePropertyTypeOptions();
        updateLandFieldVisibility();
        updateBuyerFieldVisibility();
        // Not editing anything yet - "Reklama qilish" only applies to an
        // already-live listing, hide any stale box left from a previous edit.
        document.getElementById('upgradeTierField').classList.add('hidden');
        document.getElementById('currencyToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-currency')==='ye'); });
        document.getElementById('priceRangeCurrencyToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-currency')==='ye'); });
        postPhotos = [];
        renderUploadThumbs();
        document.getElementById('uploadCount').textContent = '0/10';
        postVoiceNoteId = null; postVoiceNoteUrl = null;
        renderVoiceRecorder();
        document.getElementById('postTitle').value='';
        document.getElementById('postDesc').value='';
        document.getElementById('postPhone').value='+998';
        document.getElementById('postPrice').value='';
        document.getElementById('postPriceMin').value='';
        document.getElementById('postPriceMax').value='';
        document.getElementById('postFloor').value='';
        document.getElementById('postFloorsTotal').value='';
        document.getElementById('postArea').value='';
        document.getElementById('postRooms').value='';
        document.getElementById('postRepair').value="Ta'mirni tanlang";
        document.getElementById('postDistrict').value='';
        document.getElementById('condToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-c')==='Yangi bino'); });
        showPostStep(1);
      });
    });
    document.querySelectorAll('#postStep1 [data-role]').forEach(function(row){
      row.addEventListener('click', function(){
        postRole = this.getAttribute('data-role');
        postDeal = this.getAttribute('data-deal');
        postIsBuyer = this.getAttribute('data-buyer') === '1';
        updateMortgageFieldVisibility();
        updateConditionFieldVisibility();
        updatePropertyTypeOptions();
        updateLandFieldVisibility();
        updateBuyerFieldVisibility();
        showPostStep(2);
      });
    });
    document.querySelectorAll('#postStep2 [data-cat]').forEach(function(row){
      row.addEventListener('click', function(){
        postCat = this.getAttribute('data-cat');
        postTypeKey = this.getAttribute('data-typekey');
        document.getElementById('bcRole').textContent = postRole;
        document.getElementById('bcCat').textContent = postCat;
        updateLandFieldVisibility();
        showPostStep(3);
      });
    });
    document.getElementById('postBack').addEventListener('click', function(){
      if(editingListingId){
        editingListingId = null;
        document.getElementById('paymentSummary').classList.remove('hidden');
        document.getElementById('finishPostBtn').disabled = false;
        updatePaymentSummary();
        showPage('pageMyProfile'); switchProfileSub('profil'); renderMyListings();
        return;
      }
      if(!document.getElementById('postStep4').classList.contains('hidden')){ showPostStep(3); return; }
      if(!document.getElementById('postStep3').classList.contains('hidden')){ showPostStep(2); return; }
      if(!document.getElementById('postStep2').classList.contains('hidden')){ showPostStep(1); return; }
      showPage('pageHome'); renderPublic();
    });

    document.getElementById('postContinueBtn').addEventListener('click', function(){
      var err = validatePostForm();
      if(err){ alert(err); return; }
      if(postIsBuyer){
        // A buyer's "qidiryapman" listing always stays oddiy - skip the
        // TOP/VIP/payment step entirely and post straight away.
        postTier = 'regular';
        submitPostPayload(this);
        return;
      }
      showPostStep(4);
    });

    document.getElementById('condToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('condToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postCondition = this.getAttribute('data-c');
      });
    });
    document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postMortgage = this.getAttribute('data-m') === '1';
      });
    });
    document.getElementById('postRepair').addEventListener('change', function(){ postRepair = this.value; });
    // Narx maydoni - valyuta alohida tugmalar orqali tanlanadi, shu
    // sabab bu yerda faqat raqam kiritishga ruxsat beriladi.
    document.getElementById('postPrice').addEventListener('input', function(){
      var digitsOnly = this.value.replace(/[^0-9]/g, '');
      if(digitsOnly !== this.value) this.value = digitsOnly;
    });
    document.getElementById('currencyToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('currencyToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postCurrency = this.getAttribute('data-currency');
      });
    });
    // Same postCurrency, just the toggle shown next to the buyer's
    // budget-range inputs instead of the seller's single price input.
    document.getElementById('priceRangeCurrencyToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('priceRangeCurrencyToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postCurrency = this.getAttribute('data-currency');
      });
    });
    document.getElementById('postPriceMin').addEventListener('input', function(){
      var digitsOnly = this.value.replace(/[^0-9]/g, '');
      if(digitsOnly !== this.value) this.value = digitsOnly;
    });
    document.getElementById('postPriceMax').addEventListener('input', function(){
      var digitsOnly = this.value.replace(/[^0-9]/g, '');
      if(digitsOnly !== this.value) this.value = digitsOnly;
    });

    renderUploadThumbs();
    document.getElementById('uploadTile').addEventListener('click', function(){ document.getElementById('postFileInput').click(); });
    document.getElementById('postFileInput').addEventListener('change', function(e){
      var files = Array.from(e.target.files || []);
      files.forEach(function(file){
        if(postPhotos.length >= 10) return;
        if(!file.type || file.type.indexOf('image/') !== 0) return;
        var entry = {url: URL.createObjectURL(file), imageId: null, uploading: true, failed: false, existing: false};
        postPhotos.push(entry);
        uploadPhotoFile(file, entry); // uploads immediately - the actual bug being fixed
      });
      renderUploadThumbs();
      document.getElementById('uploadCount').textContent = postPhotos.length + '/10';
      e.target.value = '';
    });

    document.getElementById('finishPostBtn').addEventListener('click', function(){
      var err = validatePostForm();
      if(err){ alert(err); return; }
      if(!editingListingId && isPaidTier() && postPayMethod === 'card' && !paymentInfo.configured){
        alert("To'lov tizimi hali sozlanmagan. Iltimos, keyinroq urinib ko'ring.");
        return;
      }
      submitPostPayload(this);
    });

    // Coming back from Stripe Checkout (success or cancel) - confirm and
    // finish creating the listing, or let the user know it was cancelled.
    (function handlePaymentReturn(){
      var params = new URLSearchParams(window.location.search);
      var outcome = params.get('post_payment');
      if(!outcome) return;
      var sessionId = params.get('session_id');
      history.replaceState(null, '', window.location.pathname);

      if(outcome === 'cancelled'){
        toast("To'lov bekor qilindi.");
        return;
      }
      if(outcome === 'success' && sessionId){
        toast("To'lov tasdiqlanmoqda...");
        fetch(CONFIRM_PAYMENT_API + '?session_id=' + encodeURIComponent(sessionId))
          .then(function(r){ return r.json(); })
          .then(function(res){
            if(res.ok && res.listing){
              loadListings(function(){
                renderPublic();
                toast("To'lov qabul qilindi, e'lon joylandi!");
                openDetail(res.listing.id, false);
              });
            } else {
              toast("To'lov hali tasdiqlanmadi. Bir ozdan so'ng qayta urinib ko'ring.");
            }
          }).catch(function(err){ console.error('confirm payment xato:', err); toast("To'lovni tasdiqlashda xato yuz berdi."); });
      }
    })();

    // Same idea, but for a balance top-up instead of a listing purchase.
    (function handleBalanceTopupReturn(){
      var params = new URLSearchParams(window.location.search);
      var outcome = params.get('balance_payment');
      if(!outcome) return;
      var sessionId = params.get('session_id');
      history.replaceState(null, '', window.location.pathname);

      if(outcome === 'cancelled'){
        toast("To'lov bekor qilindi.");
        return;
      }
      if(outcome === 'success' && sessionId){
        toast("To'lov tasdiqlanmoqda...");
        fetch(CONFIRM_BALANCE_API + '?session_id=' + encodeURIComponent(sessionId))
          .then(function(r){ return r.json(); })
          .then(function(res){
            if(res.ok && res.profile){
              applyProfile(res.profile);
              saveLoginToStorage(res.profile);
              toast('Balans to\'ldirildi!');
            } else {
              toast("To'lov hali tasdiqlanmadi. Bir ozdan so'ng qayta urinib ko'ring.");
            }
          }).catch(function(err){ console.error('confirm balance xato:', err); toast("To'lovni tasdiqlashda xato yuz berdi."); });
      }
    })();

    document.getElementById('authGateCancel').addEventListener('click', function(){ document.getElementById('authGate').classList.add('hidden'); pendingAction=null; });
    document.getElementById('authGateEnter').addEventListener('click', function(){
      document.getElementById('authGate').classList.add('hidden');
      document.getElementById('authPhoneScreen').classList.remove('hidden');
    });
    document.getElementById('authPhoneClose').addEventListener('click', function(){ closeAllAuth(); pendingAction=null; });
    document.getElementById('guestBtn').addEventListener('click', function(){ closeAllAuth(); pendingAction=null; });
    document.getElementById('simpleRegisterBtn').addEventListener('click', function(){
      var fullName = document.getElementById('simpleRegName').value.trim();
      var phone = document.getElementById('simpleRegPhone').value.trim();
      if(!fullName){ alert("Ism familiyangizni kiriting."); return; }
      if(!phone){ alert("Telefon raqamingizni kiriting."); return; }
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Kirilmoqda...';
      fetch(SIMPLE_REGISTER_API, {
        method: 'POST', credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({full_name: fullName, phone: phone})
      }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
        .then(function(res){
          btn.disabled = false;
          btn.textContent = "Oddiy ro'yxatdan o'tish";
          if((res.status !== 200 && res.status !== 201) || !res.data.ok){
            alert((res.data && res.data.error) || "Ro'yxatdan o'tishda xato yuz berdi.");
            return;
          }
          isLoggedIn = true;
          var p = res.data.profile;
          applyProfile(p);
          saveLoginToStorage(p);
          loadProfilesDirectory();
          closeAllAuth();
          if(pendingAction){ pendingAction(); pendingAction=null; }
        }).catch(function(err){
          console.error('simple register xato:', err);
          alert("Ro'yxatdan o'tishda xato yuz berdi.");
          btn.disabled = false;
          btn.textContent = "Oddiy ro'yxatdan o'tish";
        });
    });

    // Phone -> code, no intermediate "choose method"/"open Telegram" step:
    // Telegram's Gateway API delivers the code straight to whichever
    // Telegram account is registered under the typed phone number, so
    // there's nothing to open or share - just wait for the code.
    function showCodeScreen(){
      var phone = document.getElementById('phoneInput').value.trim();
      document.getElementById('codeSubLabel').textContent = phone + " raqamiga Telegram orqali yuborilgan 6 xonali kod";
      document.getElementById('authCodeScreen').classList.remove('hidden');
      var boxes = document.querySelectorAll('#codeBoxes input');
      boxes.forEach(function(b){ b.value=''; });
      boxes[0].focus();
    }
    // Phone/Telegram-code login retired in favor of "Sign in with
    // Google" (initGoogleSignIn/handleGoogleCredential below) - the
    // phoneNextBtn entry point is gone from authPhoneScreen, so nothing
    // calls showCodeScreen()/starts the Telegram flow anymore. The
    // screens/handlers below are left in place (harmless, unreachable)
    // rather than torn out, to keep this change small and low-risk.
    var codeBoxes = document.querySelectorAll('#codeBoxes input');
    codeBoxes.forEach(function(box,i){
      box.addEventListener('input', function(){
        this.value = this.value.replace(/\D/g,'').slice(0,1);
        if(this.value && i < codeBoxes.length-1) codeBoxes[i+1].focus();
      });
      box.addEventListener('keydown', function(e){ if(e.key==='Backspace' && !this.value && i>0) codeBoxes[i-1].focus(); });
    });
    document.getElementById('authCodeClose').addEventListener('click', function(){ closeAllAuth(); pendingAction=null; });
    document.getElementById('resendLink').addEventListener('click', function(){
      var phone = document.getElementById('phoneInput').value.trim();
      if(!phone){ toast("Qaytadan urinib ko'ring."); return; }
      fetch(TELEGRAM_START_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({phone: phone})
      }).then(function(r){ return r.json(); })
        .then(function(d){
          if(d.ok){ telegramVerifyToken = d.token; toast("Kod qayta yuborildi."); }
          else { toast(d.error || "Xato yuz berdi."); }
        }).catch(function(){ toast("Xato yuz berdi."); });
    });
    document.getElementById('codeConfirmBtn').addEventListener('click', function(ev){
      if(ev && ev.preventDefault) ev.preventDefault();
      try{
        var code = Array.from(codeBoxes).map(function(b){ return b.value; }).join('');
        if(code.length < 6){ alert("Iltimos, 6 xonali kodni to'liq kiriting."); return; }
        if(!telegramVerifyToken){ alert("Tasdiqlash seansi topilmadi. Qaytadan urinib ko'ring."); return; }

        var confirmBtn = this;
        confirmBtn.disabled = true;
        fetch(TELEGRAM_VERIFY_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify({token: telegramVerifyToken, code: code})
        }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
          .then(function(res){
            confirmBtn.disabled = false;
            if(res.status !== 200 || !res.data.ok){
              alert((res.data && res.data.error) || "Kod noto'g'ri. Qaytadan urinib ko'ring.");
              return;
            }
            finishTelegramLogin(res.data.phone);
          }).catch(function(err){
            confirmBtn.disabled = false;
            console.error('telegram verify xato:', err);
            alert("Kodni tekshirishda xato yuz berdi.");
          });
      }catch(err){ console.error('codeConfirmBtn xato:', err); }
      return false;
    });
    function finishTelegramLogin(verifiedPhone){
      try{
        var phone = verifiedPhone || document.getElementById('phoneInput').value.trim();
        telegramVerifyToken = null;
        telegramDeepLink = null;

        fetch(PROFILE_API + '?phone=' + encodeURIComponent(phone))
          .then(function(r){ return r.json(); })
          .then(function(existing){
            if(existing.length){
              // Reuse the EXISTING profile as-is (id, username, full_name,
              // everything) - never regenerate/overwrite the username from
              // whatever they typed this time. The username is the stable
              // identity every listing and message is tied to; silently
              // changing it here is exactly what fragmented one person
              // into multiple disconnected "accounts" before.
              isLoggedIn = true;
              var p = existing[0];
              applyProfile(p);
              saveLoginToStorage(p);
              closeAllAuth();
              if(pendingAction){ pendingAction(); pendingAction=null; }
            } else {
              // Brand-new phone: only NOW ask for full name + site
              // username, after the phone itself is already verified.
              document.getElementById('authCodeScreen').classList.add('hidden');
              document.getElementById('newProfilePhone').value = phone;
              document.getElementById('profileFullNameInput').value = '';
              document.getElementById('profileUsernameInput').value = '';
              document.getElementById('authProfileScreen').classList.remove('hidden');
            }
          }).catch(function(err){ console.error('profile fetch xato:', err); });
      }catch(err){ console.error('finishTelegramLogin xato:', err); }
    }

    function handleGoogleCredential(response){
      // response.credential is a signed JWT from Google - we never see
      // or handle the user's actual Google password, only this token,
      // which the backend verifies with Google before trusting it.
      try{
        fetch(GOOGLE_AUTH_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify({credential: response.credential})
        }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
          .then(function(res){
            if((res.status !== 200 && res.status !== 201) || !res.data.ok){
              alert((res.data && res.data.error) || "Google bilan kirishda xato yuz berdi.");
              return;
            }
            isLoggedIn = true;
            var p = res.data.profile;
            applyProfile(p);
            saveLoginToStorage(p);
            loadProfilesDirectory();
            closeAllAuth();
            if(pendingAction){ pendingAction(); pendingAction=null; }
          }).catch(function(err){
            console.error('google auth xato:', err);
            alert("Google bilan kirishda xato yuz berdi.");
          });
      }catch(err){ console.error('handleGoogleCredential xato:', err); }
    }
    function initGoogleSignIn(){
      var clientIdEl = document.getElementById('googleClientId');
      var clientId = clientIdEl ? clientIdEl.getAttribute('data-client-id') : '';
      if(!clientId) return; // not configured yet (no GOOGLE_CLIENT_ID env var) - button stays empty
      var attempts = 0;
      (function ready(){
        if(!window.google || !window.google.accounts || !window.google.accounts.id){
          if(++attempts > 50) return; // ~10s - gsi script failed to load, give up quietly
          setTimeout(ready, 200);
          return;
        }
        // use_fedcm_for_button: Chrome endi uchinchi tomon cookie'larini
        // bloklaydi, shu sabab GSI'ning eski popup/iframe usuli
        // (accounts.google.com/gsi/transform) bo'sh oq oyna sifatida
        // qotib qoladi. FedCM - brauzerning o'z hisob tanlash oynasi -
        // bunga bog'liq emas, shuning uchun ishonchli ishlaydi.
        google.accounts.id.initialize({client_id: clientId, callback: handleGoogleCredential, use_fedcm_for_button: true});
        var btnEl = document.getElementById('googleSignInBtn');
        if(btnEl){
          google.accounts.id.renderButton(btnEl, {theme:'outline', size:'large', width:320, text:'continue_with'});
        }
      })();
    }

    document.getElementById('authProfileSubmitBtn').addEventListener('click', function(ev){
      if(ev && ev.preventDefault) ev.preventDefault();
      try{
        var fullName = document.getElementById('profileFullNameInput').value.trim();
        var username = document.getElementById('profileUsernameInput').value.trim().toLowerCase().replace(/\s+/g,'_');
        var phone = document.getElementById('newProfilePhone').value;
        if(!fullName){ alert("Iltimos, ism familiyangizni kiriting."); return; }
        if(!username){ alert("Iltimos, saytdagi profil nomingizni kiriting."); return; }

        var btn = this;
        btn.disabled = true;
        var newProfile = { phone: phone, username: username, full_name: fullName, role: 'Uy egasi' };
        fetch(PROFILE_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify(newProfile)
        }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
          .then(function(res){
            btn.disabled = false;
            if(res.status !== 201 && res.status !== 200){
              alert("Profil nomi band bo'lishi mumkin, boshqasini sinab ko'ring.");
              return;
            }
            isLoggedIn = true;
            applyProfile(res.data);
            saveLoginToStorage(res.data);
            loadProfilesDirectory();
            closeAllAuth();
            if(pendingAction){ pendingAction(); pendingAction=null; }
          }).catch(function(err){
            btn.disabled = false;
            console.error('profile post xato:', err);
            alert("Profilni yaratishda xato yuz berdi.");
          });
      }catch(err){ console.error('authProfileSubmitBtn xato:', err); }
      return false;
    });

    }catch(initErr){
      console.error('INIT XATO:', initErr);
    }

    try{
      var savedProfile = loadLoginFromStorage();
      if(savedProfile){
        isLoggedIn = true;
        applyProfile(savedProfile);
        // The cached copy in localStorage can be stale (created before a
        // field like public_id existed, or balance/verified changed on
        // another device) - always refresh from the server right after
        // showing the cached version, so the UI self-heals silently.
        if(savedProfile.id){
          fetch(PROFILE_API + savedProfile.id + '/')
            .then(function(r){ return r.ok ? r.json() : null; })
            .then(function(fresh){
              if(fresh && fresh.username){
                applyProfile(fresh);
                saveLoginToStorage(fresh);
              }
            })
            .catch(function(err){ console.error('profil yangilash xato:', err); });
        }
      }
    }catch(loginRestoreErr){
      console.error('LOGIN TIKLASH XATO:', loginRestoreErr);
    }
  } // init()

})();