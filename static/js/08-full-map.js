"use strict";

  /* =========================================================
     TO'LIQ XARITA KO'RINISHI
  ==========================================================*/
  var fullMap = null, fullMapToken = 0;
  var userLat = null, userLng = null, userMarker = null, routeLine = null;
  var geoWatchId = null, routeTargetListing = null;

  function fetchRoute(fromLat, fromLng, toLat, toLng, onSuccess, onError){
    var url = 'https://router.project-osrm.org/route/v1/driving/' + fromLng + ',' + fromLat + ';' + toLng + ',' + toLat + '?overview=full&geometries=geojson';
    fetch(url).then(function(r){ return r.json(); }).then(function(data){
      if(data && data.routes && data.routes.length){
        var route = data.routes[0];
        var coords = route.geometry.coordinates.map(function(c){ return [c[1], c[0]]; });
        var km = (route.distance / 1000).toFixed(1);
        onSuccess(coords, km);
      } else {
        onError();
      }
    }).catch(function(err){ console.error('Marshrut xatosi:', err); onError(); });
  }

  function updateUserMarkerOnMap(mapObj){
    if(!mapObj || userLat == null) return;
    if(userMarker){ try{ mapObj.removeLayer(userMarker); }catch(e){} }
    var icon = L.divIcon({className:'', html:'<div class="user-location-pin">Men</div>', iconSize:[38,38], iconAnchor:[19,19]});
    userMarker = L.marker([userLat, userLng], {icon:icon, zIndexOffset:1000}).addTo(mapObj).bindPopup('Siz shu yerdasiz');
  }

  function startLiveLocation(cb){
    if(!navigator.geolocation){ if(cb) cb(); return; }
    if(geoWatchId != null){ if(userLat != null && cb) cb(); return; }
    geoWatchId = navigator.geolocation.watchPosition(function(pos){
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      if(fullMap){ updateUserMarkerOnMap(fullMap); }
      if(currentMap){ updateUserMarkerOnMap(currentMap); }
      if(routeTargetListing && (fullMap || currentMap)){
        var activeMap = fullMap || currentMap;
        fetchRoute(userLat, userLng, routeTargetListing.lat, routeTargetListing.lng, function(coords, km){
          if(fullMap){
            if(routeLine){ fullMap.removeLayer(routeLine); }
            routeLine = L.polyline(coords, {color:'#fdf90e', weight:6, opacity:0.9}).addTo(fullMap);
            toast("Masofa: " + km + " km");
          }
          if(currentMap){
            if(detailRouteLine){ currentMap.removeLayer(detailRouteLine); }
            detailRouteLine = L.polyline(coords, {color:'#fdf90e', weight:6, opacity:0.9}).addTo(currentMap);
            var btn = document.getElementById('detailRouteBtn');
            if(btn) btn.textContent = "Masofa: " + km + " km";
          }
        }, function(){});
      }
      if(cb){ cb(); cb = null; }
    }, function(err){ console.error('Joylashuv xatosi:', err); if(cb){ cb(); cb = null; } }, {enableHighAccuracy:true, maximumAge:5000});
  }

  function requestUserLocation(cb){ startLiveLocation(cb); }

  function drawRouteToListing(l){
    routeTargetListing = l;
    toast("Joylashuvingiz aniqlanmoqda...");
    startLiveLocation(function(){
      if(userLat == null){ toast("Joylashuvingiz aniqlanmadi. Brauzer ruxsatini tekshiring."); return; }
      fetchRoute(userLat, userLng, l.lat, l.lng, function(coords, km){
        if(routeLine){ fullMap.removeLayer(routeLine); routeLine = null; }
        routeLine = L.polyline(coords, {color:'#fdf90e', weight:6, opacity:0.9}).addTo(fullMap);
        toast("Masofa: " + km + " km");
        fullMap.fitBounds(routeLine.getBounds(), {padding:[50,50]});
      }, function(){
        toast("Yo'nalishni topib bo'lmadi.");
      });
    });
  }

  function doMapSearch(){
    var q = document.getElementById('mapSearchInput').value.trim();
    if(!q || !fullMap) return;
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q + ', Jizzax, Uzbekiston'))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if(data && data.length){
          fullMap.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 15);
        } else {
          toast("Joy topilmadi.");
        }
      }).catch(function(err){ console.error('Qidiruv xatosi:', err); toast("Qidirishda xato yuz berdi."); });
  }

  function openMapFull(){
    showPage('pageMapFull');
    fullMapToken++;
    var myToken = fullMapToken;
    routeTargetListing = null;
    setTimeout(function(){
      if(myToken !== fullMapToken) return;
      if(fullMap){ try{ fullMap.remove(); }catch(e){} fullMap=null; }
      var el = document.getElementById('mapFull');
      if(!el || typeof L === 'undefined') return;
      // Same geo zoom level looks fine on a wide desktop screen but packs
      // nearby listings' price labels into far fewer horizontal pixels on
      // a phone, so they visually pile on top of each other - starting
      // one zoom level closer on narrow screens spreads them out.
      var isMobileMap = window.innerWidth <= 820;
      fullMap = L.map(el, {minZoom:9, maxBounds:JIZZAX_BOUNDS, maxBoundsViscosity:1.0}).setView(JIZZAX_CENTER, isMobileMap ? 12 : 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:'© OpenStreetMap', maxZoom:18}).addTo(fullMap);
      var visible = listings.filter(function(l){ return matchesFilters(l, filterState); });
      visible.forEach(function(l){
        var icon = L.divIcon({className:'', html:'<div class="leaflet-price-pin">'+formatPrice(l)+'</div>', iconSize:[0,0]});
        var m = L.marker([l.lat, l.lng], {icon:icon}).addTo(fullMap);
        var popupEl = document.createElement('div');
        popupEl.innerHTML = '<b>'+l.title+'</b><br>'+trValue(l.district)+'<br><span class="map-popup-link" data-a="detail">Batafsil</span> · <span class="map-popup-link" data-a="route">Yo\'nalish</span>';
        popupEl.querySelector('[data-a="detail"]').addEventListener('click', function(){ openDetail(l.id, false); });
        popupEl.querySelector('[data-a="route"]').addEventListener('click', function(){ drawRouteToListing(l); });
        m.bindPopup(popupEl);
      });
      startLiveLocation(function(){ updateUserMarkerOnMap(fullMap); });
      setTimeout(function(){ if(fullMap) fullMap.invalidateSize(); }, 100);
    }, 60);
  }

  function stopLiveLocationIfUnused(){
    if(!fullMap && !currentMap && geoWatchId != null){
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
      userLat = null; userLng = null;
      routeTargetListing = null;
    }
  }

