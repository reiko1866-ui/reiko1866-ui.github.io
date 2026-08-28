(function () {
  "use strict";

  const BUDAPEST = [19.0402, 47.4979];
  const THEME_KEY = "nav2_theme";
  const PLACE_KEY = "nav2_places";
  const OPTS_KEY = "nav2_opts";
  const EMPTY = { type: "FeatureCollection", features: [] };
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  const VALHALLA = "https://valhalla1.openstreetmap.de/route";
  const VALHALLA_TRACE = "https://valhalla1.openstreetmap.de/trace_attributes";
  const VALHALLA_LOCATE = "https://valhalla1.openstreetmap.de/locate";
  const OSRM = [
    "https://router.project-osrm.org/route/v1/driving",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving"
  ];
  const STYLES = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark"
  };

  const $ = (id) => document.getElementById(id);

  function openDrawer() {
    $("mobileDrawer").classList.add("open");
    $("drawerOverlay").classList.add("open");
    $("hamburgerBtn").setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    armBack();
  }

  function drawerOpen() {
    const el = $("mobileDrawer");
    return !!(el && el.classList.contains("open"));
  }

  function searchOpen() {
    const el = $("searchForm");
    return !!(el && !el.hidden);
  }

  function isOnHome() {
    return window.scrollY < 80;
  }

  function anyOverlay() {
    return drawerOpen() || searchOpen() || state.navigating || !isOnHome();
  }

  function armBack() {
    if (state.histArmed) return;
    state.histArmed = true;
    history.pushState({ nav2: 1 }, "");
  }

  function disarmBack() {
    if (!state.histArmed) return;
    state.histArmed = false;
    state.ignorePop = true;
    history.back();
    setTimeout(function () {
      state.ignorePop = false;
    }, 80);
  }

  function syncBack(fromPop) {
    if (fromPop === true) {
      state.histArmed = false;
      if (anyOverlay()) armBack();
      return;
    }
    if (anyOverlay()) armBack();
    else disarmBack();
  }

  function closeDrawer(fromPop) {
    $("mobileDrawer").classList.remove("open");
    $("drawerOverlay").classList.remove("open");
    $("hamburgerBtn").setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    if (fromPop !== "keep") syncBack(fromPop);
  }

  function onPopState() {
    if (state.ignorePop) return;
    if (drawerOpen()) {
      closeDrawer(true);
      return;
    }
    if (searchOpen()) {
      closeSearch(true);
      return;
    }
    if (state.navigating) {
      stopNav({ fromPop: true });
      return;
    }
    if (!isOnHome()) {
      showHome();
      syncBack(true);
      return;
    }
    state.histArmed = false;
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
    window.scrollTo(0, 0);
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
    gpsHits: 0,
    offHits: 0,
    puck: null,
    pin: null,
    pendingPlan: false,
    needPlan: false,
    histArmed: false,
    ignorePop: false,
    places: { home: null, work: null },
    limits: [],
    road: { limit: 0, urban: null, cls: "", start: 0, end: 0 },
    place: "",
    snapI: 1,
    routeLen: 0,
    lastSnap: null,
    lastLocate: 0,
    lastPlaceAt: 0,
    lastUrban: null,
    lastLimitShown: 0,
    roadBusy: false,
    spokenRoad: "",
    lastSpeedWarn: 0,
    searchTimer: 0,
    warnCtx: null,
    hazards: [],
    spokenHazard: "",
    mapOffline: false
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
    let best = { dist: Infinity, traveled: 0, bearing: state.heading, index: 1 };
    const n = coords.length;
    if (n < 2) return best;
    let from = 1;
    let to = n;
    if (n > 90 && state.snapI > 0) {
      from = Math.max(1, state.snapI - 50);
      to = Math.min(n, state.snapI + 90);
    }
    function scan(start, end, acc0) {
      let acc = acc0;
      for (let i = start; i < end; i++) {
        const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
        const b = { lng: coords[i][0], lat: coords[i][1] };
        const seg = haversine(a, b) || 1;
        const abx = b.lng - a.lng;
        const aby = b.lat - a.lat;
        const t = Math.max(0, Math.min(1, ((point.lng - a.lng) * abx + (point.lat - a.lat) * aby) / (abx * abx + aby * aby || 1)));
        const proj = { lng: a.lng + t * abx, lat: a.lat + t * aby };
        const d = haversine(point, proj);
        if (d < best.dist) best = { dist: d, traveled: acc + t * seg, bearing: bearing(a, b), index: i };
        acc += seg;
      }
      return acc;
    }
    let prefix = 0;
    if (from > 1) {
      for (let i = 1; i < from; i++) {
        prefix += haversine(
          { lng: coords[i - 1][0], lat: coords[i - 1][1] },
          { lng: coords[i][0], lat: coords[i][1] }
        );
      }
    }
    scan(from, to, prefix);
    if (best.dist > 70 && (from > 1 || to < n)) {
      best = { dist: Infinity, traveled: 0, bearing: state.heading, index: 1 };
      scan(1, n, 0);
    }
    state.snapI = best.index;
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

  function laneHint(step) {
    const ints = (step && step.intersections) || [];
    for (let i = ints.length - 1; i >= 0; i--) {
      const lanes = ints[i] && ints[i].lanes;
      if (!lanes || !lanes.length) continue;
      const valid = [];
      lanes.forEach(function (lane, idx) {
        if (lane && lane.valid) valid.push({ lane: lane, i: idx });
      });
      if (!valid.length) continue;
      const ind = [];
      valid.forEach(function (v) {
        (v.lane.indications || []).forEach(function (x) {
          if (ind.indexOf(x) < 0) ind.push(x);
        });
      });
      const left = ind.some(function (x) { return String(x).indexOf("left") >= 0; });
      const right = ind.some(function (x) { return String(x).indexOf("right") >= 0; });
      if (left && !right) return "bal sáv";
      if (right && !left) return "jobb sáv";
      if (valid.length === 1 && lanes.length >= 3) {
        if (valid[0].i === 0) return "bal sáv";
        if (valid[0].i === lanes.length - 1) return "jobb sáv";
        return valid[0].i + 1 + ". sáv";
      }
    }
    return "";
  }

  function classify(step) {
    const type = String((step && step.maneuver && step.maneuver.type) || "").toLowerCase();
    const mod = String((step && step.maneuver && step.maneuver.modifier) || "").toLowerCase();
    const exit = Number(step && step.maneuver && step.maneuver.exit) || 0;
    const street = String((step && step.name) || "").trim();
    const base = {
      street: street === "-" ? "" : street,
      exit,
      lane: laneHint(step),
      skip: false,
      highway: false
    };

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
    if (type.includes("ferry")) {
      const off = type.includes("exit") || mod.includes("off") || type.includes("end");
      return Object.assign(base, {
        cat: off ? "ferryOff" : "ferryOn",
        icon: "⛴",
        label: off ? "Hajts le a kompról" : "Hajts fel a kompra",
        action: off ? "hajts le a kompról" : "hajts fel a kompra",
        actionNow: off ? "Hajts le a kompról" : "Hajts fel a kompra"
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
      if (until > -45) return { step, index: i, until: Math.max(0, until), kind };
    }
    return null;
  }

  function nextAfter(index) {
    let acc = 0;
    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      const at = acc;
      acc += Number(step.distance || 0);
      if (i <= index) continue;
      const kind = classify(step);
      if (kind.skip) continue;
      const until = at - state.traveled;
      if (until > -45) return { step, index: i, until: Math.max(0, until), kind };
    }
    return null;
  }

  function fmtTurnDist(m) {
    if (m < 40) return "Most";
    return fmtDist(m);
  }

  function warnMeters(kind) {
    if (!kind) return 180;
    if (kind.cat === "arrive") return 80;
    const highway = kind.highway || Number(state.speed || 0) > 22;
    const v = Math.max(Number(state.speed) || 0, highway ? 25 : 11);
    return Math.max(160, Math.min(450, v * 11));
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
    const nowMax = Math.max(120, Math.min(280, v * 8));
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

  function armVoice() {
    const nv = navVoice();
    if (nv) nv.start();
    try {
      if (!state.warnCtx) state.warnCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (state.warnCtx && state.warnCtx.state === "suspended") state.warnCtx.resume();
    } catch (_e) {}
  }

  function playWarnBeep(count) {
    try {
      if (!state.warnCtx) state.warnCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = state.warnCtx;
      if (ctx.state === "suspended") ctx.resume();
      const n = Math.max(1, Math.min(3, count || 1));
      for (let i = 0; i < n; i++) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = i % 2 ? 880 : 1244;
        const t0 = ctx.currentTime + i * 0.17;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.14);
      }
    } catch (_e) {}
  }

  function huVoice() {
    try {
      const list = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
      return (
        list.filter(function (v) { return /^hu/i.test(v.lang || ""); })[0] ||
        list.filter(function (v) { return /hungarian|magyar/i.test(v.name || ""); })[0] ||
        null
      );
    } catch (_e) {
      return null;
    }
  }

  function speakRoad(text) {
    if (!state.voice || !state.navigating || !text) return;
    const nv = navVoice();
    if (nv && nv.isBusy()) return;
    const voice = huVoice();
    if (!voice || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice.lang || "hu-HU";
      u.voice = voice;
      u.rate = 1.06;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (_e) {}
  }

  function warnRoad(text, beeps, key) {
    if (key && state.spokenRoad === key) return;
    if (key) state.spokenRoad = key;
    const nv = navVoice();
    if (nv && nv.isBusy()) {
      if (key) state.spokenRoad = "";
      return;
    }
    playWarnBeep(beeps);
    speakRoad(text);
  }

  function maybeSpeakRoad() {
    if (!state.navigating || !state.voice) return;
    const kmh = Math.round((state.speed || 0) * 3.6);
    const limit = Number(state.road && state.road.limit) || 0;
    const urban = state.road && state.road.urban;
    const nxt = state.limits.length ? nextBoundary(state.traveled) : null;
    if (nxt && nxt.dist < 420 && nxt.dist > 50) {
      let text = "";
      let beeps = 1;
      if (nxt.urban === true && urban !== true) {
        text = "Település" + (nxt.limit ? ", " + nxt.limit : "");
        beeps = 2;
      } else if (nxt.urban === false && urban !== false) {
        text = "Település vége" + (nxt.limit ? ", " + nxt.limit : "");
        beeps = 2;
      } else if (nxt.limit && nxt.limit !== limit) {
        text = "Sebességhatár " + nxt.limit;
        beeps = 1;
      }
      if (text) warnRoad(text, beeps, "soon:" + nxt.urban + ":" + nxt.limit);
    }
    if (limit && kmh > limit + 5 && Date.now() - state.lastSpeedWarn > 22000) {
      const nv = navVoice();
      if (!(nv && nv.isBusy())) {
        state.lastSpeedWarn = Date.now();
        playWarnBeep(3);
        if (nv && nv.playCat("speed")) {
          /* pack only — no TTS on top */
        } else {
          speakRoad("Túlléped a " + limit + "-at");
        }
      }
    }
    maybeSpeakHazard();
  }

  function hazardLabel(tags) {
    if (!tags) return "";
    if (tags.highway === "speed_camera" || tags.enforcement === "maxspeed") return "Traffipax";
    if (tags.railway === "level_crossing") return "Vasúti átjáró";
    if (/bump|hump|table/.test(String(tags.traffic_calming || ""))) return "Fekvőrendőr";
    if (tags.hazard === "school_zone") return "Iskola";
    return "";
  }

  function nearestFull(coords, point) {
    const saved = state.snapI;
    state.snapI = 0;
    const snap = nearest(coords, point);
    state.snapI = saved;
    return snap;
  }

  function maybeSpeakHazard() {
    if (!state.navigating || !state.voice || !state.hazards.length) return;
    const nv = navVoice();
    if (nv && nv.isBusy()) return;
    for (let i = 0; i < state.hazards.length; i++) {
      const h = state.hazards[i];
      const d = h.at - state.traveled;
      if (d < 60 || d > 450) continue;
      const key = h.kind + ":" + Math.round(h.at / 40);
      if (state.spokenHazard === key) continue;
      state.spokenHazard = key;
      playWarnBeep(2);
      speakRoad(h.kind);
      return;
    }
  }

  async function loadHazards(coords) {
    state.hazards = [];
    if (!coords || coords.length < 2) return;
    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    coords.forEach(function (c) {
      minLng = Math.min(minLng, c[0]);
      maxLng = Math.max(maxLng, c[0]);
      minLat = Math.min(minLat, c[1]);
      maxLat = Math.max(maxLat, c[1]);
    });
    if (maxLat - minLat > 1.6 || maxLng - minLng > 1.6) return;
    const pad = 0.008;
    const box = (minLat - pad) + "," + (minLng - pad) + "," + (maxLat + pad) + "," + (maxLng + pad);
    const q =
      "[out:json][timeout:18];(" +
      'node["highway"="speed_camera"](' + box + ");" +
      'node["enforcement"="maxspeed"](' + box + ");" +
      'node["railway"="level_crossing"](' + box + ");" +
      'node["traffic_calming"~"^(bump|hump|table)$"](' + box + ");" +
      'node["hazard"="school_zone"](' + box + ");" +
      ");out;";
    const hosts = [
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass-api.de/api/interpreter"
    ];
    for (let i = 0; i < hosts.length; i++) {
      try {
        const res = await fetchJson(hosts[i], {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: "data=" + encodeURIComponent(q)
        }, 19000);
        if (!res.ok) continue;
        const data = await res.json();
        const out = [];
        (data.elements || []).forEach(function (el) {
          const kind = hazardLabel(el.tags || {});
          if (!kind || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) return;
          const snap = nearestFull(coords, { lat: el.lat, lng: el.lon });
          if (snap.dist > 42) return;
          out.push({ kind: kind, at: snap.traveled });
        });
        out.sort(function (a, b) { return a.at - b.at; });
        state.hazards = out.slice(0, 48);
        return;
      } catch (_e) {}
    }
  }

  function speakGuidance(kind) {
    if (!state.voice || !kind || kind.skip) return;
    hushSpeech();
    const nv = navVoice();
    if (nv) nv.playCat(kind.cat);
  }

  function afterPack(fn) {
    let n = 0;
    function tick() {
      const nv = navVoice();
      if (!nv || !nv.isBusy() || n > 24) return fn();
      n += 1;
      setTimeout(tick, 200);
    }
    setTimeout(tick, 350);
  }

  function speakTurnExtras(kind, then) {
    const bits = [];
    if (kind && kind.exit && kind.cat === "roundabout") bits.push("vedd a " + exitOrdinal(kind.exit) + " kijáratot");
    if (kind && kind.lane) bits.push(kind.lane);
    if (kind && kind.street && kind.cat !== "roundabout") bits.push(kind.street);
    if (then && then.kind && then.kind.cat !== "arrive" && then.until < 850) {
      bits.push("majd " + then.kind.action);
    }
    if (bits.length) speakRoad(bits.join(", "));
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
      state.lastSnap = snap;
      state.traveled = snap.traveled;
      if (snap.dist < 40) state.heading = snap.bearing;
      drawRoute();
      updateNav();
      updateRoadFromRoute();
    } else {
      locateRoad();
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

  function closeSearch(fromPop) {
    $("searchForm").hidden = true;
    $("results").hidden = true;
    $("searchBtn").classList.remove("is-on");
    $("searchBtn").setAttribute("aria-pressed", "false");
    if (fromPop !== "keep") syncBack(fromPop);
  }

  function toggleSearch() {
    if (searchOpen()) {
      closeSearch();
      return;
    }
    $("searchForm").hidden = false;
    $("searchBtn").classList.add("is-on");
    $("searchBtn").setAttribute("aria-pressed", "true");
    $("q").focus();
    armBack();
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
    if (!force && now - state.lastCam < 220) return;
    state.lastCam = now;
    const kmh = (state.speed || 0) * 3.6;
    const zoom = kmh > 110 ? 15 : kmh > 70 ? 15.7 : kmh > 40 ? 16.3 : 17.1;
    state.map.easeTo({
      center: [state.origin.lng, state.origin.lat],
      zoom,
      pitch: 58,
      bearing: state.heading,
      padding: { top: state.navigating ? 150 : 20, bottom: state.navigating ? 130 : 40, left: 0, right: 0 },
      duration: force ? 380 : 200,
      essential: true
    });
  }

  function remaining() {
    if (!state.route) return { m: 0, s: 0 };
    const total = state.routeLen || lineLen(state.coords) || 1;
    const left = Math.max(0, 1 - state.traveled / total);
    return { m: Math.max(0, total - state.traveled), s: state.route.duration * left };
  }

  function defaultLimit(cls) {
    const rc = String(cls || "").toLowerCase();
    if (rc === "motorway") return 130;
    if (rc === "trunk") return 110;
    if (rc === "living_street") return 20;
    if (rc === "residential" || rc === "service" || rc === "service_other") return 50;
    return 90;
  }

  function inferUrban(limit, cls) {
    const rc = String(cls || "").toLowerCase();
    if (rc === "motorway" || rc === "trunk" || rc.indexOf("motorway") >= 0) return false;
    if (limit > 0 && limit <= 50) return true;
    if (limit >= 90) return false;
    if (rc === "residential" || rc === "living_street" || rc === "unclassified") return true;
    return null;
  }

  function legalLimit(raw, cls) {
    const n = Number(raw) || 0;
    if (n >= 5 && n <= 140) return n;
    return defaultLimit(cls);
  }

  function roadAt(meters) {
    const list = state.limits;
    if (!list.length) return state.road;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].end < meters) lo = mid + 1;
      else hi = mid;
    }
    return list[lo] || state.road;
  }

  function nextBoundary(meters) {
    const cur = roadAt(meters);
    const list = state.limits;
    for (let i = 0; i < list.length; i++) {
      const seg = list[i];
      if (seg.start <= meters) continue;
      if (seg.end - seg.start < 80) continue;
      if (seg.limit !== cur.limit || seg.urban !== cur.urban) {
        return {
          dist: Math.max(0, seg.start - meters),
          limit: seg.limit,
          urban: seg.urban,
          cls: seg.cls
        };
      }
    }
    return null;
  }

  function downsampleShape(coords) {
    if (!coords || coords.length < 2) return [];
    const maxPts = 160;
    const minM = 90;
    const out = [{ lat: coords[0][1], lon: coords[0][0] }];
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      acc += haversine(
        { lng: coords[i - 1][0], lat: coords[i - 1][1] },
        { lng: coords[i][0], lat: coords[i][1] }
      );
      if (acc >= minM) {
        out.push({ lat: coords[i][1], lon: coords[i][0] });
        acc = 0;
      }
    }
    const last = coords[coords.length - 1];
    out.push({ lat: last[1], lon: last[0] });
    if (out.length <= maxPts) return out;
    const step = (out.length - 1) / (maxPts - 1);
    const slim = [];
    for (let i = 0; i < maxPts; i++) slim.push(out[Math.round(i * step)]);
    return slim;
  }

  function mergeLimits(edges) {
    const segs = [];
    let at = 0;
    (edges || []).forEach((edge) => {
      const meters = Math.max(1, (Number(edge.length) || 0) * 1000);
      const cls = edge.road_class || "";
      const limit = legalLimit(edge.speed_limit, cls);
      const urban = inferUrban(limit, cls);
      const last = segs[segs.length - 1];
      if (last && last.limit === limit && last.urban === urban && last.cls === cls) {
        last.end += meters;
      } else {
        segs.push({ start: at, end: at + meters, limit, urban, cls });
      }
      at += meters;
    });
    return segs;
  }

  function applyRoad(road, live) {
    if (!road) return;
    if (live) state.road = Object.assign({}, state.road, road);
    else state.road = road;
    paintRoadUi();
  }

  function placeLabel(urban, name) {
    if (urban === true) return name || "Település";
    if (urban === false) return name ? name + " · külterület" : "Külterület";
    return name || "";
  }

  function paintRoadUi() {
    const kmh = Math.round((state.speed || 0) * 3.6);
    const limit = Number(state.road && state.road.limit) || 0;
    const urban = state.road && state.road.urban;
    const sign = $("limitSign");
    const val = $("limitVal");
    if (sign && val) {
      sign.hidden = !limit;
      val.textContent = limit ? String(limit) : "—";
    }
    const speedEl = $("speed");
    if (speedEl) speedEl.classList.toggle("is-over", !!(limit && kmh > limit + 3));
    const chip = $("placeChip");
    const chipText = $("placeText");
    const label = placeLabel(urban, state.place);
    if (chip && chipText) {
      chip.hidden = !label;
      chipText.textContent = label;
      chip.classList.toggle("is-town", urban === true);
      chip.classList.toggle("is-rural", urban === false);
    }
    const nxt = state.navigating && state.limits.length ? nextBoundary(state.traveled) : null;
    const roadThen = $("roadThen");
    const roadThenText = $("roadThenText");
    if (roadThen && roadThenText) {
      if (nxt && nxt.dist < 1600) {
        const what =
          nxt.urban === true && urban !== true
            ? "település" + (nxt.limit ? ", " + nxt.limit : "")
            : nxt.urban === false && urban !== false
              ? "település vége" + (nxt.limit ? ", " + nxt.limit : "")
              : nxt.limit
                ? String(nxt.limit) + " km/h"
                : "";
        roadThen.hidden = !what;
        roadThenText.textContent = what ? fmtDist(nxt.dist) + " múlva " + what : "";
      } else {
        roadThen.hidden = true;
      }
    }
    const hz = $("hazardThen");
    const hzText = $("hazardThenText");
    if (hz && hzText) {
      let nextH = null;
      for (let i = 0; i < state.hazards.length; i++) {
        const d = state.hazards[i].at - state.traveled;
        if (d > 40 && d < 1800) {
          nextH = { kind: state.hazards[i].kind, dist: d };
          break;
        }
      }
      hz.hidden = !nextH;
      hzText.textContent = nextH ? fmtDist(nextH.dist) + " múlva " + nextH.kind : "";
    }
    if (state.navigating && $("status") && !($("status").classList.contains("is-err") && /GPS/i.test($("status").textContent))) {
      const bits = [];
      if (label) bits.push(label);
      if (limit) bits.push(limit + " km/h");
      if (bits.length) setStatus(bits.join(" · "));
    }
    maybeSpeakRoad();
  }

  async function loadRoadProfile(coords) {
    const shape = downsampleShape(coords);
    if (shape.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      const res = await fetch(VALHALLA_TRACE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          shape,
          costing: "auto",
          shape_match: "map_snap",
          filters: {
            attributes: ["edge.speed_limit", "edge.road_class", "edge.length", "edge.names"],
            action: "include"
          }
        })
      });
      if (!res.ok) throw new Error("trace " + res.status);
      const data = await res.json();
      const segs = mergeLimits(data.edges || []);
      if (segs.length) {
        state.limits = segs;
        applyRoad(roadAt(state.traveled));
      }
    } catch (_e) {
    } finally {
      clearTimeout(t);
    }
  }

  async function locateRoad() {
    if (!state.origin || state.roadBusy) return;
    if (Date.now() - state.lastLocate < 5000) return;
    state.roadBusy = true;
    state.lastLocate = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, 4500);
    try {
      const res = await fetch(VALHALLA_LOCATE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          locations: [{ lon: state.origin.lng, lat: state.origin.lat }],
          costing: "auto",
          verbose: true
        })
      });
      if (!res.ok) throw new Error("locate");
      const data = await res.json();
      const hit = data && data[0] && data[0].edges && data[0].edges[0];
      if (!hit) return;
      const cls = (hit.edge && hit.edge.classification && hit.edge.classification.classification) || "";
      const raw = hit.edge_info && hit.edge_info.speed_limit;
      const limit = legalLimit(raw, cls);
      const urban = inferUrban(limit, cls);
      applyRoad({ limit, urban, cls }, true);
      if (urban === true) refreshPlace(state.origin.lat, state.origin.lng);
      else if (urban === false) {
        state.place = "";
        paintRoadUi();
      }
    } catch (_e) {
    } finally {
      clearTimeout(t);
      state.roadBusy = false;
    }
  }

  async function refreshPlace(lat, lng) {
    if (Date.now() - state.lastPlaceAt < 12000 && state.place) return;
    state.lastPlaceAt = Date.now();
    try {
      const res = await fetch("https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lng);
      if (!res.ok) return;
      const data = await res.json();
      const p = (data.features && data.features[0] && data.features[0].properties) || {};
      const name = p.city || p.town || p.village || p.locality || "";
      if (name) {
        state.place = name;
        paintRoadUi();
      }
    } catch (_e) {}
  }

  function updateRoadFromRoute() {
    if (state.limits.length) {
      const road = roadAt(state.traveled);
      const primed = state.lastUrban === true || state.lastUrban === false || state.lastLimitShown > 0;
      const flipped = primed && road.urban !== state.lastUrban;
      const limitChanged = primed && road.limit !== state.lastLimitShown;
      applyRoad(road);
      if (flipped || (limitChanged && road.urban === true && !state.place)) {
        if (road.urban === true && state.origin) refreshPlace(state.origin.lat, state.origin.lng);
        else if (road.urban === false) state.place = "";
      }
      if (flipped && road.urban === true) {
        warnRoad((state.place || "Település") + (road.limit ? ", " + road.limit : ""), 2, "now:in:" + road.limit);
      } else if (flipped && road.urban === false) {
        warnRoad("Település vége" + (road.limit ? ", " + road.limit : ""), 2, "now:out:" + road.limit);
      } else if (!flipped && limitChanged && road.limit) {
        warnRoad("Sebességhatár " + road.limit, 1, "now:lim:" + road.limit);
      }
      state.lastUrban = road.urban;
      state.lastLimitShown = road.limit;
      return;
    }
    locateRoad();
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
    const then = nextAfter(cur.index);
    const warn = warnMeters(kind);
    $("banner").hidden = false;
    $("banner").classList.toggle("is-now", cur.until <= Math.min(90, warn));
    $("turnIcon").textContent = kind.icon;
    $("turnDist").textContent = fmtTurnDist(cur.until);
    $("turnText").textContent = kind.label;
    $("turnStreet").textContent = [kind.street, kind.lane].filter(Boolean).join(" · ");
    const thenRow = $("thenRow");
    if (then && then.kind && then.kind.cat !== "arrive") {
      thenRow.hidden = false;
      $("thenIcon").textContent = then.kind.icon;
      $("thenText").textContent =
        "Majd: " + then.kind.label + (then.kind.street ? ", " + then.kind.street : "");
    } else {
      thenRow.hidden = true;
    }
    const nv = navVoice();
    if (nv) {
      nv.warmCat(kind.cat);
      if (then) nv.warmCat(then.kind.cat);
    }
    if (cur.until <= warn && !already(cur.index, "now")) {
      markSpoken(cur.index, "now");
      speakGuidance(kind);
    }
    if ((kind.cat === "arrive" && cur.until < 40 && !state.arrived) || (r.m < 35 && !state.arrived)) {
      state.arrived = true;
      if (!already(cur.index, "now")) {
        markSpoken(cur.index, "now");
        speakGuidance(kind.cat === "arrive" ? kind : classify({ maneuver: { type: "arrive" }, name: "" }));
      }
      stopNav({ keepAudio: true });
    }
  }

  function routeOpts() {
    return {
      avoidMotorway: !!( $("avoidMotorway") && $("avoidMotorway").checked ),
      avoidToll: !!( $("avoidToll") && $("avoidToll").checked )
    };
  }

  function osrmExcludeQs() {
    const parts = [];
    const o = routeOpts();
    if (o.avoidMotorway) parts.push("motorway");
    if (o.avoidToll) parts.push("toll");
    return parts.length ? "&exclude=" + parts.join(",") : "";
  }

  function avoidStatus(reroute) {
    const o = routeOpts();
    if (o.avoidMotorway && o.avoidToll) return reroute ? "Újratervezés autópálya és fizető nélkül…" : "Autópálya és fizető nélkül…";
    if (o.avoidMotorway) return reroute ? "Újratervezés autópálya nélkül…" : "Autópálya nélkül…";
    if (o.avoidToll) return reroute ? "Újratervezés fizető nélkül…" : "Fizető út nélkül…";
    return reroute ? "Újratervezés…" : "Útvonal…";
  }

  function fetchJson(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, ms || 7000);
    const next = Object.assign({ signal: ctrl.signal }, opts || {});
    return fetch(url, next).finally(function () { clearTimeout(t); });
  }

  async function fetchOsrm(from, to, extraQs) {
    const path =
      from.lng +
      "," +
      from.lat +
      ";" +
      to.lng +
      "," +
      to.lat +
      "?overview=full&geometries=geojson&steps=true" +
      (extraQs || "");
    const jobs = OSRM.map(function (base) {
      return fetchJson(base + "/" + path, null, 6500).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (data) {
        if (data.code !== "Ok" || !data.routes || !data.routes[0]) throw new Error("Nincs útvonal");
        return data.routes[0];
      });
    });
    try {
      return await Promise.any(jobs);
    } catch (err) {
      const first = err && err.errors && err.errors[0];
      throw first || new Error("Az útvonaltervező nem elérhető.");
    }
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
      27: ["exit roundabout", ""],
      28: ["ferry", ""],
      29: ["ferry", "off"]
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
    const res = await fetchJson(VALHALLA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, 8000);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.trip) throw new Error("Nincs útvonal");
    return valhallaToRoute(data.trip);
  }

  async function plan(reroute) {
    if (!state.origin || !state.dest) return;
    if (state.planning) {
      state.needPlan = true;
      return;
    }
    state.planning = true;
    state.needPlan = false;
    const exclude = osrmExcludeQs();
    setStatus(avoidStatus(reroute));
    try {
      let route = null;
      let last = null;
      const tries = exclude
        ? [
            function () { return fetchValhalla(state.origin, state.dest); },
            function () { return fetchOsrm(state.origin, state.dest, exclude); }
          ]
        : [
            function () { return fetchOsrm(state.origin, state.dest, ""); },
            function () { return fetchValhalla(state.origin, state.dest); }
          ];
      for (let i = 0; i < tries.length; i++) {
        try {
          route = await tries[i]();
          last = null;
          break;
        } catch (err) {
          last = err;
        }
      }
      if (!route) throw last || new Error("Az útvonal nem jött össze.");
      state.route = route;
      state.coords = (route.geometry && route.geometry.coordinates) || [];
      state.steps = [];
      state.limits = [];
      state.snapI = 1;
      state.routeLen = Number(route.distance) || lineLen(state.coords);
      (route.legs || []).forEach((leg) => (leg.steps || []).forEach((s) => state.steps.push(s)));
      if (reroute && state.coords.length) state.traveled = nearest(state.coords, state.origin).traveled;
      else state.traveled = 0;
      state.spoken = {};
      state.spokenRoad = "";
      state.spokenHazard = "";
      state.lastSpeedWarn = 0;
      state.arrived = false;
      addLayers();
      drawRoute();
      loadRoadProfile(state.coords);
      loadHazards(state.coords);
      if (reroute) {
        const o = routeOpts();
        setStatus(
          o.avoidMotorway && o.avoidToll
            ? "Útvonal autópálya és fizető nélkül."
            : o.avoidMotorway
              ? "Útvonal autópálya nélkül."
              : o.avoidToll
                ? "Útvonal fizető nélkül."
                : "Új útvonal."
        );
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
      if (state.needPlan) {
        state.needPlan = false;
        plan(!!state.navigating || !!state.route);
      }
    }
  }

  function startNav() {
    if (!state.route) return;
    state.pendingPlan = false;
    state.navigating = true;
    $("app").classList.add("is-nav");
    $("trip").hidden = false;
    $("banner").hidden = false;
    closeDrawer("keep");
    closeSearch("keep");
    armBack();
    window.scrollTo(0, 0);
    spyNav();
    if (state.map) state.map.resize();
    state.follow = true;
    $("follow").classList.add("is-on");
    $("follow").setAttribute("aria-pressed", "true");
    state.spoken = {};
    armVoice();
    hushSpeech();
    setStatus("Navigáció");
    hushSpeech();
    playWarnBeep(1);
    const nv = navVoice();
    if (state.voice && nv) nv.playCat("start");
    else if (state.voice) speakRoad("Navigáció indul");
    updateNav();
    updateRoadFromRoute();
    updateCamera(true);
    if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
  }

  function stopNav(opts) {
    state.navigating = false;
    state.pendingPlan = false;
    $("app").classList.remove("is-nav");
    $("trip").hidden = true;
    $("banner").hidden = true;
    if ($("roadThen")) $("roadThen").hidden = true;
    if ($("hazardThen")) $("hazardThen").hidden = true;
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
    syncBack(opts && opts.fromPop);
  }

  function maybeReroute() {
    if (!state.navigating || !state.origin || !state.dest || state.planning) return;
    if (!state.coords.length) return plan(true);
    const snap = state.lastSnap || nearest(state.coords, state.origin);
    const limit = Number(state.speed || 0) > 22 ? 80 : 45;
    if (snap.dist < limit) {
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
    const acc = Number(pos.coords.accuracy);
    setOrigin(
      { lat: pos.coords.latitude, lng: pos.coords.longitude },
      pos.coords.heading,
      pos.coords.speed
    );
    if (state.navigating && acc > 50) {
      state.gpsHits += 1;
      if (state.gpsHits >= 3 && Date.now() - state.lastGpsWarn > 40000) {
        state.lastGpsWarn = Date.now();
        const nv = navVoice();
        if (state.voice && nv && !nv.isBusy()) nv.playCat("gps");
        setStatus("Gyenge GPS", true);
      }
    } else {
      state.gpsHits = 0;
    }
    if (state.pendingPlan && state.dest && !state.route && !state.planning) {
      state.pendingPlan = false;
      plan(false);
    }
    maybeReroute();
    if (state.navigating) {
      if (state.gpsHits === 0) paintRoadUi();
    } else if (!state.arrived) {
      setStatus("GPS kész");
    }
  }

  function uniqueBits(list) {
    const out = [];
    list.forEach(function (x) {
      const s = String(x || "").trim();
      if (!s) return;
      if (out.some(function (y) { return y.toLowerCase() === s.toLowerCase(); })) return;
      out.push(s);
    });
    return out;
  }

  function keepSub(s) {
    const x = String(s || "").trim();
    if (!x) return false;
    if (/^(hungary|great plain|transdanubia|central hungary|northern hungary|western transdanubia|southern transdanubia|northern great plain|southern great plain|great plain and north)$/i.test(x)) {
      return false;
    }
    return true;
  }

  function placeKind(type) {
    const t = String(type || "").toLowerCase();
    if (/station|halt|stop_position|railway/.test(t)) return "Állomás";
    if (/city|town|village|hamlet|suburb|municipality|county/.test(t)) return "Település";
    if (/house|building/.test(t)) return "Házszám";
    if (/street|residential|living|primary|secondary|tertiary|unclassified|road|pedestrian/.test(t)) {
      return "Utca";
    }
    return "Hely";
  }

  function finishPlace(lat, lon, title, extra, type) {
    const kind = placeKind(type);
    const bits = uniqueBits(extra.filter(function (x) { return keepSub(x) && x !== title; }));
    const subtitle = uniqueBits([kind].concat(bits)).join(" · ");
    const display = uniqueBits([title].concat(bits)).join(", ");
    return {
      lat: Number(lat),
      lon: Number(lon),
      title: title || display || "Hely",
      subtitle: subtitle,
      display_name: display || title || "Hely"
    };
  }

  function fromPhoton(f) {
    const p = f.properties || {};
    const g = f.geometry || {};
    const c = g.coordinates || [];
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const title = p.name || street || p.city || p.county || "Hely";
    return finishPlace(
      c[1],
      c[0],
      title,
      [street, p.district, p.locality, p.city || p.county, p.state, p.country],
      p.osm_value || p.type
    );
  }

  function fromNominatim(item) {
    const a = item.address || {};
    const street = [a.road || a.pedestrian || a.residential, a.house_number].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.municipality || a.county || "";
    const title = item.name || street || city || "Hely";
    return finishPlace(
      item.lat,
      item.lon,
      title,
      [street, a.suburb || a.neighbourhood, city, a.state, a.country],
      item.addresstype || item.type
    );
  }

  async function geocode(q) {
    try {
      const res = await fetch(
        "https://photon.komoot.io/api/?lang=hu&limit=8&q=" + encodeURIComponent(q)
      );
      const data = await res.json();
      const list = (data.features || []).map(fromPhoton).filter(function (p) {
        return Number.isFinite(p.lat) && Number.isFinite(p.lon);
      });
      if (list.length) return list;
    } catch (_e) {}
    const url =
      NOMINATIM +
      "?format=jsonv2&addressdetails=1&limit=8&q=" +
      encodeURIComponent(q);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("A keresés sikertelen.");
    const data = await res.json();
    if (!data.length) throw new Error("Nincs találat.");
    return data.map(fromNominatim);
  }

  function showResults(list) {
    const box = $("results");
    box.innerHTML = "";
    list.forEach(function (p) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      const title = document.createElement("strong");
      title.className = "result-title";
      title.textContent = p.title || p.display_name;
      btn.appendChild(title);
      if (p.subtitle) {
        const sub = document.createElement("span");
        sub.className = "result-sub";
        sub.textContent = p.subtitle;
        btn.appendChild(sub);
      }
      btn.addEventListener("click", function () {
        choose(p);
      });
      li.appendChild(btn);
      box.appendChild(li);
    });
    box.hidden = !list.length;
  }

  async function choose(place) {
    armVoice();
    $("results").hidden = true;
    closeSearch("keep");
    showHome();
    const label = place.title || place.display_name || "";
    setDest({ lat: Number(place.lat), lng: Number(place.lon) }, label);
    $("q").value = label;
    if (!state.origin) {
      state.pendingPlan = true;
      setStatus("Várom a GPS-t, aztán indulok…");
      return;
    }
    await plan(false);
  }

  async function lookupAddress(q) {
    const list = await geocode(q);
    showResults(list);
    return list;
  }

  async function onSearch(e) {
    e.preventDefault();
    const q = String($("q").value || "").trim();
    if (!q) return setStatus("Írj be egy címet.", true);
    const m = q.match(/^(-?\d+(?:[.,]\d+))\s*[,;]\s*(-?\d+(?:[.,]\d+))$/);
    if (m) {
      const lat = Number(m[1].replace(",", "."));
      const lng = Number(m[2].replace(",", "."));
      return choose({
        lat: lat,
        lon: lng,
        title: lat.toFixed(5) + ", " + lng.toFixed(5),
        subtitle: "Koordináta",
        display_name: lat + ", " + lng
      });
    }
    try {
      setStatus("Keresés…");
      const list = await lookupAddress(q);
      if (!list.length) throw new Error("Nincs találat.");
      setStatus(list.length + " találat — koppints a címre");
    } catch (err) {
      showResults([]);
      setStatus(err.message || "A keresés sikertelen.", true);
    }
  }

  function onQueryInput() {
    const q = String($("q").value || "").trim();
    clearTimeout(state.searchTimer);
    if (q.length < 2) {
      $("results").hidden = true;
      $("results").innerHTML = "";
      return;
    }
    state.searchTimer = setTimeout(function () {
      lookupAddress(q).catch(function () {
        showResults([]);
      });
    }, 320);
  }

  function loadNavOpts() {
    try {
      const o = JSON.parse(localStorage.getItem(OPTS_KEY) || "{}");
      if ($("avoidMotorway") && o.avoidMotorway) $("avoidMotorway").checked = true;
      if ($("avoidToll") && o.avoidToll) $("avoidToll").checked = true;
    } catch (_e) {}
  }

  function saveNavOpts() {
    localStorage.setItem(OPTS_KEY, JSON.stringify(routeOpts()));
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
    closeDrawer("keep");
    choose({ lat: p.lat, lon: p.lng, title: p.label || kind, display_name: p.label || kind });
  }

  function europePmtilesUrl() {
    try {
      return new URL("./map/europe.pmtiles", document.baseURI).href;
    } catch (_e) {
      return "./map/europe.pmtiles";
    }
  }

  function registerPmtiles() {
    if (window.__pmtilesReady || !window.pmtiles || !window.maplibregl) return;
    const protocol = new window.pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    window.__pmtilesReady = true;
  }

  async function loadEuropeStyle(dark) {
    registerPmtiles();
    const flavor = dark ? "dark" : "light";
    let layers = null;
    try {
      const mod = await import("https://esm.sh/@protomaps/basemaps@5.4.0");
      layers = mod.layers("protomaps", mod.namedFlavor(flavor), { lang: "hu" });
    } catch (_e) {
      layers = [
        { id: "bg", type: "background", paint: { "background-color": dark ? "#0F172A" : "#f2efe9" } },
        {
          id: "earth",
          type: "fill",
          source: "protomaps",
          "source-layer": "earth",
          paint: { "fill-color": dark ? "#1E293B" : "#e8e0d0" }
        },
        {
          id: "water",
          type: "fill",
          source: "protomaps",
          "source-layer": "water",
          paint: { "fill-color": dark ? "#0c4a6e" : "#80b8d8" }
        },
        {
          id: "roads",
          type: "line",
          source: "protomaps",
          "source-layer": "roads",
          paint: { "line-color": dark ? "#94a3b8" : "#666", "line-width": 1.15 }
        },
        {
          id: "places",
          type: "symbol",
          source: "protomaps",
          "source-layer": "places",
          layout: {
            "text-field": ["coalesce", ["get", "name:hu"], ["get", "name"], ["get", "name:en"]],
            "text-size": 13
          },
          paint: {
            "text-color": dark ? "#E2E8F0" : "#111",
            "text-halo-color": dark ? "#0F172A" : "#fff",
            "text-halo-width": 1.4
          }
        }
      ];
    }
    return {
      version: 8,
      name: "Európa",
      glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/" + flavor,
      sources: {
        protomaps: {
          type: "vector",
          url: "pmtiles://" + europePmtilesUrl(),
          attribution: "© OpenStreetMap © Protomaps"
        }
      },
      layers: layers
    };
  }

  function applyTheme(dark) {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    if (!state.map) return;
    const done = function () {
      state.map.once("style.load", addLayers);
    };
    if (state.mapOffline) {
      loadEuropeStyle(dark).then(function (st) {
        state.map.setStyle(st);
        done();
      });
      return;
    }
    state.map.setStyle(dark ? STYLES.dark : STYLES.light);
    done();
  }

  function initMap() {
    if (typeof maplibregl === "undefined") {
      setStatus("A térképkönyvtár nem töltődött be. Frissítsd az oldalt.", true);
      return;
    }
    registerPmtiles();
    const dark = localStorage.getItem(THEME_KEY) !== "light";
    document.documentElement.classList.toggle("dark", dark);
    if ($("dark")) $("dark").checked = dark;
    if ($("voiceCheck")) $("voiceCheck").checked = state.voice;
    state.map = new maplibregl.Map({
      container: "map",
      style: dark ? STYLES.dark : STYLES.light,
      center: BUDAPEST,
      zoom: 13.5,
      pitch: 50,
      maxPitch: 75,
      attributionControl: true
    });
    let ready = false;
    state.map.once("load", function () {
      ready = true;
    });
    window.setTimeout(function () {
      if (ready || state.mapOffline) return;
      state.mapOffline = true;
      loadEuropeStyle(dark).then(function (st) {
        state.map.setStyle(st);
        state.map.once("style.load", addLayers);
        setStatus("Letöltött Európa-térkép");
      });
    }, 8000);
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
        choose({ lat: start.lat, lon: start.lng, title: "Térképpont", display_name: "Térképpont" });
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
    $("q").addEventListener("input", onQueryInput);
    $("stop").addEventListener("click", stopNav);
    $("follow").addEventListener("click", () => {
      state.follow = !state.follow;
      $("follow").classList.toggle("is-on", state.follow);
      $("follow").setAttribute("aria-pressed", state.follow ? "true" : "false");
      if (state.follow) updateCamera(true);
    });
    $("searchBtn").addEventListener("click", () => {
      armVoice();
      toggleSearch();
    });
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
    closeBtn.addEventListener("click", function () {
      closeDrawer();
    });
    drawerOverlay.addEventListener("click", function () {
      closeDrawer();
    });

    allNavLinks.forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = String(link.getAttribute("href") || "").replace(/^#/, "");
        closeDrawer("keep");
        if (state.navigating && id !== "kezdolap") {
          syncBack();
          return;
        }
        if (id === "kezdolap") {
          showHome();
          syncBack();
          return;
        }
        const section = $(id);
        if (section) {
          section.scrollIntoView();
          armBack();
        }
      });
    });

    window.addEventListener("scroll", spyNav, { passive: true });
    window.addEventListener("popstate", onPopState);
    spyNav();
    $("homeGo").addEventListener("click", () => goPlace("home"));
    $("workGo").addEventListener("click", () => goPlace("work"));
    $("homeSet").addEventListener("click", () => savePlace("home"));
    $("workSet").addEventListener("click", () => savePlace("work"));
    $("dark").addEventListener("change", () => applyTheme($("dark").checked));
    ["avoidMotorway", "avoidToll"].forEach((id) => {
      $(id).addEventListener("change", () => {
        saveNavOpts();
        const on = $(id).checked;
        const name = id === "avoidMotorway" ? "Autópálya elkerülése" : "Fizetős utak elkerülése";
        setStatus(name + (on ? " bekapcsolva" : " kikapcsolva"));
        if (state.origin && state.dest) plan(true);
      });
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function loadPmtiles() {
    if (window.pmtiles) return Promise.resolve();
    return loadScript("https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js").catch(function () {
      return loadScript("https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/dist/pmtiles.js");
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
    const ready = window.maplibregl
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
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
    return ready.then(loadPmtiles).then(function () {
      registerPmtiles();
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
      const opts = { enableHighAccuracy: true, maximumAge: 250, timeout: 7000 };
      navigator.geolocation.getCurrentPosition(onPos, (e) => setStatus(e.message || "GPS hiba", true), opts);
      navigator.geolocation.watchPosition(onPos, () => setStatus("GPS jel gyenge", true), opts);
    }
    if ("serviceWorker" in navigator && location.hostname === "reiko1866-ui.github.io") {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function boot() {
    loadPlaces();
    loadNavOpts();
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
