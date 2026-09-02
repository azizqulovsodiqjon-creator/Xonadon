"use strict";

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

