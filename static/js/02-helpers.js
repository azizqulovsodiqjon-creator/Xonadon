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
  // Line icons (24px grid, stroke = currentColor) - used everywhere a
  // visitor sees an icon, instead of emoji. Static markup asks for one
  // with <span data-ico="name"></span>; script-built markup calls ico().
  var ICON_PATHS = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.2"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-3.8-.9L3 20l1.1-3.5A8.3 8.3 0 0 1 3.5 12 8.4 8.4 0 0 1 12 3.5a8.4 8.4 0 0 1 9 8z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    pin: '<path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M8 16H3v5"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    idcard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M13 10h5M13 14h4"/>',
    selfie: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="10" r="3"/><path d="M7 18c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'
  };
  function ico(name, size){
    var px = size || 16;
    return '<svg class="ico" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
  }
  function fillIcons(root){
    (root || document).querySelectorAll('[data-ico]').forEach(function(el){
      if(!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', ico(el.getAttribute('data-ico'), Number(el.getAttribute('data-ico-size')) || 0));
    });
  }
  fillIcons();
  function mapListing(item){
    var imgs = (item.images && item.images.length) ? item.images.map(function(im){ return im.image; }) : [];
    var isWanted = !!item.is_wanted;
    return {
      id: item.id, price: item.price, currency: item.currency || 'ye', title: item.title, desc: item.desc,
      district: item.district, lat: item.lat, lng: item.lng, rooms: item.rooms,
      area: item.area, floor: item.floor, type: item.type, typeKey: item.type_key,
      repair: item.repair, condition: item.condition, phone: item.phone,
      seller: item.seller, ownerRole: item.owner_role, owner: item.owner,
      mortgage: item.mortgage, deal: item.deal, vip: item.vip, top: item.top,
      createdAt: item.created_at || null,
      daysAgo: item.created_at ? Math.max(0, Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000)) : 0,
      sold: item.sold, viewsCount: item.views_count || 0, likesCount: item.likes_count || 0,
      photos: imgs.length ? imgs : (isWanted ? [WANTED_PLACEHOLDER_IMG] : []),
      img: imgs.length ? imgs[0] : (isWanted ? WANTED_PLACEHOLDER_IMG : ''),
      voiceNote: item.voice_note ? {id: item.voice_note.id, url: item.voice_note.audio} : null,
      isWanted: isWanted,
      translations: item.translations || {}
    };
  }
  // A listing's own title/description in the chosen language - the
  // server machine-translates them (listings/translate.py); until that's
  // done, or in the language they were written in, the original shows.
  function lt(l, field){
    var lang = (typeof currentLang !== 'undefined' ? currentLang : 'UZ').toLowerCase();
    var tr = l.translations && l.translations[lang];
    return (tr && tr[field]) || l[field];
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
    // whole numbers with thousands spaced, like every other price in town;
    // cents only matter on tiny amounts (a daily rent converted from so'm)
    if(usdEquivalent >= 100) return Math.round(usdEquivalent).toLocaleString('ru-RU') + ' у.е';
    var rounded = Math.round(usdEquivalent * 100) / 100;
    return (rounded % 1 === 0 ? rounded : rounded.toFixed(2)) + ' у.е';
  }
  // "Bugun" / "Kecha" / "5 kun oldin" / "12.09.2026" - when a listing went up.
  function listingAgeLabel(l){
    if(!l.createdAt) return '';
    var d = new Date(l.createdAt), now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var days = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
    if(days <= 0) return 'Bugun';
    if(days === 1) return 'Kecha';
    if(days < 30) return days + ' kun oldin';
    return d.toLocaleDateString('ru-RU');
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
  // Real scalloped "verified" seal (the Instagram/Twitter-style badge
  // shape, not a plain circle+checkmark text) - a single path, MIT
  // Heroicons "check-badge" icon, checkmark cutout built into the
  // same path via fill-rule.
  var VERIFIED_TICK_HTML = ' <span class="verified-tick" title="Tasdiqlangan"><svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.603 3.799A4.49 4.49 0 0 1 12 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 0 1 3.498 1.307 4.491 4.491 0 0 1 1.307 3.497A4.49 4.49 0 0 1 21.75 12a4.49 4.49 0 0 1-1.549 3.397 4.491 4.491 0 0 1-1.307 3.497 4.491 4.491 0 0 1-3.497 1.307A4.49 4.49 0 0 1 12 21.75a4.49 4.49 0 0 1-3.397-1.549 4.49 4.49 0 0 1-3.498-1.306 4.491 4.491 0 0 1-1.307-3.498A4.49 4.49 0 0 1 2.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 0 1 1.307-3.497 4.49 4.49 0 0 1 3.497-1.307Zm7.007 6.387a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"/></svg></span>';
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

