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
    }, function(err){
      console.error('Joylashuv xatosi:', err);
      // Drop the failed watch - otherwise geoWatchId stays set with no
      // position, and every later call hits the early return above
      // without ever running its callback (button silently dead).
      if(geoWatchId != null){ navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
      if(cb){ cb(); cb = null; }
    }, {enableHighAccuracy:true, maximumAge:5000, timeout:15000});
  }

  function geoErrorMessage(err){
    if(err && err.code === 1) return "Joylashuvga ruxsat berilmagan. Brauzer sozlamalarida ruxsat bering.";
    if(err && err.code === 3) return "Joylashuvni aniqlash juda uzoq davom etdi. Qayta urinib ko'ring.";
    return "Joylashuvingiz aniqlanmadi. GPS yoqilganini tekshiring.";
  }

  function distanceKm(lat1, lng1, lat2, lng2){
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng/2) * Math.sin(dLng/2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  var NEAR_RADIUS_KM = 3;
  var nearCircle = null;

  // "Menga yaqin": a one-shot position fix (with its own timeout, so the
  // button always answers), then the user's pin plus only the listings
  // within NEAR_RADIUS_KM that match the current filters - everything
  // farther away is taken off the map, and the radius is drawn as a
  // circle. refreshMapMarkers() (filter change / reopening the map)
  // brings all listings back.
  function showNearestListings(mapObj){
    if(!window.isSecureContext){ toast("Joylashuv faqat https:// manzilda ishlaydi."); return; }
    if(!navigator.geolocation){ toast("Brauzeringiz joylashuvni aniqlay olmaydi."); return; }
    toast("Joylashuvingiz aniqlanmoqda...");
    navigator.geolocation.getCurrentPosition(function(pos){
      if(mapObj !== fullMap) return;  // map was closed/rebuilt meanwhile
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      var here = L.latLng(userLat, userLng);

      // The map is locked to Jizzax; if the user is outside it, widen the
      // limits so their own pin can actually be shown.
      var bounds = L.latLngBounds(JIZZAX_BOUNDS);
      if(!bounds.contains(here)){
        mapObj.setMinZoom(5);
        mapObj.setMaxBounds(bounds.extend(here).pad(0.2));
      }
      updateUserMarkerOnMap(mapObj);
      startLiveLocation();  // keep the "Men" pin following the user

      var nearIds = listings.filter(function(l){
        return matchesFilters(l, filterState) && isFinite(l.lat) && isFinite(l.lng) &&
               distanceKm(userLat, userLng, l.lat, l.lng) <= NEAR_RADIUS_KM;
      }).map(function(l){ return l.id; });
      showOnlyMarkers(nearIds);

      if(nearCircle){ try{ mapObj.removeLayer(nearCircle); }catch(e){} }
      nearCircle = L.circle(here, {radius: NEAR_RADIUS_KM * 1000, color: '#33456B', weight: 2,
                                   fillColor: '#33456B', fillOpacity: 0.06, interactive: false}).addTo(mapObj);
      mapObj.invalidateSize();  // stale size -> fitBounds zooms all the way in
      var size = mapObj.getSize();
      if(size.x && size.y) mapObj.fitBounds(nearCircle.getBounds(), {padding: [20, 20], maxZoom: 15});
      else mapObj.setView(here, 13);
      toast(nearIds.length
        ? NEAR_RADIUS_KM + " km ichida " + nearIds.length + " ta e'lon"
        : NEAR_RADIUS_KM + " km ichida e'lon topilmadi.");
    }, function(err){
      console.error('Joylashuv xatosi:', err);
      toast(geoErrorMessage(err));
    }, {enableHighAccuracy:true, timeout:15000, maximumAge:30000});
  }

  function showOnlyMarkers(ids){
    if(!mapCluster) return;
    var keep = mapMarkers.filter(function(m){ return ids.indexOf(m.listingId) !== -1; });
    mapCluster.clearLayers();
    keep.forEach(function(m){
      // marked before it's (re)added, so the pin is drawn highlighted
      // whether it ends up on its own or inside a cluster
      m.setIcon(listingPinIcon(m.listing, true));
    });
    mapCluster.addLayers(keep);
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
      L.tileLayer(MAPTILER_TILE_URL, {attribution: MAPTILER_ATTRIBUTION, maxZoom: 20}).addTo(fullMap);
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
          showNearestListings(mapObj);
        });
        return div;
      }
    });
    mapObj.addControl(new YandexControl());
    mapObj.addControl(new NearMeControl());
  }
  var mapMarkers = [];
  var mapCluster = null;
  // Yellow price label with a small black pin under it, its tip on the
  // spot; zoomed out, nearby ones merge into a navy bubble with a count.
  var MAP_PIN_SVG = '<svg class="mpm-pin" viewBox="0 0 24 24"><path d="M12 2C7.6 2 4 5.5 4 9.9 4 15.6 12 22 12 22s8-6.4 8-12.1C20 5.5 16.4 2 12 2z"/><circle cx="12" cy="9.8" r="3.1" fill="#fff"/></svg>';
  function listingPinIcon(l, nearest){
    return L.divIcon({
      className: 'map-price-marker' + (nearest ? ' is-nearest' : ''),
      html: '<div class="leaflet-price-pin' + (nearest ? ' is-nearest' : '') + '">' + formatPrice(l) + '</div>' + MAP_PIN_SVG,
      iconSize: [0, 0]
    });
  }
  function makeMapCluster(){
    return L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: function(cluster){
        var n = cluster.getChildCount();
        var size = n < 10 ? 40 : (n < 100 ? 48 : 56);
        return L.divIcon({className: 'map-cluster', html: '<span>' + n + '</span>', iconSize: [size, size]});
      }
    });
  }
  // Re-draws just the listing pins against the CURRENT filterState,
  // without tearing down/recreating the whole map (keeps whatever
  // pan/zoom the user already has) - called on first open AND every
  // time a filter changes while the map is already showing, so
  // "faqat shu turdagi uylar" actually updates live.
  function refreshMapMarkers(){
    if(!fullMap) return;
    if(mapCluster){ try{ fullMap.removeLayer(mapCluster); }catch(e){} }
    mapCluster = makeMapCluster();
    mapMarkers = [];
    if(nearCircle){ try{ nearCircle.remove(); }catch(e){} nearCircle = null; }
    var visible = listings.filter(function(l){ return matchesFilters(l, filterState); });
    visible.forEach(function(l){
      var m = L.marker([l.lat, l.lng], {icon: listingPinIcon(l, false)});
      m.listingId = l.id;
      m.listing = l;
      var popupEl = document.createElement('div');
      popupEl.innerHTML = '<b>'+lt(l,'title')+'</b><br>'+trValue(l.district)+'<br><span class="map-popup-link" data-a="detail">Batafsil</span> · <span class="map-popup-link" data-a="route">Yo\'nalish</span>';
      popupEl.querySelector('[data-a="detail"]').addEventListener('click', function(){ openDetail(l.id, false); });
      popupEl.querySelector('[data-a="route"]').addEventListener('click', function(){ drawRouteToListing(l); });
      m.bindPopup(popupEl);
      mapMarkers.push(m);
    });
    mapCluster.addLayers(mapMarkers);
    fullMap.addLayer(mapCluster);
  }
  function stopLiveLocationIfUnused(){
    if(!fullMap && !currentMap && geoWatchId != null){
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
      userLat = null; userLng = null;
      routeTargetListing = null;
    }
  }

