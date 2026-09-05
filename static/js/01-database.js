"use strict";

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

  /* =========================================================
     URL YO'NALTIRISH (routing) - joymee.uz kabi, har bir asosiy
     ekran (bosh sahifa/xarita/e'lon/profil/e'lon joylash) o'z
     manzil qatoriga ega bo'lishi uchun. Django tarafida bir xil
     SPA sahifasini har qanday yo'l uchun qaytaradigan "catch-all"
     marshrut bor (xonadon_project/urls.py) - shuning uchun to'g'ridan
     -to'g'ri /xarita yoki /elon/42 ga kirish (yoki sahifani yangilash)
     ham to'g'ri ishlaydi.
     ========================================================= */
  function updateUrl(path, replaceOnly){
    if(PANEL_ROUTE) return; // /panel/ manzili hech qachon o'zgarmasin
    if(typeof history === 'undefined' || !history.pushState) return;
    if(location.pathname === path) return; // aynan shu yo'lda turibmiz - qayta yozmaymiz
    var fn = replaceOnly ? history.replaceState : history.pushState;
    try{ fn.call(history, {route: path}, '', path + location.search); }catch(e){}
  }
  // Orqaga/oldinga (brauzer tugmalari) bosilganda yoki sahifa birinchi
  // marta to'g'ridan-to'g'ri shu manzilda ochilganda qaysi ekranni
  // ko'rsatish kerakligini hal qiladi. Mavjud tugmalarni ".click()"
  // orqali "bosish" - profil/e'lon joylash kabi ekranlar uchun ularning
  // o'z requireAuth/tozalash mantig'ini qayta yozmaslik uchun.
  // Reflects the current filterState into the URL's query string
  // (?deal=ijara&type=kvartira&owner=1&...) so a filtered view is a
  // real, shareable/bookmarkable/back-button-able link too - not just
  // the page routes above. Uses replaceState (not pushState): every
  // single filter click adding its own back-button stop would make
  // "back" nearly unusable, so filters update the current entry
  // in place instead of piling up new ones.
  function syncFilterUrl(){
    if(PANEL_ROUTE) return;
    var params = new URLSearchParams();
    if(filterState.deal) params.set('deal', filterState.deal);
    if(filterState.type && filterState.type !== 'all') params.set('type', filterState.type);
    if(filterState.owner) params.set('owner', '1');
    if(filterState.mortgage) params.set('mortgage', '1');
    if(filterState.lastWeek) params.set('lastWeek', '1');
    if(filterState.lastMonth) params.set('lastMonth', '1');
    if(filterState.district) params.set('district', filterState.district);
    if(filterState.priceMin != null) params.set('priceMin', filterState.priceMin);
    if(filterState.priceMax != null) params.set('priceMax', filterState.priceMax);
    if(filterState.rooms != null) params.set('rooms', filterState.rooms);
    if(filterState.search) params.set('q', filterState.search);
    var qs = params.toString();
    var newUrl = location.pathname + (qs ? '?' + qs : '');
    try{ history.replaceState({route: location.pathname}, '', newUrl); }catch(e){}
  }
  // Reverse of the above - reads whatever filter query params the page
  // was opened with (a shared/bookmarked filtered link) back into
  // filterState, before the first render.
  function applyFilterParamsFromUrl(){
    var params = new URLSearchParams(location.search);
    if(params.has('deal')) filterState.deal = params.get('deal');
    if(params.has('type')) filterState.type = params.get('type');
    if(params.has('owner')) filterState.owner = params.get('owner') === '1';
    if(params.has('mortgage')) filterState.mortgage = params.get('mortgage') === '1';
    if(params.has('lastWeek')) filterState.lastWeek = params.get('lastWeek') === '1';
    if(params.has('lastMonth')) filterState.lastMonth = params.get('lastMonth') === '1';
    if(params.has('district')) filterState.district = params.get('district');
    if(params.has('priceMin')) filterState.priceMin = parseInt(params.get('priceMin'), 10) || null;
    if(params.has('priceMax')) filterState.priceMax = parseInt(params.get('priceMax'), 10) || null;
    if(params.has('rooms')) filterState.rooms = parseInt(params.get('rooms'), 10) || null;
    if(params.has('q')) filterState.search = params.get('q');
  }

  function routeFromLocation(){
    if(PANEL_ROUTE) return;
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var m = path.match(/^\/elon\/(\d+)$/);
    if(m){ openDetail(Number(m[1]), false); return; }
    if(path === '/xarita'){ openMapFull(); return; }
    if(path === '/profil'){ var pb = document.getElementById('avatarBtn'); if(pb) pb.click(); return; }
    if(path === '/xabarlar'){ var mb = document.getElementById('mtabMessages') || document.getElementById('notifBtn'); if(mb) mb.click(); return; }
    if(path === '/elon-joylash'){ var nb = document.getElementById('postAdBtn'); if(nb) nb.click(); return; }
    showPage('pageHome'); renderPublic();
  }
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

