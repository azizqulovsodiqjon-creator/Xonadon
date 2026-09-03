"use strict";

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
      // hero's "Foydalanuvchi" stat - every registered profile, whether
      // or not they've ever posted a listing.
      var usersEl = document.getElementById('heroStatUsers');
      if(usersEl) usersEl.textContent = allProfilesDirectory.length;
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

