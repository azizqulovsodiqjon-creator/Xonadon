"use strict";

  /* =========================================================
     TASHQI YUKLASH: HAMMA TUGMALARNI ULASH
  ==========================================================*/
  document.addEventListener('DOMContentLoaded', init);
  if(document.readyState !== 'loading') init();

  function init(){
    try{

    document.getElementById('tierToggle').querySelectorAll('button').forEach(function(b){
      b.classList.toggle('sel', b.getAttribute('data-tier')==='regular');
      b.addEventListener('click', function(){
        document.getElementById('tierToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postTier = this.getAttribute('data-tier');
        updatePaymentSummary();
      });
    });

    document.getElementById('postPayMethodToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('postPayMethodToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postPayMethod = this.getAttribute('data-method');
        updatePaymentSummary();
      });
    });

    loadListings();
    loadProfilesDirectory();
    loadPaymentConfig();
    loadCurrencyRate(function(){ renderPublic(); }); // re-render once the real rate is in, in case so'm display was already selected
    initGoogleSignIn();
    document.getElementById('langCode').textContent = 'UZ';

    document.getElementById('logoHome').addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });

    // Hero buttons just proxy the real ones - same auth/scroll behavior,
    // no duplicated logic.
    document.getElementById('heroPostBtn').addEventListener('click', function(){ document.getElementById('postAdBtn').click(); });
    document.getElementById('heroBrowseBtn').addEventListener('click', function(){
      var target = document.querySelector('.vip-section') || document.querySelector('.toolbar');
      if(target) target.scrollIntoView({behavior:'smooth', block:'start'});
    });

    document.getElementById('searchInput').addEventListener('input', function(e){
      filterState.search = e.target.value.trim();
      renderPublic();
    });

    var langBtn = document.getElementById('langBtn'), langMenu = document.getElementById('langMenu');
    langBtn.addEventListener('click', function(e){ e.stopPropagation(); langMenu.classList.toggle('open'); });
    langMenu.querySelectorAll('button').forEach(function(b){ b.addEventListener('click', function(){ applyLang(this.getAttribute('data-lang')); langMenu.classList.remove('open'); }); });

    var currencyBtn = document.getElementById('currencyBtn'), currencyMenu = document.getElementById('currencyMenu');
    currencyMenu.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-currency') === displayCurrency); });
    currencyBtn.addEventListener('click', function(e){ e.stopPropagation(); currencyMenu.classList.toggle('open'); });
    currencyMenu.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        displayCurrency = this.getAttribute('data-currency');
        try{ localStorage.setItem('displayCurrency', displayCurrency); }catch(e){}
        currencyMenu.querySelectorAll('button').forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        currencyMenu.classList.remove('open');
        renderPublic(); // re-render every visible price in the new currency
      });
    });

    document.getElementById('darkToggle').addEventListener('click', function(){
      document.body.classList.toggle('dark');
      this.classList.toggle('mode-active');
    });

    document.querySelectorAll('#segment button').forEach(function(b){
      b.addEventListener('click', function(){
        document.querySelectorAll('#segment button').forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        filterState.deal = this.getAttribute('data-deal');
        renderPublic();
      });
    });

    document.querySelectorAll('.view-controls .view-btn').forEach(function(b){
      b.addEventListener('click', function(){
        document.querySelectorAll('.view-controls .view-btn').forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        var grid = document.getElementById('regularGrid');
        grid.classList.remove('view-grid','view-list','view-compact');
        grid.classList.add('view-'+this.getAttribute('data-view'));
      });
    });

    document.getElementById('mapBtn').addEventListener('click', openMapFull);
    document.getElementById('mapSearchBtn').addEventListener('click', doMapSearch);
    document.getElementById('mapSearchInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ doMapSearch(); } });
    document.getElementById('openYandexMapBtn').addEventListener('click', function(){
      var center = fullMap ? fullMap.getCenter() : {lat: JIZZAX_CENTER[0], lng: JIZZAX_CENTER[1]};
      var zoom = fullMap ? fullMap.getZoom() : 10;
      // Yandex Maps takes ll as "longitude,latitude" (reversed from Leaflet's lat/lng).
      var url = 'https://yandex.com/maps/?ll=' + center.lng + ',' + center.lat + '&z=' + zoom;
      window.open(url, '_blank', 'noopener');
    });
    document.getElementById('nearMeBtn').addEventListener('click', function(){
      startLiveLocation(function(){
        if(userLat == null){ toast("Joylashuvingiz aniqlanmadi. Brauzer ruxsatini tekshiring."); return; }
        if(fullMap) fullMap.setView([userLat, userLng], 15);
      });
    });
    document.getElementById('mapFullBackBtn').addEventListener('click', function(){
      if(fullMap){ try{ fullMap.remove(); }catch(e){} fullMap=null; }
      stopLiveLocationIfUnused();
      showPage('pageHome'); renderPublic();
    });

    var typePill = document.getElementById('propertyTypePill'), typeDropdown = document.getElementById('typeDropdown');
    typePill.addEventListener('click', function(e){ e.stopPropagation(); typeDropdown.classList.toggle('open'); typePill.classList.toggle('open'); });
    typeDropdown.querySelectorAll('button').forEach(function(opt){
      opt.addEventListener('click', function(){
        typeDropdown.querySelectorAll('button').forEach(function(o){ o.classList.remove('active'); });
        this.classList.add('active');
        document.getElementById('typeLabel').textContent = this.textContent;
        typePill.classList.toggle('selected', this.getAttribute('data-type')!=='all');
        filterState.type = this.getAttribute('data-type');
        renderPublic();
        typeDropdown.classList.remove('open'); typePill.classList.remove('open');
      });
    });

    document.querySelectorAll('#filterPillsRow .pill[data-toggle]').forEach(function(p){
      p.addEventListener('click', function(){
        this.classList.toggle('selected');
        filterState[this.getAttribute('data-filter')] = this.classList.contains('selected');
        renderPublic();
      });
    });

    document.addEventListener('click', function(){
      langMenu.classList.remove('open');
      currencyMenu.classList.remove('open');
      typeDropdown.classList.remove('open'); typePill.classList.remove('open');
    });

    var backdrop = document.getElementById('backdrop');
    var panels = ['profileSearchPanel','notifPanel','filtersPanel','editProfilePanel','messageThreadPanel','myLikesPanel'];
    function openPanel(id){ closeAllPanels(); document.getElementById(id).classList.add('open'); backdrop.classList.add('open'); }
    function closeAllPanels(){ panels.forEach(function(p){ document.getElementById(p).classList.remove('open'); }); backdrop.classList.remove('open'); }
    backdrop.addEventListener('click', closeAllPanels);
    document.querySelectorAll('[data-close]').forEach(function(b){ b.addEventListener('click', closeAllPanels); });

    function renderSellerSearch(filter){
      var list = document.getElementById('psList');
      var sellers = combinedSellers().filter(function(s){ return s.name.toLowerCase().indexOf(filter.toLowerCase())>-1; });
      list.innerHTML = sellers.map(function(s){
        return '<div class="ps-row" data-seller="'+s.name+'"><div class="ps-avatar"></div>' +
          '<div><div class="ps-name">'+displayName(s.name)+(isSellerVerified(s.name)?VERIFIED_TICK_HTML:'')+'</div><div class="ps-handle">@'+s.name+' · '+s.count+' e\'lon</div></div></div>';
      }).join('');
      document.getElementById('psCountNum').textContent = sellers.length;
      list.querySelectorAll('[data-seller]').forEach(function(row){
        row.addEventListener('click', function(){ closeAllPanels(); openSellerProfile(this.getAttribute('data-seller'), false); });
      });
    }
    document.getElementById('profileSearchBtn').addEventListener('click', function(){
      renderSellerSearch('');
      openPanel('profileSearchPanel');
      loadProfilesDirectory(function(){ renderSellerSearch(document.getElementById('psInput').value || ''); });
    });
    document.getElementById('psInput').addEventListener('input', function(e){ renderSellerSearch(e.target.value); });
    document.getElementById('notifBtn').addEventListener('click', function(){
      requireAuth(function(){
        renderConversationsList('notifMessagesList');
        openPanel('notifPanel');
      });
    });

    function renderMyLikesPanel(){
      var wrap = document.getElementById('myLikesList');
      var mine = listings.filter(function(l){ return myLikedIds.indexOf(l.id) !== -1; });
      if(!mine.length){
        wrap.innerHTML = '<div class="empty-state"><div class="emoji-box">🤍</div><p>Hali hech qanday e\'longa layk bosmagansiz</p></div>';
        return;
      }
      wrap.innerHTML = mine.map(function(l){
        return '<div class="listing" data-id="'+l.id+'"><div class="thumb"><img src="'+l.img+'" alt=""></div>' +
          '<div class="body"><div class="price">'+formatPrice(l)+'</div><div class="desc">'+l.title+', '+trValue(l.district)+'</div></div></div>';
      }).join('');
      wrap.querySelectorAll('[data-id]').forEach(function(el){
        el.addEventListener('click', function(){ closeAllPanels(); openDetail(Number(this.getAttribute('data-id')), false); });
      });
    }
    document.getElementById('myLikesBtn').addEventListener('click', function(){
      requireAuth(function(){
        loadMyLikes(function(){
          renderMyLikesPanel();
          openPanel('myLikesPanel');
        });
      });
    });

    document.getElementById('filtersBtn').addEventListener('click', function(){ openPanel('filtersPanel'); });
    document.getElementById('applyFiltersBtn').addEventListener('click', function(){
      var pf = document.getElementById('priceFromInput').value.trim();
      var pt = document.getElementById('priceToInput').value.trim();
      var rooms = document.getElementById('roomsInput').value.trim();
      filterState.priceMin = pf ? parseInt(pf,10) : null;
      filterState.priceMax = pt ? parseInt(pt,10) : null;
      filterState.rooms = rooms ? parseInt(rooms,10) || null : null;
      filterState.district = document.getElementById('filterDistrict').value || null;
      closeAllPanels();
      renderPublic();
      toast('Filtrlar qo\'llandi.');
    });
    document.getElementById('resetFiltersBtn').addEventListener('click', function(){
      document.getElementById('priceFromInput').value='';
      document.getElementById('priceToInput').value='';
      document.getElementById('roomsInput').value='';
      document.getElementById('filterDistrict').value='';
      filterState.priceMin=null; filterState.priceMax=null; filterState.rooms=null; filterState.district=null;
      renderPublic();
    });

    document.getElementById('adminLoginForm').addEventListener('submit', loginAdmin);
    document.getElementById('loginCloseBtn').addEventListener('click', function(){
      // On /panel/, the login modal is the only thing on screen - closing
      // it must not fall through to the public site underneath.
      if(PANEL_ROUTE) return;
      closeModal('adminLoginModal');
    });
    // No admin button anywhere on the site anymore - the only way in is
    // knowing the hidden /panel/ URL. That route shows ONLY the login
    // modal - the public homepage underneath is hidden, not just covered.
    if(PANEL_ROUTE){
      document.getElementById('pageHome').classList.remove('show');
      openModal('adminLoginModal');
    }
    document.getElementById('adminLogoutBtn').addEventListener('click', logoutAdmin);
    document.getElementById('statsAdminLogoutBtn').addEventListener('click', logoutAdmin);
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(function(b){ b.addEventListener('click', function(){ setAdminTab(this.getAttribute('data-tab')); }); });
    document.querySelectorAll('.overlay').forEach(function(ov){
      ov.addEventListener('click', function(e){
        if(e.target!==ov) return;
        // Same rule as the close-x: on /panel/, clicking the backdrop of
        // the login modal must not reveal the public site.
        if(PANEL_ROUTE && ov.id==='adminLoginModal') return;
        ov.classList.remove('show');
      });
    });

    document.getElementById('detailBackBtn').addEventListener('click', returnFromDetail);
    document.getElementById('sellerProfileBackBtn').addEventListener('click', returnFromSellerProfile);

    document.querySelectorAll('[data-info]').forEach(function(link){
      link.addEventListener('click', function(e){ e.preventDefault(); showPage(this.getAttribute('data-info')); });
    });
    ['aloqaBackBtn','yordamBackBtn','reklamaBackBtn','ofertaBackBtn'].forEach(function(id){
      var b = document.getElementById(id);
      if(b) b.addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });
    });

    document.getElementById('avatarBtn').addEventListener('click', function(){
      requireAuth(function(){ showPage('pageMyProfile'); switchProfileSub('profil'); renderMyListings(); });
    });
    document.getElementById('myProfileBackBtn').addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });

    // ---- mobil pastki panel (faqat telefon ekranida ko'rinadi) ----
    var mtabHomeBtn = document.getElementById('mtabHome');
    if(mtabHomeBtn) mtabHomeBtn.addEventListener('click', function(){ showPage('pageHome'); renderPublic(); });
    var mtabSearchBtn = document.getElementById('mtabSearch');
    if(mtabSearchBtn) mtabSearchBtn.addEventListener('click', function(){
      showPage('pageHome'); renderPublic(); setMobileTab('Search');
      var si = document.getElementById('searchInput');
      if(si){ si.scrollIntoView({block:'center'}); si.focus(); }
    });
    var mtabPostBtn = document.getElementById('mtabPost');
    if(mtabPostBtn) mtabPostBtn.addEventListener('click', function(){ document.getElementById('postAdBtn').click(); });
    var mtabMessagesBtn = document.getElementById('mtabMessages');
    if(mtabMessagesBtn) mtabMessagesBtn.addEventListener('click', function(){
      requireAuth(function(){
        showPage('pageMyProfile');
        document.querySelectorAll('.profile-nav-item[data-sub]').forEach(function(i){ i.classList.remove('active'); });
        var navItem = document.querySelector('.profile-nav-item[data-sub="xabarlar"]');
        if(navItem) navItem.classList.add('active');
        switchProfileSub('xabarlar');
        setMobileTab('Messages');
      });
    });
    var mtabProfileBtn = document.getElementById('mtabProfile');
    if(mtabProfileBtn) mtabProfileBtn.addEventListener('click', function(){
      requireAuth(function(){ showPage('pageMyProfile'); switchProfileSub('profil'); renderMyListings(); setMobileTab('Profile'); });
    });
    document.querySelectorAll('.profile-nav-item[data-sub]').forEach(function(item){
      item.addEventListener('click', function(){
        document.querySelectorAll('.profile-nav-item[data-sub]').forEach(function(i){ i.classList.remove('active'); });
        this.classList.add('active');
        switchProfileSub(this.getAttribute('data-sub'));
      });
    });
    function switchProfileSub(sub){
      ['profil','balans','xabarlar','tasdiqlash'].forEach(function(s){ document.getElementById('sub-'+s).classList.toggle('hidden', s!==sub); });
      if(sub === 'xabarlar'){ renderConversationsList(); }
      if(sub === 'tasdiqlash'){ renderVerifyBox(); }
    }
    function renderVerifyBox(){
      var box = document.getElementById('verifyBoxContent');
      var username = myUsername();
      box.innerHTML = '<div class="empty-note">Yuklanmoqda...</div>';
      fetch(VERIFICATION_STATUS_API + '?username=' + encodeURIComponent(username))
        .then(function(r){ return r.json(); })
        .then(function(s){
          if(s.verified){
            box.innerHTML = '<div class="badge">✓</div><h3>Profilingiz tasdiqlangan</h3>' +
              '<p style="color:rgba(var(--ink-rgb),0.6);font-size:13.5px;">Ismingiz yonida tasdiqlash belgisi ko\'rinadi.</p>';
            return;
          }
          if(s.pending){
            box.innerHTML = '<div class="badge">⏳</div><h3>Ko\'rib chiqilmoqda</h3>' +
              '<p style="color:rgba(var(--ink-rgb),0.6);font-size:13.5px;">Hujjatlaringiz yuborildi, admin tez orada ko\'rib chiqadi.</p>';
            return;
          }
          box.innerHTML =
            '<div class="badge">✓</div>' +
            '<h3>Profilingizni tasdiqlang</h3>' +
            '<p style="color:rgba(var(--ink-rgb),0.6);font-size:13.5px;margin-bottom:20px;">Ismingiz yonida belgi paydo bo\'ladi — foydalanuvchilar sizga ko\'proq ishonadi.</p>' +
            '<div style="display:flex;gap:14px;text-align:left;">' +
              '<div style="flex:1;">' +
                '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">📄 Pasport/ID rasmi</div>' +
                '<div class="upload-tile" id="verifyIdTile" style="width:100%;height:110px;font-size:26px;">📄</div>' +
                '<input type="file" id="verifyIdInput" accept="image/*" class="hidden">' +
              '</div>' +
              '<div style="flex:1;">' +
                '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">🤳 Hujjatli selfie</div>' +
                '<div class="upload-tile" id="verifySelfieTile" style="width:100%;height:110px;font-size:26px;">🤳</div>' +
                '<input type="file" id="verifySelfieInput" accept="image/*" class="hidden">' +
              '</div>' +
            '</div>' +
            '<button class="btn-full-black" id="verifySubmitBtn" style="margin-top:18px;">Yuborish</button>';

          var idFile = null, selfieFile = null;
          function wireTile(tileId, inputId, onPick){
            var tile = document.getElementById(tileId);
            var input = document.getElementById(inputId);
            tile.addEventListener('click', function(){ input.click(); });
            input.addEventListener('change', function(e){
              var f = e.target.files[0];
              if(!f) return;
              onPick(f);
              tile.style.backgroundImage = 'url(' + URL.createObjectURL(f) + ')';
              tile.style.backgroundSize = 'cover';
              tile.style.backgroundPosition = 'center';
              tile.textContent = '';
            });
          }
          wireTile('verifyIdTile', 'verifyIdInput', function(f){ idFile = f; });
          wireTile('verifySelfieTile', 'verifySelfieInput', function(f){ selfieFile = f; });

          document.getElementById('verifySubmitBtn').addEventListener('click', function(){
            if(!idFile || !selfieFile){ toast("Iltimos, ikkala rasmni ham tanlang."); return; }
            var btn = this;
            btn.disabled = true; btn.textContent = 'Yuborilmoqda...';
            var fd = new FormData();
            fd.append('username', username);
            fd.append('id_photo', idFile);
            fd.append('selfie_photo', selfieFile);
            fetch(SUBMIT_VERIFICATION_API, {method:'POST', body: fd})
              .then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
              .then(function(res){
                if(res.status !== 200 || !res.data.ok){
                  toast((res.data && res.data.error) || "Yuborishda xato yuz berdi.");
                  btn.disabled = false; btn.textContent = 'Yuborish';
                  return;
                }
                toast("Yuborildi! Admin ko'rib chiqadi.");
                renderVerifyBox();
              }).catch(function(err){
                console.error('verify submit xato:', err);
                toast("Yuborishda xato yuz berdi.");
                btn.disabled = false; btn.textContent = 'Yuborish';
              });
          });
        }).catch(function(err){
          console.error('verify status xato:', err);
          box.innerHTML = '<div class="empty-note">Yuklashda xato yuz berdi.</div>';
        });
    }
    document.getElementById('threadSendBtn').addEventListener('click', sendThreadMessage);
    document.getElementById('threadInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ sendThreadMessage(); } });
    document.getElementById('logoutBtn').addEventListener('click', function(){ isLoggedIn=false; clearLoginStorage(); showPage('pageHome'); renderPublic(); });

    function renderMyListings(){
      var username = document.getElementById('profileUsername').textContent.trim();
      var mine = listings.filter(function(l){ return l.seller === username; });
      document.getElementById('myAdsCount').textContent = mine.length;
      document.getElementById('myViewsCount').textContent = mine.reduce(function(sum,l){ return sum + (l.viewsCount||0); }, 0);
      document.getElementById('myLikesCount').textContent = mine.reduce(function(sum,l){ return sum + (l.likesCount||0); }, 0);
      // Sold listings vanish from `listings` the instant they're marked
      // sold (no grace period), so the count comes from the server's
      // sold-snapshot history instead of filtering `mine` locally.
      fetch('/api/listings/my-sold-count/?seller=' + encodeURIComponent(username))
        .then(function(r){ return r.json(); })
        .then(function(d){ document.getElementById('mySoldCount').textContent = d.soldCount || 0; })
        .catch(function(){ document.getElementById('mySoldCount').textContent = 0; });
      var box = document.getElementById('myProfileTabContent');
      if(!mine.length){
        box.innerHTML = '<div class="empty-state"><div class="emoji-box">🏠</div><p>Sizda hali e\'lonlar yo\'q</p></div>';
        return;
      }
      box.innerHTML = '<div class="grid" style="padding:16px 0;">' + mine.map(function(l){
        return '<div class="listing" data-id="'+l.id+'"><div class="thumb"><img src="'+l.img+'" alt=""></div>' +
          '<div class="body"><div class="price">'+formatPrice(l)+'</div><div class="desc">'+l.title+'</div>' +
          '<div class="meta" style="gap:8px;"><button type="button" class="qbtn" data-edit="'+l.id+'">Tahrirlash</button>' +
          '<button type="button" class="qbtn del" data-delmine="'+l.id+'">O\'chirish</button></div></div></div>';
      }).join('') + '</div>';
      box.querySelectorAll('[data-id]').forEach(function(el){ el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), false); }); });
      box.querySelectorAll('[data-edit]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          var l = findListing(Number(this.getAttribute('data-edit')));
          if(l) openEditListing(l);
        });
      });
      box.querySelectorAll('[data-delmine]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          var id = Number(this.getAttribute('data-delmine'));
          if(!confirm("E'lonni o'chirishni tasdiqlaysizmi?")) return;
          fetch(API_BASE + id + '/', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: csrfHeaders({'Content-Type': 'application/json'}),
            body: JSON.stringify({seller: username})
          }).then(function(r){
            if(r.status === 403){ toast("Bu e'lonni o'chirishga ruxsatingiz yo'q."); return; }
            loadListings(function(){ renderMyListings(); toast("E'lon o'chirildi."); });
          }).catch(function(err){ console.error('delete mine xato:', err); toast("O'chirishda xato yuz berdi."); });
        });
      });
    }
    function renderTanlanganTab(){
      var box = document.getElementById('myProfileTabContent');
      box.innerHTML = '<div class="empty-admin">Yuklanmoqda...</div>';
      loadMyLikes(function(){
        var mine = listings.filter(function(l){ return myLikedIds.indexOf(l.id) !== -1; });
        if(!mine.length){
          box.innerHTML = '<div class="empty-state"><div class="emoji-box">⭐</div><p>Sevimlilar ro\'yxati bo\'sh</p></div>';
          return;
        }
        box.innerHTML = '<div class="grid" style="padding:16px 0;">' + mine.map(function(l){
          return '<div class="listing" data-id="'+l.id+'"><div class="thumb"><img src="'+l.img+'" alt=""></div>' +
            '<div class="body"><div class="price">'+formatPrice(l)+'</div><div class="desc">'+l.title+'</div></div></div>';
        }).join('') + '</div>';
        box.querySelectorAll('[data-id]').forEach(function(el){
          el.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-id')), false); });
        });
      });
    }
    document.querySelectorAll('.profile-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        document.querySelectorAll('.profile-tab').forEach(function(t){ t.classList.remove('active'); });
        this.classList.add('active');
        if(this.getAttribute('data-ptab')==='elonlar'){ renderMyListings(); }
        else { renderTanlanganTab(); }
      });
    });

    document.getElementById('editProfileBtn').addEventListener('click', function(){
      document.getElementById('editFullNameInput').value = document.getElementById('profileFullName').textContent.trim();
      document.getElementById('editUsernameInput').value = document.getElementById('profileUsername').textContent.trim();
      document.getElementById('editPhoneInput').value = document.getElementById('profilePhoneDisplay').textContent.trim();
      openPanel('editProfilePanel');
    });
    document.getElementById('saveProfileBtn').addEventListener('click', function(){
      var fullName = document.getElementById('editFullNameInput').value.trim();
      var username = document.getElementById('editUsernameInput').value.trim();
      var phone = document.getElementById('editPhoneInput').value.trim();
      if(!fullName || !username){ alert("Iltimos, ism va foydalanuvchi nomini to'ldiring."); return; }
      if(phone.replace(/\D/g,'').length < 9){ alert("Iltimos, telefon raqamni to'liq kiriting."); return; }
      if(!currentProfile || !currentProfile.id){ alert("Profil topilmadi. Iltimos, qayta kiring."); return; }

      var saveBtn = this;
      saveBtn.disabled = true;
      fetch(PROFILE_API + currentProfile.id + '/', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({full_name: fullName, username: username, phone: phone})
      }).then(function(r){ return r.json(); }).then(function(updated){
        // Persist for real - this used to only touch the DOM, so a page
        // reload (or messaging under 'me') would silently revert to the
        // old username, which is exactly why messages could look like
        // they never reached the right person.
        applyProfile(updated);
        saveLoginToStorage(updated);
        closeAllPanels();
        renderMyListings();
        toast('Profil yangilandi.');
      }).catch(function(err){
        console.error('save profile xato:', err);
        alert("Profilni saqlashda xato yuz berdi.");
      }).finally(function(){ saveBtn.disabled = false; });
    });

    document.querySelectorAll('#quickAmounts button').forEach(function(b){
      b.addEventListener('click', function(){
        document.querySelectorAll('#quickAmounts button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        document.getElementById('amountInput').value = this.getAttribute('data-v');
      });
    });
    document.getElementById('topUpBtn').addEventListener('click', function(){
      if(!currentProfile || !currentProfile.id){ alert("Profil topilmadi. Iltimos, qayta kiring."); return; }
      if(!paymentInfo.configured){ alert("To'lov tizimi hali sozlanmagan."); return; }
      var raw = document.getElementById('amountInput').value.trim();
      var usd = parseFloat(raw.replace(',', '.'));
      if(!usd || isNaN(usd) || usd < 1){ alert("Iltimos, kamida $1 miqdorida summa kiriting."); return; }
      var cents = Math.round(usd * 100);
      var btn = this;
      btn.disabled = true;
      btn.textContent = "Yo'naltirilmoqda...";
      fetch(BALANCE_TOPUP_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({profile_id: currentProfile.id, amount_cents: cents})
      }).then(function(r){ return r.json().then(function(data){ return {status:r.status, data:data}; }); })
        .then(function(res){
          if(res.status === 200 && res.data.ok && res.data.url){
            window.location.href = res.data.url;
          } else {
            alert((res.data && res.data.error) || "To'lovni boshlashda xato yuz berdi.");
            btn.disabled = false;
            btn.textContent = "Stripe orqali to'ldirish";
          }
        })
        .catch(function(err){
          console.error('topUpBtn xato:', err);
          alert("To'lovni boshlashda xato yuz berdi.");
          btn.disabled = false;
          btn.textContent = "Stripe orqali to'ldirish";
        });
    });
    document.getElementById('postAdBtn').addEventListener('click', function(){
      requireAuth(function(){
        showPage('pagePost');
        editingListingId = null;
        postTier = 'regular';
        postPayMethod = 'card';
        document.getElementById('postPayMethodToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-method')==='card'); });
        document.getElementById('tierToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-tier')==='regular'); });
        document.getElementById('paymentSummary').classList.remove('hidden');
        var finishBtn = document.getElementById('finishPostBtn');
        finishBtn.textContent = "E'lon joylash";
        finishBtn.disabled = false;
        postRole=''; postCat=''; postDeal='sotuv'; postTypeKey='kvartira'; postRepair="Ta'mirni tanlang"; postCondition="Yangi bino"; postMortgage=false; postCurrency='ye'; postIsBuyer=false;
        document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-m')==='0'); });
        updateMortgageFieldVisibility();
        updateConditionFieldVisibility();
        updatePropertyTypeOptions();
        updateLandFieldVisibility();
        updateBuyerFieldVisibility();
        // Not editing anything yet - "Reklama qilish" only applies to an
        // already-live listing, hide any stale box left from a previous edit.
        document.getElementById('upgradeTierField').classList.add('hidden');
        document.getElementById('currencyToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-currency')==='ye'); });
        document.getElementById('priceRangeCurrencyToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-currency')==='ye'); });
        postPhotos = [];
        renderUploadThumbs();
        document.getElementById('uploadCount').textContent = '0/10';
        postVoiceNoteId = null; postVoiceNoteUrl = null;
        renderVoiceRecorder();
        document.getElementById('postTitle').value='';
        document.getElementById('postDesc').value='';
        document.getElementById('postPhone').value='+998';
        document.getElementById('postPrice').value='';
        document.getElementById('postPriceMin').value='';
        document.getElementById('postPriceMax').value='';
        document.getElementById('postFloor').value='';
        document.getElementById('postFloorsTotal').value='';
        document.getElementById('postArea').value='';
        document.getElementById('postRooms').value='';
        document.getElementById('postRepair').value="Ta'mirni tanlang";
        document.getElementById('postDistrict').value='';
        document.getElementById('condToggle').querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.getAttribute('data-c')==='Yangi bino'); });
        showPostStep(1);
      });
    });
    document.querySelectorAll('#postStep1 [data-role]').forEach(function(row){
      row.addEventListener('click', function(){
        postRole = this.getAttribute('data-role');
        postDeal = this.getAttribute('data-deal');
        postIsBuyer = this.getAttribute('data-buyer') === '1';
        updateMortgageFieldVisibility();
        updateConditionFieldVisibility();
        updatePropertyTypeOptions();
        updateLandFieldVisibility();
        updateBuyerFieldVisibility();
        showPostStep(2);
      });
    });
    document.querySelectorAll('#postStep2 [data-cat]').forEach(function(row){
      row.addEventListener('click', function(){
        postCat = this.getAttribute('data-cat');
        postTypeKey = this.getAttribute('data-typekey');
        document.getElementById('bcRole').textContent = postRole;
        document.getElementById('bcCat').textContent = postCat;
        updateLandFieldVisibility();
        showPostStep(3);
      });
    });
    document.getElementById('postBack').addEventListener('click', function(){
      if(editingListingId){
        editingListingId = null;
        document.getElementById('paymentSummary').classList.remove('hidden');
        document.getElementById('finishPostBtn').disabled = false;
        updatePaymentSummary();
        showPage('pageMyProfile'); switchProfileSub('profil'); renderMyListings();
        return;
      }
      if(!document.getElementById('postStep4').classList.contains('hidden')){ showPostStep(3); return; }
      if(!document.getElementById('postStep3').classList.contains('hidden')){ showPostStep(2); return; }
      if(!document.getElementById('postStep2').classList.contains('hidden')){ showPostStep(1); return; }
      showPage('pageHome'); renderPublic();
    });

    var postLocSearchBtn = document.getElementById('postLocationSearchBtn');
    if(postLocSearchBtn) postLocSearchBtn.addEventListener('click', doPostLocationSearch);
    var postLocSearchInput = document.getElementById('postLocationSearchInput');
    if(postLocSearchInput) postLocSearchInput.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); doPostLocationSearch(); } });
    var postLocExpandBtn = document.getElementById('postLocationExpandBtn');
    if(postLocExpandBtn) postLocExpandBtn.addEventListener('click', function(){
      var wrap = document.getElementById('postLocationMapWrap');
      var goingFull = !wrap.classList.contains('fullscreen');
      wrap.classList.toggle('fullscreen', goingFull);
      postLocExpandBtn.title = goingFull ? "Xaritani kichraytirish" : "Xaritani kattalashtirish";
      postLocExpandBtn.innerHTML = goingFull
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6"/></svg>';
      setTimeout(function(){ if(postLocationMap) postLocationMap.invalidateSize(); }, 60);
    });

    document.getElementById('postContinueBtn').addEventListener('click', function(){
      var err = validatePostForm();
      if(err){ alert(err); return; }
      if(postIsBuyer){
        // A buyer's "qidiryapman" listing always stays oddiy - skip the
        // TOP/VIP/payment step entirely and post straight away.
        postTier = 'regular';
        submitPostPayload(this);
        return;
      }
      showPostStep(4);
    });

    document.getElementById('condToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('condToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postCondition = this.getAttribute('data-c');
      });
    });
    document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('mortgageToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postMortgage = this.getAttribute('data-m') === '1';
      });
    });
    document.getElementById('postRepair').addEventListener('change', function(){ postRepair = this.value; });
    // Narx maydoni - valyuta alohida tugmalar orqali tanlanadi, shu
    // sabab bu yerda faqat raqam kiritishga ruxsat beriladi.
    document.getElementById('postPrice').addEventListener('input', function(){
      var digitsOnly = this.value.replace(/[^0-9]/g, '');
      if(digitsOnly !== this.value) this.value = digitsOnly;
    });
    document.getElementById('currencyToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('currencyToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postCurrency = this.getAttribute('data-currency');
      });
    });
    // Same postCurrency, just the toggle shown next to the buyer's
    // budget-range inputs instead of the seller's single price input.
    document.getElementById('priceRangeCurrencyToggle').querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        document.getElementById('priceRangeCurrencyToggle').querySelectorAll('button').forEach(function(x){ x.classList.remove('sel'); });
        this.classList.add('sel');
        postCurrency = this.getAttribute('data-currency');
      });
    });
    document.getElementById('postPriceMin').addEventListener('input', function(){
      var digitsOnly = this.value.replace(/[^0-9]/g, '');
      if(digitsOnly !== this.value) this.value = digitsOnly;
    });
    document.getElementById('postPriceMax').addEventListener('input', function(){
      var digitsOnly = this.value.replace(/[^0-9]/g, '');
      if(digitsOnly !== this.value) this.value = digitsOnly;
    });

    renderUploadThumbs();
    document.getElementById('uploadTile').addEventListener('click', function(){ document.getElementById('postFileInput').click(); });
    document.getElementById('postFileInput').addEventListener('change', function(e){
      var files = Array.from(e.target.files || []);
      files.forEach(function(file){
        if(postPhotos.length >= 10) return;
        if(!file.type || file.type.indexOf('image/') !== 0) return;
        var entry = {url: URL.createObjectURL(file), imageId: null, uploading: true, failed: false, existing: false};
        postPhotos.push(entry);
        uploadPhotoFile(file, entry); // uploads immediately - the actual bug being fixed
      });
      renderUploadThumbs();
      document.getElementById('uploadCount').textContent = postPhotos.length + '/10';
      e.target.value = '';
    });

    document.getElementById('finishPostBtn').addEventListener('click', function(){
      var err = validatePostForm();
      if(err){ alert(err); return; }
      if(!editingListingId && isPaidTier() && postPayMethod === 'card' && !paymentInfo.configured){
        alert("To'lov tizimi hali sozlanmagan. Iltimos, keyinroq urinib ko'ring.");
        return;
      }
      submitPostPayload(this);
    });

    // Coming back from Stripe Checkout (success or cancel) - confirm and
    // finish creating the listing, or let the user know it was cancelled.
    (function handlePaymentReturn(){
      var params = new URLSearchParams(window.location.search);
      var outcome = params.get('post_payment');
      if(!outcome) return;
      var sessionId = params.get('session_id');
      history.replaceState(null, '', window.location.pathname);

      if(outcome === 'cancelled'){
        toast("To'lov bekor qilindi.");
        return;
      }
      if(outcome === 'success' && sessionId){
        toast("To'lov tasdiqlanmoqda...");
        fetch(CONFIRM_PAYMENT_API + '?session_id=' + encodeURIComponent(sessionId))
          .then(function(r){ return r.json(); })
          .then(function(res){
            if(res.ok && res.listing){
              loadListings(function(){
                renderPublic();
                toast("To'lov qabul qilindi, e'lon joylandi!");
                openDetail(res.listing.id, false);
              });
            } else {
              toast("To'lov hali tasdiqlanmadi. Bir ozdan so'ng qayta urinib ko'ring.");
            }
          }).catch(function(err){ console.error('confirm payment xato:', err); toast("To'lovni tasdiqlashda xato yuz berdi."); });
      }
    })();

    // Same idea, but for a balance top-up instead of a listing purchase.
    (function handleBalanceTopupReturn(){
      var params = new URLSearchParams(window.location.search);
      var outcome = params.get('balance_payment');
      if(!outcome) return;
      var sessionId = params.get('session_id');
      history.replaceState(null, '', window.location.pathname);

      if(outcome === 'cancelled'){
        toast("To'lov bekor qilindi.");
        return;
      }
      if(outcome === 'success' && sessionId){
        toast("To'lov tasdiqlanmoqda...");
        fetch(CONFIRM_BALANCE_API + '?session_id=' + encodeURIComponent(sessionId))
          .then(function(r){ return r.json(); })
          .then(function(res){
            if(res.ok && res.profile){
              applyProfile(res.profile);
              saveLoginToStorage(res.profile);
              toast('Balans to\'ldirildi!');
            } else {
              toast("To'lov hali tasdiqlanmadi. Bir ozdan so'ng qayta urinib ko'ring.");
            }
          }).catch(function(err){ console.error('confirm balance xato:', err); toast("To'lovni tasdiqlashda xato yuz berdi."); });
      }
    })();

    document.getElementById('authGateCancel').addEventListener('click', function(){ document.getElementById('authGate').classList.add('hidden'); pendingAction=null; });
    document.getElementById('authGateEnter').addEventListener('click', function(){
      document.getElementById('authGate').classList.add('hidden');
      document.getElementById('authPhoneScreen').classList.remove('hidden');
    });
    document.getElementById('authPhoneClose').addEventListener('click', function(){ closeAllAuth(); pendingAction=null; });
    document.getElementById('guestBtn').addEventListener('click', function(){ closeAllAuth(); pendingAction=null; });
    document.getElementById('simpleRegisterBtn').addEventListener('click', function(){
      var fullName = document.getElementById('simpleRegName').value.trim();
      var phone = document.getElementById('simpleRegPhone').value.trim();
      if(!fullName){ alert("Ism familiyangizni kiriting."); return; }
      if(!phone){ alert("Telefon raqamingizni kiriting."); return; }
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Kirilmoqda...';
      fetch(SIMPLE_REGISTER_API, {
        method: 'POST', credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({full_name: fullName, phone: phone})
      }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
        .then(function(res){
          btn.disabled = false;
          btn.textContent = "Ro'yxatdan o'tish";
          if((res.status !== 200 && res.status !== 201) || !res.data.ok){
            alert((res.data && res.data.error) || "Ro'yxatdan o'tishda xato yuz berdi.");
            return;
          }
          isLoggedIn = true;
          var p = res.data.profile;
          applyProfile(p);
          saveLoginToStorage(p);
          loadProfilesDirectory();
          closeAllAuth();
          if(pendingAction){ pendingAction(); pendingAction=null; }
        }).catch(function(err){
          console.error('simple register xato:', err);
          alert("Ro'yxatdan o'tishda xato yuz berdi.");
          btn.disabled = false;
          btn.textContent = "Ro'yxatdan o'tish";
        });
    });

    // Phone -> code, no intermediate "choose method"/"open Telegram" step:
    // Telegram's Gateway API delivers the code straight to whichever
    // Telegram account is registered under the typed phone number, so
    // there's nothing to open or share - just wait for the code.
    function showCodeScreen(){
      var phone = document.getElementById('phoneInput').value.trim();
      document.getElementById('codeSubLabel').textContent = phone + " raqamiga Telegram orqali yuborilgan 6 xonali kod";
      document.getElementById('authCodeScreen').classList.remove('hidden');
      var boxes = document.querySelectorAll('#codeBoxes input');
      boxes.forEach(function(b){ b.value=''; });
      boxes[0].focus();
    }
    // Phone/Telegram-code login retired in favor of "Sign in with
    // Google" (initGoogleSignIn/handleGoogleCredential below) - the
    // phoneNextBtn entry point is gone from authPhoneScreen, so nothing
    // calls showCodeScreen()/starts the Telegram flow anymore. The
    // screens/handlers below are left in place (harmless, unreachable)
    // rather than torn out, to keep this change small and low-risk.
    var codeBoxes = document.querySelectorAll('#codeBoxes input');
    codeBoxes.forEach(function(box,i){
      box.addEventListener('input', function(){
        this.value = this.value.replace(/\D/g,'').slice(0,1);
        if(this.value && i < codeBoxes.length-1) codeBoxes[i+1].focus();
      });
      box.addEventListener('keydown', function(e){ if(e.key==='Backspace' && !this.value && i>0) codeBoxes[i-1].focus(); });
    });
    document.getElementById('authCodeClose').addEventListener('click', function(){ closeAllAuth(); pendingAction=null; });
    document.getElementById('resendLink').addEventListener('click', function(){
      var phone = document.getElementById('phoneInput').value.trim();
      if(!phone){ toast("Qaytadan urinib ko'ring."); return; }
      fetch(TELEGRAM_START_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({phone: phone})
      }).then(function(r){ return r.json(); })
        .then(function(d){
          if(d.ok){ telegramVerifyToken = d.token; toast("Kod qayta yuborildi."); }
          else { toast(d.error || "Xato yuz berdi."); }
        }).catch(function(){ toast("Xato yuz berdi."); });
    });
    document.getElementById('codeConfirmBtn').addEventListener('click', function(ev){
      if(ev && ev.preventDefault) ev.preventDefault();
      try{
        var code = Array.from(codeBoxes).map(function(b){ return b.value; }).join('');
        if(code.length < 6){ alert("Iltimos, 6 xonali kodni to'liq kiriting."); return; }
        if(!telegramVerifyToken){ alert("Tasdiqlash seansi topilmadi. Qaytadan urinib ko'ring."); return; }

        var confirmBtn = this;
        confirmBtn.disabled = true;
        fetch(TELEGRAM_VERIFY_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify({token: telegramVerifyToken, code: code})
        }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
          .then(function(res){
            confirmBtn.disabled = false;
            if(res.status !== 200 || !res.data.ok){
              alert((res.data && res.data.error) || "Kod noto'g'ri. Qaytadan urinib ko'ring.");
              return;
            }
            finishTelegramLogin(res.data.phone);
          }).catch(function(err){
            confirmBtn.disabled = false;
            console.error('telegram verify xato:', err);
            alert("Kodni tekshirishda xato yuz berdi.");
          });
      }catch(err){ console.error('codeConfirmBtn xato:', err); }
      return false;
    });
    function finishTelegramLogin(verifiedPhone){
      try{
        var phone = verifiedPhone || document.getElementById('phoneInput').value.trim();
        telegramVerifyToken = null;
        telegramDeepLink = null;

        fetch(PROFILE_API + '?phone=' + encodeURIComponent(phone))
          .then(function(r){ return r.json(); })
          .then(function(existing){
            if(existing.length){
              // Reuse the EXISTING profile as-is (id, username, full_name,
              // everything) - never regenerate/overwrite the username from
              // whatever they typed this time. The username is the stable
              // identity every listing and message is tied to; silently
              // changing it here is exactly what fragmented one person
              // into multiple disconnected "accounts" before.
              isLoggedIn = true;
              var p = existing[0];
              applyProfile(p);
              saveLoginToStorage(p);
              closeAllAuth();
              if(pendingAction){ pendingAction(); pendingAction=null; }
            } else {
              // Brand-new phone: only NOW ask for full name + site
              // username, after the phone itself is already verified.
              document.getElementById('authCodeScreen').classList.add('hidden');
              document.getElementById('newProfilePhone').value = phone;
              document.getElementById('profileFullNameInput').value = '';
              document.getElementById('profileUsernameInput').value = '';
              document.getElementById('authProfileScreen').classList.remove('hidden');
            }
          }).catch(function(err){ console.error('profile fetch xato:', err); });
      }catch(err){ console.error('finishTelegramLogin xato:', err); }
    }

    function handleGoogleCredential(response){
      // response.credential is a signed JWT from Google - we never see
      // or handle the user's actual Google password, only this token,
      // which the backend verifies with Google before trusting it.
      try{
        fetch(GOOGLE_AUTH_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify({credential: response.credential})
        }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
          .then(function(res){
            if((res.status !== 200 && res.status !== 201) || !res.data.ok){
              alert((res.data && res.data.error) || "Google bilan kirishda xato yuz berdi.");
              return;
            }
            isLoggedIn = true;
            var p = res.data.profile;
            applyProfile(p);
            saveLoginToStorage(p);
            loadProfilesDirectory();
            closeAllAuth();
            if(pendingAction){ pendingAction(); pendingAction=null; }
          }).catch(function(err){
            console.error('google auth xato:', err);
            alert("Google bilan kirishda xato yuz berdi.");
          });
      }catch(err){ console.error('handleGoogleCredential xato:', err); }
    }
    function initGoogleSignIn(){
      var clientIdEl = document.getElementById('googleClientId');
      var clientId = clientIdEl ? clientIdEl.getAttribute('data-client-id') : '';
      if(!clientId) return; // not configured yet (no GOOGLE_CLIENT_ID env var) - button stays empty
      var attempts = 0;
      (function ready(){
        if(!window.google || !window.google.accounts || !window.google.accounts.id){
          if(++attempts > 50) return; // ~10s - gsi script failed to load, give up quietly
          setTimeout(ready, 200);
          return;
        }
        // use_fedcm_for_button: Chrome endi uchinchi tomon cookie'larini
        // bloklaydi, shu sabab GSI'ning eski popup/iframe usuli
        // (accounts.google.com/gsi/transform) bo'sh oq oyna sifatida
        // qotib qoladi. FedCM - brauzerning o'z hisob tanlash oynasi -
        // bunga bog'liq emas, shuning uchun ishonchli ishlaydi.
        google.accounts.id.initialize({client_id: clientId, callback: handleGoogleCredential, use_fedcm_for_button: true});
        var btnEl = document.getElementById('googleSignInBtn');
        if(btnEl){
          google.accounts.id.renderButton(btnEl, {theme:'outline', size:'large', width:320, text:'continue_with'});
        }
      })();
    }

    document.getElementById('authProfileSubmitBtn').addEventListener('click', function(ev){
      if(ev && ev.preventDefault) ev.preventDefault();
      try{
        var fullName = document.getElementById('profileFullNameInput').value.trim();
        var username = document.getElementById('profileUsernameInput').value.trim().toLowerCase().replace(/\s+/g,'_');
        var phone = document.getElementById('newProfilePhone').value;
        if(!fullName){ alert("Iltimos, ism familiyangizni kiriting."); return; }
        if(!username){ alert("Iltimos, saytdagi profil nomingizni kiriting."); return; }

        var btn = this;
        btn.disabled = true;
        var newProfile = { phone: phone, username: username, full_name: fullName, role: 'Uy egasi' };
        fetch(PROFILE_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify(newProfile)
        }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
          .then(function(res){
            btn.disabled = false;
            if(res.status !== 201 && res.status !== 200){
              alert("Profil nomi band bo'lishi mumkin, boshqasini sinab ko'ring.");
              return;
            }
            isLoggedIn = true;
            applyProfile(res.data);
            saveLoginToStorage(res.data);
            loadProfilesDirectory();
            closeAllAuth();
            if(pendingAction){ pendingAction(); pendingAction=null; }
          }).catch(function(err){
            btn.disabled = false;
            console.error('profile post xato:', err);
            alert("Profilni yaratishda xato yuz berdi.");
          });
      }catch(err){ console.error('authProfileSubmitBtn xato:', err); }
      return false;
    });

    }catch(initErr){
      console.error('INIT XATO:', initErr);
    }

    try{
      var savedProfile = loadLoginFromStorage();
      if(savedProfile){
        isLoggedIn = true;
        applyProfile(savedProfile);
        // The cached copy in localStorage can be stale (created before a
        // field like public_id existed, or balance/verified changed on
        // another device) - always refresh from the server right after
        // showing the cached version, so the UI self-heals silently.
        if(savedProfile.id){
          fetch(PROFILE_API + savedProfile.id + '/')
            .then(function(r){ return r.ok ? r.json() : null; })
            .then(function(fresh){
              if(fresh && fresh.username){
                applyProfile(fresh);
                saveLoginToStorage(fresh);
              }
            })
            .catch(function(err){ console.error('profil yangilash xato:', err); });
        }
      }
    }catch(loginRestoreErr){
      console.error('LOGIN TIKLASH XATO:', loginRestoreErr);
    }
  } // init()
