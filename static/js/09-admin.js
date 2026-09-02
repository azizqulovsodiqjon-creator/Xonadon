"use strict";

  /* =========================================================
     ADMIN
  ==========================================================*/
  function loginAdmin(e){
    e.preventDefault();
    var u = document.getElementById('a_user').value, p = document.getElementById('a_pass').value;
    var errBox = document.getElementById('loginError');
    var btn = document.getElementById('adminLoginForm').querySelector('button[type="submit"]');
    if(btn) btn.disabled = true;
    fetch(ADMIN_LOGIN_API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify({username: u, password: p})
    }).then(function(r){ return r.json().then(function(data){ return {status:r.status, data:data}; }); })
      .then(function(res){
        if(res.status === 200 && res.data.ok){
          errBox.style.display='none'; closeModal('adminLoginModal');
          document.getElementById('adminLoginForm').reset();
          if(res.data.isSuperAdmin){
            showPage('pageAdmin'); renderAdmin();
          } else {
            showPage('pageAdminStats'); renderAdminStatsOnly();
          }
        } else {
          errBox.textContent = (res.data && res.data.error) || "Login yoki parol noto'g'ri.";
          errBox.style.display='block';
        }
      })
      .catch(function(err){ console.error('loginAdmin xato:', err); errBox.textContent = "Ulanishda xato yuz berdi."; errBox.style.display='block'; })
      .finally(function(){ if(btn) btn.disabled = false; });
  }
  function logoutAdmin(){
    fetch(ADMIN_LOGOUT_API, {method:'POST', credentials:'same-origin', headers: csrfHeaders()})
      .catch(function(err){ console.error('logoutAdmin xato:', err); })
      .finally(function(){
        if(PANEL_ROUTE){
          // Logging out on /panel/ must land back on the login form, not
          // the public site - this URL never shows the site, logged in
          // or not.
          document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('show'); });
          openModal('adminLoginModal');
          return;
        }
        showPage('pageHome'); renderPublic();
      });
  }
  function renderAdminStatsOnly(targetId){
    var wrap = document.getElementById(targetId || 'statsAdminContent');
    wrap.innerHTML = '<div class="empty-admin">Yuklanmoqda...</div>';
    fetch('/api/admin/stats/', {credentials:'same-origin'}).then(function(r){
      // A non-200 (e.g. a session/permission hiccup) still has a JSON
      // body, just not the stats shape - without this check it used to
      // render straight through as "undefined" / "$NaN" everywhere
      // instead of a clear error.
      if(!r.ok){ throw new Error('admin stats HTTP ' + r.status); }
      return r.json();
    }).then(function(s){
      var sellerRows = (s.sellers || []).map(function(row){
        var paidHtml = (row.top_count || row.vip_count)
          ? (row.top_count ? ('TOP: ' + row.top_count + " ta (" + formatUsd(row.top_value_cents||0) + ')') : '') +
            (row.top_count && row.vip_count ? ' · ' : '') +
            (row.vip_count ? ('VIP: ' + row.vip_count + " ta (" + formatUsd(row.vip_value_cents||0) + ')') : '')
          : "pullik e'lon yo'q";
        return '<div class="queue-row"><div class="queue-info">' +
          '<div class="qdesc">' + displayName(row.seller) + '</div>' +
          '<div class="qseller">' + row.listing_count + " ta e'lon · 👁 " + (row.total_views||0) + " ko'rish · 🤍 " + (row.total_likes||0) + ' layk · ' + paidHtml + '</div>' +
          '</div></div>';
      }).join('') || '<div class="empty-admin">Hozircha sotuvchi yo\'q.</div>';
      var soldRows = (s.soldListingsDetail || []).map(function(row){
        return '<div class="queue-row"><div class="queue-info">' +
          '<div class="qdesc">' + row.title + ' · ' + row.district + '</div>' +
          '<div class="qseller">' + displayName(row.seller) + ' · ' + row.price + '</div>' +
          '</div></div>';
      }).join('') || '<div class="empty-admin">Hozircha sotilgan uy yo\'q.</div>';
      wrap.innerHTML =
        '<div class="admin-stats">' +
          '<div class="astat"><div class="n">' + s.totalListings + '</div><div class="l">Jami e\'lonlar</div></div>' +
          '<div class="astat"><div class="n">' + s.soldListings + '</div><div class="l">Sotilgan uylar</div></div>' +
          '<div class="astat"><div class="n">' + s.paidListingsBought + '</div><div class="l">Pullik (TOP/VIP) e\'lonlar</div></div>' +
          '<div class="astat"><div class="n">' + (s.totalViews||0) + '</div><div class="l">Jami ko\'rishlar</div></div>' +
          '<div class="astat"><div class="n">' + (s.totalLikes||0) + '</div><div class="l">Jami layklar</div></div>' +
        '</div>' +
        '<div class="admin-stats">' +
          '<div class="astat"><div class="n">' + ((s.tierBreakdown&&s.tierBreakdown.top) ? s.tierBreakdown.top.count : 0) + '</div><div class="l">TOP e\'lonlar (qiymati ' + formatUsd((s.tierBreakdown&&s.tierBreakdown.top) ? s.tierBreakdown.top.revenueCents : 0) + ')</div></div>' +
          '<div class="astat"><div class="n">' + ((s.tierBreakdown&&s.tierBreakdown.vip) ? s.tierBreakdown.vip.count : 0) + '</div><div class="l">VIP e\'lonlar (qiymati ' + formatUsd((s.tierBreakdown&&s.tierBreakdown.vip) ? s.tierBreakdown.vip.revenueCents : 0) + ')</div></div>' +
        '</div>' +
        '<div class="admin-stats">' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsToday) + '</div><div class="l">Kunlik daromad</div></div>' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsWeek) + '</div><div class="l">Haftalik daromad</div></div>' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsMonth) + '</div><div class="l">Oylik daromad</div></div>' +
          '<div class="astat"><div class="n">' + formatUsd(s.revenueCentsAllTime) + '</div><div class="l">Jami daromad</div></div>' +
        '</div>' +
        '<h3 style="margin:18px 0 10px;">Sotilgan uylar (jami narx: ' + (s.soldListingsTotalPriceNumber||0).toLocaleString('ru-RU') + ')</h3>' + soldRows +
        '<h3 style="margin:18px 0 10px;">Profillar</h3>' + sellerRows;
    }).catch(function(err){
      console.error('admin stats xato:', err);
      wrap.innerHTML = '<div class="empty-admin">Statistikani yuklashda xato yuz berdi.</div>';
    });
  }
  function setAdminTab(tab){
    adminTab = tab;
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tab')===tab); });
    renderAdmin();
  }
  function renderAdminStats(){
    var vipCount = listings.filter(function(l){ return l.vip; }).length;
    var topCount = listings.filter(function(l){ return l.top; }).length;
    var totalViews = listings.reduce(function(sum,l){ return sum + (l.viewsCount||0); }, 0);
    var totalLikes = listings.reduce(function(sum,l){ return sum + (l.likesCount||0); }, 0);
    // Total registered profiles (allProfilesDirectory), not just sellers
    // who've posted a listing - a "profiles" count should include
    // everyone who signed up, listing or not.
    document.getElementById('adminStats').innerHTML =
      '<div class="astat"><div class="n">'+listings.length+'</div><div class="l">Jami e\'lonlar</div></div>' +
      '<div class="astat"><div class="n">'+vipCount+'</div><div class="l">VIP e\'lonlar</div></div>' +
      '<div class="astat"><div class="n">'+topCount+'</div><div class="l">TOP e\'lonlar</div></div>' +
      '<div class="astat"><div class="n">'+allProfilesDirectory.length+'</div><div class="l">Profillar ro\'yxati</div></div>' +
      '<div class="astat"><div class="n">'+totalViews+'</div><div class="l">Jami ko\'rishlar</div></div>' +
      '<div class="astat"><div class="n">'+totalLikes+'</div><div class="l">Jami layklar</div></div>';
  }
  function renderAdmin(){
    renderAdminStats();
    var wrap = document.getElementById('adminContent');
    if(adminTab==='stats'){
      // Same rich statistics the stats-only admin sees - the full admin
      // (988912) shouldn't need a separate login to see them too.
      renderAdminStatsOnly('adminContent');
      return;
    }
    if(adminTab==='profiles'){
      // Tasdiqlash used to be its own tab - now it renders inline on
      // whichever profile has a pending request, so there's one place
      // to look instead of two. Needs three fetches merged together:
      // the profile list itself, who's waiting on verification, and
      // (from the stats endpoint, already computed there) each
      // profile's listing/view/like/payment totals.
      wrap.innerHTML =
        '<input type="text" id="profileSearchInput" placeholder="ID, username yoki ism bo\'yicha qidirish..." style="width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--line);margin-bottom:14px;font-family:inherit;font-size:14px;background:var(--card);color:var(--ink);">' +
        '<div id="profileListBody"><div class="empty-admin">Yuklanmoqda...</div></div>';
      Promise.all([
        fetch(PROFILE_API).then(function(r){ return r.json(); }),
        fetch(ADMIN_VERIFICATION_REQUESTS_API, {credentials:'same-origin'}).then(function(r){ return r.json(); }),
        fetch('/api/admin/stats/', {credentials:'same-origin'}).then(function(r){ return r.json(); })
      ]).then(function(results){
        var profiles = results[0], verifReqs = results[1], stats = results[2];
        var verifByUsername = {};
        verifReqs.forEach(function(v){ verifByUsername[v.username] = v; });
        var statsByUsername = {};
        (stats.sellers || []).forEach(function(s){ statsByUsername[s.seller] = s; });
        renderAdminProfilesList(profiles, verifByUsername, statsByUsername, '');
        document.getElementById('profileSearchInput').addEventListener('input', function(){
          renderAdminProfilesList(profiles, verifByUsername, statsByUsername, this.value.trim().toLowerCase());
        });
      }).catch(function(err){
        console.error('admin profiles xato:', err);
        var body = document.getElementById('profileListBody');
        if(body) body.innerHTML = '<div class="empty-admin">Yuklashda xato yuz berdi.</div>';
      });
      return;
    }
    if(!listings.length){ wrap.innerHTML = '<div class="empty-admin">Hozircha e\'lon yo\'q.</div>'; return; }
    wrap.innerHTML = listings.map(function(l){
      return '<div class="queue-row" data-open="'+l.id+'"><img src="'+l.img+'" alt="">' +
        '<div class="queue-info"><div class="qprice">'+formatPrice(l)+(l.sold?' · <span style="color:var(--red);">SOTILDI</span>':'')+'</div>' +
        '<div class="qdesc">'+l.title+' · '+l.district+' · '+l.type+'</div>' +
        '<div class="qseller">'+l.seller+' · 👁 '+l.viewsCount+' · 🤍 '+l.likesCount+'</div></div>' +
        '<div class="queue-actions">' +
          '<button class="qbtn" data-action="sold" data-id="'+l.id+'" data-sold="'+(l.sold?'1':'0')+'">'+(l.sold?'Sotilmagan deb belgilash':'Sotildi deb belgilash')+'</button>' +
          '<button class="qbtn del" data-action="delete" data-id="'+l.id+'">O\'chirish</button>' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('[data-open]').forEach(function(row){ row.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-open')), true); }); });
    wrap.querySelectorAll('[data-action="delete"]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        deleteListing(Number(this.getAttribute('data-id')));
      });
    });
    wrap.querySelectorAll('[data-action="sold"]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = Number(this.getAttribute('data-id'));
        var nextSold = this.getAttribute('data-sold') !== '1';
        toggleListingSold(id, nextSold);
      });
    });
  }
  function renderAdminProfilesList(profiles, verifByUsername, statsByUsername, query){
    var body = document.getElementById('profileListBody');
    if(!body) return;
    var filtered = profiles.filter(function(p){
      if(!query) return true;
      return String(p.public_id||'') === query || String(p.id) === query ||
        (p.username||'').toLowerCase().indexOf(query)!==-1 ||
        (p.full_name||'').toLowerCase().indexOf(query)!==-1;
    });
    if(!filtered.length){ body.innerHTML = '<div class="empty-admin">Hech narsa topilmadi.</div>'; return; }
    body.innerHTML = filtered.map(function(p){
      var v = verifByUsername[p.username];
      var s = statsByUsername[p.username] || {listing_count:0, total_views:0, total_likes:0, top_count:0, vip_count:0, top_value_cents:0, vip_value_cents:0};
      var verifHtml = v ?
        '<div class="verify-inline" style="width:100%;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">' +
          '<div style="font-size:12.5px;font-weight:700;color:var(--accent2);margin-bottom:8px;">Tasdiqlash kutilmoqda</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
            '<img src="'+v.idPhoto+'" alt="ID" style="width:80px;height:64px;border-radius:8px;object-fit:cover;">' +
            '<img src="'+v.selfiePhoto+'" alt="Selfie" style="width:80px;height:64px;border-radius:8px;object-fit:cover;">' +
          '</div>' +
          '<button class="qbtn" data-decide="approve" data-vid="'+v.id+'">Tasdiqlash</button> ' +
          '<button class="qbtn del" data-decide="reject" data-vid="'+v.id+'">Rad etish</button>' +
        '</div>' : '';
      // TOP/VIP shown separately (each tier's own price × how many of
      // their listings are currently at that tier) rather than one
      // lumped total - a listing that reached a tier without an audited
      // payment (seeded/demo data, or predating PaymentEvent tracking)
      // still shows a real amount here instead of $0.00.
      var paidHtml = (s.top_count || s.vip_count)
        ? (s.top_count ? ('TOP: ' + s.top_count + " ta (" + formatUsd(s.top_value_cents||0) + ')') : '') +
          (s.top_count && s.vip_count ? ' · ' : '') +
          (s.vip_count ? ('VIP: ' + s.vip_count + " ta (" + formatUsd(s.vip_value_cents||0) + ')') : '')
        : "pullik e'lon yo'q";
      return '<div class="profile-row" data-seller="'+p.username+'" style="cursor:pointer;flex-wrap:wrap;">' +
        '<div class="profile-avatar">'+(p.full_name || p.username).charAt(0).toUpperCase()+'</div>' +
        '<div class="profile-info"><div class="profile-name">'+(p.full_name || p.username)+(p.verified?VERIFIED_TICK_HTML:'')+'</div>' +
        '<div class="profile-meta">ID: '+(p.public_id||p.id)+' · '+(p.phone || p.email || '—')+' · '+p.role+'</div></div>' +
        '<div class="profile-count">'+s.listing_count+" ta e'lon · 👁 "+(s.total_views||0)+' · 🤍 '+(s.total_likes||0)+' · '+paidHtml+'</div>' +
        '<button class="qbtn" data-discount="'+p.id+'" data-username="'+p.username+'" style="flex-shrink:0;">Chegirma berish</button>' +
        '<button class="qbtn del" data-delprofile="'+p.id+'" data-username="'+p.username+'" style="flex-shrink:0;">O\'chirish</button>' +
        '<div class="discount-form hidden" id="discountForm-'+p.id+'" style="width:100%;"></div>' +
        verifHtml +
      '</div>';
    }).join('');

    body.querySelectorAll('[data-seller]').forEach(function(row){
      row.addEventListener('click', function(e){
        if(e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
        openSellerProfile(this.getAttribute('data-seller'), true);
      });
    });
    body.querySelectorAll('[data-delprofile]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-delprofile');
        var username = this.getAttribute('data-username');
        if(!confirm("'" + username + "' profilini butunlay o'chirmoqchimisiz? Bu amalni orqaga qaytarib bo'lmaydi.")) return;
        fetch('/api/profiles/' + id + '/', {method: 'DELETE', credentials: 'same-origin', headers: csrfHeaders()})
          .then(function(r){
            if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
            if(r.status === 204 || r.ok){
              toast("Profil o'chirildi.");
              renderAdmin();
            } else {
              toast("O'chirishda xato yuz berdi.");
            }
          }).catch(function(err){ console.error('delete profile xato:', err); toast("Xato yuz berdi."); });
      });
    });
    body.querySelectorAll('[data-decide]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-vid');
        var decision = this.getAttribute('data-decide');
        fetch(ADMIN_VERIFICATION_REQUESTS_API + id + '/decide/', {
          method: 'POST', credentials: 'same-origin',
          headers: csrfHeaders({'Content-Type': 'application/json'}),
          body: JSON.stringify({decision: decision})
        }).then(function(r){
          if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
          toast(decision === 'approve' ? "Profil tasdiqlandi." : "So'rov rad etildi.");
          renderAdmin();
        }).catch(function(err){ console.error('verification decide xato:', err); toast("Xato yuz berdi."); });
      });
    });
    body.querySelectorAll('[data-discount]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var pid = this.getAttribute('data-discount');
        var username = this.getAttribute('data-username');
        var formEl = document.getElementById('discountForm-'+pid);
        var wasOpen = !formEl.classList.contains('hidden');
        document.querySelectorAll('.discount-form').forEach(function(f){ f.classList.add('hidden'); f.innerHTML=''; });
        if(wasOpen) return;
        formEl.classList.remove('hidden');
        formEl.innerHTML =
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">' +
            '<select class="disc-tier" style="padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);"><option value="top">TOP</option><option value="vip">VIP</option></select>' +
            '<input type="text" inputmode="numeric" class="disc-percent" placeholder="Foiz (masalan 30)" style="width:150px;padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);">' +
            '<button type="button" class="qbtn" data-send-discount="1">Yuborish</button>' +
          '</div>';
        formEl.querySelector('[data-send-discount]').addEventListener('click', function(ev){
          ev.stopPropagation();
          var tier = formEl.querySelector('.disc-tier').value;
          var percent = parseInt(formEl.querySelector('.disc-percent').value, 10);
          if(!percent || percent < 1 || percent > 100){ alert("1 dan 100 gacha foiz kiriting."); return; }
          fetch('/api/admin/discounts/', {
            method: 'POST', credentials: 'same-origin',
            headers: csrfHeaders({'Content-Type': 'application/json'}),
            body: JSON.stringify({profile_id: pid, tier: tier, percent: percent})
          }).then(function(r){ return r.json().then(function(d){ return {status:r.status, data:d}; }); })
            .then(function(res){
              if(res.status === 200 && res.data.ok){
                toast(username + "ga " + percent + "% " + tier.toUpperCase() + " chegirma berildi.");
                formEl.classList.add('hidden'); formEl.innerHTML = '';
              } else {
                alert((res.data && res.data.error) || "Xato yuz berdi.");
              }
            }).catch(function(err){ console.error('discount xato:', err); alert("Xato yuz berdi."); });
        });
      });
    });
  }
  function deleteListing(id){
    fetch(API_BASE + id + '/', {method:'DELETE', credentials:'same-origin', headers: csrfHeaders()})
      .then(function(r){
        if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
        loadListings(function(){ renderAdmin(); });
        toast("E'lon o'chirildi.");
      })
      .catch(function(err){ console.error('deleteListing xato:', err); toast("O'chirishda xato yuz berdi."); });
  }
  function toggleListingSold(id, sold){
    fetch(API_BASE + id + '/mark-sold/', {
      method: 'POST', credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify({sold: sold})
    }).then(function(r){
      if(r.status === 401 || r.status === 403){ toast("Bu amal uchun admin sifatida kirishingiz kerak."); return; }
      loadListings(function(){ renderAdmin(); });
      toast(sold ? "E'lon sotilgan deb belgilandi." : "E'lon sotilmagan deb belgilandi.");
    }).catch(function(err){ console.error('toggleListingSold xato:', err); toast("Xato yuz berdi."); });
  }

