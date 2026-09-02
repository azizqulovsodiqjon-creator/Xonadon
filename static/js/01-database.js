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

