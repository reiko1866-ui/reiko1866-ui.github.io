(function () {
  "use strict";

  const BUDAPEST = [19.0402, 47.4979];
  const THEME_KEY = "nav2_theme";
  const PLACE_KEY = "nav2_places";
  const EMPTY = { type: "FeatureCollection", features: [] };
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  const VALHALLA = "https://valhalla1.openstreetmap.de/route";
  const OSRM = [
    "https://router.project-osrm.org/route/v1/driving",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving"
  ];
  const STYLES = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark"
  };

  const $ = (id) => document.getElementById(id);

  const state = {
    map: null,
    origin: null,
    dest: null,
    destLabel: "",
    heading: 0,
    speed: 0,
    follow: true,
    voice: true,
    navigating: false,
    planning: false,
    route: null,
    coords: [],
    steps: [],
    traveled: 0,
    lastSpoken: -1,
    arrived: false,
    lastCam: 0,
    lastOff: 0,
    offHits: 0,
    puck: null,
    pin: null,
    pendingPlan: false,
    places: { home: null, work: null }
  };

  function setStatus(msg, err) {
    const el = $("status");
    el.textContent = msg || "";
    el.classList.toggle("is-err", !!err);
  }

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function haversine(a, b) {
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function bearing(a, b) {
    const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
    const x =
      Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
      Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function fmtDist(m) {
    if (m >= 1000) return (Math.round(m / 100) / 10).toString().replace(".", ",") + " km";
    return Math.max(10, Math.round(m / 10) * 10) + " m";
  }

  function fmtDur(sec) {
    const m = Math.max(1, Math.round(sec / 60));
    if (m < 60) return m + " perc";
    return Math.floor(m / 60) + " ó " + (m % 60) + " p";
  }

  function fmtClock(sec) {
    const t = new Date(Date.now() + sec * 1000);
    return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  }

  function lineLen(coords) {
    let d = 0;
    for (let i = 1; i < coords.length; i++) {
      d += haversine(
        { lng: coords[i - 1][0], lat: coords[i - 1][1] },
        { lng: coords[i][0], lat: coords[i][1] }
      );
    }
    return d;
  }

  function nearest(coords, point) {
    let best = { dist: Infinity, traveled: 0, bearing: state.heading };
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversine(a, b) || 1;
      const abx = b.lng - a.lng;
      const aby = b.lat - a.lat;
      const t = Math.max(0, Math.min(1, ((point.lng - a.lng) * abx + (point.lat - a.lat) * aby) / (abx * abx + aby * aby || 1)));
      const proj = { lng: a.lng + t * abx, lat: a.lat + t * aby };
      const d = haversine(point, proj);
      if (d < best.dist) best = { dist: d, traveled: acc + t * seg, bearing: bearing(a, b) };
      acc += seg;
    }
    return best;
  }

  function splitLine(coords, traveled) {
    const rest = [];
    let acc = 0;
    if (!coords.length) return EMPTY;
    for (let i = 1; i < coords.length; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversine(a, b);
      if (acc + seg >= traveled && !rest.length) {
        const t = seg ? (traveled - acc) / seg : 1;
        rest.push([a.lng + t * (b.lng - a.lng), a.lat + t * (b.lat - a.lat)], coords[i]);
      } else if (rest.length) rest.push(coords[i]);
      acc += seg;
    }
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: rest.length > 1 ? rest : coords },
      properties: {}
    };
  }

  function maneuver(step) {
    const type = String(step?.maneuver?.type || "");
    const mod = String(step?.maneuver?.modifier || "");
    const map = {
      "turn|right": ["↱", "Fordulj jobbra"],
      "turn|left": ["↰", "Fordulj balra"],
      "turn|slight right": ["↱", "Tarts jobbra"],
      "turn|slight left": ["↰", "Tarts balra"],
      "turn|sharp right": ["↱", "Élesen jobbra"],
      "turn|sharp left": ["↰", "Élesen balra"],
      "turn|uturn": ["↩", "Fordulj vissza"],
      "depart|": ["↑", "Indulás"],
      "arrive|": ["●", "Megérkeztél"],
      "roundabout|": ["↻", "Körforgalom"],
      "rotary|": ["↻", "Körforgalom"],
      "exit roundabout|": ["↑", "Hajts ki"],
      "on ramp|": ["↗", "Hajts fel"],
      "off ramp|": ["↘", "Hajts le"],
      "merge|": ["↗", "Csatlakozz"],
      "fork|right": ["↱", "Jobb elágazás"],
      "fork|left": ["↰", "Bal elágazás"]
    };
    const hit = map[type + "|" + mod] || map[type + "|"] || ["↑", "Haladj tovább"];
    return { icon: hit[0], text: hit[1], street: String(step?.name || "").trim() };
  }

  function currentStep() {
    let acc = 0;
    for (let i = 0; i < state.steps.length; i++) {
      acc += Number(state.steps[i].distance || 0);
      if (acc > state.traveled + 8) {
        return { step: state.steps[i], index: i, until: acc - state.traveled };
      }
    }
    const last = state.steps[state.steps.length - 1];
    return last ? { step: last, index: state.steps.length - 1, until: 0 } : null;
  }

  function speak(text) {
    if (!state.voice || !text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hu-HU";
    u.rate = 0.98;
    const voices = window.speechSynthesis.getVoices();
    const hu = voices.find((v) => String(v.lang || "").toLowerCase().startsWith("hu"));
    if (hu) u.voice = hu;
    window.speechSynthesis.speak(u);
  }

  function sayTurn(copy, until) {
    if (/Megérkezt/i.test(copy.text)) return speak("Megérkeztél.");
    const dist = until >= 1000 ? Math.round(until / 100) / 10 + " kilométer" : Math.max(20, Math.round(until / 10) * 10) + " méter";
    const street = copy.street ? ", " + copy.street : "";
    speak(dist + ", " + copy.text.toLowerCase() + street + ".");
  }

  function makeEl(cls) {
    const el = document.createElement("div");
    el.className = cls;
    return el;
  }

  function setOrigin(lngLat, heading, speed) {
    state.origin = lngLat;
    if (Number.isFinite(heading)) state.heading = heading;
    if (Number.isFinite(speed) && speed >= 0) state.speed = speed;
    if (!state.puck) {
      state.puck = new maplibregl.Marker({ element: makeEl("puck"), anchor: "center" })
        .setLngLat([lngLat.lng, lngLat.lat])
        .addTo(state.map);
    } else state.puck.setLngLat([lngLat.lng, lngLat.lat]);
    const mapBearing = state.map.getBearing();
    state.puck.setRotation(state.heading - mapBearing);
    const kmh = Math.round((state.speed || 0) * 3.6);
    $("speed").hidden = false;
    $("kmh").textContent = String(kmh);
    if (state.coords.length) {
      const snap = nearest(state.coords, lngLat);
      state.traveled = snap.traveled;
      if (snap.dist < 40) state.heading = snap.bearing;
      drawRoute();
      updateNav();
    }
    updateCamera();
  }

  function setDest(lngLat, label) {
    state.dest = lngLat;
    state.destLabel = label || "";
    if (!state.pin) {
      state.pin = new maplibregl.Marker({ element: makeEl("pin"), anchor: "bottom" })
        .setLngLat([lngLat.lng, lngLat.lat])
        .addTo(state.map);
    } else state.pin.setLngLat([lngLat.lng, lngLat.lat]);
  }

  function addLayers() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    if (!state.map.getSource("route")) {
      state.map.addSource("route", { type: "geojson", data: EMPTY });
      state.map.addLayer({
        id: "route-case",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#fff", "line-width": 16 }
      });
      state.map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#00b4ff", "line-width": 10 }
      });
    }
    if (state.coords.length) drawRoute();
  }

  function drawRoute() {
    const src = state.map.getSource("route");
    if (!src) return;
    src.setData(splitLine(state.coords, state.traveled));
  }

  function updateCamera(force) {
    if (!state.map || !state.origin || !state.follow) return;
    const now = performance.now();
    if (!force && now - state.lastCam < 800) return;
    state.lastCam = now;
    const kmh = (state.speed || 0) * 3.6;
    const zoom = kmh > 90 ? 15.2 : kmh > 50 ? 16.1 : 17;
    state.map.easeTo({
      center: [state.origin.lng, state.origin.lat],
      zoom,
      pitch: 58,
      bearing: state.heading,
      padding: { top: state.navigating ? 80 : 20, bottom: state.navigating ? 120 : 40, left: 0, right: 0 },
      duration: force ? 700 : 450,
      essential: true
    });
  }

  function remaining() {
    if (!state.route) return { m: 0, s: 0 };
    const total = lineLen(state.coords) || 1;
    const left = Math.max(0, 1 - state.traveled / total);
    return { m: Math.max(0, total - state.traveled), s: state.route.duration * left };
  }

  function updateNav() {
    if (!state.navigating) return;
    const cur = currentStep();
    const r = remaining();
    $("eta").textContent = fmtClock(r.s);
    $("remain").textContent = fmtDur(r.s);
    $("dist").textContent = fmtDist(r.m);
    if (!cur) return;
    const copy = maneuver(cur.step);
    $("banner").hidden = false;
    $("turnIcon").textContent = copy.icon;
    $("turnDist").textContent = fmtDist(cur.until);
    $("turnText").textContent = copy.text;
    $("turnStreet").textContent = copy.street;
    if (cur.index !== state.lastSpoken && cur.until < 220) {
      state.lastSpoken = cur.index;
      sayTurn(copy, cur.until);
    }
    if (r.m < 30 && !state.arrived) {
      state.arrived = true;
      speak("Megérkeztél.");
      stopNav();
    }
  }

  async function fetchOsrm(from, to) {
    const path = from.lng + "," + from.lat + ";" + to.lng + "," + to.lat + "?overview=full&geometries=geojson&steps=true";
    let last = null;
    for (let i = 0; i < OSRM.length; i++) {
      try {
        const res = await fetch(OSRM[i] + "/" + path);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data.code !== "Ok" || !data.routes || !data.routes[0]) throw new Error("Nincs útvonal");
        return data.routes[0];
      } catch (err) {
        last = err;
      }
    }
    throw last || new Error("Az útvonaltervező nem elérhető.");
  }

  function valhallaToRoute(trip) {
    const legs = trip.legs || [];
    const coords = [];
    const steps = [];
    let duration = 0;
    let distance = 0;
    const typeMap = {
      1: ["depart", ""],
      8: ["continue", ""],
      9: ["turn", "slight right"],
      10: ["turn", "right"],
      11: ["turn", "sharp right"],
      12: ["turn", "uturn"],
      15: ["turn", "left"],
      16: ["turn", "slight left"],
      19: ["on ramp", ""],
      20: ["off ramp", "right"],
      21: ["off ramp", "left"],
      26: ["roundabout", ""],
      27: ["exit roundabout", ""],
      4: ["arrive", ""]
    };
    function decode(str) {
      const inv = 1e-6;
      let index = 0;
      let lat = 0;
      let lng = 0;
      const out = [];
      while (index < str.length) {
        let b;
        let shift = 0;
        let result = 0;
        do {
          b = str.charCodeAt(index++) - 63;
          result |= (b & 31) << shift;
          shift += 5;
        } while (b >= 32);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        shift = 0;
        result = 0;
        do {
          b = str.charCodeAt(index++) - 63;
          result |= (b & 31) << shift;
          shift += 5;
        } while (b >= 32);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        out.push([lng * inv, lat * inv]);
      }
      return out;
    }
    legs.forEach((leg) => {
      const shape = decode(leg.shape || "");
      shape.forEach((c, i) => {
        if (!coords.length || i) coords.push(c);
      });
      duration += Number(leg.summary && leg.summary.time) || 0;
      distance += Number(leg.summary && leg.summary.length) * 1000 || 0;
      (leg.maneuvers || []).forEach((m) => {
        const pair = typeMap[m.type] || ["continue", ""];
        steps.push({
          distance: (Number(m.length) || 0) * 1000,
          duration: Number(m.time) || 0,
          name: (m.street_names && m.street_names[0]) || "",
          maneuver: { type: pair[0], modifier: pair[1] }
        });
      });
    });
    return {
      duration,
      distance,
      geometry: { coordinates: coords },
      legs: [{ steps }]
    };
  }

  async function fetchValhalla(from, to) {
    const body = {
      locations: [
        { lon: from.lng, lat: from.lat },
        { lon: to.lng, lat: to.lat }
      ],
      costing: "auto",
      costing_options: {
        auto: {
          use_highways: $("avoidMotorway").checked ? 0 : 1,
          use_tolls: $("avoidToll").checked ? 0 : 1
        }
      }
    };
    const res = await fetch(VALHALLA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.trip) throw new Error("Nincs útvonal");
    return valhallaToRoute(data.trip);
  }

  async function plan(reroute) {
    if (!state.origin || !state.dest || state.planning) return;
    state.planning = true;
    setStatus(reroute ? "Újratervezés…" : "Útvonal…");
    try {
      const route =
        $("avoidMotorway").checked || $("avoidToll").checked
          ? await fetchValhalla(state.origin, state.dest)
          : await fetchOsrm(state.origin, state.dest);
      state.route = route;
      state.coords = (route.geometry && route.geometry.coordinates) || [];
      state.steps = [];
      (route.legs || []).forEach((leg) => (leg.steps || []).forEach((s) => state.steps.push(s)));
      if (reroute && state.coords.length) state.traveled = nearest(state.coords, state.origin).traveled;
      else state.traveled = 0;
      state.lastSpoken = -1;
      state.arrived = false;
      addLayers();
      drawRoute();
      if (reroute) {
        setStatus("Új útvonal.");
        speak("Új útvonal.");
      } else {
        startNav();
      }
    } catch (err) {
      setStatus(err.message || "Az útvonal nem jött össze.", true);
    } finally {
      state.planning = false;
    }
  }

  function startNav() {
    if (!state.route) return;
    state.pendingPlan = false;
    state.navigating = true;
    $("app").classList.add("is-nav");
    $("trip").hidden = false;
    $("banner").hidden = false;
    $("panel").hidden = true;
    state.follow = true;
    $("follow").classList.add("is-on");
    const cur = currentStep();
    if (cur) {
      const copy = maneuver(cur.step);
      sayTurn(copy, cur.until);
      state.lastSpoken = cur.index;
    }
    setStatus("Navigáció");
    updateNav();
    updateCamera(true);
    if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
  }

  function stopNav() {
    state.navigating = false;
    state.pendingPlan = false;
    $("app").classList.remove("is-nav");
    $("trip").hidden = true;
    $("banner").hidden = true;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setStatus("Megállítva");
  }

  function maybeReroute() {
    if (!state.navigating || !state.origin || !state.dest || state.planning) return;
    if (!state.coords.length) return plan(true);
    const snap = nearest(state.coords, state.origin);
    if (snap.dist < 70) {
      state.offHits = 0;
      return;
    }
    state.offHits += 1;
    if (state.offHits < 2) return;
    if (Date.now() - state.lastOff < 6000) return;
    state.lastOff = Date.now();
    state.offHits = 0;
    speak("Letértél. Újratervezek.");
    plan(true);
  }

  function onPos(pos) {
    setOrigin(
      { lat: pos.coords.latitude, lng: pos.coords.longitude },
      pos.coords.heading,
      pos.coords.speed
    );
    if (state.pendingPlan && state.dest && !state.route && !state.planning) {
      state.pendingPlan = false;
      plan(false);
    }
    maybeReroute();
    if (!$("status").classList.contains("is-err")) setStatus(state.navigating ? "Navigáció" : "GPS kész");
  }

  async function geocode(q) {
    try {
      const res = await fetch("https://photon.komoot.io/api/?lang=hu&limit=5&q=" + encodeURIComponent(q));
      const data = await res.json();
      const list = (data.features || []).map((f) => {
        const p = f.properties || {};
        return {
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          display_name: [p.name, p.street, p.city || p.county, p.country].filter(Boolean).join(", ")
        };
      });
      if (list.length) return list;
    } catch (_e) {}
    const url = NOMINATIM + "?format=jsonv2&limit=5&countrycodes=hu&q=" + encodeURIComponent(q);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("A keresés sikertelen.");
    const data = await res.json();
    if (!data.length) throw new Error("Nincs találat.");
    return data;
  }

  function showResults(list) {
    const box = $("results");
    box.innerHTML = "";
    list.forEach((p) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = p.display_name;
      btn.addEventListener("click", () => choose(p));
      li.appendChild(btn);
      box.appendChild(li);
    });
    box.hidden = !list.length;
  }

  async function choose(place) {
    $("results").hidden = true;
    setDest({ lat: Number(place.lat), lng: Number(place.lon) }, place.display_name);
    $("q").value = place.display_name.split(",")[0];
    if (!state.origin) {
      state.pendingPlan = true;
      setStatus("Várom a GPS-t, aztán indulok…");
      return;
    }
    await plan(false);
  }

  async function onSearch(e) {
    e.preventDefault();
    const q = String($("q").value || "").trim();
    if (!q) return setStatus("Írj be egy címet.", true);
    const m = q.match(/^(-?\d+(?:[.,]\d+))\s*[,;]\s*(-?\d+(?:[.,]\d+))$/);
    if (m) {
      const lat = Number(m[1].replace(",", "."));
      const lng = Number(m[2].replace(",", "."));
      return choose({ lat, lon: lng, display_name: lat + ", " + lng });
    }
    try {
      setStatus("Keresés…");
      const list = await geocode(q);
      showResults(list);
      await choose(list[0]);
    } catch (err) {
      setStatus(err.message || "A keresés sikertelen.", true);
    }
  }

  function loadPlaces() {
    try {
      state.places = Object.assign({ home: null, work: null }, JSON.parse(localStorage.getItem(PLACE_KEY) || "{}"));
    } catch (_e) {
      state.places = { home: null, work: null };
    }
  }

  function savePlace(kind) {
    const src = state.dest || state.origin;
    if (!src) return setStatus("Nincs hely a mentéshez.", true);
    state.places[kind] = { lat: src.lat, lng: src.lng, label: state.destLabel || kind };
    localStorage.setItem(PLACE_KEY, JSON.stringify(state.places));
    setStatus(kind === "home" ? "Otthon elmentve." : "Munka elmentve.");
  }

  function goPlace(kind) {
    const p = state.places[kind];
    if (!p) return setStatus("Előbb mentsd el ezt a helyet a menüben.", true);
    choose({ lat: p.lat, lon: p.lng, display_name: p.label || kind });
  }

  function applyTheme(dark) {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    if (state.map) {
      state.map.setStyle(dark ? STYLES.dark : STYLES.light);
      state.map.once("style.load", addLayers);
    }
  }

  function initMap() {
    const dark = localStorage.getItem(THEME_KEY) === "dark";
    document.documentElement.classList.toggle("dark", dark);
    $("dark").checked = dark;
    state.map = new maplibregl.Map({
      container: "map",
      style: dark ? STYLES.dark : STYLES.light,
      center: BUDAPEST,
      zoom: 13.5,
      pitch: 50,
      maxPitch: 75,
      attributionControl: true
    });
    state.map.on("load", addLayers);
    state.map.on("style.load", addLayers);
    state.map.on("dragstart", () => {
      state.follow = false;
      $("follow").classList.remove("is-on");
    });
    let t = 0;
    let start = null;
    function armLongPress(lngLat) {
      clearTimeout(t);
      start = lngLat;
      t = window.setTimeout(() => {
        choose({ lat: start.lat, lon: start.lng, display_name: "Térképpont" });
      }, 550);
    }
    state.map.on("mousedown", (e) => armLongPress(e.lngLat));
    state.map.on("touchstart", (e) => {
      if (e.points && e.points.length > 1) {
        clearTimeout(t);
        return;
      }
      armLongPress(e.lngLat);
    });
    ["mouseup", "mousemove", "dragstart", "touchend", "touchmove"].forEach((ev) =>
      state.map.on(ev, () => clearTimeout(t))
    );
  }

  function bind() {
    $("searchForm").addEventListener("submit", onSearch);
    $("stop").addEventListener("click", stopNav);
    $("follow").addEventListener("click", () => {
      state.follow = !state.follow;
      $("follow").classList.toggle("is-on", state.follow);
      if (state.follow) updateCamera(true);
    });
    $("voice").addEventListener("click", () => {
      state.voice = !state.voice;
      $("voice").classList.toggle("is-on", state.voice);
      $("voice").textContent = state.voice ? "🔊" : "🔇";
      if (state.voice) speak("Hang be.");
    });
    $("menu").addEventListener("click", () => {
      $("panel").hidden = !$("panel").hidden;
    });
    $("panelClose").addEventListener("click", () => {
      $("panel").hidden = true;
    });
    $("homeGo").addEventListener("click", () => goPlace("home"));
    $("workGo").addEventListener("click", () => goPlace("work"));
    $("homeSet").addEventListener("click", () => savePlace("home"));
    $("workSet").addEventListener("click", () => savePlace("work"));
    $("dark").addEventListener("change", () => applyTheme($("dark").checked));
    ["avoidMotorway", "avoidToll"].forEach((id) => {
      $(id).addEventListener("change", () => {
        if (state.origin && state.dest) plan(state.navigating);
      });
    });
  }

  loadPlaces();
  initMap();
  bind();
  if (!navigator.geolocation) setStatus("Nincs GPS ebben a böngészőben.", true);
  else {
    const opts = { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 };
    navigator.geolocation.getCurrentPosition(onPos, (e) => setStatus(e.message || "GPS hiba", true), opts);
    navigator.geolocation.watchPosition(onPos, () => {}, opts);
  }
  if (window.speechSynthesis) window.speechSynthesis.getVoices();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
