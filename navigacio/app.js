(function () {
  "use strict";

  const DEFAULT_CENTER = [47.4979, 19.0402];
  const THEME_KEY = "nav_theme";
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  const OSRM_QUERY = "overview=full&geometries=geojson&alternatives=false&steps=false";
  const REROUTE_METERS = 40;

  const OSRM_ENDPOINTS = {
    driving: [
      "https://router.project-osrm.org/route/v1/driving",
      "https://routing.openstreetmap.de/routed-car/route/v1/driving"
    ],
    biking: [
      "https://router.project-osrm.org/route/v1/biking",
      "https://router.project-osrm.org/route/v1/bike",
      "https://routing.openstreetmap.de/routed-bike/route/v1/cycling"
    ],
    foot: [
      "https://router.project-osrm.org/route/v1/foot",
      "https://routing.openstreetmap.de/routed-foot/route/v1/walking"
    ]
  };

  const LIGHT_TILES = {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  };
  const DARK_TILES = {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  };

  const $ = (id) => document.getElementById(id);

  const state = {
    map: null,
    tileLayer: null,
    positionMarker: null,
    destinationMarker: null,
    routeLayer: null,
    origin: null,
    destination: null,
    destinationLabel: "",
    travelMode: "driving",
    follow: true,
    watchId: null,
    lastRouteOrigin: null,
    theme: "light"
  };

  function setStatus(message, isError) {
    const el = $("statusText");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", !!isError);
  }

  function preferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    const toggle = $("themeToggle");
    if (toggle) toggle.setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.theme === "dark" ? "#111827" : "#f4f6f8");
    localStorage.setItem(THEME_KEY, state.theme);
    updateTiles();
  }

  function updateTiles() {
    if (!state.map) return;
    const spec = state.theme === "dark" ? DARK_TILES : LIGHT_TILES;
    if (state.tileLayer) state.map.removeLayer(state.tileLayer);
    state.tileLayer = L.tileLayer(spec.url, {
      attribution: spec.attribution,
      maxZoom: 19
    }).addTo(state.map);
  }

  function haversineMeters(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function formatDistance(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(1).replace(".", ",") + " km";
    return Math.round(meters) + " m";
  }

  function formatDuration(seconds) {
    const total = Math.round(seconds / 60);
    if (total < 60) return total + " perc";
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return hours + " ó " + mins + " perc";
  }

  function selectedTravelMode() {
    const checked = document.querySelector('input[name="travelMode"]:checked');
    return checked ? checked.value : "driving";
  }

  function gpsIcon() {
    return L.divIcon({
      className: "",
      html: '<div class="gps-dot"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function destIcon() {
    return L.divIcon({
      className: "",
      html: '<div class="dest-pin"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 18]
    });
  }

  function setOrigin(latlng, heading) {
    state.origin = latlng;
    if (!state.positionMarker) {
      state.positionMarker = L.marker(latlng, {
        icon: gpsIcon(),
        zIndexOffset: 600,
        keyboard: false
      }).addTo(state.map);
    } else {
      state.positionMarker.setLatLng(latlng);
    }
    if (typeof heading === "number" && !Number.isNaN(heading)) {
      const dot = state.positionMarker.getElement()?.querySelector(".gps-dot");
      if (dot) dot.style.transform = "rotate(" + heading + "deg)";
    }
    if (state.follow) {
      state.map.setView(latlng, Math.max(state.map.getZoom(), 16), { animate: true });
    }
  }

  function setDestination(latlng, label) {
    state.destination = latlng;
    state.destinationLabel = label || "";
    if (!state.destinationMarker) {
      state.destinationMarker = L.marker(latlng, {
        icon: destIcon(),
        zIndexOffset: 500
      }).addTo(state.map);
    } else {
      state.destinationMarker.setLatLng(latlng);
    }
    state.destinationMarker.bindPopup(state.destinationLabel || "Célállomás");
    $("routeDestination").textContent = state.destinationLabel || "Célállomás";
    $("routeCard").hidden = false;
  }

  function clearSearchResults() {
    const list = $("searchResults");
    list.innerHTML = "";
    list.hidden = true;
  }

  function showSearchResults(places) {
    const list = $("searchResults");
    list.innerHTML = "";
    if (!places.length) {
      list.hidden = true;
      return;
    }
    places.forEach((place) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = place.display_name;
      btn.addEventListener("click", () => {
        $("addressInput").value = place.display_name;
        clearSearchResults();
        choosePlace(place);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
    list.hidden = false;
  }

  async function geocodeAddress(query) {
    const params = new URLSearchParams({
      format: "jsonv2",
      q: query,
      limit: "5",
      addressdetails: "0"
    });
    if (state.origin) {
      const pad = 0.35;
      params.set(
        "viewbox",
        [state.origin.lng - pad, state.origin.lat + pad, state.origin.lng + pad, state.origin.lat - pad].join(",")
      );
    }
    const res = await fetch(NOMINATIM_URL + "?" + params.toString(), {
      headers: { Accept: "application/json", "Accept-Language": "hu" }
    });
    if (!res.ok) throw new Error("A címkereső most nem elérhető.");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("Nincs találat erre a címre.");
    return data;
  }

  async function fetchOsrmRoute(from, to, mode) {
    const coord = from.lng + "," + from.lat + ";" + to.lng + "," + to.lat;
    const urls = OSRM_ENDPOINTS[mode] || OSRM_ENDPOINTS.driving;
    let lastError = null;
    for (const base of urls) {
      try {
        const res = await fetch(base + "/" + coord + "?" + OSRM_QUERY);
        if (!res.ok) {
          lastError = new Error("OSRM HTTP " + res.status);
          continue;
        }
        const data = await res.json();
        if (data.code !== "Ok" || !data.routes || !data.routes[0]) {
          lastError = new Error(data.message || "Nincs útvonal.");
          continue;
        }
        return data.routes[0];
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Az útvonaltervező nem elérhető.");
  }

  function drawRoute(route) {
    if (state.routeLayer) {
      state.map.removeLayer(state.routeLayer);
      state.routeLayer = null;
    }
    state.routeLayer = L.geoJSON(route.geometry, {
      style: {
        color: state.theme === "dark" ? "#60a5fa" : "#2563eb",
        weight: 6,
        opacity: 0.9
      }
    }).addTo(state.map);
    $("routeDistance").textContent = formatDistance(route.distance);
    $("routeDuration").textContent = formatDuration(route.duration);
    $("routeCard").hidden = false;
  }

  async function planRoute(opts) {
    const fit = !!(opts && opts.fit);
    if (!state.origin || !state.destination) return;
    try {
      setStatus("Útvonal tervezése…");
      const route = await fetchOsrmRoute(state.origin, state.destination, state.travelMode);
      drawRoute(route);
      state.lastRouteOrigin = { lat: state.origin.lat, lng: state.origin.lng };
      if (fit && state.routeLayer) {
        const bounds = state.routeLayer.getBounds();
        if (state.positionMarker) bounds.extend(state.positionMarker.getLatLng());
        if (state.destinationMarker) bounds.extend(state.destinationMarker.getLatLng());
        state.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
        if (state.follow) {
          window.setTimeout(() => {
            if (state.follow && state.origin) {
              state.map.setView(state.origin, Math.max(state.map.getZoom(), 16), { animate: true });
            }
          }, 2200);
        }
      }
      setStatus("Útvonal kész · élő GPS követés");
    } catch (err) {
      setStatus(err.message || "Az útvonaltervezés sikertelen.", true);
    }
  }

  async function choosePlace(place) {
    const latlng = L.latLng(Number(place.lat), Number(place.lon));
    setDestination(latlng, place.display_name);
    if (!state.origin) {
      setStatus("Várom a GPS-pozíciót az útvonalhoz…");
      state.map.setView(latlng, 15);
      return;
    }
    await planRoute({ fit: true });
  }

  async function searchAddress(event) {
    if (event) event.preventDefault();
    const query = String($("addressInput").value || "").trim();
    if (!query) {
      setStatus("Írj be egy címet a kereséshez.", true);
      return;
    }
    const btn = $("searchBtn");
    btn.disabled = true;
    clearSearchResults();
    try {
      setStatus("Cím keresése…");
      const places = await geocodeAddress(query);
      showSearchResults(places);
      await choosePlace(places[0]);
      $("addressInput").value = places[0].display_name;
    } catch (err) {
      setStatus(err.message || "A keresés sikertelen.", true);
    } finally {
      window.setTimeout(() => {
        btn.disabled = false;
      }, 1100);
    }
  }

  function maybeReroute() {
    if (!state.origin || !state.destination) return;
    if (!state.lastRouteOrigin) {
      planRoute({ fit: false });
      return;
    }
    if (haversineMeters(state.lastRouteOrigin, state.origin) >= REROUTE_METERS) {
      planRoute({ fit: false });
    }
  }

  function onPosition(pos) {
    const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    setOrigin(latlng, pos.coords.heading);
    maybeReroute();
    if (!$("statusText").classList.contains("is-error")) {
      setStatus("Élő GPS követés aktív");
    }
  }

  function geoErrorMessage(err) {
    if (!err) return "A GPS nem elérhető.";
    if (err.code === 1) return "A GPS-engedélyt meg kell adni a böngészőben.";
    if (err.code === 2) return "A helyzet jelenleg nem meghatározható.";
    if (err.code === 3) return "A GPS-lekérdezés időtúllépés miatt sikertelen.";
    return err.message || "A GPS nem elérhető.";
  }

  function startGpsTracking() {
    if (!navigator.geolocation) {
      setStatus("Ez a böngésző nem támogatja a GPS-t.", true);
      return;
    }
    const opts = { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 };
    navigator.geolocation.getCurrentPosition(onPosition, (err) => setStatus(geoErrorMessage(err), true), opts);
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = navigator.geolocation.watchPosition(onPosition, (err) => setStatus(geoErrorMessage(err), true), opts);
  }

  function setFollow(on) {
    state.follow = !!on;
    $("followBtn").classList.toggle("is-active", state.follow);
    $("followBtn").setAttribute("aria-pressed", state.follow ? "true" : "false");
    if (state.follow && state.origin) {
      state.map.setView(state.origin, Math.max(state.map.getZoom(), 16), { animate: true });
    }
  }

  function setupSheet() {
    const sidebar = $("sidebar");
    const handle = $("sheetHandle");
    handle.addEventListener("click", () => {
      const open = !sidebar.classList.contains("is-expanded");
      sidebar.classList.toggle("is-expanded", open);
      handle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    let startY = 0;
    handle.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    handle.addEventListener("touchend", (e) => {
      const dy = e.changedTouches[0].clientY - startY;
      if (dy < -24) {
        sidebar.classList.add("is-expanded");
        handle.setAttribute("aria-expanded", "true");
      } else if (dy > 24) {
        sidebar.classList.remove("is-expanded");
        handle.setAttribute("aria-expanded", "false");
      }
    });
  }

  function initMap() {
    state.map = L.map("map", {
      zoomControl: true,
      attributionControl: true
    }).setView(DEFAULT_CENTER, 13);

    state.map.on("dragstart", () => setFollow(false));
    updateTiles();
  }

  function bindUi() {
    $("searchForm").addEventListener("submit", searchAddress);
    $("themeToggle").addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
      if (state.routeLayer && state.destination) planRoute({ fit: false });
    });
    $("followBtn").addEventListener("click", () => setFollow(!state.follow));
    document.querySelectorAll('input[name="travelMode"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.travelMode = selectedTravelMode();
        if (state.origin && state.destination) planRoute({ fit: true });
      });
    });
  }

  applyTheme(preferredTheme());
  initMap();
  bindUi();
  setupSheet();
  startGpsTracking();
})();
