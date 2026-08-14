(function () {
  "use strict";

  const DEFAULT_CENTER = [19.0402, 47.4979];
  const THEME_KEY = "nav_theme";
  const VIEW_KEY = "nav_view_mode";
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  const OSRM_QUERY = "overview=full&geometries=geojson&alternatives=false&steps=true";
  const REROUTE_METERS = 45;
  const EMPTY_LINE = { type: "FeatureCollection", features: [] };

  const STYLES = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark"
  };

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

  const $ = (id) => document.getElementById(id);

  const state = {
    map: null,
    origin: null,
    heading: 0,
    speedMps: 0,
    destination: null,
    destinationLabel: "",
    travelMode: "driving",
    viewMode: "4d",
    follow: true,
    theme: "light",
    watchId: null,
    lastRouteOrigin: null,
    route: null,
    routeCoords: [],
    steps: [],
    traveledMeters: 0,
    puckMarker: null,
    destMarker: null,
    lastCameraAt: 0,
    previewing: false,
    previewRaf: 0,
    voice: false,
    lastSpokenStep: -1,
    overlaysReady: false
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

  function preferredView() {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === "2d" || saved === "3d" || saved === "4d") return saved;
    return "4d";
  }

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function toDeg(r) {
    return (r * 180) / Math.PI;
  }

  function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearingDeg(from, to) {
    const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
    const x =
      Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
      Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function formatDistance(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(1).replace(".", ",") + " km";
    return Math.round(meters) + " m";
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds / 60));
    if (total < 60) return total + " perc";
    return Math.floor(total / 60) + " ó " + (total % 60) + " p";
  }

  function formatClock(fromSeconds) {
    const when = new Date(Date.now() + fromSeconds * 1000);
    return String(when.getHours()).padStart(2, "0") + ":" + String(when.getMinutes()).padStart(2, "0");
  }

  function selectedTravelMode() {
    const checked = document.querySelector('input[name="travelMode"]:checked');
    return checked ? checked.value : "driving";
  }

  function selectedViewMode() {
    const checked = document.querySelector('input[name="viewMode"]:checked');
    return checked ? checked.value : "4d";
  }

  function lineLength(coords) {
    let d = 0;
    for (let i = 1; i < coords.length; i++) {
      d += haversineMeters(
        { lng: coords[i - 1][0], lat: coords[i - 1][1] },
        { lng: coords[i][0], lat: coords[i][1] }
      );
    }
    return d;
  }

  function alongLine(coords, distMeters) {
    if (!coords.length) return null;
    let remaining = Math.max(0, distMeters);
    for (let i = 1; i < coords.length; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversineMeters(a, b);
      if (remaining <= seg) {
        const t = seg === 0 ? 0 : remaining / seg;
        return {
          lng: a.lng + t * (b.lng - a.lng),
          lat: a.lat + t * (b.lat - a.lat),
          bearing: bearingDeg(a, b)
        };
      }
      remaining -= seg;
    }
    const last = coords[coords.length - 1];
    const prev = coords[Math.max(0, coords.length - 2)];
    return {
      lng: last[0],
      lat: last[1],
      bearing: bearingDeg({ lng: prev[0], lat: prev[1] }, { lng: last[0], lat: last[1] })
    };
  }

  function nearestOnLine(coords, point) {
    let best = { dist: Infinity, traveled: 0, lng: point.lng, lat: point.lat, bearing: state.heading };
    let traveled = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversineMeters(a, b) || 1;
      const abx = b.lng - a.lng;
      const aby = b.lat - a.lat;
      const apx = point.lng - a.lng;
      const apy = point.lat - a.lat;
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
      const proj = { lng: a.lng + t * abx, lat: a.lat + t * aby };
      const d = haversineMeters(point, proj);
      if (d < best.dist) {
        best = {
          dist: d,
          traveled: traveled + t * seg,
          lng: proj.lng,
          lat: proj.lat,
          bearing: bearingDeg(a, b)
        };
      }
      traveled += seg;
    }
    return best;
  }

  function splitRoute(coords, traveled) {
    const done = [];
    const rest = [];
    let acc = 0;
    let split = false;
    if (!coords.length) return { done, rest };
    done.push(coords[0]);
    for (let i = 1; i < coords.length; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversineMeters(a, b);
      if (!split && acc + seg >= traveled) {
        const t = seg === 0 ? 1 : (traveled - acc) / seg;
        const mid = [a.lng + t * (b.lng - a.lng), a.lat + t * (b.lat - a.lat)];
        done.push(mid);
        rest.push(mid, coords[i]);
        split = true;
      } else if (!split) {
        done.push(coords[i]);
      } else {
        rest.push(coords[i]);
      }
      acc += seg;
    }
    if (!split) rest.push(coords[coords.length - 1]);
    return { done, rest };
  }

  function maneuverCopy(step) {
    const type = String(step?.maneuver?.type || "");
    const mod = String(step?.maneuver?.modifier || "");
    const name = String(step?.name || "").trim();
    const map = {
      "turn|right": ["↱", "Fordulj jobbra"],
      "turn|left": ["↰", "Fordulj balra"],
      "turn|slight right": ["↱", "Tarts jobbra"],
      "turn|slight left": ["↰", "Tarts balra"],
      "turn|sharp right": ["↱", "Élesen jobbra"],
      "turn|sharp left": ["↰", "Élesen balra"],
      "turn|uturn": ["↩", "Fordulj vissza"],
      "turn|straight": ["↑", "Haladj tovább"],
      "new name|": ["↑", "Haladj tovább"],
      "continue|": ["↑", "Haladj tovább"],
      "depart|": ["↑", "Indulás"],
      "arrive|": ["●", "Megérkeztél"],
      "roundabout|": ["↻", "Hajts be a körforgalomba"],
      "rotary|": ["↻", "Hajts be a körforgalomba"],
      "exit roundabout|": ["↑", "Hajts ki a körforgalomból"],
      "merge|": ["↗", "Csatlakozz"],
      "on ramp|": ["↗", "Hajts fel a rámpára"],
      "off ramp|": ["↘", "Hajts le"],
      "fork|right": ["↱", "Jobb elágazás"],
      "fork|left": ["↰", "Bal elágazás"],
      "end of road|right": ["↱", "Az út végén jobbra"],
      "end of road|left": ["↰", "Az út végén balra"]
    };
    const hit = map[type + "|" + mod] || map[type + "|"] || ["↑", "Haladj tovább"];
    return { icon: hit[0], text: hit[1], street: name };
  }

  function currentStep() {
    if (!state.steps.length) return null;
    let acc = 0;
    for (let i = 0; i < state.steps.length; i++) {
      acc += Number(state.steps[i].distance || 0);
      if (acc > state.traveledMeters + 8) {
        return { step: state.steps[i], index: i, until: acc - state.traveledMeters };
      }
    }
    const last = state.steps[state.steps.length - 1];
    return { step: last, index: state.steps.length - 1, until: 0 };
  }

  function speak(text) {
    if (!state.voice || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hu-HU";
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  }

  function updateManeuverUi() {
    const banner = $("maneuverBanner");
    if (!state.route || !state.steps.length) {
      banner.hidden = true;
      return;
    }
    const cur = currentStep();
    if (!cur) {
      banner.hidden = true;
      return;
    }
    const copy = maneuverCopy(cur.step);
    banner.hidden = false;
    $("maneuverIcon").textContent = copy.icon;
    $("maneuverDistance").textContent = formatDistance(cur.until);
    $("maneuverInstruction").textContent = copy.text;
    $("maneuverStreet").textContent = copy.street;
    if (cur.index !== state.lastSpokenStep && cur.until < 180) {
      state.lastSpokenStep = cur.index;
      speak(copy.text + (copy.street ? " " + copy.street : ""));
    }
  }

  function remainingSeconds() {
    if (!state.route) return 0;
    const total = lineLength(state.routeCoords) || 1;
    const left = Math.max(0, 1 - state.traveledMeters / total);
    return state.route.duration * left;
  }

  function updateEtaUi() {
    if (!state.route) {
      $("etaBar").hidden = true;
      $("progressTrack").hidden = true;
      $("previewBtn").hidden = true;
      $("routeDestination").hidden = true;
      return;
    }
    const leftMeters = Math.max(0, (lineLength(state.routeCoords) || 0) - state.traveledMeters);
    const sec = remainingSeconds();
    $("etaBar").hidden = false;
    $("progressTrack").hidden = false;
    $("previewBtn").hidden = false;
    $("routeDestination").hidden = false;
    $("etaClock").textContent = formatClock(sec);
    $("routeDuration").textContent = formatDuration(sec);
    $("routeDistance").textContent = formatDistance(leftMeters);
    $("routeDestination").textContent = state.destinationLabel;
    const frac = Math.max(0, Math.min(1, state.traveledMeters / (lineLength(state.routeCoords) || 1)));
    $("progressFill").style.width = frac * 100 + "%";
  }

  function firstLabelLayerId() {
    const layers = state.map.getStyle().layers || [];
    const found = layers.find((l) => l.type === "symbol" && l.layout && l.layout["text-field"]);
    return found ? found.id : undefined;
  }

  function add3dWorld() {
    try {
      if (!state.map.getSource("terrain-dem")) {
        state.map.addSource("terrain-dem", {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 15
        });
      }
      if (state.viewMode === "2d") {
        state.map.setTerrain(null);
      } else {
        state.map.setTerrain({ source: "terrain-dem", exaggeration: state.viewMode === "4d" ? 1.45 : 1.15 });
      }
    } catch (_e) {}

    try {
      if (state.viewMode === "2d") {
        if (typeof state.map.setSky === "function") state.map.setSky(undefined);
      } else if (typeof state.map.setSky === "function") {
        state.map.setSky({
          "sky-color": state.theme === "dark" ? "#071018" : "#5ec8ff",
          "sky-horizon-blend": 0.6,
          "horizon-color": state.theme === "dark" ? "#1b2838" : "#ffffff",
          "horizon-fog-blend": 0.7,
          "fog-color": state.theme === "dark" ? "#0b1220" : "#dfe9f3",
          "fog-ground-blend": 0.45
        });
      }
    } catch (_e) {}

    if (!state.map.getLayer("3d-buildings")) {
      const src = state.map.getSource("openmaptiles") ? "openmaptiles" : null;
      if (src) {
        state.map.addLayer(
          {
            id: "3d-buildings",
            source: src,
            "source-layer": "building",
            type: "fill-extrusion",
            minzoom: 14,
            filter: ["!=", ["get", "hide_3d"], true],
            paint: {
              "fill-extrusion-color": state.theme === "dark" ? "#3d4d63" : "#d9dde3",
              "fill-extrusion-opacity": 0.82,
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                15.5,
                ["coalesce", ["get", "render_height"], ["get", "height"], 8]
              ],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0]
            }
          },
          firstLabelLayerId()
        );
      }
    }
    if (state.map.getLayer("3d-buildings")) {
      state.map.setLayoutProperty("3d-buildings", "visibility", state.viewMode === "2d" ? "none" : "visible");
    }
  }

  function addRouteLayers() {
    if (!state.map.getSource("route-rest")) {
      state.map.addSource("route-done", { type: "geojson", data: EMPTY_LINE });
      state.map.addSource("route-rest", { type: "geojson", data: EMPTY_LINE });
      state.map.addLayer({
        id: "route-rest-casing",
        type: "line",
        source: "route-rest",
        paint: { "line-color": "#fff", "line-width": 12, "line-opacity": 0.95 }
      });
      state.map.addLayer({
        id: "route-rest-line",
        type: "line",
        source: "route-rest",
        paint: { "line-color": "#1a73e8", "line-width": 7, "line-opacity": 1 }
      });
      state.map.addLayer({
        id: "route-done-line",
        type: "line",
        source: "route-done",
        paint: { "line-color": "#9aa0a6", "line-width": 6, "line-opacity": 0.85 }
      });
    }
  }

  function ensureOverlays() {
    add3dWorld();
    addRouteLayers();
    state.overlaysReady = true;
    if (state.routeCoords.length) drawRouteProgress();
  }

  function setGeoJson(sourceId, coords) {
    const src = state.map.getSource(sourceId);
    if (!src) return;
    src.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords.length > 1 ? coords : [] },
      properties: {}
    });
  }

  function drawRouteProgress() {
    if (!state.map || !state.overlaysReady || !state.routeCoords.length) return;
    const parts = splitRoute(state.routeCoords, state.traveledMeters);
    setGeoJson("route-done", parts.done);
    setGeoJson("route-rest", parts.rest);
  }

  function cameraForMode(center, bearing) {
    const mode = state.viewMode;
    if (mode === "2d") {
      return { center, zoom: 16.2, pitch: 0, bearing: 0, padding: { top: 80, bottom: 180, left: 0, right: 0 } };
    }
    if (mode === "3d") {
      return {
        center,
        zoom: 17.4,
        pitch: 58,
        bearing: state.follow ? bearing : state.map.getBearing(),
        padding: { top: 40, bottom: 220, left: 0, right: 0 }
      };
    }
    const look = alongLine(state.routeCoords.length ? state.routeCoords : [[center[0], center[1]]], state.traveledMeters + 55);
    return {
      center: look ? [look.lng, look.lat] : center,
      zoom: 18.05,
      pitch: 68,
      bearing: state.follow ? (look ? look.bearing : bearing) : state.map.getBearing(),
      padding: { top: 20, bottom: 260, left: 0, right: 0 }
    };
  }

  function updateCamera(force) {
    if (!state.map || !state.origin || !state.follow || state.previewing) return;
    const now = performance.now();
    if (!force && now - state.lastCameraAt < 280) return;
    state.lastCameraAt = now;
    const cam = cameraForMode([state.origin.lng, state.origin.lat], state.heading);
    state.map.easeTo({
      center: cam.center,
      zoom: cam.zoom,
      pitch: cam.pitch,
      bearing: cam.bearing,
      padding: cam.padding,
      duration: force ? 700 : 420,
      essential: true
    });
  }

  function applyViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem(VIEW_KEY, mode);
    const radio = document.querySelector('input[name="viewMode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    if (state.overlaysReady) add3dWorld();
    updateCamera(true);
  }

  function applyTheme(theme, reloadStyle) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    $("themeToggle").setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.theme === "dark" ? "#0b1220" : "#1a73e8");
    localStorage.setItem(THEME_KEY, state.theme);
    if (reloadStyle && state.map) {
      state.overlaysReady = false;
      state.map.setStyle(STYLES[state.theme]);
    }
  }

  function makePuck() {
    const el = document.createElement("div");
    el.className = "nav-puck";
    el.innerHTML = '<div class="nav-puck-cone"></div>';
    return el;
  }

  function makePin() {
    const el = document.createElement("div");
    el.className = "dest-pin";
    return el;
  }

  function setOrigin(lngLat, heading, speed) {
    state.origin = lngLat;
    if (Number.isFinite(heading)) state.heading = heading;
    if (Number.isFinite(speed) && speed >= 0) state.speedMps = speed;
    if (!state.puckMarker) {
      state.puckMarker = new maplibregl.Marker({ element: makePuck(), anchor: "center" })
        .setLngLat([lngLat.lng, lngLat.lat])
        .addTo(state.map);
    } else {
      state.puckMarker.setLngLat([lngLat.lng, lngLat.lat]);
    }
    const puckRot = state.viewMode === "2d" || !state.follow ? state.heading : 0;
    state.puckMarker.setRotation(puckRot);
    const kmh = Math.round((state.speedMps || 0) * 3.6);
    $("speedBadge").hidden = false;
    $("speedValue").textContent = String(kmh);
    if (state.routeCoords.length) {
      const snap = nearestOnLine(state.routeCoords, lngLat);
      state.traveledMeters = snap.traveled;
      if (snap.dist < 40 && Number.isFinite(snap.bearing)) state.heading = snap.bearing;
      drawRouteProgress();
      updateManeuverUi();
      updateEtaUi();
    }
    updateCamera(false);
  }

  function setDestination(lngLat, label) {
    state.destination = lngLat;
    state.destinationLabel = label || "";
    if (!state.destMarker) {
      state.destMarker = new maplibregl.Marker({ element: makePin(), anchor: "bottom" })
        .setLngLat([lngLat.lng, lngLat.lat])
        .addTo(state.map);
    } else {
      state.destMarker.setLngLat([lngLat.lng, lngLat.lat]);
    }
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

  async function planRoute() {
    if (!state.origin || !state.destination) return;
    try {
      setStatus("Útvonal tervezése…");
      const route = await fetchOsrmRoute(state.origin, state.destination, state.travelMode);
      state.route = route;
      state.routeCoords = route.geometry && route.geometry.coordinates ? route.geometry.coordinates : [];
      state.steps = [];
      (route.legs || []).forEach((leg) => {
        (leg.steps || []).forEach((step) => state.steps.push(step));
      });
      state.lastRouteOrigin = { lat: state.origin.lat, lng: state.origin.lng };
      state.traveledMeters = 0;
      state.lastSpokenStep = -1;
      if (state.overlaysReady) drawRouteProgress();
      updateManeuverUi();
      updateEtaUi();
      setFollow(true);
      updateCamera(true);
      setStatus("4D navigáció aktív");
      const first = currentStep();
      if (first) {
        const copy = maneuverCopy(first.step);
        speak(copy.text);
      }
    } catch (err) {
      setStatus(err.message || "Az útvonaltervezés sikertelen.", true);
    }
  }

  async function choosePlace(place) {
    const lngLat = { lat: Number(place.lat), lng: Number(place.lon) };
    setDestination(lngLat, place.display_name);
    $("sidebar").classList.remove("is-expanded");
    if (!state.origin) {
      setStatus("Várom a GPS-pozíciót az útvonalhoz…");
      state.map.easeTo({ center: [lngLat.lng, lngLat.lat], zoom: 16, pitch: 55, duration: 800 });
      return;
    }
    await planRoute();
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
    if (!state.origin || !state.destination || state.previewing) return;
    if (!state.lastRouteOrigin) {
      planRoute();
      return;
    }
    if (haversineMeters(state.lastRouteOrigin, state.origin) >= REROUTE_METERS) {
      planRoute();
    }
  }

  function onPosition(pos) {
    const lngLat = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const heading = Number.isFinite(pos.coords.heading) ? pos.coords.heading : state.heading;
    setOrigin(lngLat, heading, pos.coords.speed);
    maybeReroute();
    if (!$("statusText").classList.contains("is-error")) {
      setStatus(state.viewMode.toUpperCase() + " navigáció · élő GPS");
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
    const opts = { enableHighAccuracy: true, maximumAge: 800, timeout: 12000 };
    navigator.geolocation.getCurrentPosition(onPosition, (err) => setStatus(geoErrorMessage(err), true), opts);
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = navigator.geolocation.watchPosition(onPosition, (err) => setStatus(geoErrorMessage(err), true), opts);
  }

  function setFollow(on) {
    state.follow = !!on;
    $("followBtn").classList.toggle("is-active", state.follow);
    $("followBtn").setAttribute("aria-pressed", state.follow ? "true" : "false");
    if (state.follow) updateCamera(true);
  }

  function stopPreview() {
    state.previewing = false;
    if (state.previewRaf) cancelAnimationFrame(state.previewRaf);
    state.previewRaf = 0;
    $("previewBtn").textContent = "4D útvonal-előnézet";
  }

  function playPreview() {
    if (!state.routeCoords.length) return;
    if (state.previewing) {
      stopPreview();
      setFollow(true);
      return;
    }
    state.previewing = true;
    setFollow(false);
    $("previewBtn").textContent = "Előnézet leállítása";
    const total = lineLength(state.routeCoords) || 1;
    const durationMs = Math.max(14000, Math.min(28000, total / 2.2));
    const start = performance.now();
    function tick(now) {
      if (!state.previewing) return;
      const t = Math.min(1, (now - start) / durationMs);
      const here = alongLine(state.routeCoords, t * total);
      const ahead = alongLine(state.routeCoords, Math.min(total, t * total + 70));
      if (here && ahead) {
        state.map.jumpTo({
          center: [ahead.lng, ahead.lat],
          zoom: 17.8,
          pitch: 70,
          bearing: here.bearing
        });
        state.traveledMeters = t * total;
        drawRouteProgress();
        updateManeuverUi();
        updateEtaUi();
      }
      if (t < 1) {
        state.previewRaf = requestAnimationFrame(tick);
      } else {
        stopPreview();
        setFollow(true);
        setStatus("Előnézet kész · élő navigáció");
      }
    }
    state.previewRaf = requestAnimationFrame(tick);
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
    state.map = new maplibregl.Map({
      container: "map",
      style: STYLES[state.theme],
      center: DEFAULT_CENTER,
      zoom: 13.4,
      pitch: 62,
      bearing: -18,
      maxPitch: 80,
      attributionControl: true
    });
    state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    state.map.on("load", ensureOverlays);
    state.map.on("style.load", ensureOverlays);
    state.map.on("dragstart", () => {
      if (!state.previewing) setFollow(false);
    });
    state.map.on("pitchstart", () => {
      if (!state.previewing && state.follow === false) return;
    });
  }

  function bindUi() {
    $("searchForm").addEventListener("submit", searchAddress);
    $("themeToggle").addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark", true));
    $("followBtn").addEventListener("click", () => setFollow(!state.follow));
    $("previewBtn").addEventListener("click", playPreview);
    $("voiceBtn").addEventListener("click", () => {
      state.voice = !state.voice;
      $("voiceBtn").setAttribute("aria-pressed", state.voice ? "true" : "false");
      $("voiceBtn").textContent = state.voice ? "🔊" : "🔇";
      if (state.voice) speak("Hangutasítás bekapcsolva");
    });
    document.querySelectorAll('input[name="travelMode"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.travelMode = selectedTravelMode();
        if (state.origin && state.destination) planRoute();
      });
    });
    document.querySelectorAll('input[name="viewMode"]').forEach((input) => {
      input.addEventListener("change", () => applyViewMode(selectedViewMode()));
    });
  }

  state.theme = preferredTheme();
  state.viewMode = preferredView();
  applyTheme(state.theme, false);
  applyViewMode(state.viewMode);
  initMap();
  bindUi();
  setupSheet();
  startGpsTracking();
})();
