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

  function doPostLocationSearch(){
    var input = document.getElementById('postLocationSearchInput');
    var q = input ? input.value.trim() : '';
    if(!q || !postLocationMap) return;
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q + ', Jizzax, Uzbekiston'))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if(data && data.length){
          var latlng = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
          postLocationMap.setView(latlng, 16);
          // the property pin jumps to the searched spot too (fine-tune
          // by dragging afterwards) - the separate "sizning
          // joylashuvingiz" dot is its own marker and is untouched.
          if(postLocationMarker) postLocationMarker.setLatLng(latlng);
        } else {
          toast("Joy topilmadi.");
        }
      }).catch(function(err){ console.error('Manzil qidirish xatosi:', err); toast("Qidirishda xato yuz berdi."); });
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

