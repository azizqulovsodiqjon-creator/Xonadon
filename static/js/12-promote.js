"use strict";

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

