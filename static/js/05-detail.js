"use strict";

  /* =========================================================
     UY TAFSILOTLARI SAHIFASI
  ==========================================================*/
  var galleryPhotos = [], galleryIndex = 0;
  var detailRouteLine = null;

  // One details-table row, or nothing at all when the poster left that
  // field empty - the listing page shows only what was actually filled in.
  function infoRow(label, value){
    var v = (value == null) ? '' : String(value).trim();
    if(!v || v === '—' || v === '0') return '';
    return '<div class="info-row"><span class="il">' + label + '</span><span class="iv">' + v + '</span></div>';
  }
  function floorRows(l){
    var dict = t[currentLang] || t.UZ;
    var parts = String(l.floor || '').split('/');  // "3/9", "3", "—/9" or ""
    return infoRow(dict.floor_label, parts[0]) + infoRow(dict.floors_total_label, parts[1]);
  }

  var currentDetailListing = null; // {id, fromAdmin} while pageDetail is showing - lets applyLang() below refresh its translated text without re-opening it (which would double-count the view)
  // A real <a href="tel:"> rather than a button that sets
  // window.location from script: the in-app browsers of Instagram and
  // Telegram (where most visitors arrive from) ignore script-initiated
  // tel: navigation, so "Qo'ng'iroq qilish" silently did nothing there.
  // They do open the dialer for a tel: link the user actually taps.
  function callSellerButtonHtml(phone, label){
    var digits = String(phone || '').replace(/[^\d+]/g, '');
    var href = digits ? ' href="tel:' + digits + '"' : ' href="#"';
    return '<a class="action-btn filled" id="callSellerBtn" role="button"' + href + '>' + label + '</a>';
  }
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
    var roomsRow = infoRow(dict.rooms_count, l.rooms);
    // Calling/messaging yourself makes no sense - hide those two
    // buttons entirely when the viewer owns this listing.
    var isOwnListing = !!(l.seller && myUsername() && l.seller === myUsername());
    var SHARE_ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

    var dealLabel = {sotuv: dict.sotuv, ijara: dict.ijara, kunlik: dict.kunlik}[l.deal] || '';
    var HEART_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';

    // Two columns, like the bigger listing sites: photos + seller on the
    // left; actions, tags, title, price and every detail on the right.
    document.getElementById('detailContent').innerHTML =
      '<div class="detail-layout">' +
        '<div class="detail-left">' +
          '<div class="detail-gallery" style="position:relative;">' +
            (l.sold ? '<div class="sold-sticker">SOTILDI</div>' : '') +
            '<div class="gallery-main"><img id="galleryMainImg" src="' + galleryPhotos[0] + '" alt="">' +
              (l.vip ? '<span class="tier-badge vip">★ VIP</span>' : (l.top ? '<span class="tier-badge top">▲ TOP</span>' : '')) +
              (galleryPhotos.length > 1 ? '<button class="gallery-arrow prev" id="galleryPrev">‹</button><button class="gallery-arrow next" id="galleryNext">›</button><div class="gallery-counter" id="galleryCounter">1/' + galleryPhotos.length + '</div>' : '') +
            '</div>' +
            (galleryPhotos.length > 1 ? '<div class="gallery-thumbs" id="galleryThumbs">' + galleryPhotos.map(function(src,i){ return '<img data-i="'+i+'" src="'+src+'" class="'+(i===0?'active':'')+'">'; }).join('') + '</div>' : '') +
          '</div>' +
          '<div class="owner-card">' +
            '<div class="owner-avatar">' + l.seller.charAt(0).toUpperCase() + '</div>' +
            '<div><div class="owner-name">' + l.seller + (isSellerVerified(l.seller) ? VERIFIED_TICK_HTML : '') + '</div><div class="owner-role">' + trValue(l.ownerRole) + '</div></div>' +
            '<button class="owner-contact-btn" id="viewSellerProfileBtn">' + dict.view_profile + '</button>' +
          '</div>' +
          '<div class="detail-info-block">' +
            '<div class="info-list">' +
              '<div class="info-row"><span class="il">' + dict.posted_by + '</span><span class="iv">' + trValue(l.ownerRole) + '</span></div>' +
              '<div class="info-row"><span class="il">' + dict.property_type + '</span><span class="iv">' + trValue(l.type) + '</span></div>' +
              // A buyer's "qidiryapman" listing has no rooms/floor/area/repair
              // of its own to show - it's a budget, not a property.
            (l.isWanted ? '' : (roomsRow + floorRows(l) +
              infoRow(dict.area_label, l.area) +
              infoRow(dict.repair_label, trValue(l.repair)) +
              infoRow('Holati', trValue(l.condition)))) +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-right">' +
          '<div class="detail-head">' +
          (isOwnListing ? '' : '<div class="action-btns-row"><button class="action-btn outline" id="msgSellerBtn">' + dict.msg_seller + '</button>' + callSellerButtonHtml(l.phone, dict.call_seller) + '</div>') +
          '<div class="detail-tags-row">' +
            '<div class="action-tags">' +
              (dealLabel ? '<span class="detail-tag strong">' + dealLabel + '</span>' : '') +
              '<span class="detail-tag strong">' + trValue(l.type) + '</span>' +
              (l.mortgage ? '<span class="detail-tag">' + dict.mortgage + '</span>' : '') +
            '</div>' +
            '<div class="detail-icon-btns">' +
              '<button class="detail-icon-btn like-btn" id="detailLikeBtn" title="Yoqdi"' + (myLikedIds.indexOf(l.id)!==-1 ? ' disabled' : '') + '>' + HEART_SVG + '<span id="detailLikeCount">' + l.likesCount + '</span></button>' +
              '<button class="detail-icon-btn" id="shareListingBtn" title="' + dict.share_btn + '">' + SHARE_ICON_SVG + '</button>' +
            '</div>' +
          '</div>' +
          '<h1 class="detail-title">' + lt(l,'title') + '</h1>' +
          '<div class="detail-price">' + formatPrice(l) + '</div>' +
          '<div class="location-row"><span class="pin">📍</span>' + trValue(l.district) + '<span class="view-count">· 👁 ' + l.viewsCount + ' ko\'rildi</span></div>' +
          '<div class="detail-desc-text">' + lt(l,'desc') + '</div>' +
          (l.voiceNote ? '<div class="detail-section"><h3>🎤 Ovozli xabar</h3><audio controls src="' + l.voiceNote.url + '" style="width:100%;"></audio></div>' : '') +
          '</div>' +
          '<div class="detail-section detail-map-section">' +
            '<div class="section-head-row"><h3 style="margin:0;">' + dict.location + '</h3></div>' +
            '<div class="location-row2"><span class="pin">📍</span>' + trValue(l.district) + '</div>' +
            '<div class="map-box" id="detailMap"></div>' +
            '<div class="map-caption">Jizzax viloyati xaritasida taxminiy joylashuv ko\'rsatilgan.</div>' +
            '<button class="action-btn filled" id="detailRouteBtn" style="margin-top:12px;width:100%;">' + dict.show_route + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="similar-section" id="similarSection"></div>';

    showPage('pageDetail');
    if(!isTranslationRefresh) updateUrl('/elon/' + id);
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
          likeBtn.querySelector('#detailLikeCount').textContent = l.likesCount + 1;
          likeListing(l.id, function(newCount){
            l.likesCount = (newCount != null) ? newCount : l.likesCount + 1;
            document.getElementById('detailLikeCount').textContent = l.likesCount;
          });
        });
      });
    }

    var shareBtn = document.getElementById('shareListingBtn');
    if(shareBtn){
      shareBtn.addEventListener('click', function(){
        var shareUrl = location.origin + '/elon/' + l.id;
        var shareText = lt(l,'title') + ' - ' + formatPrice(l);
        function fallbackCopy(){
          var done = false;
          try{
            var ta = document.createElement('textarea');
            ta.value = shareUrl; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            done = document.execCommand('copy');
            document.body.removeChild(ta);
          }catch(e){}
          toast(done ? "Havola nusxalandi" : shareUrl);
        }
        if(navigator.share){
          navigator.share({title: lt(l,'title'), text: shareText, url: shareUrl}).catch(function(err){
            if(err && err.name !== 'AbortError') fallbackCopy();
          });
        } else if(navigator.clipboard && window.isSecureContext){
          navigator.clipboard.writeText(shareUrl).then(function(){ toast("Havola nusxalandi"); }, fallbackCopy);
        } else {
          fallbackCopy();
        }
      });
    }

    var vBtn = document.getElementById('viewSellerProfileBtn');
    if(vBtn){ vBtn.addEventListener('click', function(){ openSellerProfile(l.seller, fromAdmin); }); }

    var callBtn = document.getElementById('callSellerBtn');
    if(callBtn){
      callBtn.addEventListener('click', function(e){
        if(!l.phone){ e.preventDefault(); toast("Telefon raqami ko'rsatilmagan."); return; }
        // No preventDefault: the tap on the real tel: link is what opens
        // the dialer. Also show the number, in case the browser can't
        // place calls at all (desktop) - it can still be read and dialled.
        toast("Telefon: " + l.phone);
        callBtn.textContent = l.phone;
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
    var mainImg = document.getElementById('galleryMainImg');
    if(mainImg) mainImg.addEventListener('click', function(){ openPhotoViewer(galleryIndex); });
  }

  // Full-screen photo viewer: tap the listing photo to see it large;
  // arrows / swipe / keyboard to move, tap outside or the X / Esc to close.
  var photoViewer = null, viewerIndex = 0;
  function openPhotoViewer(index){
    if(!galleryPhotos.length) return;
    if(!photoViewer){
      photoViewer = document.createElement('div');
      photoViewer.className = 'photo-viewer';
      photoViewer.innerHTML = '<button class="pv-close" aria-label="Yopish">\u2715</button>' +
        '<button class="pv-arrow prev" aria-label="Oldingi">\u2039</button><img alt="">' +
        '<button class="pv-arrow next" aria-label="Keyingi">\u203A</button><div class="pv-counter"></div>';
      document.body.appendChild(photoViewer);
      photoViewer.querySelector('.pv-close').addEventListener('click', closePhotoViewer);
      photoViewer.querySelector('.prev').addEventListener('click', function(e){ e.stopPropagation(); showViewerPhoto(viewerIndex - 1); });
      photoViewer.querySelector('.next').addEventListener('click', function(e){ e.stopPropagation(); showViewerPhoto(viewerIndex + 1); });
      photoViewer.addEventListener('click', function(e){ if(e.target === photoViewer) closePhotoViewer(); });
      var touchX = null;
      photoViewer.addEventListener('touchstart', function(e){ touchX = e.touches[0].clientX; }, {passive: true});
      photoViewer.addEventListener('touchend', function(e){
        if(touchX == null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        if(Math.abs(dx) > 40) showViewerPhoto(viewerIndex + (dx < 0 ? 1 : -1));
        touchX = null;
      });
      document.addEventListener('keydown', function(e){
        if(!photoViewer.classList.contains('open')) return;
        if(e.key === 'Escape') closePhotoViewer();
        else if(e.key === 'ArrowLeft') showViewerPhoto(viewerIndex - 1);
        else if(e.key === 'ArrowRight') showViewerPhoto(viewerIndex + 1);
      });
    }
    var many = galleryPhotos.length > 1;
    photoViewer.querySelectorAll('.pv-arrow').forEach(function(b){ b.style.display = many ? '' : 'none'; });
    photoViewer.classList.add('open');
    document.body.style.overflow = 'hidden';
    showViewerPhoto(index);
  }
  function showViewerPhoto(i){
    var n = galleryPhotos.length;
    viewerIndex = (i + n) % n;
    photoViewer.querySelector('img').src = galleryPhotos[viewerIndex];
    photoViewer.querySelector('.pv-counter').textContent = n > 1 ? (viewerIndex + 1) + '/' + n : '';
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
          '<div class="body"><div class="price">'+formatPrice(o)+'</div><div class="desc">'+lt(o,'title')+', '+trValue(o.district)+'</div></div></button>';
      }).join('') + '</div>';
    wrap.querySelectorAll('[data-id]').forEach(function(el){
      el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), lastPage==='pageAdmin'); });
    });
  }
  function closePhotoViewer(){
    photoViewer.classList.remove('open');
    document.body.style.overflow = '';
    goToPhoto(viewerIndex);  // the page gallery follows what was viewed
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
        L.tileLayer(MAPTILER_TILE_URL, {attribution: MAPTILER_ATTRIBUTION, maxZoom: 20}).addTo(currentMap);
        L.marker([l.lat,l.lng]).addTo(currentMap).bindPopup(lt(l,'title')+'<br>'+trValue(l.district)).openPopup();
        setTimeout(function(){ if(currentMap) currentMap.invalidateSize(); },200);
      }catch(err){ mapEl.innerHTML = '<div class="map-fallback">Xaritani yuklab bo\'lmadi.</div>'; }
    },60);
  }

  function returnFromDetail(){
    if(currentMap){ try{ currentMap.remove(); }catch(e){} currentMap=null; }
    stopLiveLocationIfUnused();
    if(lastPage==='pageAdmin'){ showPage('pageAdmin'); renderAdmin(); } else { showPage('pageHome'); renderPublic(); updateUrl('/'); }
  }

