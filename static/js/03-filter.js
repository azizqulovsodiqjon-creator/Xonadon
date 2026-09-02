"use strict";

  /* =========================================================
     FILTRLASH
  ==========================================================*/
  function matchesFilters(p, state){
    if(state.deal && p.deal !== state.deal) return false;
    if(state.type !== 'all' && p.typeKey !== state.type) return false;
    if(state.owner && !p.owner) return false;
    if(state.mortgage && !p.mortgage) return false;
    if(state.lastWeek && p.daysAgo > 7) return false;
    if(state.lastMonth && p.daysAgo > 30) return false;
    if(state.priceMin != null && priceNum(p.price) < state.priceMin) return false;
    if(state.priceMax != null && priceNum(p.price) > state.priceMax) return false;
    if(state.rooms != null && (!p.rooms || p.rooms < state.rooms)) return false;
    if(state.district && p.district !== state.district) return false;
    if(state.search){
      var q = state.search.toLowerCase();
      var hay = (p.title + ' ' + p.district + ' ' + p.desc).toLowerCase();
      if(hay.indexOf(q) === -1) return false;
    }
    return true;
  }

