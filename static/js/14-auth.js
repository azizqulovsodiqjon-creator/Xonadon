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
    updateProfileCodeRow();
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
    try{ localStorage.removeItem('xonadonProfile'); localStorage.removeItem('xonadonLoginCode'); }catch(e){}
  }
  // The account code is only stored hashed on the server, so it can't be
  // read back from there - this device keeps the copy shown in the profile.
  function formatLoginCode(raw){
    var c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c;
  }
  function saveLoginCode(code){
    try{ localStorage.setItem('xonadonLoginCode', formatLoginCode(code)); }catch(e){}
  }
  function loadLoginCode(){
    try{ return localStorage.getItem('xonadonLoginCode') || ''; }catch(e){ return ''; }
  }
  function updateProfileCodeRow(){
    var row = document.getElementById('profileCodeRow');
    if(!row) return;
    var code = loadLoginCode();
    row.style.display = code ? 'flex' : 'none';
    document.getElementById('profileCodeValue').textContent = code;
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

