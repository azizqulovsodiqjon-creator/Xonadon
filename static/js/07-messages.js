"use strict";

  /* =========================================================
     XABARLAR (ichki xabarlashish)
  ==========================================================*/
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function formatMsgTime(iso){
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('uz-UZ', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
  }
  function renderThreadMessages(list){
    var me = myUsername();
    var wrap = document.getElementById('threadMessages');
    if(!list.length){ wrap.innerHTML = '<div class="empty-note">Hozircha xabar yo\'q. Birinchi bo\'lib yozing!</div>'; return; }
    wrap.innerHTML = list.map(function(m){
      var mine = m.sender === me;
      return '<div class="msg-bubble ' + (mine?'mine':'theirs') + '">' + escapeHtml(m.text) +
        '<span class="msg-time">' + formatMsgTime(m.created_at) + '</span></div>';
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }
  function openMessageThread(otherUsername){
    currentThreadWith = otherUsername;
    document.getElementById('threadWithName').innerHTML = escapeHtml(displayName(otherUsername)) + (isSellerVerified(otherUsername) ? VERIFIED_TICK_HTML : '');
    document.getElementById('threadInput').value = '';
    document.getElementById('threadMessages').innerHTML = '<div class="empty-note">Yuklanmoqda...</div>';
    var panels = document.querySelectorAll('.side-panel.open');
    panels.forEach(function(p){ p.classList.remove('open'); });
    document.getElementById('messageThreadPanel').classList.add('open');
    document.getElementById('backdrop').classList.add('open');
    fetch(MESSAGE_THREAD_API + '?me=' + encodeURIComponent(myUsername()) + '&with=' + encodeURIComponent(otherUsername))
      .then(function(r){ return r.json(); })
      .then(function(list){ renderThreadMessages(list); updateNotifBadge(); })
      .catch(function(err){ console.error('message thread xato:', err); toast('Xabarlarni yuklashda xato yuz berdi.'); });
  }
  function sendThreadMessage(){
    var input = document.getElementById('threadInput');
    var text = input.value.trim();
    if(!text || !currentThreadWith) return;
    fetch(SEND_MESSAGE_API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders({'Content-Type': 'application/json'}),
      body: JSON.stringify({sender: myUsername(), receiver: currentThreadWith, text: text})
    }).then(function(r){ return r.json(); }).then(function(){
      input.value = '';
      openMessageThread(currentThreadWith);
    }).catch(function(err){ console.error('send message xato:', err); toast("Xabar yuborishda xato yuz berdi."); });
  }
  function renderConversationsList(targetId){
    var wrap = document.getElementById(targetId || 'xabarlarList');
    if(!wrap) return;
    fetch(MESSAGE_CONVERSATIONS_API + '?me=' + encodeURIComponent(myUsername()))
      .then(function(r){ return r.json(); })
      .then(function(list){
        if(!list.length){ wrap.innerHTML = '<div class="empty-state"><div class="emoji-box">💬</div><p>Hozircha xabarlar yo\'q</p></div>'; return; }
        wrap.innerHTML = list.map(function(c){
          return '<div class="conv-row" data-with="' + c.username + '">' +
            '<div class="ps-avatar"></div>' +
            '<div style="flex:1;"><div class="conv-name-row"><span class="ps-name">' + displayName(c.username) + (isSellerVerified(c.username) ? VERIFIED_TICK_HTML : '') + '</span>' +
              (c.unread ? '<span class="conv-unread">' + c.unread + '</span>' : '') + '</div>' +
            '<div class="conv-preview">' + escapeHtml(c.lastText || '') + '</div></div></div>';
        }).join('');
        wrap.querySelectorAll('[data-with]').forEach(function(row){
          // openMessageThread already closes every open side-panel itself.
          row.addEventListener('click', function(){ openMessageThread(this.getAttribute('data-with')); });
        });
      }).catch(function(err){ console.error('conversations xato:', err); });
  }
  function updateNotifBadge(){
    var badge = document.getElementById('notifBadge');
    if(!badge || !isLoggedIn) return;
    fetch(MESSAGE_CONVERSATIONS_API + '?me=' + encodeURIComponent(myUsername()))
      .then(function(r){ return r.json(); })
      .then(function(list){
        var total = list.reduce(function(sum, c){ return sum + (c.unread || 0); }, 0);
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.classList.toggle('hidden', total === 0);
      }).catch(function(err){ console.error('notif badge xato:', err); });
  }

