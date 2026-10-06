"use strict";

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
  var postPayMethod = 'card'; // 'card' (Stripe), 'payme', 'click' or 'balance'
  var topUpMethod = 'card';
  var PAY_METHOD_NAMES = {card: 'Stripe', payme: 'Payme', click: 'Click'};

  function loadPaymentConfig(cb){
    fetch(PAYMENT_CONFIG_API).then(function(r){ return r.json(); }).then(function(data){
      paymentInfo = data;
      updatePaymentSummary();
      if(cb) cb();
    }).catch(function(err){ console.error('payment config xato:', err); if(cb) cb(); });
  }
  function formatUsd(cents){ return '$' + (cents/100).toFixed(2); }
  function formatUzs(soum){ return String(Math.round(soum)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm"; }
  // Payme/Click (real so'm payments) that the server has keys for.
  function uzProviders(){
    var p = paymentInfo.uzProviders || {};
    return ['payme', 'click'].filter(function(k){ return p[k]; });
  }
  function isUzMethod(m){ return m === 'payme' || m === 'click'; }
  // Show only the pay buttons that can actually take money: Payme/Click
  // once their keys are set - and then the Stripe card button (test mode,
  // foreign cards only) goes away. Returns the method to use, falling
  // back to the first available one if `method` isn't offered.
  function syncPayMethodToggle(toggle, method){
    var uz = uzProviders();
    if(toggle){
      toggle.querySelectorAll('button').forEach(function(b){
        var m = b.getAttribute('data-method');
        if(isUzMethod(m)) b.classList.toggle('hidden', uz.indexOf(m) === -1);
        if(m === 'card') b.classList.toggle('hidden', uz.length > 0);
      });
    }
    if((method === 'card' && uz.length) || (isUzMethod(method) && uz.indexOf(method) === -1)){
      method = uz.length ? uz[0] : 'card';
    }
    if(toggle){
      toggle.querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-method') === method); });
    }
    return method;
  }
  function tierPriceUzs(tier){
    var soum = paymentInfo.pricesUzs ? paymentInfo.pricesUzs[tier] : null;
    var discountPercent = paymentInfo.discounts ? paymentInfo.discounts[tier] : null;
    if(soum != null && discountPercent) soum = Math.round(soum * (100 - discountPercent) / 100);
    return soum;
  }
  function syncTopUpMethod(){
    topUpMethod = syncPayMethodToggle(document.getElementById('topUpMethodToggle'), topUpMethod);
    var btn = document.getElementById('topUpBtn');
    var note = document.getElementById('topUpNote');
    if(btn && !btn.disabled) btn.textContent = PAY_METHOD_NAMES[topUpMethod] + " orqali to'ldirish";
    if(note){
      note.textContent = isUzMethod(topUpMethod)
        ? PAY_METHOD_NAMES[topUpMethod] + " sahifasida summa so'mda (Markaziy bank kursi bo'yicha) ko'rsatiladi, Uzcard yoki Humo karta bilan to'lanadi."
        : "To'lov Stripe orqali, karta bilan amalga oshiriladi.";
    }
  }
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
    postPayMethod = syncPayMethodToggle(methodToggle, postPayMethod);
    syncTopUpMethod();
    var noteEl = document.getElementById('paymentNote');
    if(noteEl){
      noteEl.textContent = isUzMethod(postPayMethod)
        ? 'Keyingi qadamda ' + PAY_METHOD_NAMES[postPayMethod] + " to'lov sahifasi ochiladi - Uzcard yoki Humo karta bilan to'lang."
        : (postPayMethod === 'balance' ? "Summa balansingizdan yechiladi."
          : "Karta tanlansa, keyingi qadamda summa va e'lon turi Stripe to'lov sahifasida ko'rsatiladi.");
    }
    if(!isPaidTier()){
      amountEl.textContent = 'Bepul';
      if(methodToggle) methodToggle.classList.add('hidden');
      if(noteEl) noteEl.classList.add('hidden');
    } else if(isUzMethod(postPayMethod)){
      var soum = tierPriceUzs(postTier);
      amountEl.textContent = (soum != null) ? formatUzs(soum) : '—';
      if(methodToggle) methodToggle.classList.remove('hidden');
      if(noteEl) noteEl.classList.remove('hidden');
    } else {
      if(noteEl) noteEl.classList.remove('hidden');
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
      } else if(isUzMethod(postPayMethod)){
        finishBtn.textContent = PAY_METHOD_NAMES[postPayMethod] + " orqali to'lash va joylash";
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
        document.getElementById('uploadCount').textContent = postPhotos.length + '/6';
      });
    });
    document.getElementById('uploadTile').style.display = postPhotos.length >= 6 ? 'none' : 'flex';
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

  // ---- Address search on the posting map ----
  // Photon (komoot) is a typo-tolerant search over OpenStreetMap that also
  // knows shops/schools/hotels and house numbers; Nominatim is asked too
  // for the exact phrase. Both are limited to Jizzax viloyati. People type
  // "xamza mahalla", "asalchilar 42", "32 maktab", "royal hotel" - so when
  // the phrase as typed finds nothing, simpler forms of it are tried.
  var GEO_BBOX = [67.55, 39.95, 68.1, 40.3]; // w, s, e, n
  var GEO_GENERIC_WORD = /^(mahalla\S*|maxalla\S*|mfy|ko'?ch\S*|kuch\S*|tor|berk|uy|dom|hotel|otel|mehmonxona|mexmonxona|gostinitsa|restoran|kafe|shahri?|shahar|tumani?|jizzax|jizzakh)$/i;
  function geoNormalize(q){
    return q.replace(/[’‘`ʻʼ]/g, "'").replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function geoVariants(q){
    var out = [];
    function add(v){ v = geoNormalize(v); if(v && out.indexOf(v) === -1) out.push(v); }
    add(q);
    // "32 maktab", "32-sonli maktab", "maktab 32" -> OSM's "32-maktab"
    var school = q.match(/(\d+)\s*-?\s*(son\S*\s*)?maktab/i) || q.match(/maktab\S*\s*(?:№\s*)?(\d+)/i);
    if(school) add(school[1] + '-maktab');
    var words = q.split(' ').filter(function(w){ return !GEO_GENERIC_WORD.test(w); });
    add(words.join(' '));
    // Uzbek h/x are written both ways (Hamza / Xamza)
    add(words.map(function(w){
      var c = w.charAt(0).toLowerCase();
      return c === 'h' ? 'x' + w.slice(1) : (c === 'x' ? 'h' + w.slice(1) : w);
    }).join(' '));
    // last resort: the longest single word on its own ("royal" -> Grand Royal)
    var longest = words.filter(function(w){ return !/^\d+$/.test(w); }).sort(function(x, y){ return y.length - x.length; })[0];
    if(longest && longest.length >= 4) add(longest);
    return out;
  }
  function geoPhoton(q){
    var url = 'https://photon.komoot.io/api/?limit=6&lang=default&lat=' + JIZZAX_CENTER[0] + '&lon=' + JIZZAX_CENTER[1] +
      '&bbox=' + GEO_BBOX.join(',') + '&q=' + encodeURIComponent(q);
    return fetch(url).then(function(r){ return r.json(); }).then(function(d){
      return (d.features || []).map(function(f){
        var p = f.properties || {};
        var street = [p.street, p.housenumber].filter(Boolean).join(' ');
        var title = p.name || street || p.district || p.city || q;
        var sub = [p.name ? street : '', p.locality, p.district, p.city || p.county].filter(Boolean)
          .filter(function(x, i, arr){ return x !== title && arr.indexOf(x) === i; }).join(', ');
        return {lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], title: title, sub: sub};
      });
    }).catch(function(){ return []; });
  }
  function geoNominatim(q){
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&bounded=1&accept-language=uz&viewbox=' +
      [GEO_BBOX[0], GEO_BBOX[3], GEO_BBOX[2], GEO_BBOX[1]].join(',') + '&q=' + encodeURIComponent(q);
    return fetch(url).then(function(r){ return r.json(); }).then(function(d){
      return (d || []).map(function(x){
        var parts = String(x.display_name || '').split(', ');
        // "42, Asalchilar ko'chasi, ..." - keep the house number with its street
        var head = /^\d/.test(parts[0]) && parts[1] ? parts[1] + ' ' + parts[0] : parts[0];
        var rest = parts.slice(/^\d/.test(parts[0]) ? 2 : 1).filter(function(t){ return !/^\d{5,6}$/.test(t) && !/Oʻzbekiston|O'zbekiston|Uzbekistan/.test(t); });
        return {lat: parseFloat(x.lat), lng: parseFloat(x.lon), title: head, sub: rest.slice(0, 3).join(', ')};
      });
    }).catch(function(){ return []; });
  }
  function geoMerge(lists){
    var seen = {}, out = [];
    lists.forEach(function(list){
      list.forEach(function(r){
        // one street is several OSM pieces - list it once
        var k = (r.title + '|' + r.sub).toLowerCase();
        var k2 = r.lat.toFixed(4) + ',' + r.lng.toFixed(4);
        if(seen[k] || seen[k2] || isNaN(r.lat)) return;
        seen[k] = seen[k2] = true;
        out.push(r);
      });
    });
    return out.slice(0, 8);
  }
  function goToPostSearchResult(r){
    var latlng = [r.lat, r.lng];
    postLocationMap.setView(latlng, 17);
    // the property pin jumps to the picked spot too (fine-tune by dragging
    // afterwards) - the separate "sizning joylashuvingiz" dot is untouched.
    if(postLocationMarker){ postLocationMarker.setLatLng(latlng); postPinMovedByUser = true; }
    var box = document.getElementById('postLocationResults');
    if(box){ box.innerHTML = ''; box.classList.add('hidden'); }
  }
  function showPostSearchResults(results){
    var box = document.getElementById('postLocationResults');
    if(!box) return;
    box.innerHTML = results.map(function(r, i){
      return '<button type="button" data-i="' + i + '"><b>' + escapeHtml(r.title) + '</b>' +
        (r.sub ? '<span>' + escapeHtml(r.sub) + '</span>' : '') + '</button>';
    }).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('button').forEach(function(btn){
      btn.addEventListener('click', function(){ goToPostSearchResult(results[Number(this.getAttribute('data-i'))]); });
    });
  }
  function doPostLocationSearch(){
    var input = document.getElementById('postLocationSearchInput');
    var q = input ? geoNormalize(input.value) : '';
    if(!q || !postLocationMap) return;
    var btn = document.getElementById('postLocationSearchBtn');
    if(btn){ btn.disabled = true; btn.textContent = 'Qidirilmoqda...'; }
    var variants = geoVariants(q);
    // the phrase as typed: both services at once
    Promise.all([geoPhoton(variants[0]), geoNominatim(variants[0])]).then(function(first){
      var results = geoMerge(first);
      // nothing? try the simpler forms one by one (Photon only - Nominatim
      // asks for at most one request a second)
      var i = 1;
      function next(){
        if(results.length || i >= variants.length) return Promise.resolve(results);
        return geoPhoton(variants[i++]).then(function(found){ results = geoMerge([found]); return next(); });
      }
      return next();
    }).then(function(results){
      if(btn){ btn.disabled = false; btn.textContent = 'Qidirish'; }
      if(!results.length){
        toast("Joy topilmadi. Ko'cha nomini yoki yaqin joy (maktab, do'kon) nomini yozib ko'ring.");
        return;
      }
      if(results.length === 1){ goToPostSearchResult(results[0]); return; }
      showPostSearchResults(results);
    }).catch(function(err){
      console.error('Manzil qidirish xatosi:', err);
      if(btn){ btn.disabled = false; btn.textContent = 'Qidirish'; }
      toast("Qidirishda xato yuz berdi.");
    });
  }
  function initPostLocationMap(){
    if(postLocationMap){ setTimeout(function(){ postLocationMap.invalidateSize(); },60); return; }
    setTimeout(function(){
      var el = document.getElementById('postLocationMap');
      if(!el || typeof L === 'undefined') return;
      postLocationMap = L.map(el, {scrollWheelZoom:false, minZoom:9, maxBounds:JIZZAX_BOUNDS, maxBoundsViscosity:1.0}).setView(JIZZAX_CENTER, 12);
      L.tileLayer(MAPTILER_TILE_URL, {attribution: MAPTILER_ATTRIBUTION, maxZoom: 20}).addTo(postLocationMap);
      postLocationMarker = L.marker(JIZZAX_CENTER, {draggable:true}).addTo(postLocationMap);
      postLocationMap.on('click', function(e){ postLocationMarker.setLatLng(e.latlng); });
      setTimeout(function(){ postLocationMap.invalidateSize(); }, 60);
      addPostLocateControl();
      locateForPost(false);
    }, 60);
  }
  // Puts the user's current position on the posting map: a small fixed
  // "you are here" dot, and the draggable property pin moved there unless
  // the user already placed it. Asks for a quick network fix first, then
  // refines with GPS, so a slow GPS lock indoors no longer leaves the map
  // silently on the city centre; failures say why. `manual` = the user
  // pressed the button: always move the pin and report problems.
  var postMeMarker = null, postPinMovedByUser = false;
  function placePostLocation(pos, movePin){
    var latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    var bounds = L.latLngBounds(JIZZAX_BOUNDS);
    if(!bounds.contains(latlng)){
      // outside the region: widen the limits so the dot can still show
      postLocationMap.setMinZoom(5);
      postLocationMap.setMaxBounds(bounds.extend(latlng).pad(0.2));
    }
    if(!postMeMarker){
      var meIcon = L.divIcon({className:'my-location-dot', html:'<span></span>', iconSize:[16,16], iconAnchor:[8,8]});
      postMeMarker = L.marker(latlng, {icon: meIcon, interactive:false, keyboard:false, zIndexOffset:-100})
        .addTo(postLocationMap).bindTooltip("Sizning joylashuvingiz");
    } else {
      postMeMarker.setLatLng(latlng);
    }
    if(movePin){
      postLocationMarker.setLatLng(latlng);
      postLocationMap.setView(latlng, Math.max(postLocationMap.getZoom(), 15));
    }
  }
  function locateForPost(manual){
    if(!postLocationMap) return;
    if(!window.isSecureContext || !navigator.geolocation){
      if(manual) toast(!window.isSecureContext ? "Joylashuv faqat https:// manzilda ishlaydi." : "Brauzeringiz joylashuvni aniqlay olmaydi.");
      return;
    }
    if(manual) toast("Joylashuvingiz aniqlanmoqda...");
    var gotOne = false;
    function onFix(pos){
      gotOne = true;
      placePostLocation(pos, manual || !postPinMovedByUser);
    }
    function onError(err){
      if(gotOne) return;  // the quick fix already worked
      if(manual || (err && err.code === 1)) toast(geoErrorMessage(err));
    }
    // 1) quick, approximate (network / recently known) position
    navigator.geolocation.getCurrentPosition(onFix, function(){}, {enableHighAccuracy:false, timeout:10000, maximumAge:300000});
    // 2) precise GPS fix, which can take a while
    navigator.geolocation.getCurrentPosition(onFix, onError, {enableHighAccuracy:true, timeout:20000, maximumAge:0});
  }
  function addPostLocateControl(){
    var LocateControl = L.Control.extend({
      options: {position: 'topright'},
      onAdd: function(){
        var div = L.DomUtil.create('div', 'leaflet-bar map-corner-btn');
        div.innerHTML = '<a href="#" role="button" title="Mening joylashuvim" aria-label="Mening joylashuvim">&#128205;</a>';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(div.querySelector('a'), 'click', function(e){ L.DomEvent.preventDefault(e); locateForPost(true); });
        return div;
      }
    });
    postLocationMap.addControl(new LocateControl());
    // once the user places the pin themselves, a late GPS fix must not move it
    postLocationMarker.on('dragend', function(){ postPinMovedByUser = true; });
    postLocationMap.on('click', function(){ postPinMovedByUser = true; });
  }
  function showPostStep(n){
    [1,2,3,4].forEach(function(i){ document.getElementById('postStep'+i).classList.toggle('hidden', i!==n); });
    try{ history.replaceState({route:'/elon-joylash'}, '', '/elon-joylash?step=' + n); }catch(e){}
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

