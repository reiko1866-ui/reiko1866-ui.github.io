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
    dark: {
      version: 8,
      name: "Carto Dark Matter",
      sources: {
        carto: {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
          ],
          tileSize: 256,
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
        }
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0F172A" } },
        { id: "carto", type: "raster", source: "carto" }
      ]
    }
  };

  const $ = (id) => document.getElementById(id);

  function openDrawer() {
    $("mobileDrawer").classList.add("open");
    $("drawerOverlay").classList.add("open");
    $("hamburgerBtn").setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    $("mobileDrawer").classList.remove("open");
    $("drawerOverlay").classList.remove("open");
    $("hamburgerBtn").setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  function spyNav() {
    const allNavLinks = document.querySelectorAll(".nav-link, .mobile-link");
    const pageIds = ["kezdolap", "funkciok", "Ajanlatok", "kapcsolat"];
    let current = pageIds[0];
    pageIds.forEach((id) => {
      const section = $(id);
      if (!section || section.hidden) return;
      if (window.scrollY >= section.offsetTop - 100) current = id;
    });
    if (state.navigating) current = "kezdolap";
    allNavLinks.forEach((link) => {
      link.classList.remove("active");
      if (link.getAttribute("href") === "#" + current) link.classList.add("active");
    });
    document.body.classList.toggle("is-scrolled", window.scrollY > 80);
  }

  function showHome() {
    const home = $("kezdolap");
    if (home) home.scrollIntoView();
    if (state.map) state.map.resize();
  }

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
    spoken: {},
    arrived: false,
    lastCam: 0,
    lastOff: 0,
    lastGpsWarn: 0,
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

  function exitOrdinal(n) {
    return ["", "első", "második", "harmadik", "negyedik", "ötödik", "hatodik", "hetedik", "nyolcadik"][n] || n + ".";
  }

  function cap(s) {
    const t = String(s || "");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  function classify(step) {
    const type = String((step && step.maneuver && step.maneuver.type) || "").toLowerCase();
    const mod = String((step && step.maneuver && step.maneuver.modifier) || "").toLowerCase();
    const exit = Number(step && step.maneuver && step.maneuver.exit) || 0;
    const street = String((step && step.name) || "").trim();
    const base = { street: street === "-" ? "" : street, exit, skip: false, highway: false };

    if (type === "arrive") {
      return Object.assign(base, {
        cat: "arrive",
        icon: "●",
        label: "Megérkeztél",
        action: "megérkezel",
        actionNow: "Megérkeztél"
      });
    }
    if (
      type === "depart" ||
      type === "continue" ||
      type === "new name" ||
      type === "notification" ||
      type === "exit roundabout" ||
      type === "exit rotary"
    ) {
      return Object.assign(base, {
        skip: true,
        cat: "straight",
        icon: "↑",
        label: "Haladj tovább",
        action: "haladj tovább egyenesen",
        actionNow: "Haladj tovább"
      });
    }
    if (type.includes("uturn") || mod.includes("uturn")) {
      return Object.assign(base, {
        cat: "uturn",
        icon: "↩",
        label: "Fordulj vissza",
        action: "fordulj vissza",
        actionNow: "Fordulj vissza"
      });
    }
    if (type.includes("roundabout") || type.includes("rotary")) {
      const action = exit
        ? "hajts be a körforgalomba, és vedd a " + exitOrdinal(exit) + " kijáratot"
        : "hajts be a körforgalomba";
      return Object.assign(base, {
        cat: "roundabout",
        icon: "↻",
        label: exit ? "Körforgalom, " + exit + ". kijárat" : "Körforgalom",
        action,
        actionNow: cap(action)
      });
    }
    if (type.includes("on ramp") || type === "merge") {
      const side = mod.includes("left") ? " balra" : mod.includes("right") ? " jobbra" : "";
      return Object.assign(base, {
        cat: "motorwayOn",
        highway: true,
        icon: "↗",
        label: "Hajts fel",
        action: "hajts fel az autópályára" + side,
        actionNow: "Hajts fel az autópályára"
      });
    }
    if (type.includes("off ramp")) {
      const left = mod.includes("left");
      const action = left ? "hajts le balra" : "hajts le jobbra";
      return Object.assign(base, {
        cat: "motorwayOff",
        highway: true,
        icon: "↘",
        label: left ? "Hajts le balra" : "Hajts le jobbra",
        action,
        actionNow: cap(action)
      });
    }
    if (type === "fork" || type === "end of road") {
      if (mod.includes("left")) {
        return Object.assign(base, {
          cat: "leftKeep",
          icon: "↰",
          label: "Tarts balra",
          action: "tarts balra",
          actionNow: "Tarts balra"
        });
      }
      return Object.assign(base, {
        cat: "rightKeep",
        icon: "↱",
        label: "Tarts jobbra",
        action: "tarts jobbra",
        actionNow: "Tarts jobbra"
      });
    }
    if (mod.includes("sharp") && mod.includes("left")) {
      return Object.assign(base, {
        cat: "leftSharp",
        icon: "↰",
        label: "Élesen balra",
        action: "fordulj élesen balra",
        actionNow: "Fordulj élesen balra"
      });
    }
    if (mod.includes("sharp") && mod.includes("right")) {
      return Object.assign(base, {
        cat: "rightSharp",
        icon: "↱",
        label: "Élesen jobbra",
        action: "fordulj élesen jobbra",
        actionNow: "Fordulj élesen jobbra"
      });
    }
    if ((mod.includes("slight") || mod.includes("bear")) && mod.includes("left")) {
      return Object.assign(base, {
        cat: "leftKeep",
        icon: "↰",
        label: "Tarts balra",
        action: "tarts balra",
        actionNow: "Tarts balra"
      });
    }
    if ((mod.includes("slight") || mod.includes("bear")) && mod.includes("right")) {
      return Object.assign(base, {
        cat: "rightKeep",
        icon: "↱",
        label: "Tarts jobbra",
        action: "tarts jobbra",
        actionNow: "Tarts jobbra"
      });
    }
    if (mod.includes("left")) {
      return Object.assign(base, {
        cat: "left",
        icon: "↰",
        label: "Fordulj balra",
        action: "fordulj balra",
        actionNow: "Fordulj balra"
      });
    }
    if (mod.includes("right")) {
      return Object.assign(base, {
        cat: "right",
        icon: "↱",
        label: "Fordulj jobbra",
        action: "fordulj jobbra",
        actionNow: "Fordulj jobbra"
      });
    }
    if (type === "turn" || type === "straight") {
      return Object.assign(base, {
        skip: true,
        cat: "straight",
        icon: "↑",
        label: "Haladj tovább",
        action: "haladj tovább egyenesen",
        actionNow: "Haladj tovább"
      });
    }
    return Object.assign(base, {
      skip: true,
      cat: "straight",
      icon: "↑",
      label: "Haladj tovább",
      action: "haladj tovább egyenesen",
      actionNow: "Haladj tovább"
    });
  }

  function nextActionable() {
    let acc = 0;
    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      const at = acc;
      acc += Number(step.distance || 0);
      const kind = classify(step);
      if (kind.skip) continue;
      const until = at - state.traveled;
      if (until > -25) return { step, index: i, until: Math.max(0, until), kind };
    }
    return null;
  }

  function spokenDist(meters) {
    const m = Math.max(0, Math.round(meters));
    if (m >= 1750) return "két kilométer";
    if (m >= 1250) return "másfél kilométer";
    if (m >= 850) return "egy kilométer";
    if (m >= 650) return "nyolcszáz méter";
    if (m >= 550) return "hatszáz méter";
    if (m >= 450) return "ötszáz méter";
    if (m >= 350) return "négyszáz méter";
    if (m >= 250) return "háromszáz méter";
    if (m >= 150) return "kétszáz méter";
    if (m >= 80) return "száz méter";
    return "ötven méter";
  }

  function promptText(kind, until, phase) {
    if (!kind) return "";
    if (kind.cat === "arrive") {
      return phase === "now" ? "Megérkeztél." : spokenDist(until) + " múlva megérkezel.";
    }
    let text = phase === "now" ? kind.actionNow : spokenDist(until) + " múlva " + kind.action;
    if (phase !== "now" && kind.street && kind.cat !== "roundabout" && kind.cat !== "motorwayOn") {
      text += ", " + kind.street;
    }
    if (!/[.!?]$/.test(text)) text += ".";
    return cap(text);
  }

  function desiredPhase(until, kind) {
    if (!kind || kind.skip) return null;
    if (kind.cat === "arrive") {
      if (until < 45) return "now";
      if (until < 180) return "near";
      return null;
    }
    const highway = kind.highway || Number(state.speed || 0) > 22;
    const v = Math.max(Number(state.speed) || 0, highway ? 22 : 8);
    const nowMax = Math.max(55, Math.min(140, v * 5));
    const nearMax = Math.max(250, Math.min(520, v * 18));
    const soonMax = Math.max(800, Math.min(2000, v * 55));
    if (until <= nowMax) return "now";
    if (until <= nearMax) return "near";
    if (until <= soonMax) return "soon";
    return null;
  }

  function phaseRank(phase) {
    return { soon: 1, near: 2, now: 3 }[phase] || 0;
  }

  function already(index, phase) {
    return phaseRank(state.spoken[index]) >= phaseRank(phase);
  }

  function markSpoken(index, phase) {
    if (phaseRank(phase) >= phaseRank(state.spoken[index])) state.spoken[index] = phase;
  }

  function navVoice() {
    return window.NavVoice && window.NavVoice.instance;
  }

  function hushSpeech() {
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (_e) {}
  }

  function speakGuidance(kind, phase) {
    if (!state.voice || !kind || phase !== "now") return;
    hushSpeech();
    const nv = navVoice();
    if (nv) nv.playCat(kind.cat);
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
    $("destName").textContent = state.destLabel || "Cél —";
    fetchWeather(lngLat.lat, lngLat.lng);
    if (!state.pin) {
      state.pin = new maplibregl.Marker({ element: makeEl("pin"), anchor: "bottom" })
        .setLngLat([lngLat.lng, lngLat.lat])
        .addTo(state.map);
    } else state.pin.setLngLat([lngLat.lng, lngLat.lat]);
  }

  function weatherIcon(code) {
    if (code === 0) return "☀️";
    if (code <= 3) return "⛅";
    if (code <= 48) return "🌫️";
    if (code <= 57) return "🌦️";
    if (code <= 67) return "🌧️";
    if (code <= 77) return "❄️";
    if (code <= 82) return "🌦️";
    if (code <= 86) return "❄️";
    return "⛈️";
  }

  async function fetchWeather(lat, lng) {
    const box = $("weather");
    try {
      const res = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=" +
          lat +
          "&longitude=" +
          lng +
          "&current=temperature_2m,weather_code"
      );
      if (!res.ok) throw new Error("weather");
      const data = await res.json();
      const temp = data.current && data.current.temperature_2m;
      const code = data.current && data.current.weather_code;
      if (!Number.isFinite(temp)) throw new Error("weather");
      $("weatherIcon").textContent = weatherIcon(Number(code) || 0);
      $("weatherTemp").textContent = Math.round(temp) + "°";
      box.hidden = false;
    } catch (_e) {
      box.hidden = true;
    }
  }

  function closeSearch() {
    $("searchForm").hidden = true;
    $("results").hidden = true;
    $("searchBtn").classList.remove("is-on");
    $("searchBtn").setAttribute("aria-pressed", "false");
  }

  function toggleSearch() {
    const open = $("searchForm").hidden;
    $("searchForm").hidden = !open;
    $("searchBtn").classList.toggle("is-on", open);
    $("searchBtn").setAttribute("aria-pressed", open ? "true" : "false");
    if (open) $("q").focus();
    else $("results").hidden = true;
  }

  function addLayers() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    if (!state.map.getSource("route")) {
      state.map.addSource("route", { type: "geojson", data: EMPTY });
      state.map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#3B82F6",
          "line-width": 8,
          "line-opacity": 0.8
        }
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
    const cur = nextActionable();
    const r = remaining();
    $("eta").textContent = fmtClock(r.s);
    $("remain").textContent = fmtDur(r.s);
    $("dist").textContent = fmtDist(r.m);
    if (!cur) return;
    const kind = cur.kind;
    $("banner").hidden = false;
    $("turnIcon").textContent = kind.icon;
    $("turnDist").textContent = fmtDist(cur.until);
    $("turnText").textContent = kind.label;
    $("turnStreet").textContent = kind.street || "";
    const phase = desiredPhase(cur.until, kind);
    if (phase === "now" && !already(cur.index, "now")) {
      markSpoken(cur.index, "now");
      speakGuidance(kind, "now");
    }
    if ((kind.cat === "arrive" && cur.until < 35 && !state.arrived) || (r.m < 30 && !state.arrived)) {
      state.arrived = true;
      if (!already(cur.index, "now")) {
        markSpoken(cur.index, "now");
        speakGuidance(kind.cat === "arrive" ? kind : classify({ maneuver: { type: "arrive" }, name: "" }), "now");
      }
      stopNav({ keepAudio: true });
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
      4: ["arrive", ""],
      5: ["arrive", "right"],
      6: ["arrive", "left"],
      7: ["new name", ""],
      8: ["continue", ""],
      9: ["turn", "slight right"],
      10: ["turn", "right"],
      11: ["turn", "sharp right"],
      12: ["turn", "uturn"],
      13: ["turn", "uturn"],
      14: ["turn", "sharp left"],
      15: ["turn", "left"],
      16: ["turn", "slight left"],
      17: ["on ramp", ""],
      18: ["on ramp", "right"],
      19: ["on ramp", "left"],
      20: ["off ramp", "right"],
      21: ["off ramp", "left"],
      22: ["continue", ""],
      23: ["fork", "right"],
      24: ["fork", "left"],
      25: ["merge", ""],
      26: ["roundabout", ""],
      27: ["exit roundabout", ""]
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
          maneuver: {
            type: pair[0],
            modifier: pair[1],
            exit: Number(m.roundabout_exit_count) || undefined
          }
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
      state.spoken = {};
      state.arrived = false;
      addLayers();
      drawRoute();
      if (reroute) {
        setStatus("Új útvonal.");
        if (state.navigating) {
          const nxt = nextActionable();
          if (nxt && desiredPhase(nxt.until, nxt.kind) === "soon") markSpoken(nxt.index, "soon");
          updateNav();
        }
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
    closeDrawer();
    closeSearch();
    window.scrollTo(0, 0);
    spyNav();
    if (state.map) state.map.resize();
    state.follow = true;
    $("follow").classList.add("is-on");
    $("follow").setAttribute("aria-pressed", "true");
    state.spoken = {};
    hushSpeech();
    setStatus("Navigáció");
    updateNav();
    updateCamera(true);
    if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
  }

  function stopNav(opts) {
    state.navigating = false;
    state.pendingPlan = false;
    $("app").classList.remove("is-nav");
    $("trip").hidden = true;
    $("banner").hidden = true;
    if (!(opts && opts.keepAudio)) {
      hushSpeech();
      const nv = navVoice();
      if (nv) nv.stop();
      setStatus("Megállítva");
    } else {
      setStatus("Megérkeztél");
    }
    spyNav();
    if (state.map) state.map.resize();
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
    hushSpeech();
    const nv = navVoice();
    if (state.voice && nv) nv.playCat("recompute");
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
    if (!$("status").classList.contains("is-err")) {
      setStatus(state.navigating ? "Navigáció" : state.arrived ? "Megérkeztél" : "GPS kész");
    }
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
    closeSearch();
    showHome();
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
    closeDrawer();
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
    if (typeof maplibregl === "undefined") {
      setStatus("A térképkönyvtár nem töltődött be. Frissítsd az oldalt.", true);
      return;
    }
    const dark = localStorage.getItem(THEME_KEY) !== "light";
    document.documentElement.classList.toggle("dark", dark);
    if ($("dark")) $("dark").checked = dark;
    if ($("voiceCheck")) $("voiceCheck").checked = state.voice;
    state.map = new maplibregl.Map({
      container: "map",
      style: STYLES.dark,
      center: BUDAPEST,
      zoom: 13.5,
      pitch: 50,
      maxPitch: 75,
      attributionControl: true
    });
    state.map.on("error", (e) => {
      const msg = e && e.error && (e.error.message || e.error.statusText);
      if (msg) setStatus("Térkép: " + msg, true);
    });
    state.map.on("load", addLayers);
    state.map.on("style.load", addLayers);
    state.map.on("dragstart", () => {
      state.follow = false;
      $("follow").classList.remove("is-on");
      $("follow").setAttribute("aria-pressed", "false");
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
      $("follow").setAttribute("aria-pressed", state.follow ? "true" : "false");
      if (state.follow) updateCamera(true);
    });
    $("searchBtn").addEventListener("click", toggleSearch);
    const voiceStart = $("voiceStart");
    const voiceFind = $("voiceFind");
    const voiceBase = $("voiceBase");
    if (voiceBase && window.NavVoice && window.NavVoice.instance) {
      voiceBase.value = window.NavVoice.instance.base || "";
    }
    if (voiceFind) {
      voiceFind.addEventListener("click", () => {
        const nv = navVoice();
        if (!nv) return setStatus("A hangmodul nem töltődött be.", true);
        const typed = voiceBase ? String(voiceBase.value || "").trim() : "";
        const isAuto =
          !typed ||
          typed === "automatikus" ||
          typed === "/hungary_jf/" ||
          typed === "/navigacio/hungary_jf/";
        if (!isAuto) nv.setBase(typed);
        nv.findSounds().then(() => {
          if (voiceBase && nv.base) voiceBase.value = nv.base;
        });
      });
    }
    if (voiceStart) {
      voiceStart.addEventListener("click", (ev) => {
        ev.preventDefault();
        const nv = navVoice();
        if (!nv) return setStatus("A hangmodul nem töltődött be.", true);
        nv.start();
      });
    }
    $("voiceCheck").addEventListener("change", () => {
      state.voice = $("voiceCheck").checked;
      if (!state.voice) {
        const nv = navVoice();
        if (nv) nv.stop();
        return;
      }
      hushSpeech();
    });
    document.querySelectorAll("[data-voice]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const nv = navVoice();
        const key = btn.getAttribute("data-voice");
        if (nv) nv.playPhrase(key);
        else setStatus("A hangmodul nem töltődött be.", true);
      });
    });
    const hamburgerBtn = $("hamburgerBtn");
    const closeBtn = $("closeBtn");
    const drawerOverlay = $("drawerOverlay");
    const allNavLinks = document.querySelectorAll(".nav-link, .mobile-link");

    hamburgerBtn.addEventListener("click", openDrawer);
    closeBtn.addEventListener("click", closeDrawer);
    drawerOverlay.addEventListener("click", closeDrawer);

    allNavLinks.forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = String(link.getAttribute("href") || "").replace(/^#/, "");
        closeDrawer();
        const section = $(id);
        if (section) section.scrollIntoView();
      });
    });

    window.addEventListener("scroll", spyNav, { passive: true });
    spyNav();
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

  function loadMapLibre() {
    const cssHref = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.5.0/dist/maplibre-gl.css";
    const jsHrefs = [
      "https://cdn.jsdelivr.net/npm/maplibre-gl@5.5.0/dist/maplibre-gl.js",
      "https://unpkg.com/maplibre-gl@5.5.0/dist/maplibre-gl.js"
    ];
    if (!document.querySelector("link[data-maplibre]")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = cssHref;
      css.setAttribute("data-maplibre", "1");
      document.head.appendChild(css);
    }
    if (window.maplibregl) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let i = 0;
      function next() {
        if (window.maplibregl) return resolve();
        if (i >= jsHrefs.length) return reject(new Error("A térképkönyvtár nem elérhető."));
        const s = document.createElement("script");
        s.src = jsHrefs[i++];
        s.onload = function () {
          window.maplibregl ? resolve() : next();
        };
        s.onerror = next;
        document.head.appendChild(s);
      }
      next();
    });
  }

  function initVoice() {
    if (!window.NavVoice) return;
    window.NavVoice.init({
      onLog(line, isError) {
        const el = $("voiceLog");
        if (!el) return;
        el.textContent = line;
        el.classList.toggle("is-err", !!isError);
      }
    }).then((mgr) => {
      const el = $("voiceBase");
      if (el && mgr && mgr.base) el.value = mgr.base;
    }).catch((err) => console.warn("[NavVoice] init", err));
  }

  function initGps() {
    if (!navigator.geolocation) setStatus("Nincs GPS ebben a böngészőben.", true);
    else {
      const opts = { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 };
      navigator.geolocation.getCurrentPosition(onPos, (e) => setStatus(e.message || "GPS hiba", true), opts);
      navigator.geolocation.watchPosition(onPos, () => {}, opts);
    }
    if ("serviceWorker" in navigator && location.hostname === "reiko1866-ui.github.io") {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function boot() {
    loadPlaces();
    loadMapLibre()
      .then(() => {
        initMap();
        bind();
        initVoice();
        initGps();
      })
      .catch((err) => {
        setStatus(err && err.message ? err.message : "A térkép nem töltődött be.", true);
        try {
          bind();
        } catch (_e) {}
      });
  }

  boot();
})();
