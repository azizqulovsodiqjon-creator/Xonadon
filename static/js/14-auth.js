"use strict";

  /* =========================================================
     AUTH FLOW (telefon + kod, demo)
  ==========================================================*/
  function applyProfile(p){
    if(!p || !p.username){ console.error('applyProfile: invalid profile', p); return; }
    currentProfile = p;
    document.getElementById('profileFullName').innerHTML = escapeHtml(p.full_name || '') + (p.verified ? VERIFIED_TICK_HTML : '');
    document.getElementById('profileUsername').textContent = p.username;
    var idEl = document.getElementById('profileIdDisplay');
    if(idEl) idEl.textContent = 'ID: ' + (p.public_id || p.id);
    document.getElementById('profilePhoneDisplay').textContent = p.phone || '';
    document.getElementById('balancePhone').textContent = p.phone || '';
    var balEl = document.getElementById('balanceAmount');
    if(balEl) balEl.textContent = formatUsd(p.balance_cents || 0);
    var av = document.getElementById('myAvatar');
    av.textContent = (p.full_name || p.username || 'M').charAt(0).toUpperCase();
    updateNotifBadge();
    updatePaymentSummary();
    loadMyLikes();
  }
  function saveLoginToStorage(p){
    try{ localStorage.setItem('xonadonProfile', JSON.stringify(p)); }catch(e){}
  }
  function loadLoginFromStorage(){
    try{
      var raw = localStorage.getItem('xonadonProfile');
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  }
  function clearLoginStorage(){
    try{ localStorage.removeItem('xonadonProfile'); }catch(e){}
  }
  function requireAuth(action){
    if(isLoggedIn){ action(); return; }
    pendingAction = action;
    document.getElementById('authGate').classList.remove('hidden');
  }
  function closeAllAuth(){
    document.getElementById('authGate').classList.add('hidden');
    document.getElementById('authPhoneScreen').classList.add('hidden');
    document.getElementById('otpMethodModal').classList.add('hidden');
    document.getElementById('authCodeScreen').classList.add('hidden');
    document.getElementById('authProfileScreen').classList.add('hidden');
    stopTelegramPoll();
    resetOtpMethodModalUI();
  }
  function resetOtpMethodModalUI(){
    var introText = document.getElementById('otpIntroText');
    var waitingText = document.getElementById('otpWaitingText');
    var tgBtn = document.getElementById('otpTelegramBtn');
    if(introText) introText.classList.remove('hidden');
    if(waitingText) waitingText.classList.add('hidden');
    if(tgBtn){ tgBtn.classList.remove('hidden'); tgBtn.disabled = false; }
  }

