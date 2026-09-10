(function () {
  "use strict";

  const BUDAPEST = [19.0402, 47.4979];
  const THEME_KEY = "nav2_theme";
  const PLACE_KEY = "nav2_places";
  const CAR_KEY = "nav2_car";
  const OPTS_KEY = "nav2_opts";
  const AR_KEY = "nav2_ar";
  const CAM_KEY = "nav2_360";
  const KALAND_KEY = "nav2_kaland";
  const FUNPOI_KEY = "nav2_funpoi";
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
    const pageIds = ["kezdolap", "poen", "funkciok", "Ajanlatok", "kapcsolat"];
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
    ar: false,
    cameraError: false,
    camBeat: 0,
    camTimer: 0,
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
    view: null,
    target: null,
    camHeading: 0,
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
    spokenLimit: 0,
    roadBusy: false,
    spokenRoad: "",
    lastSpeedWarn: 0,
    lastSpare: 0,
    kaland: false,
    funPoi: true,
    funPois: [],
    spokenPoi: {},
    poiAt: 0,
    poiBusy: false,
    funChipUntil: 0,
    cameras: [],
    camBusy: false,
    camAt: 0,
    floatMarks: [],
    distMark: null,
    floatKey: "",
    searchTimer: 0,
    car: null,
    carMark: null,
    drove: false,
    stillSince: 0,
    parkPos: null,
    lastFix: null,
    fixRejects: 0,
    gpsAcc: 0,
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

  function carAge(at) {
    const m = Math.round((Date.now() - Number(at || 0)) / 60000);
    if (!Number.isFinite(m) || m < 2) return "Most";
    if (m < 60) return m + " perce";
    const h = Math.round(m / 60);
    if (h < 24) return h + " órája";
    const d = Math.round(h / 24);
    return d === 1 ? "tegnap" : d + " napja";
  }

  function loadCar() {
    try {
      const c = JSON.parse(localStorage.getItem(CAR_KEY) || "null");
      if (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))) {
        state.car = { lat: Number(c.lat), lng: Number(c.lng), at: Number(c.at) || Date.now() };
      }
    } catch (_e) {
      state.car = null;
    }
  }

  function saveCar(point) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    if (state.gpsAcc > 45) return;
    const next = { lat: point.lat, lng: point.lng, at: Date.now() };
    if (state.car && haversine(state.car, next) < 25) state.car.at = next.at;
    else state.car = next;
    try {
      localStorage.setItem(CAR_KEY, JSON.stringify(state.car));
    } catch (_e) {}
    paintCar();
  }

  function paintCar() {
    if (!state.map || !state.car) return;
    const hide =
      (state.origin && haversine(state.origin, state.car) < 40) ||
      (state.dest && haversine(state.dest, state.car) < 25);
    if (hide) {
      if (state.carMark) {
        try {
          state.carMark.remove();
        } catch (_e) {}
        state.carMark = null;
      }
      return;
    }
    const lngLat = [state.car.lng, state.car.lat];
    if (!state.carMark) {
      try {
        state.carMark = new maplibregl.Marker({ element: makeEl("car-pin"), anchor: "center" })
          .setLngLat(lngLat)
          .addTo(state.map);
      } catch (_e) {}
    } else {
      state.carMark.setLngLat(lngLat);
    }
  }

  function watchPark(lngLat, speed) {
    const kmh = Math.round((Number(speed) || 0) * 3.6);
    if (kmh >= 18) {
      state.drove = true;
      state.parkPos = lngLat;
      state.stillSince = 0;
      return;
    }
    if (state.navigating) return;
    if (state.drove && kmh < 5) {
      if (!state.stillSince) {
        state.stillSince = Date.now();
        state.parkPos = lngLat;
      }
      if (state.parkPos && haversine(state.parkPos, lngLat) > 45) {
        state.drove = false;
        state.stillSince = 0;
        return;
      }
      if (Date.now() - state.stillSince > 150000) {
        saveCar(state.parkPos || lngLat);
        state.drove = false;
        state.stillSince = 0;
      }
      return;
    }
    state.stillSince = 0;
  }

  function carPlace() {
    if (!state.car) return null;
    if (state.origin && haversine(state.origin, state.car) < 55) return null;
    return {
      lat: state.car.lat,
      lon: state.car.lng,
      title: "Autó",
      subtitle: "Itt hagytad · " + carAge(state.car.at),
      display_name: "Autó",
      shortcut: "car"
    };
  }

  function showShortcuts() {
    const car = carPlace();
    showResults(car ? [car] : []);
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

  function angDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  function mixHeading(from, to, k) {
    if (!Number.isFinite(from)) return to;
    if (!Number.isFinite(to)) return from;
    return (from + angDelta(from, to) * k + 360) % 360;
  }

  function alongLine(coords, traveled) {
    let acc = 0;
    const n = coords.length;
    if (n < 1) return null;
    if (n === 1 || traveled <= 0) return { lng: coords[0][0], lat: coords[0][1] };
    for (let i = 1; i < n; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversine(a, b);
      if (acc + seg >= traveled) {
        const t = seg ? (traveled - acc) / seg : 1;
        return { lng: a.lng + t * (b.lng - a.lng), lat: a.lat + t * (b.lat - a.lat) };
      }
      acc += seg;
    }
    return { lng: coords[n - 1][0], lat: coords[n - 1][1] };
  }

  function nearest(coords, point) {
    let best = { dist: Infinity, traveled: 0, bearing: state.heading, index: 1, score: Infinity };
    const n = coords.length;
    if (n < 2) return best;
    let from = 1;
    let to = n;
    if (n > 90 && state.snapI > 0) {
      from = Math.max(1, state.snapI - 36);
      to = Math.min(n, state.snapI + (state.navigating ? 160 : 90));
    }
    function scan(start, end, acc0) {
      let acc = acc0;
      for (let i = start; i < end; i++) {
        const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
        const b = { lng: coords[i][0], lat: coords[i][1] };
        const seg = haversine(a, b) || 1;
        const clat = Math.cos(toRad((a.lat + b.lat) * 0.5)) || 1;
        const abx = (b.lng - a.lng) * clat;
        const aby = b.lat - a.lat;
        const apx = (point.lng - a.lng) * clat;
        const apy = point.lat - a.lat;
        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
        const proj = { lng: a.lng + t * (b.lng - a.lng), lat: a.lat + t * (b.lat - a.lat) };
        const d = haversine(point, proj);
        const traveled = acc + t * seg;
        const br = bearing(a, b);
        let score = d;
        if (state.navigating) {
          if (traveled < state.traveled - 18) score += 22;
          if (Number.isFinite(state.heading) && Math.abs(angDelta(state.heading, br)) > 75) score += 14;
        }
        if (score < best.score) {
          best = { dist: d, traveled: traveled, bearing: br, index: i, score: score };
        }
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
      best = { dist: Infinity, traveled: 0, bearing: state.heading, index: 1, score: Infinity };
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

  function nextLanesAhead(maxM) {
    if (!state.origin || !state.coords.length) return null;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < state.steps.length; i++) {
      const ints = state.steps[i].intersections || [];
      for (let j = 0; j < ints.length; j++) {
        const lanes = ints[j] && ints[j].lanes;
        if (!lanes || lanes.length < 2 || lanes.length > 8) continue;
        const loc = ints[j].location;
        if (!loc || loc.length < 2) continue;
        const snap = nearestFull(state.coords, { lng: loc[0], lat: loc[1] });
        const d = snap.traveled - state.traveled;
        if (d < -15 || d > maxM) continue;
        if (d < bestD) {
          bestD = d;
          best = lanes;
        }
      }
    }
    return best;
  }

  function laneGlyph(inds) {
    const x = (inds || []).map(function (s) { return String(s || "").toLowerCase(); });
    const has = function (p) { return x.some(function (s) { return s.indexOf(p) >= 0; }); };
    const left = has("left") && !has("uturn");
    const right = has("right");
    const straight = x.some(function (s) { return s === "straight" || s === "none" || s === ""; });
    const slightL = has("slight") && has("left");
    const slightR = has("slight") && has("right");
    const sharpL = has("sharp") && has("left");
    const sharpR = has("sharp") && has("right");
    if (has("uturn")) return "uturn";
    if (straight && left && !right) return "forkL";
    if (straight && right && !left) return "forkR";
    if (sharpL) return "sharpL";
    if (sharpR) return "sharpR";
    if (slightL) return "slightL";
    if (slightR) return "slightR";
    if (left && !right) return "left";
    if (right && !left) return "right";
    return "straight";
  }

  function laneSvg(kind) {
    const head = "M12 7l-4.2 5.2M12 7l4.2 5.2";
    const paths = {
      straight: "M12 26V7 " + head,
      slightL: "M14 26L11 16L8 7 M8 7l1.2 6.2M8 7l6 1",
      slightR: "M10 26L13 16L16 7 M16 7l-1.2 6.2M16 7l-6 1",
      left: "M16 26V16H8 M8 16l4.2-4.2M8 16l4.2 4.2",
      right: "M8 26V16h8 M16 16l-4.2-4.2M16 16l-4.2 4.2",
      sharpL: "M17 25V18H7 M7 18l4.4-4.6M7 18l4.4 4.6",
      sharpR: "M7 25V18h10 M17 18l-4.4-4.6M17 18l-4.4 4.6",
      forkL: "M14 26V14L8 7 M8 7l1.4 5.8M8 7l5.6.8 M14 14V8 M14 8l-3.6 4.6M14 8l3.6 4.6",
      forkR: "M10 26V14L16 7 M16 7l-1.4 5.8M16 7l-5.6.8 M10 14V8 M10 8l-3.6 4.6M10 8l3.6 4.6",
      uturn: "M16 26V15A5 5 0 0 0 6 15v4 M6 19l-3.4-3.6M6 19l3.6-3.2"
    };
    return (
      '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="' +
      (paths[kind] || paths.straight) +
      '"/></svg>'
    );
  }

  function laneHint(step) {
    const ints = (step && step.intersections) || [];
    for (let i = 0; i < ints.length; i++) {
      const lanes = ints[i] && ints[i].lanes;
      if (!lanes || !lanes.length) continue;
      const valid = [];
      lanes.forEach(function (lane, idx) {
        if (lane && lane.valid) valid.push(idx);
      });
      if (!valid.length || valid.length === lanes.length) continue;
      if (valid.length === 1) {
        if (valid[0] === 0) return "bal sáv";
        if (valid[0] === lanes.length - 1) return "jobb sáv";
        return valid[0] + 1 + ". sáv";
      }
      return valid.map(function (n) { return n + 1; }).join(". és ") + ". sáv";
    }
    return "";
  }

  function paintLanes(highway) {
    const box = $("lanes");
    if (!box) return;
    const lanes = nextLanesAhead(highway ? 820 : 520);
    if (!lanes) {
      box.hidden = true;
      box.innerHTML = "";
      box.removeAttribute("aria-label");
      return;
    }
    const valid = [];
    lanes.forEach(function (lane, idx) {
      if (lane && lane.valid) valid.push(idx + 1);
    });
    box.innerHTML = "";
    lanes.forEach(function (lane) {
      const el = document.createElement("span");
      el.className = "lane" + (lane && lane.valid ? " is-go" : "");
      el.innerHTML = laneSvg(laneGlyph((lane && lane.indications) || ["straight"]));
      box.appendChild(el);
    });
    box.setAttribute("aria-label", valid.length ? "Sávok: " + valid.join(". és ") + "." : "Sávok");
    box.hidden = false;
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
    if (m < 22) return "Most";
    if (m < 80) return Math.round(m / 5) * 5 + " m";
    if (m < 1000) return Math.round(m / 10) * 10 + " m";
    return (m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",") + " km";
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

  function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  function poenFiles() {
    const nv = navVoice();
    return nv && nv.filesFor ? nv.filesFor("start") : [];
  }

  function setPoenNow(name, played, total) {
    const el = $("poenNow");
    if (!el) return;
    if (!played || !total) {
      el.textContent = name ? "Szól" : "Koppints: Mind megy";
      return;
    }
    el.textContent = "Szól: " + played + " / " + total;
  }

  function fillPoen() {
    const files = poenFiles();
    const list = $("poenList");
    const count = $("poenCount");
    if (count) count.textContent = files.length ? files.length + " poén a csomagban" : "A hangcsomag még töltődik…";
    if (!list) return;
    list.innerHTML = "";
    files.forEach(function (name, i) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Poén " + (i + 1);
      btn.addEventListener("click", function () {
        const nv = navVoice();
        if (!nv) return setStatus("A hangmodul nem töltődött be.", true);
        armVoice();
        nv.playJokes(files, i);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function bindPoen() {
    const nv0 = navVoice();
    if (nv0) nv0.onJoke = setPoenNow;
    const play = $("poenPlay");
    const next = $("poenNext");
    const stop = $("poenStop");
    if (play) {
      play.addEventListener("click", function () {
        const nv = navVoice();
        if (!nv) return setStatus("A hangmodul nem töltődött be.", true);
        armVoice();
        nv.playJokes(shuffle(poenFiles()), 0);
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        const nv = navVoice();
        if (!nv) return;
        armVoice();
        nv.skipJoke();
      });
    }
    if (stop) {
      stop.addEventListener("click", function () {
        const nv = navVoice();
        if (nv) nv.stop();
      });
    }
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

  function announceLimit(limit) {
    const n = Number(limit) || 0;
    if (!n || n === state.spokenLimit) return false;
    if (!state.navigating || !state.voice) return false;
    const nv = navVoice();
    if (nv && nv.isBusy()) return false;
    state.spokenLimit = n;
    warnRoad("Sebességhatár " + n, 1, "lim:" + n);
    return true;
  }

  function maybeSpeakRoad() {
    if (!state.navigating || !state.voice) return;
    const kmh = Math.round((state.speed || 0) * 3.6);
    const limit = Number(state.road && state.road.limit) || 0;
    const nxt = state.limits.length ? nextBoundary(state.traveled) : null;
    if (nxt && nxt.dist < 420 && nxt.dist > 50 && nxt.limit && nxt.limit !== limit) {
      announceLimit(nxt.limit);
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
    maybePlaySpare();
  }

  function maybePlaySpare() {
    if (!state.navigating || !state.voice) return;
    const nv = navVoice();
    if (!nv || nv.isBusy()) return;
    if (Date.now() - (state.lastSpare || 0) < (state.kaland ? 45000 : 90000)) return;
    state.lastSpare = Date.now();
    nv.playCat("start");
  }

  const FUN_GAG = {
    fuel: ["a kocsi is szomjas", "tankolj, mielőtt a poén kifogy"],
    pub: ["ide most nem térünk be", "söröző. te vezetsz"],
    bar: ["a GPS nem kér fröccsöt"],
    cafe: ["a szemednek kell, nem a kocsinak"],
    restaurant: ["a gyomor navigál, de én a kormány"],
    fast_food: ["gyorsabban eszel, mint ahogy kanyarodsz"],
    attraction: ["nézd a műemléket, ne a telefont"],
    museum: ["a múltat nem ússzuk le"],
    viewpoint: ["a kilátás szép, a sávot tartsd"],
    castle: ["nem ostrom, csak elhaladunk"],
    supermarket: ["tej, kenyér, és egyenesben maradsz"]
  };

  function poiKindFromTags(tags) {
    if (!tags) return "";
    const a = String(tags.amenity || "");
    const t = String(tags.tourism || "");
    const h = String(tags.historic || "");
    const s = String(tags.shop || "");
    if (a === "fuel") return "fuel";
    if (a === "pub") return "pub";
    if (a === "bar") return "bar";
    if (a === "cafe") return "cafe";
    if (a === "restaurant") return "restaurant";
    if (a === "fast_food") return "fast_food";
    if (t === "attraction") return "attraction";
    if (t === "museum") return "museum";
    if (t === "viewpoint") return "viewpoint";
    if (h === "castle") return "castle";
    if (s === "supermarket") return "supermarket";
    return "";
  }

  function poiGag(kind, name) {
    const list = FUN_GAG[kind] || ["figyelem, poénos hely"];
    let n = 0;
    const s = String(name || kind || "");
    for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0;
    const gag = list[Math.abs(n) % list.length];
    return (name ? name + " — " + cap(gag) : cap(gag)) + ".";
  }

  function showFunChip(text) {
    const chip = $("placeChip");
    const chipText = $("placeText");
    if (!chip || !chipText || !text) return;
    chip.hidden = false;
    chipText.textContent = text;
    chip.classList.add("is-fun");
    chip.classList.remove("is-town", "is-rural");
    state.funChipUntil = Date.now() + 9000;
  }

  function parseOverpassPois(data) {
    const out = [];
    (data && data.elements ? data.elements : []).forEach(function (el) {
      const tags = el.tags || {};
      const kind = poiKindFromTags(tags);
      if (!kind) return;
      const lat = Number(el.lat || (el.center && el.center.lat));
      const lon = Number(el.lon || (el.center && el.center.lon));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      out.push({
        id: String(el.type || "n") + "/" + el.id,
        lat: lat,
        lng: lon,
        kind: kind,
        name: tags.name || tags["name:hu"] || ""
      });
    });
    return out;
  }

  function maybeLoadFunPois() {
    if (!state.funPoi || !state.navigating || !state.origin) return;
    if (state.poiBusy) return;
    if (Date.now() - (state.poiAt || 0) < 40000) return;
    const lat = state.origin.lat;
    const lng = state.origin.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    state.poiBusy = true;
    state.poiAt = Date.now();
    const q =
      "[out:json][timeout:6];(" +
      "nwr(around:850," +
      lat.toFixed(5) +
      "," +
      lng.toFixed(5) +
      ')[amenity~"^(fuel|pub|bar|cafe|restaurant|fast_food)$"];' +
      "nwr(around:850," +
      lat.toFixed(5) +
      "," +
      lng.toFixed(5) +
      ')[tourism~"^(attraction|museum|viewpoint)$"];' +
      "nwr(around:850," +
      lat.toFixed(5) +
      "," +
      lng.toFixed(5) +
      ")[historic=castle];" +
      "nwr(around:850," +
      lat.toFixed(5) +
      "," +
      lng.toFixed(5) +
      ")[shop=supermarket];);out center 28;";
    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "data=" + encodeURIComponent(q)
    })
      .then(function (res) {
        if (!res.ok) throw new Error("poi");
        return res.json();
      })
      .then(function (data) {
        state.funPois = parseOverpassPois(data);
        state.poiBusy = false;
      })
      .catch(function () {
        state.poiBusy = false;
      });
  }

  function maybeSpeakFunPoi() {
    if (!state.funPoi || !state.navigating || !state.origin) return;
    if (state.funChipUntil && Date.now() < state.funChipUntil - 4000) return;
    const here = state.origin;
    let best = null;
    let bestD = 90;
    (state.funPois || []).forEach(function (p) {
      if (state.spokenPoi[p.id]) return;
      const d = haversine(here, p);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    });
    if (!best) return;
    state.spokenPoi[best.id] = true;
    const line = poiGag(best.kind, best.name);
    showFunChip(line);
    if (!state.voice) return;
    const nv = navVoice();
    if (nv && nv.isBusy()) return;
    if (nv) {
      nv.playCat("start");
      state.lastSpare = Date.now();
    }
  }

  function nearestFull(coords, point) {
    const saved = state.snapI;
    state.snapI = 0;
    const snap = nearest(coords, point);
    state.snapI = saved;
    return snap;
  }

  let voiceGen = 0;

  function speakGuidance(kind) {
    if (!state.voice || !kind || kind.skip) return;
    hushSpeech();
    const nv = navVoice();
    const gen = ++voiceGen;
    if (nv) nv.playCat(kind.cat);
    afterPack(function () {
      if (gen !== voiceGen || !state.navigating || !state.voice) return;
      const n2 = navVoice();
      if (n2 && !n2.isBusy()) n2.playCat("start");
    });
  }

  function afterPack(fn) {
    let n = 0;
    function tick() {
      const nv = navVoice();
      if (nv && nv.isBusy() && n < 120) {
        n += 1;
        setTimeout(tick, 250);
        return;
      }
      if (nv && nv.isBusy()) return;
      fn();
    }
    setTimeout(tick, 400);
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

  function makeCarEl() {
    const el = document.createElement("div");
    el.className = "car3d";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<svg viewBox="0 0 90 120" xmlns="http://www.w3.org/2000/svg">' +
      '<ellipse cx="45" cy="112" rx="26" ry="5" fill="rgba(0,0,0,.4)"/>' +
      '<path d="M16 78c1 18 8 26 29 26s28-8 29-26l2-24c1-14-7-24-31-24S14 40 14 54z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.7"/>' +
      '<path d="M24 52c1-8 7-13 21-13s20 5 21 13l1 16H23z" fill="#111827"/>' +
      '<path d="M20 74h50l-1 9c-2 10-10 14-24 14s-22-4-24-14z" fill="#e5e7eb"/>' +
      '<rect x="32" y="78" width="26" height="5" rx="1.3" fill="#111"/>' +
      '<rect x="19" y="70" width="12" height="6" rx="1.8" fill="#ef4444"/>' +
      '<rect x="59" y="70" width="12" height="6" rx="1.8" fill="#ef4444"/>' +
      '<path d="M18 62h10v12H19z" fill="#fff"/>' +
      '<path d="M62 62h10v12h-9z" fill="#fff"/>' +
      '<path d="M33 40h24c3 0 5 2 5 4v3H28v-3c0-2 2-4 5-4z" fill="#94a3b8"/>' +
      '<circle cx="22" cy="58" r="2.1" fill="#fbbf24"/>' +
      '<circle cx="68" cy="58" r="2.1" fill="#fbbf24"/>' +
      "</svg>";
    return el;
  }

  function snapLimit() {
    const acc = state.gpsAcc || 0;
    const fast = (state.speed || 0) > 22;
    return Math.max(fast ? 78 : 42, acc > 28 ? Math.min(90, acc + 22) : 42);
  }

  function offRouteLimit() {
    return Math.max(snapLimit() + 8, (state.speed || 0) > 22 ? 80 : 45);
  }

  function plausibleJump(prev, next, acc) {
    if (!prev || !prev.ll) return true;
    const dt = (next.t - prev.t) / 1000;
    if (!(dt > 0.12)) return true;
    const d = haversine(prev.ll, next.ll);
    const vmax = Math.max(prev.speed || 0, next.speed || 0, 8) + 12;
    const budget = vmax * dt + Math.max(acc || 0, 12) + 18;
    if (d > 420 && dt < 2.2) return false;
    return d <= budget * 2.4;
  }

  function setOrigin(lngLat, heading, speed) {
    const now = Date.now();
    const acc = state.gpsAcc || 0;
    const raw = { lng: lngLat.lng, lat: lngLat.lat };
    if (!plausibleJump(state.lastFix, { ll: raw, t: now, speed: speed || 0 }, acc)) {
      state.fixRejects = (state.fixRejects || 0) + 1;
      if (state.fixRejects < 3) return;
    }
    state.fixRejects = 0;
    state.lastFix = { ll: raw, t: now, speed: speed || 0 };

    if (Number.isFinite(speed) && speed >= 0) state.speed = speed;
    const kmh = (state.speed || 0) * 3.6;
    if (Number.isFinite(heading) && kmh >= 2) state.heading = heading;

    let display = raw;
    if (state.coords.length) {
      const snap = nearest(state.coords, raw);
      state.lastSnap = snap;
      const onRoad = snap.dist < snapLimit();
      if (onRoad) {
        const prevT = state.traveled || 0;
        let nextT = snap.traveled;
        if (nextT + 8 < prevT && snap.dist < 35) nextT = prevT;
        const maxFwd = Math.max(40, (state.speed || 0) * 2.5 + 25);
        if (prevT > 0 && nextT > prevT + maxFwd) nextT = prevT + maxFwd;
        state.traveled = nextT;
        const along = alongLine(state.coords, nextT);
        if (along) display = along;
        const br = snap.bearing;
        if (Number.isFinite(br) && (kmh >= 2 || state.navigating) && (!Number.isFinite(heading) || Math.abs(angDelta(heading, br)) < 70)) {
          state.heading = mixHeading(state.heading, br, kmh >= 2 ? 0.48 : 0.22);
        }
      } else if (snap.dist < offRouteLimit() && state.traveled > 0) {
        const along = alongLine(state.coords, state.traveled);
        if (along) display = along;
      }
      state.origin = display;
      drawRoute();
      updateNav();
      updateRoadFromRoute();
    } else {
      state.origin = display;
      locateRoad();
    }

    setTarget(display, state.heading);
    $("speed").hidden = false;
    $("kmh").textContent = String(Math.round(kmh));
    watchPark(raw, state.speed);
    paintCar();
    maybeLoadFunPois();
    maybeSpeakFunPoi();
    if (state.navigating) syncFloatMarks();
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
    paintCar();
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
    showShortcuts();
  }

  function satTileUrl() {
    return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  }

  function syncSatellite() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    const want = !!(state.ar && !state.mapOffline);
    if (want && !state.map.getSource("sat")) {
      state.map.addSource("sat", {
        type: "raster",
        tiles: [satTileUrl()],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Esri"
      });
      const layers = (state.map.getStyle() && state.map.getStyle().layers) || [];
      let beforeId = null;
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].type !== "background" && layers[i].id !== "sat") {
          beforeId = layers[i].id;
          break;
        }
      }
      const layer = {
        id: "sat",
        type: "raster",
        source: "sat",
        paint: { "raster-opacity": 0.76 }
      };
      try {
        if (beforeId) state.map.addLayer(layer, beforeId);
        else state.map.addLayer(layer);
      } catch (_e) {
        try {
          state.map.addLayer(layer);
        } catch (_e2) {}
      }
    }
    if (!want) {
      try {
        if (state.map.getLayer("sat")) state.map.removeLayer("sat");
        if (state.map.getSource("sat")) state.map.removeSource("sat");
      } catch (_e) {}
    }
  }

  function applySky() {
    if (!state.map) return;
    const dark = document.documentElement.classList.contains("dark") || localStorage.getItem(THEME_KEY) !== "light";
    const sky = dark ? "#0B1220" : "#64748b";
    const horizon = dark ? "#0F172A" : "#94a3b8";
    try {
      if (typeof state.map.setSky === "function") {
        state.map.setSky({
          "sky-color": sky,
          "horizon-color": horizon,
          "fog-color": sky,
          "sky-horizon-blend": 0.5,
          "horizon-fog-blend": 0.85,
          "fog-ground-blend": 0.45
        });
      }
    } catch (_e) {}
    try {
      if (typeof state.map.setFog === "function") {
        state.map.setFog({
          color: sky,
          "high-color": sky,
          "space-color": sky,
          "horizon-blend": 0.12,
          range: [0.8, 12]
        });
      }
    } catch (_e2) {}
  }

  function addLayers() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    applySky();
    syncSatellite();
    if (!state.map.getSource("route")) {
      state.map.addSource("route", { type: "geojson", data: EMPTY, lineMetrics: true });
      state.map.addLayer({
        id: "route-outline",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#04140c",
          "line-width": 18,
          "line-opacity": 0.95
        }
      });
      state.map.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#00ff66",
          "line-width": 22,
          "line-opacity": 0.3,
          "line-blur": 8
        }
      });
      state.map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#00ff66",
          "line-width": 12
        }
      });
    }
    if (state.coords.length) drawRoute();
    paintCar();
    applyRouteStyle();
    if (state.navigating) syncFloatMarks(true);
  }

  function routeColors() {
    if (state.kaland) {
      return { outline: "#3b1d04", glow: "#FBBF24", line: "#F59E0B" };
    }
    return { outline: "#04140c", glow: "#00ff66", line: "#00ff66" };
  }

  function applyRouteStyle() {
    if (!state.map || !state.map.getLayer("route-line")) return;
    const c = routeColors();
    try {
      if (state.map.getLayer("route-outline")) {
        state.map.setPaintProperty("route-outline", "line-color", c.outline);
        state.map.setPaintProperty("route-outline", "line-width", 18);
      }
      state.map.setPaintProperty("route-glow", "line-color", c.glow);
      state.map.setPaintProperty("route-glow", "line-width", 22);
      state.map.setPaintProperty("route-line", "line-color", c.line);
      state.map.setPaintProperty("route-line", "line-width", 12);
    } catch (_e) {}
  }

  function drawRoute() {
    const src = state.map.getSource("route");
    if (!src) return;
    src.setData(splitLine(state.coords, state.traveled));
  }

  function copyPose(p, heading) {
    return {
      lng: p.lng,
      lat: p.lat,
      heading: Number.isFinite(heading) ? heading : Number.isFinite(p.heading) ? p.heading : state.heading || 0
    };
  }

  function offsetLngLat(ll, heading, meters) {
    if (!ll || !Number.isFinite(meters) || meters === 0) return ll;
    const rad = toRad(Number.isFinite(heading) ? heading : 0);
    const dLat = (meters * Math.cos(rad)) / 111320;
    const cos = Math.cos(toRad(ll.lat)) || 1;
    const dLng = (meters * Math.sin(rad)) / (111320 * cos);
    return { lng: ll.lng + dLng, lat: ll.lat + dLat };
  }

  function lookAheadMeters() {
    const kmh = (state.speed || 0) * 3.6;
    if (state.ar) return Math.max(22, Math.min(56, 22 + kmh * 0.28));
    return Math.max(3, Math.min(10, 3 + kmh * 0.06));
  }

  function lookAhead(from, heading) {
    if (!from) return from;
    const m = lookAheadMeters();
    if (state.navigating && state.coords.length) {
      const p = alongLine(state.coords, (state.traveled || 0) + m);
      if (p) return p;
    }
    return offsetLngLat(from, heading, m);
  }

  function camPad() {
    const box = state.map ? state.map.getContainer() : null;
    const h = box ? box.clientHeight : window.innerHeight;
    const fabs = $("fabBar");
    let right = 8;
    if (fabs) {
      const r = fabs.getBoundingClientRect();
      if (r.left > 0) right = Math.max(8, Math.round(window.innerWidth - r.left + 6));
    }
    if (state.ar) {
      return { top: 6, bottom: 10, left: 6, right: 6 };
    }
    const top = Math.round(h * (state.navigating ? 0.46 : 0.18));
    const bottom = Math.round(h * (state.navigating ? 0.14 : 0.22));
    return { top: top, bottom: bottom, left: 8, right: right };
  }

  function placePuck(ll, heading) {
    if (!state.map || !ll) return;
    if (!state.puck) {
      state.puck = new maplibregl.Marker({ element: makeCarEl(), anchor: "center" })
        .setLngLat([ll.lng, ll.lat])
        .addTo(state.map);
    } else state.puck.setLngLat([ll.lng, ll.lat]);
    const mapBearing = state.map.getBearing();
    state.puck.setRotation((Number.isFinite(heading) ? heading : 0) - mapBearing);
  }

  let smoothRaf = 0;
  let smoothTs = 0;

  function startSmooth() {
    if (smoothRaf) return;
    smoothTs = 0;
    smoothRaf = requestAnimationFrame(tickSmooth);
  }

  function setTarget(ll, heading) {
    if (!ll) return;
    state.target = copyPose(ll, heading);
    if (!state.view) state.view = copyPose(state.target);
    startSmooth();
  }

  function tickSmooth(ts) {
    smoothRaf = requestAnimationFrame(tickSmooth);
    if (!state.map || !state.target) return;
    const dt = smoothTs ? Math.min(0.08, (ts - smoothTs) / 1000) : 0.016;
    smoothTs = ts;
    if (!state.view) state.view = copyPose(state.target);
    const k = 1 - Math.exp(-dt * 5.2);
    const v = state.view;
    const t = state.target;
    v.lng += (t.lng - v.lng) * k;
    v.lat += (t.lat - v.lat) * k;
    const kmh = (state.speed || 0) * 3.6;
    const remain = haversine(v, t);
    const turn = Number.isFinite(t.heading) ? Math.abs(angDelta(v.heading, t.heading)) : 0;
    const headingOk = (kmh >= 2 || state.navigating) && Number.isFinite(t.heading);
    if (headingOk && (remain >= 0.35 || turn > 3 || kmh >= 2)) {
      v.heading = mixHeading(v.heading, t.heading, Math.min(1, k * 1.35));
      state.camHeading = v.heading;
    } else if (!Number.isFinite(state.camHeading)) {
      state.camHeading = v.heading || t.heading || 0;
    }
    placePuck(v, v.heading);
    if (!state.follow) return;
    if (state.lastCam && ts - state.lastCam < 32) return;
    state.lastCam = ts;
    const zoom = state.ar
      ? kmh > 90 ? 15.8 : 16.4
      : kmh > 110 ? 16.9 : kmh > 70 ? 17.35 : kmh > 40 ? 17.8 : 18.2;
    const ahead = lookAhead(v, v.heading);
    try {
      state.map.jumpTo({
        center: [ahead.lng, ahead.lat],
        zoom: zoom,
        pitch: state.ar ? 52 : state.navigating ? 78 : 56,
        bearing: state.camHeading || 0,
        padding: camPad()
      });
    } catch (_e) {}
  }

  function updateCamera(force) {
    if (!state.origin) return;
    setTarget(state.origin, state.heading);
    if (force && state.target) {
      state.view = copyPose(state.target);
      if (((state.speed || 0) * 3.6 >= 2 || state.navigating) && Number.isFinite(state.target.heading)) {
        state.camHeading = state.target.heading;
        state.view.heading = state.camHeading;
      }
      placePuck(state.view, state.view.heading);
    }
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
    if (chip && chipText && !(state.funChipUntil && Date.now() < state.funChipUntil)) {
      chip.classList.remove("is-fun");
      chip.hidden = !label;
      chipText.textContent = label;
      chip.classList.toggle("is-town", urban === true);
      chip.classList.toggle("is-rural", urban === false);
    }
    const nxt = state.navigating && state.limits.length ? nextBoundary(state.traveled) : null;
    const roadThen = $("roadThen");
    const roadThenText = $("roadThenText");
    if (roadThen && roadThenText) {
      if (nxt && nxt.dist < 1600 && nxt.limit && nxt.limit !== limit) {
        roadThen.hidden = false;
        roadThenText.textContent = fmtDist(nxt.dist) + " múlva " + nxt.limit + " km/h";
      } else {
        roadThen.hidden = true;
      }
    }
    const hz = $("hazardThen");
    if (hz) hz.hidden = true;
    if (state.navigating && $("status") && !($("status").classList.contains("is-err") && /GPS/i.test($("status").textContent))) {
      const bits = [];
      if (label) bits.push(label);
      if (limit) bits.push(limit + " km/h");
      if (bits.length) setStatus(bits.join(" · "));
    }
    maybeSpeakRoad();
  }

  function clearFloatMarks() {
    (state.floatMarks || []).forEach(function (m) {
      try {
        m.remove();
      } catch (_e) {}
    });
    state.floatMarks = [];
    state.distMark = null;
    state.floatKey = "";
  }

  function makeFloatEl(kind, text) {
    const wrap = document.createElement("div");
    wrap.className = "float-mark";
    if (kind === "cam") {
      wrap.innerHTML = '<span class="float-cam" aria-hidden="true">◉</span>';
    } else if (kind === "limit") {
      wrap.innerHTML = '<span class="float-limit">' + String(text || "") + "</span>";
    } else {
      wrap.innerHTML = '<span class="float-dist">' + String(text || "") + "</span>";
    }
    return wrap;
  }

  function addFloatMark(ll, kind, text) {
    if (!state.map || !ll) return null;
    const mark = new maplibregl.Marker({
      element: makeFloatEl(kind, text),
      anchor: "bottom",
      pitchAlignment: "viewport",
      rotationAlignment: "viewport"
    })
      .setLngLat([ll.lng, ll.lat])
      .addTo(state.map);
    state.floatMarks.push(mark);
    return mark;
  }

  function sampleRoute(coords, everyM, maxPts) {
    const len = lineLen(coords);
    if (!len) return [];
    const step = Math.max(everyM, len / Math.max(2, maxPts));
    const out = [];
    for (let m = 0; m <= len; m += step) {
      const p = alongLine(coords, m);
      if (p) out.push(p);
    }
    return out;
  }

  function loadCameras(coords) {
    if (!coords || coords.length < 2) return;
    if (state.camBusy) return;
    state.camBusy = true;
    state.camAt = Date.now();
    const samples = sampleRoute(coords, 1800, 32);
    if (!samples.length) {
      state.camBusy = false;
      return;
    }
    let q = "[out:json][timeout:8];(";
    samples.forEach(function (p) {
      q +=
        "node(around:110," +
        p.lat.toFixed(5) +
        "," +
        p.lng.toFixed(5) +
        ")[highway=speed_camera];";
    });
    q += ");out;";
    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "data=" + encodeURIComponent(q)
    })
      .then(function (res) {
        if (!res.ok) throw new Error("cam");
        return res.json();
      })
      .then(function (data) {
        const seen = {};
        const out = [];
        (data && data.elements ? data.elements : []).forEach(function (el) {
          const id = String(el.type || "n") + "/" + el.id;
          if (seen[id]) return;
          const lat = Number(el.lat);
          const lon = Number(el.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const pt = { lng: lon, lat: lat };
          let bestD = Infinity;
          let bestT = 0;
          let acc = 0;
          for (let i = 1; i < coords.length; i++) {
            const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
            const b = { lng: coords[i][0], lat: coords[i][1] };
            const seg = haversine(a, b);
            const d = Math.min(haversine(pt, a), haversine(pt, b));
            if (d < bestD) {
              bestD = d;
              bestT = acc;
            }
            acc += seg;
          }
          if (bestD > 90) return;
          seen[id] = true;
          out.push({ id: id, lat: lat, lng: lon, traveled: bestT });
        });
        state.cameras = out;
        state.camBusy = false;
        syncFloatMarks(true);
      })
      .catch(function () {
        state.camBusy = false;
      });
  }

  function syncFloatMarks(force) {
    if (!state.map || !state.navigating || !state.coords.length) {
      if (state.floatMarks && state.floatMarks.length) clearFloatMarks();
      return;
    }
    const cur = nextActionable();
    const nxt = state.limits.length ? nextBoundary(state.traveled) : null;
    const key = [
      Math.round((state.traveled || 0) / 40),
      state.limits.length,
      state.cameras.length,
      cur ? Math.round(cur.until / 20) + ":" + cur.index : "x",
      nxt ? nxt.limit : "n"
    ].join("|");
    if (!force && key === state.floatKey) return;
    state.floatKey = key;
    clearFloatMarks();
    state.floatKey = key;
    let shown = 0;
    for (let i = 0; i < state.limits.length && shown < 5; i++) {
      const seg = state.limits[i];
      if (seg.start < (state.traveled || 0) - 15) continue;
      if (seg.start > (state.traveled || 0) + 2600) break;
      if (i > 0 && state.limits[i - 1].limit === seg.limit) continue;
      if (!seg.limit) continue;
      const p = alongLine(state.coords, Math.max(seg.start, (state.traveled || 0) + 18));
      if (!p) continue;
      addFloatMark(p, "limit", String(seg.limit));
      shown += 1;
    }
    (state.cameras || []).forEach(function (cam) {
      if (cam.traveled < (state.traveled || 0) - 30) return;
      if (cam.traveled > (state.traveled || 0) + 2200) return;
      addFloatMark(cam, "cam", "");
    });
    if (cur && cur.until < 1400) {
      const loc = cur.step && cur.step.maneuver && cur.step.maneuver.location;
      const p =
        loc && Number.isFinite(loc[0])
          ? { lng: loc[0], lat: loc[1] }
          : alongLine(state.coords, (state.traveled || 0) + Math.max(24, cur.until));
      if (p) {
        const extra = nxt && nxt.dist < 220 && nxt.limit ? " · " + nxt.limit : "";
        state.distMark = addFloatMark(p, "dist", fmtTurnDist(cur.until) + extra);
      }
    }
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
        syncFloatMarks(true);
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
      if (limitChanged && road.limit) announceLimit(road.limit);
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
    if (!cur) {
      if ($("lanes")) {
        $("lanes").hidden = true;
        $("lanes").innerHTML = "";
      }
      paintArHud();
      return;
    }
    const kind = cur.kind;
    const then = nextAfter(cur.index);
    const warn = warnMeters(kind);
    $("banner").hidden = false;
    $("banner").classList.toggle("is-now", cur.until <= Math.min(90, warn));
    $("turnIcon").textContent = kind.icon;
    $("turnDist").textContent = fmtTurnDist(cur.until);
    $("turnText").textContent = kind.label;
    $("turnStreet").textContent = kind.street || "";
    paintLanes(kind.highway);
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
    paintArHud();
    syncFloatMarks();
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
      avoidMotorway: !!( ($("avoidMotorway") && $("avoidMotorway").checked) || state.kaland ),
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
    if (state.kaland) return reroute ? "Kaland: újratervezés autópálya nélkül…" : "Kaland útvonal…";
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
    const rad = Math.max(25, Math.min(80, Math.round((state.gpsAcc || 35) + 8)));
    const baseSnap = "&continue_straight=true&radiuses=" + rad + ";" + rad;
    function pathWith(snapQs) {
      return (
        from.lng +
        "," +
        from.lat +
        ";" +
        to.lng +
        "," +
        to.lat +
        "?overview=full&geometries=geojson&steps=true" +
        snapQs +
        (extraQs || "")
      );
    }
    function tryPath(snapQs) {
      const path = pathWith(snapQs);
      const jobs = OSRM.map(function (base) {
        return fetchJson(base + "/" + path, null, 6500).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        }).then(function (data) {
          if (data.code !== "Ok" || !data.routes || !data.routes[0]) throw new Error("Nincs útvonal");
          return data.routes[0];
        });
      });
      return Promise.any(jobs);
    }
    try {
      if (state.navigating && Number.isFinite(state.heading) && (state.speed || 0) > 3) {
        const range = (state.speed || 0) > 8 ? 35 : 60;
        try {
          return await tryPath(baseSnap + "&bearings=" + Math.round(state.heading) + "," + range + ";");
        } catch (_e) {}
      }
      return await tryPath(baseSnap);
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

  function valhallaLoc(point, withHeading) {
    const loc = {
      lon: point.lng,
      lat: point.lat,
      radius: Math.max(20, Math.min(70, Math.round(state.gpsAcc || 35)))
    };
    if (withHeading && Number.isFinite(state.heading) && (state.speed || 0) > 3) {
      loc.heading = Math.round(state.heading);
    }
    return loc;
  }

  async function fetchValhalla(from, to) {
    const body = {
      locations: [
        valhallaLoc(from, true),
        valhallaLoc(to, false)
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
      state.spokenLimit = 0;
      state.spokenHazard = "";
      state.lastSpeedWarn = 0;
      state.arrived = false;
      addLayers();
      drawRoute();
      state.cameras = [];
      clearFloatMarks();
      loadRoadProfile(state.coords);
      loadCameras(state.coords);
      if (reroute) {
        const o = routeOpts();
        setStatus(
          state.kaland
            ? "Kaland útvonal, autópálya nélkül."
            : o.avoidMotorway && o.avoidToll
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
    state.spokenPoi = {};
    state.funPois = [];
    state.poiAt = 0;
    armVoice();
    hushSpeech();
    setStatus(state.kaland ? "Kaland mód" : "Navigáció");
    hushSpeech();
    playWarnBeep(1);
    const nv = navVoice();
    state.lastSpare = Date.now();
    if (state.voice && nv) nv.playCat("start");
    else if (state.voice) speakRoad("Navigáció indul");
    updateNav();
    updateRoadFromRoute();
    updateCamera(true);
    paintArHud();
    maybeLoadFunPois();
    loadCameras(state.coords);
    syncFloatMarks(true);
    armWake();
  }

  let wakeLock = null;
  let wakeTimer = 0;

  function dropWake() {
    if (wakeTimer) {
      clearInterval(wakeTimer);
      wakeTimer = 0;
    }
    if (wakeLock) {
      try {
        wakeLock.release();
      } catch (_e) {}
      wakeLock = null;
    }
  }

  function holdWake() {
    if (!state.navigating || !navigator.wakeLock) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () {
        wakeLock = null;
        if (state.navigating) holdWake();
      });
    }).catch(function () {});
  }

  function armWake() {
    holdWake();
    if (wakeTimer) clearInterval(wakeTimer);
    wakeTimer = setInterval(holdWake, 20000);
  }

  function stopNav(opts) {
    state.navigating = false;
    state.pendingPlan = false;
    $("app").classList.remove("is-nav");
    $("trip").hidden = true;
    $("banner").hidden = true;
    if ($("lanes")) {
      $("lanes").hidden = true;
      $("lanes").innerHTML = "";
    }
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
    paintArHud();
    state.funPois = [];
    state.spokenPoi = {};
    state.funChipUntil = 0;
    state.cameras = [];
    clearFloatMarks();
    if ($("placeChip")) $("placeChip").classList.remove("is-fun");
    if (state.lastFix && state.lastFix.ll) saveCar(state.lastFix.ll);
    else if (state.origin) saveCar(state.origin);
    state.drove = false;
    state.stillSince = 0;
    paintCar();
    spyNav();
    if (state.map) state.map.resize();
    syncBack(opts && opts.fromPop);
    dropWake();
  }

  function maybeReroute() {
    if (!state.navigating || !state.origin || !state.dest || state.planning) return;
    if (!state.coords.length) return plan(true);
    const snap = state.lastSnap || nearest(state.coords, state.origin);
    const limit = offRouteLimit();
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
    const c = pos.coords;
    const acc = Number(c.accuracy);
    state.gpsAcc = acc;
    const raw = { lat: c.latitude, lng: c.longitude };
    let spd = c.speed;
    if ((spd == null || isNaN(spd) || spd < 0) && state.lastFix) {
      const dt = (Date.now() - state.lastFix.t) / 1000;
      if (dt > 0.4 && dt < 8) spd = haversine(state.lastFix.ll, raw) / dt;
    }
    if (spd == null || isNaN(spd) || spd < 0) spd = state.speed || 0;
    setOrigin(raw, c.heading, spd);
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
      [street, /kerület/i.test(String(p.district || "")) ? p.district : "", p.city || p.county, p.country],
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
      [street, a.suburb || a.neighbourhood, city, a.country],
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
      if (p.shortcut) btn.className = "is-shortcut";
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
    paintCar();
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
    if (/autó|auto|kocsi/i.test(q)) {
      const car = carPlace();
      if (car) list.unshift(car);
    }
    showResults(list);
    return list;
  }

  async function onSearch(e) {
    e.preventDefault();
    const q = String($("q").value || "").trim();
    if (!q) {
      showShortcuts();
      if (!carPlace()) setStatus("Írj be egy címet.", true);
      return;
    }
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
      showShortcuts();
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
    try {
      state.kaland = localStorage.getItem(KALAND_KEY) === "1";
      if ($("kalandCheck")) $("kalandCheck").checked = state.kaland;
      if ($("app")) $("app").classList.toggle("is-kaland", state.kaland);
    } catch (_e2) {}
    try {
      const fun = localStorage.getItem(FUNPOI_KEY);
      state.funPoi = fun !== "0";
      if ($("funPoiCheck")) $("funPoiCheck").checked = state.funPoi;
    } catch (_e3) {}
  }

  function saveNavOpts() {
    localStorage.setItem(
      OPTS_KEY,
      JSON.stringify({
        avoidMotorway: !!( $("avoidMotorway") && $("avoidMotorway").checked ),
        avoidToll: !!( $("avoidToll") && $("avoidToll").checked )
      })
    );
  }

  function applyKaland(on) {
    state.kaland = !!on;
    try {
      localStorage.setItem(KALAND_KEY, state.kaland ? "1" : "0");
    } catch (_e) {}
    const app = $("app");
    const check = $("kalandCheck");
    if (app) app.classList.toggle("is-kaland", state.kaland);
    if (check) check.checked = state.kaland;
    applyRouteStyle();
    setStatus(state.kaland ? "Kaland mód be" : "Kaland mód ki");
    if (state.origin && state.dest) plan(true);
  }

  function applyFunPoi(on) {
    state.funPoi = !!on;
    try {
      localStorage.setItem(FUNPOI_KEY, state.funPoi ? "1" : "0");
    } catch (_e) {}
    const check = $("funPoiCheck");
    if (check) check.checked = state.funPoi;
    if (!state.funPoi) {
      state.funPois = [];
      state.funChipUntil = 0;
    } else if (state.navigating) {
      state.poiAt = 0;
      maybeLoadFunPois();
    }
  }

  function loadPlaces() {
    try {
      state.places = Object.assign({ home: null, work: null }, JSON.parse(localStorage.getItem(PLACE_KEY) || "{}"));
    } catch (_e) {
      state.places = { home: null, work: null };
    }
    loadCar();
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

  function paintArHud() {
    const hint = $("arHint");
    const hud = $("arHud");
    const arrow = $("arArrow");
    const dist = $("arDist");
    const street = $("arStreet");
    const road = $("arRoad");
    if (hint) hint.textContent = camVideoLive() ? "Dashcam" : "360°";
    if (!state.ar || !state.navigating) {
      if (hud) hud.hidden = true;
      if (road) road.hidden = true;
      return;
    }
    const cur = nextActionable();
    if (!cur || !cur.kind) {
      if (hud) hud.hidden = true;
      if (road) road.hidden = true;
      return;
    }
    const kind = cur.kind;
    const soon = cur.until <= Math.min(90, warnMeters(kind));
    if (hud) hud.hidden = false;
    if (arrow) arrow.textContent = kind.icon || "↑";
    if (dist) dist.textContent = fmtTurnDist(cur.until);
    if (street) street.textContent = kind.street || kind.label || "";
    if (road) {
      road.hidden = kind.cat === "arrive";
      road.classList.toggle("is-left", /left|uturn/i.test(kind.cat || ""));
      road.classList.toggle("is-right", /right/i.test(kind.cat || "") || kind.cat === "roundabout");
      road.classList.toggle("is-uturn", kind.cat === "uturn");
      road.classList.toggle("is-now", soon);
    }
  }

  function tryDashcam() {
    if (!state.ar || native360Pinned()) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    if (camVideoLive()) return;
    function start() {
      if (!state.ar) return;
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        })
        .then(function (stream) {
          if (!state.ar) {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
            return;
          }
          const v = $("arCam");
          if (v) {
            v.srcObject = stream;
            const play = v.play();
            if (play && play.catch) play.catch(function () {});
          }
          const root = $("app");
          if (root) root.classList.add("has-ar-cam");
          markCamOk();
        })
        .catch(function () {});
    }
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "camera" })
        .then(function (st) {
          if (st.state === "granted") start();
        })
        .catch(function () {});
    }
  }

  function native360Pinned() {
    try {
      const q = new URLSearchParams(location.search);
      const raw = q.get("360") || q.get("cam");
      if (raw === "0") {
        try {
          localStorage.removeItem(CAM_KEY);
        } catch (_e) {}
        return false;
      }
      if (raw === "1") {
        try {
          localStorage.setItem(CAM_KEY, "1");
        } catch (_e) {}
        return true;
      }
      if (raw === "clear") {
        const app = $("app");
        if (app) app.classList.add("is-ar-clear");
        try {
          localStorage.setItem(CAM_KEY, "1");
        } catch (_e) {}
        return true;
      }
    } catch (_e) {}
    try {
      if (localStorage.getItem(CAM_KEY) === "1") return true;
    } catch (_e) {}
    return false;
  }

  function camVideoLive() {
    const v = $("arCam");
    if (!v) return false;
    if (v.readyState >= 2 && v.videoWidth > 0) return true;
    if (!v.paused && v.currentTime > 0) return true;
    return false;
  }

  function applyCamLayout() {
    const app = $("app");
    const stage = $("arStage");
    const led = $("arLed");
    const hideWell = !state.ar || state.cameraError;
    if (app) app.classList.toggle("is-ar-full", !!(state.ar && state.cameraError));
    if (stage) stage.hidden = hideWell;
    if (led) led.hidden = !(state.ar && state.cameraError);
    if (!state.ar || state.cameraError) {
      const root = $("app");
      if (root) root.classList.remove("has-ar-cam");
    }
    if (state.map) {
      try {
        state.map.resize();
      } catch (_e) {}
      if (state.follow) updateCamera(true);
    }
  }

  function markCamOk() {
    state.camBeat = Date.now();
    if (!state.ar) return;
    state.cameraError = false;
    applyCamLayout();
  }

  function markCamError() {
    if (!state.ar || state.cameraError) return;
    state.cameraError = true;
    applyCamLayout();
  }

  function stopCamWatch() {
    if (state.camTimer) {
      clearInterval(state.camTimer);
      state.camTimer = 0;
    }
    state.cameraError = false;
    state.camBeat = 0;
    const v = $("arCam");
    if (v) {
      try {
        v.pause();
      } catch (_e) {}
      if (v.srcObject && v.srcObject.getTracks) {
        v.srcObject.getTracks().forEach(function (t) {
          t.stop();
        });
      }
      v.removeAttribute("src");
      v.srcObject = null;
    }
    const root = $("app");
    if (root) root.classList.remove("has-ar-cam", "is-ar-full");
    if ($("arLed")) $("arLed").hidden = true;
  }

  function bindCamVideo() {
    const v = $("arCam");
    if (!v || v.getAttribute("data-bound") === "1") return;
    v.setAttribute("data-bound", "1");
    ["playing", "timeupdate", "loadeddata", "canplay"].forEach(function (ev) {
      v.addEventListener(ev, function () {
        if (!camVideoLive()) return;
        const root = $("app");
        if (root) root.classList.add("has-ar-cam");
        markCamOk();
      });
    });
    v.addEventListener("error", function () {
      const root = $("app");
      if (root) root.classList.remove("has-ar-cam");
      if (state.ar && !native360Pinned()) markCamError();
    });
    ["stalled", "emptied", "suspend"].forEach(function (ev) {
      v.addEventListener(ev, function () {
        const root = $("app");
        if (root) root.classList.remove("has-ar-cam");
      });
    });
  }

  function watchCam() {
    bindCamVideo();
    if (state.camTimer) {
      clearInterval(state.camTimer);
      state.camTimer = 0;
    }
    if (!state.ar) return;
    state.cameraError = false;
    state.camBeat = Date.now();
    applyCamLayout();
    tryDashcam();
    if (native360Pinned()) return;
    state.camTimer = setInterval(function () {
      if (!state.ar) return;
      if (native360Pinned() || camVideoLive()) {
        state.camBeat = Date.now();
        if (state.cameraError) {
          state.cameraError = false;
          applyCamLayout();
        }
        return;
      }
      if (state.camBeat && Date.now() - state.camBeat >= 3000) markCamError();
    }, 400);
  }

  function applyAr(on) {
    state.ar = !!on;
    try {
      localStorage.setItem(AR_KEY, state.ar ? "1" : "0");
    } catch (_e) {}
    const app = $("app");
    const btn = $("arBtn");
    const check = $("arCheck");
    if (app) app.classList.toggle("is-ar", state.ar);
    if (btn) {
      btn.classList.toggle("is-on", state.ar);
      btn.setAttribute("aria-pressed", state.ar ? "true" : "false");
    }
    if (check) check.checked = state.ar;
    if (state.ar) {
      if (app) app.classList.add("is-ar-clear");
      state.follow = true;
      if ($("follow")) {
        $("follow").classList.add("is-on");
        $("follow").setAttribute("aria-pressed", "true");
      }
      paintArHud();
      watchCam();
    } else {
      stopCamWatch();
      if (app) app.classList.remove("is-ar-clear");
      if ($("arStage")) $("arStage").hidden = true;
    }
    if (state.map) {
      syncSatellite();
      try {
        state.map.resize();
      } catch (_e) {}
      updateCamera(true);
    }
  }

  window.Nav360 = {
    beat: markCamOk,
    ok: markCamOk,
    error: markCamError,
    present: function () {
      try {
        localStorage.setItem(CAM_KEY, "1");
      } catch (_e) {}
      markCamOk();
    },
    clear: function () {
      const app = $("app");
      if (app) app.classList.add("is-ar-clear");
      try {
        localStorage.setItem(CAM_KEY, "1");
      } catch (_e) {}
      markCamOk();
    }
  };

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
      pitch: 56,
      maxPitch: 85,
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
    if ($("arBtn")) {
      $("arBtn").addEventListener("click", function () {
        applyAr(!state.ar);
      });
    }
    if ($("arCheck")) {
      $("arCheck").addEventListener("change", function () {
        applyAr($("arCheck").checked);
      });
    }
    window.addEventListener("message", function (ev) {
      const d = ev && ev.data;
      if (!d || (d.source !== "nav360" && d.type !== "nav360")) return;
      if (d.state === "error" || d.ok === false) markCamError();
      else markCamOk();
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
    function paintVoiceBtn() {
      const btn = $("voiceBtn");
      if (!btn) return;
      btn.classList.toggle("is-on", !!state.voice);
      btn.setAttribute("aria-pressed", state.voice ? "true" : "false");
      if ($("voiceCheck")) $("voiceCheck").checked = !!state.voice;
    }
    paintVoiceBtn();
    $("voiceCheck").addEventListener("change", () => {
      state.voice = $("voiceCheck").checked;
      paintVoiceBtn();
      if (!state.voice) {
        const nv = navVoice();
        if (nv) nv.stop();
        return;
      }
      hushSpeech();
    });
    if ($("voiceBtn")) {
      $("voiceBtn").addEventListener("click", function () {
        state.voice = !state.voice;
        paintVoiceBtn();
        if (!state.voice) {
          const nv = navVoice();
          if (nv) nv.stop();
          setStatus("Hang ki");
          return;
        }
        armVoice();
        hushSpeech();
        setStatus("Hang be");
      });
    }
    document.querySelectorAll("[data-voice]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const nv = navVoice();
        const key = btn.getAttribute("data-voice");
        if (nv) nv.playPhrase(key);
        else setStatus("A hangmodul nem töltődött be.", true);
      });
    });
    bindPoen();
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
    window.addEventListener("resize", function () {
      if (state.map) state.map.resize();
      if (state.navigating && state.follow) updateCamera(true);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && state.navigating) holdWake();
    });
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
    if ($("kalandCheck")) {
      $("kalandCheck").addEventListener("change", function () {
        applyKaland($("kalandCheck").checked);
      });
    }
    if ($("funPoiCheck")) {
      $("funPoiCheck").addEventListener("change", function () {
        applyFunPoi($("funPoiCheck").checked);
        setStatus(state.funPoi ? "Poénos POI be" : "Poénos POI ki");
      });
    }
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
      if (mgr) mgr.onJoke = setPoenNow;
      fillPoen();
    }).catch((err) => console.warn("[NavVoice] init", err));
  }

  function initGps() {
    if (!navigator.geolocation) setStatus("Nincs GPS ebben a böngészőben.", true);
    else {
      const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 };
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
        try {
          if (localStorage.getItem(AR_KEY) === "1") applyAr(true);
        } catch (_e) {}
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

  window.NavDrive = {
    ready: function () {
      return new Promise(function (resolve) {
        let n = 0;
        (function tick() {
          if (state.map) return resolve(true);
          if (n++ > 80) return resolve(false);
          setTimeout(tick, 100);
        })();
      });
    },
    poke: function (lng, lat, heading, speed) {
      state.gpsAcc = 8;
      setOrigin({ lng: lng, lat: lat }, heading, speed);
    },
    go: function (lng, lat, label) {
      if (!state.map) return Promise.reject(new Error("nincs térkép"));
      setDest({ lng: lng, lat: lat }, label || "Cél");
      return plan(false);
    },
    road: function (limit) {
      applyRoad({ limit: Number(limit) || 70, urban: true, cls: "residential", start: 0, end: 1e9 }, true);
    }
  };

  boot();
})();
