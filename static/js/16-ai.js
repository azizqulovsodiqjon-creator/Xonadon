"use strict";

  /* =========================================================
     SUN'IY INTELLEKT (OpenAI) - listings/ai.py bilan ishlaydi
     1) narxni baholash (majburiy emas)  2) tavsifni yozish
     3) AI yordamchi (chat)  4) admin: AI tekshiruv
  ==========================================================*/
  var AI_API = '/api/ai/';
  var AI_ADMIN_API = '/api/admin/ai-reviews/';
  var aiOn = false;

  function aiLang(){ return (typeof currentLang === 'string' ? currentLang : 'UZ').toLowerCase(); }
  function aiPost(path, body){
    return fetch(AI_API + path, {
      method: 'POST', credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(d){ return {status: r.status, data: d}; }, function(){ return {status: r.status, data: {}}; }); });
  }
  function aiError(res, fallback){
    if(res.status === 401) return "Avval tizimga kiring.";
    if(res.status === 429) return (res.data && res.data.error) || "Bugungi AI limiti tugadi.";
    return (res.data && res.data.error) || fallback;
  }
  function aiNum(v){ return Number(v).toLocaleString('ru-RU').replace(/,/g, ' '); }
  function aiCur(c){ return c === 'uzs' ? "so'm" : 'у.е'; }

  /* ---------- 1. Narxni baholash ---------- */
  function aiPostFields(){
    var floorVal = document.getElementById('postFloor').value.trim();
    var floorsTotal = document.getElementById('postFloorsTotal').value.trim();
    return {
      deal: postDeal, type_key: postTypeKey, type: postCat || 'Kvartira',
      title: document.getElementById('postTitle').value.trim(),
      rooms: document.getElementById('postRooms').value.trim(),
      area: document.getElementById('postArea').value.trim(),
      floor: floorsTotal ? ((floorVal || '—') + '/' + floorsTotal) : floorVal,
      district: document.getElementById('postDistrict').value,
      repair: postRepair === "Ta'mirni tanlang" ? '' : postRepair,
      condition: postCondition, mortgage: postMortgage,
      price: document.getElementById('postPrice').value.trim(), currency: postCurrency,
      listing_id: typeof editingListingId !== 'undefined' ? editingListingId : null,
      lang: aiLang()
    };
  }
  function aiEstimatePrice(){
    var box = document.getElementById('aiPriceBox');
    var btn = document.getElementById('aiPriceBtn');
    var f = aiPostFields();
    if(!f.district){ toast("Avval tumanni tanlang."); return; }
    if(postDeal === 'sotuv' && postTypeKey !== 'yer' && !f.area){ toast("Avval maydonni kiriting."); return; }
    btn.disabled = true;
    box.classList.remove('hidden');
    box.innerHTML = '<div class="ai-muted">Saytdagi o\'xshash e\'lonlar tahlil qilinmoqda...</div>';
    aiPost('price-estimate/', f).then(function(res){
      btn.disabled = false;
      var d = res.data || {};
      if(res.status !== 200 || !d.ok){ box.innerHTML = '<div class="ai-muted">' + escapeHtml(aiError(res, "Baholab bo'lmadi.")) + '</div>'; return; }
      if(!d.enough){
        box.innerHTML = '<div class="ai-muted">Saytda o\'xshash e\'lonlar hali kam (' + (d.count || 0) + ' ta), shuning uchun aniq baholab bo\'lmaydi. Narxni o\'zingiz belgilang.</div>';
        return;
      }
      var conf = {high: 'yuqori', medium: "o'rtacha", low: 'past'}[d.confidence] || d.confidence;
      var where = {district: "shu tumandagi o'xshash", region_similar: "viloyat bo'yicha o'xshash", region_type: "viloyat bo'yicha shu turdagi"}[d.level] || '';
      box.innerHTML =
        '<div class="ai-price-head">Tavsiya etilgan narx</div>' +
        '<div class="ai-price-range">' + aiNum(d.low) + ' – ' + aiNum(d.high) + ' ' + aiCur(d.currency) + '</div>' +
        '<div class="ai-muted">O\'rtacha: <b>' + aiNum(d.mid) + ' ' + aiCur(d.currency) + '</b>' + (d.perM2 ? ' · 1 m² ≈ ' + aiNum(d.perM2) + ' ' + aiCur(d.currency) : '') + '</div>' +
        '<div class="ai-muted">' + d.count + ' ta ' + where + ' e\'lon asosida · ishonchlilik: ' + conf + '</div>' +
        (d.explanation ? '<div class="ai-expl">' + escapeHtml(d.explanation) + '</div>' : '') +
        '<div class="ai-price-actions"><button type="button" class="qbtn" id="aiUsePriceBtn">Shu narxni qo\'yish</button>' +
        '<span class="ai-muted">Majburiy emas - narxni o\'zingiz belgilaysiz.</span></div>';
      document.getElementById('aiUsePriceBtn').addEventListener('click', function(){
        document.getElementById('postPrice').value = String(d.mid);
        if(d.currency !== postCurrency){
          var b = document.querySelector('#currencyToggle button[data-currency="' + d.currency + '"]');
          if(b) b.click();
        }
        toast("Narx qo'yildi - xohlasangiz o'zgartirishingiz mumkin.");
      });
    }).catch(function(){ btn.disabled = false; box.innerHTML = '<div class="ai-muted">Baholab bo\'lmadi.</div>'; });
  }

  /* ---------- 2. Tavsifni yozish ---------- */
  function aiDescribe(){
    if(!aiOn){ toast("AI hozircha ulanmagan."); return; }
    var btn = document.getElementById('aiDescribeBtn');
    var area = document.getElementById('postDesc');
    var f = aiPostFields();
    f.notes = area.value.trim();
    if(!f.title && !f.rooms && !f.area){ toast("Avval sarlavha, xonalar yoki maydonni kiriting."); return; }
    btn.disabled = true;
    var label = btn.innerHTML;
    btn.textContent = 'Yozilmoqda...';
    aiPost('describe/', f).then(function(res){
      btn.disabled = false; btn.innerHTML = label;
      if(res.status !== 200 || !res.data.ok){ toast(aiError(res, "Matn yozib bo'lmadi.")); return; }
      if(area.value.trim() && !confirm("Hozirgi tavsif AI yozgan matn bilan almashtirilsinmi?")) return;
      area.value = res.data.text;
      toast("Tavsif yozildi - tekshirib, kerak bo'lsa tahrirlang.");
    }).catch(function(){ btn.disabled = false; btn.innerHTML = label; toast("Matn yozib bo'lmadi."); });
  }

  /* ---------- 3. AI yordamchi (chat) ---------- */
  var aiChatHistory = [];
  function aiBuildChat(){
    if(document.getElementById('aiChatFab')) return;
    var fab = document.createElement('button');
    fab.type = 'button'; fab.id = 'aiChatFab'; fab.className = 'ai-fab';
    fab.setAttribute('aria-label', 'AI yordamchi');
    fab.innerHTML = '✨ <span>AI yordamchi</span>';
    var panel = document.createElement('div');
    panel.id = 'aiChatPanel'; panel.className = 'ai-chat hidden';
    panel.innerHTML =
      '<div class="ai-chat-head"><b>✨ AI yordamchi</b><button type="button" class="ai-chat-x" aria-label="Yopish">✕</button></div>' +
      '<div class="ai-chat-body" id="aiChatBody">' +
        '<div class="ai-msg bot">Salom! Qanday uy qidiryapsiz? Oddiy so\'z bilan yozing.</div>' +
        '<div class="ai-chips">' +
          '<button type="button" class="ai-chip">Jizzax shahrida 3 xonali kvartira, 50 ming dollargacha</button>' +
          '<button type="button" class="ai-chip">Ijaraga hovli, oyiga 3 mln so\'mgacha</button>' +
          '<button type="button" class="ai-chip">Ipotekaga mumkin bo\'lgan yangi bino</button>' +
        '</div>' +
      '</div>' +
      '<form class="ai-chat-form" id="aiChatForm"><input type="text" id="aiChatInput" maxlength="500" placeholder="Masalan: 2 xonali, evroremont, Zomin" autocomplete="off"><button type="submit" class="qbtn">Yuborish</button></form>';
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    fab.addEventListener('click', function(){ panel.classList.toggle('hidden'); if(!panel.classList.contains('hidden')) document.getElementById('aiChatInput').focus(); });
    panel.querySelector('.ai-chat-x').addEventListener('click', function(){ panel.classList.add('hidden'); });
    panel.querySelectorAll('.ai-chip').forEach(function(c){ c.addEventListener('click', function(){ aiSend(c.textContent); }); });
    document.getElementById('aiChatForm').addEventListener('submit', function(e){
      e.preventDefault();
      var input = document.getElementById('aiChatInput');
      var text = input.value.trim();
      if(text){ input.value = ''; aiSend(text); }
    });
  }
  function aiAddMsg(cls, html){
    var body = document.getElementById('aiChatBody');
    var el = document.createElement('div');
    el.className = 'ai-msg ' + cls;
    el.innerHTML = html;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  function aiSend(text){
    aiAddMsg('me', escapeHtml(text));
    var wait = aiAddMsg('bot', '<span class="ai-typing"><i></i><i></i><i></i></span>');
    aiPost('assistant/', {message: text, lang: aiLang(), history: aiChatHistory.slice(-6)}).then(function(res){
      wait.remove();
      if(res.status !== 200 || !res.data.ok){ aiAddMsg('bot', escapeHtml(aiError(res, "Hozir javob bera olmadim."))); return; }
      aiChatHistory.push({role: 'user', text: text});
      aiChatHistory.push({role: 'assistant', text: res.data.reply});
      var cards = (res.data.listings || []).map(function(l){
        return '<button type="button" class="ai-card" data-id="' + l.id + '">' +
          (l.image ? '<img src="' + escapeHtml(l.image) + '" alt="">' : '<span class="ai-card-noimg">🏠</span>') +
          '<span class="ai-card-t"><b>' + escapeHtml(l.title) + '</b><small>' + escapeHtml(l.price) + ' ' + aiCur(l.currency) + ' · ' + escapeHtml(l.district || '') + '</small></span></button>';
      }).join('');
      var el = aiAddMsg('bot', escapeHtml(res.data.reply) + (cards ? '<div class="ai-cards">' + cards + '</div>' : ''));
      el.querySelectorAll('.ai-card').forEach(function(c){
        c.addEventListener('click', function(){
          var id = Number(this.getAttribute('data-id'));
          document.getElementById('aiChatPanel').classList.add('hidden');
          openDetail(id, false);
        });
      });
    }).catch(function(){ wait.remove(); aiAddMsg('bot', "Hozir javob bera olmadim."); });
  }

  /* ---------- 4. Admin: AI tekshiruv ---------- */
  function updateAdminAiCount(n){
    var el = document.getElementById('adminAiCount');
    if(!el) return;
    el.textContent = n;
    el.classList.toggle('hidden', !n);
  }
  function loadAdminAiCount(){
    fetch(AI_ADMIN_API, {credentials: 'same-origin'}).then(function(r){ return r.ok ? r.json() : []; })
      .then(function(list){ updateAdminAiCount(list.length); }).catch(function(){});
  }
  function renderAdminAiReviews(){
    var wrap = document.getElementById('adminContent');
    wrap.innerHTML = '<div class="empty-admin">Yuklanmoqda...</div>';
    fetch(AI_ADMIN_API, {credentials: 'same-origin'}).then(function(r){
      if(!r.ok) throw new Error('ai reviews HTTP ' + r.status);
      return r.json();
    }).then(function(list){
      updateAdminAiCount(list.length);
      if(!list.length){ wrap.innerHTML = '<div class="empty-admin">AI shubhali deb belgilagan e\'lon yo\'q.</div>'; return; }
      wrap.innerHTML = '<div class="ai-muted" style="margin-bottom:12px;">AI va qoidalar shubhali deb topgan e\'lonlar. Hech narsa avtomatik o\'chirilmaydi - qarorni siz qabul qilasiz.</div>' +
        list.map(function(l){
          return '<div class="pay-row">' +
            '<div class="queue-info pay-info">' +
              '<div class="pay-amount">' + escapeHtml(l.title) + '</div>' +
              '<div class="qseller">' + escapeHtml(displayName(l.seller || '—')) + ' · ' + escapeHtml(l.price) + ' ' + aiCur(l.currency) + ' · ' + escapeHtml(l.district || '') + '</div>' +
              '<div class="ai-reasons">' + l.reasons.map(function(x){ return '<span>' + escapeHtml(x) + '</span>'; }).join('') + '</div>' +
              (l.desc ? '<div class="qdesc">' + escapeHtml(l.desc) + '</div>' : '') +
            '</div>' +
            '<div class="pay-actions">' +
              '<button class="qbtn" data-ai-open="' + l.id + '">Ko\'rish</button>' +
              '<button class="qbtn approve" data-ai="' + l.id + '" data-decision="ok">Hammasi joyida</button>' +
              '<button class="qbtn del" data-ai="' + l.id + '" data-decision="delete">O\'chirish</button>' +
            '</div>' +
          '</div>';
        }).join('');
      wrap.querySelectorAll('[data-ai-open]').forEach(function(b){
        b.addEventListener('click', function(){ openDetail(Number(this.getAttribute('data-ai-open')), false); });
      });
      wrap.querySelectorAll('[data-ai]').forEach(function(b){
        b.addEventListener('click', function(){
          var id = this.getAttribute('data-ai');
          var decision = this.getAttribute('data-decision');
          if(decision === 'delete' && !confirm("E'lon butunlay o'chirilsinmi? Buni qaytarib bo'lmaydi.")) return;
          var row = this.closest('.pay-row');
          row.querySelectorAll('button').forEach(function(x){ x.disabled = true; });
          fetch(AI_ADMIN_API + id + '/decide/', {
            method: 'POST', credentials: 'same-origin',
            headers: csrfHeaders({'Content-Type': 'application/json'}),
            body: JSON.stringify({decision: decision})
          }).then(function(r){ return r.json(); }).then(function(d){
            if(!d.ok){ toast(d.error || "Xato yuz berdi."); row.querySelectorAll('button').forEach(function(x){ x.disabled = false; }); return; }
            toast(decision === 'ok' ? "Belgilandi: hammasi joyida." : "E'lon o'chirildi.");
            loadListings(function(){ renderAdmin(); });
          }).catch(function(){ toast("Xato yuz berdi."); row.querySelectorAll('button').forEach(function(x){ x.disabled = false; }); });
        });
      });
    }).catch(function(){ wrap.innerHTML = '<div class="empty-admin">Yuklashda xato yuz berdi.</div>'; });
  }

  /* ---------- ishga tushirish ---------- */
  function aiInit(){
    var priceBtn = document.getElementById('aiPriceBtn');
    if(priceBtn) priceBtn.addEventListener('click', aiEstimatePrice);
    var descBtn = document.getElementById('aiDescribeBtn');
    if(descBtn) descBtn.addEventListener('click', aiDescribe);
    fetch(AI_API + 'status/', {credentials: 'same-origin'}).then(function(r){ return r.json(); }).then(function(s){
      aiOn = !!s.configured;
      if(descBtn) descBtn.classList.toggle('hidden', !aiOn);
      if(aiOn && !PANEL_ROUTE) aiBuildChat();
    }).catch(function(){});
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aiInit); else aiInit();
