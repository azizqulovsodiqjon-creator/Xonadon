"use strict";

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

