"use strict";

  /* =========================================================
     TO'LIQ XARITA KO'RINISHI
  ==========================================================*/
  var fullMap = null, fullMapToken = 0;
  var userLat = null, userLng = null, userMarker = null, routeLine = null;
  var geoWatchId = null, routeTargetListing = null;

  // #mapFull's CSS height is dvh-based (tracks the real, live viewport),
  // so it visibly changes as a mobile browser's address bar auto-hides
  // on scroll/settle - but Leaflet only measures its container once at
  // init. Without re-measuring on every such change, the map keeps
  // rendering tiles for its STALE (usually shorter) original size,
  // leaving a grey unrendered gap where the container grew into. Both
  // listeners are harmless no-ops whenever the map isn't open.
  function invalidateFullMapSize(){ if(fullMap) fullMap.invalidateSize(); }
  window.addEventListener('resize', invalidateFullMapSize);
  if(window.visualViewport) window.visualViewport.addEventListener('resize', invalidateFullMapSize);

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
    updateUrl('/xarita');
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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:'© OpenStreetMap',subdomains:'abc', maxZoom:18}).addTo(fullMap);
      addMapCornerControls(fullMap);
      refreshMapMarkers();
      startLiveLocation(function(){ updateUserMarkerOnMap(fullMap); });
      setTimeout(function(){ if(fullMap) fullMap.invalidateSize(); }, 100);
    }, 60);
  }
  // "Yandex xaritada ochish" / "Menga yaqin" as real Leaflet controls
  // (map corners), NOT page-level position:fixed buttons. Reported
  // problem: on at least one real machine the two fixed buttons were
  // present and clickable (hover tooltip, click both worked) but
  // rendered fully invisible - no background/icon at all - while
  // everything else on the page, INCLUDING Leaflet's own +/- zoom
  // buttons (same leaflet-bar family used here), rendered fine. That
  // strongly suggests something external (most likely a browser
  // extension) was specifically targeting the old .yandex-map-fab /
  // .near-me-fab classes/pattern - couldn't be reproduced or confirmed
  // locally, so instead of patching CSS blindly again, these are
  // rebuilt as genuine map controls using Leaflet's own well-tested,
  // already-proven-visible-for-this-user leaflet-bar styling.
  function addMapCornerControls(mapObj){
    var YandexControl = L.Control.extend({
      options: {position: 'bottomleft'},
      onAdd: function(){
        var div = L.DomUtil.create('div', 'leaflet-bar map-corner-btn');
        div.title = 'Yandex xaritada ochish';
        div.innerHTML = '<a href="#" role="button" aria-label="Yandex xaritada ochish"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg></a>';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(div.querySelector('a'), 'click', function(e){
          L.DomEvent.preventDefault(e);
          // Center Yandex on the user's REAL current location (with a
          // pin marking it) when it's known, not just wherever the
          // map happened to be panned to.
          startLiveLocation(function(){
            var zoom = mapObj.getZoom();
            var lat, lng;
            if(userLat != null){ lat = userLat; lng = userLng; }
            else { var c = mapObj.getCenter(); lat = c.lat; lng = c.lng; }
            // Yandex Maps takes coordinates as "longitude,latitude" (reversed from Leaflet's lat/lng).
            var url = 'https://yandex.com/maps/?ll=' + lng + ',' + lat + '&z=' + zoom;
            if(userLat != null) url += '&pt=' + lng + ',' + lat + ',pm2gnm';
            window.open(url, '_blank', 'noopener');
          });
        });
        return div;
      }
    });
    var NearMeControl = L.Control.extend({
      options: {position: 'bottomright'},
      onAdd: function(){
        var div = L.DomUtil.create('div', 'leaflet-bar map-corner-btn');
        div.title = 'Menga yaqin';
        div.innerHTML = '<a href="#" role="button" aria-label="Menga yaqin"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></a>';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(div.querySelector('a'), 'click', function(e){
          L.DomEvent.preventDefault(e);
          startLiveLocation(function(){
            if(userLat == null){ toast("Joylashuvingiz aniqlanmadi. Brauzer ruxsatini tekshiring."); return; }
            mapObj.setView([userLat, userLng], 15);
          });
        });
        return div;
      }
    });
    mapObj.addControl(new YandexControl());
    mapObj.addControl(new NearMeControl());
  }
  var mapMarkers = [];
  // Re-draws just the listing pins against the CURRENT filterState,
  // without tearing down/recreating the whole map (keeps whatever
  // pan/zoom the user already has) - called on first open AND every
  // time a filter changes while the map is already showing, so
  // "faqat shu turdagi uylar" actually updates live.
  function refreshMapMarkers(){
    if(!fullMap) return;
    mapMarkers.forEach(function(m){ try{ fullMap.removeLayer(m); }catch(e){} });
    mapMarkers = [];
    var visible = listings.filter(function(l){ return matchesFilters(l, filterState); });
    visible.forEach(function(l){
      var icon = L.divIcon({className:'', html:'<div class="leaflet-price-pin">'+formatPrice(l)+'</div>', iconSize:[0,0]});
      var m = L.marker([l.lat, l.lng], {icon:icon}).addTo(fullMap);
      var popupEl = document.createElement('div');
      popupEl.innerHTML = '<b>'+l.title+'</b><br>'+trValue(l.district)+'<br><span class="map-popup-link" data-a="detail">Batafsil</span> · <span class="map-popup-link" data-a="route">Yo\'nalish</span>';
      popupEl.querySelector('[data-a="detail"]').addEventListener('click', function(){ openDetail(l.id, false); });
      popupEl.querySelector('[data-a="route"]').addEventListener('click', function(){ drawRouteToListing(l); });
      m.bindPopup(popupEl);
      mapMarkers.push(m);
    });
  }
  function stopLiveLocationIfUnused(){
    if(!fullMap && !currentMap && geoWatchId != null){
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
      userLat = null; userLng = null;
      routeTargetListing = null;
    }
  }

