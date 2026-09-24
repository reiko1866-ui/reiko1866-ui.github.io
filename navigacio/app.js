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
  const LOCAL_STYLE = "./map/style.json";
  const OFF_ROUTE_M = 35;
  const POS_LERP = 0.1;
  const HEAD_LERP = 0.1;
  const GPS_CORRECT = 0.48;
  const COAST_MIN_SPEED = 0.35;
  const DEADBAND_KMH = 3;
  const DEADBAND_MS = 0.83;
  const PATH_HEADING_KMH = 5;
  const SIM_KMH = 50;
  const SIM_MS = SIM_KMH / 3.6;
  const CAR_LS_KEY = "selectedCar";
  const GARAGE_LS_KEY = "nav2_car_model";
  const TOMTOM_API_KEY = "oE6c7oDmIR80A8Vsr4o96nBlcqNRs3vD";
  const TOMTOM_POLL_MS = 20000;

  function readSelectedCar() {
    try {
      const id = String(localStorage.getItem(CAR_LS_KEY) || localStorage.getItem(GARAGE_LS_KEY) || "verso");
      return id || "verso";
    } catch (_e) {
      return "verso";
    }
  }

  const AppState = {
    currentPos: { lat: BUDAPEST[1], lng: BUDAPEST[0], bearing: 0 },
    targetPos: { lat: BUDAPEST[1], lng: BUDAPEST[0], bearing: 0 },
    activeRoute: null,
    selectedCar: readSelectedCar(),
    snappedPosition: null,
    speed: 0,
    accuracy: 0
  };
  window.AppState = AppState;

  const $ = (id) => document.getElementById(id);

  function on(target, type, fn, opts) {
    try {
      const el = typeof target === "string" ? document.getElementById(target) : target;
      if (!el || typeof el.addEventListener !== "function") return false;
      el.addEventListener(type, fn, opts);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function openDrawer() {
    const drawer = $("mobileDrawer");
    const overlay = $("drawerOverlay");
    if (drawer) drawer.classList.add("open");
    if (overlay) overlay.classList.add("open");
    if ($("hamburgerBtn")) $("hamburgerBtn").setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    armBack();
    paintGarage();
    window.requestAnimationFrame(function () {
      if (window.NavCar3D && typeof window.NavCar3D.mountGarage === "function") {
        window.NavCar3D.mountGarage($("garageGrid"));
      }
    });
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
    const drawer = $("mobileDrawer");
    const overlay = $("drawerOverlay");
    if (drawer) drawer.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
    if ($("hamburgerBtn")) $("hamburgerBtn").setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    try {
      if (window.NavCar3D && typeof window.NavCar3D.stopGarage === "function") {
        window.NavCar3D.stopGarage();
      }
    } catch (_e) {}
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
    ar: false,
    cameraError: false,
    camBeat: 0,
    camTimer: 0,
    navigating: false,
    planning: false,
    route: null,
    coords: [],
    steps: [],
    traveled: 0,
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
    pinDragging: false,
    pendingPlan: false,
    needPlan: false,
    histArmed: false,
    ignorePop: false,
    places: { home: null, work: null },
    limits: [],
    road: { limit: 0, urban: null, cls: "", start: 0, end: 0, posted: false, grade: 0 },
    place: "",
    snapI: 1,
    routeLen: 0,
    lastSnap: null,
    rawGps: null,
    simulating: false,
    lastLocate: 0,
    lastPlaceAt: 0,
    lastUrban: null,
    lastLimitShown: 0,
    roadBusy: false,
    audioCue: {},
    lastSpeedWarn: 0,
    kaland: false,
    cameras: [],
    camBusy: false,
    camAt: 0,
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
    hazards: [],
    mapOffline: false,
    lastOsrmUrl: "",
    carModel: readSelectedCar(),
    carLean: 0,
    leanHeading: null,
    leanAt: 0
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

  function routeTangent(coords, traveled) {
    if (!coords || coords.length < 2) return Number(state.heading) || 0;
    let acc = 0;
    const at = Number(traveled) || 0;
    for (let i = 1; i < coords.length; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversine(a, b) || 1;
      if (acc + seg >= at) return bearing(a, b);
      acc += seg;
    }
    const n = coords.length;
    return bearing(
      { lng: coords[n - 2][0], lat: coords[n - 2][1] },
      { lng: coords[n - 1][0], lat: coords[n - 1][1] }
    );
  }

  function lockToRoute(raw, opts) {
    opts = opts || {};
    if (!state.coords || state.coords.length < 2) return null;
    if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
    const snap = nearest(state.coords, raw);
    state.lastSnap = snap;
    const prevT = state.traveled || 0;
    let nextT = Number.isFinite(snap.traveled) ? snap.traveled : prevT;
    if (!opts.fromSmooth && !state.simulating) {
      if (nextT + 8 < prevT && snap.dist < 50) nextT = prevT;
      const maxFwd = Math.max(40, (opts.speed || state.speed || 0) * 3 + 25);
      if (prevT > 0 && nextT > prevT + maxFwd) nextT = prevT + maxFwd;
      state.traveled = nextT;
    } else {
      nextT = state.traveled || nextT;
    }
    const along = alongLine(state.coords, nextT);
    if (!along) return null;
    const pathBr = Number.isFinite(snap.bearing) ? snap.bearing : routeTangent(state.coords, nextT);
    const kmh = (opts.speed != null ? opts.speed : state.speed || 0) * 3.6;
    let br = pathBr;
    if (!state.simulating && kmh >= PATH_HEADING_KMH && Number.isFinite(opts.heading)) {
      if (Math.abs(angDelta(opts.heading, pathBr)) < 80) {
        br = mixHeading(opts.heading, pathBr, 0.7);
      }
    }
    AppState.snappedPosition = {
      lat: along.lat,
      lng: along.lng,
      dist: snap.dist,
      traveled: nextT,
      bearing: pathBr
    };
    return { lat: along.lat, lng: along.lng, bearing: br, traveled: nextT, dist: snap.dist };
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

  function cleanStreet(name) {
    const s = String(name || "").trim();
    if (!s || s === "-" || s === "—") return "";
    if (/^unnamed/i.test(s) || /névtelen|út nélküli/i.test(s)) return "";
    if (/^(road|street|path|track|footway|cycleway|service)$/i.test(s)) return "";
    return s;
  }

  function classify(step) {
    const type = String((step && step.maneuver && step.maneuver.type) || "").toLowerCase();
    const mod = String((step && step.maneuver && step.maneuver.modifier) || "").toLowerCase();
    const exit = Number(step && step.maneuver && step.maneuver.exit) || 0;
    const street = cleanStreet((step && step.name) || "");
    const base = {
      street: street,
      exit,
      lane: laneHint(step),
      skip: false,
      highway: false
    };

    if (type === "arrive") {
      return Object.assign(base, {
        cat: "arrive",
        icon: "●",
        label: "Megérkeztél"
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
        label: "Haladj tovább"
      });
    }
    if (type.includes("uturn") || mod.includes("uturn")) {
      return Object.assign(base, {
        cat: "uturn",
        icon: "↩",
        label: "Fordulj vissza"
      });
    }
    if (type.includes("roundabout") || type.includes("rotary")) {
      return Object.assign(base, {
        cat: "roundabout",
        icon: "↻",
        label: exit ? "Körforgalom, " + exit + ". kijárat" : "Körforgalom"
      });
    }
    if (type.includes("ferry")) {
      const off = type.includes("exit") || mod.includes("off") || type.includes("end");
      return Object.assign(base, {
        cat: off ? "ferryOff" : "ferryOn",
        icon: "⛴",
        label: off ? "Hajts le a kompról" : "Hajts fel a kompra"
      });
    }
    if (type.includes("on ramp") || type === "merge") {
      return Object.assign(base, {
        cat: "motorwayOn",
        highway: true,
        icon: "↗",
        label: "Hajts fel"
      });
    }
    if (type.includes("off ramp")) {
      const left = mod.includes("left");
      return Object.assign(base, {
        cat: "motorwayOff",
        highway: true,
        icon: "↘",
        label: left ? "Hajts le balra" : "Hajts le jobbra"
      });
    }
    if (type === "fork" || type === "end of road") {
      if (mod.includes("left")) {
        return Object.assign(base, {
          cat: "leftKeep",
          icon: "↰",
          label: "Tarts balra"
        });
      }
      return Object.assign(base, {
        cat: "rightKeep",
        icon: "↱",
        label: "Tarts jobbra"
      });
    }
    if (mod.includes("sharp") && mod.includes("left")) {
      return Object.assign(base, {
        cat: "leftSharp",
        icon: "↰",
        label: "Élesen balra"
      });
    }
    if (mod.includes("sharp") && mod.includes("right")) {
      return Object.assign(base, {
        cat: "rightSharp",
        icon: "↱",
        label: "Élesen jobbra"
      });
    }
    if ((mod.includes("slight") || mod.includes("bear")) && mod.includes("left")) {
      return Object.assign(base, {
        cat: "leftKeep",
        icon: "↰",
        label: "Tarts balra"
      });
    }
    if ((mod.includes("slight") || mod.includes("bear")) && mod.includes("right")) {
      return Object.assign(base, {
        cat: "rightKeep",
        icon: "↱",
        label: "Tarts jobbra"
      });
    }
    if (mod.includes("left")) {
      return Object.assign(base, {
        cat: "left",
        icon: "↰",
        label: "Fordulj balra"
      });
    }
    if (mod.includes("right")) {
      return Object.assign(base, {
        cat: "right",
        icon: "↱",
        label: "Fordulj jobbra"
      });
    }
    if (type === "turn" || type === "straight") {
      return Object.assign(base, {
        skip: true,
        cat: "straight",
        icon: "↑",
        label: "Haladj tovább"
      });
    }
    return Object.assign(base, {
      skip: true,
      cat: "straight",
      icon: "↑",
      label: "Haladj tovább"
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

  function makeEl(cls) {
    const el = document.createElement("div");
    el.className = cls;
    if (cls === "pin") {
      el.className = "pin pin-3d";
      el.innerHTML = '<span class="pin-shadow"></span><span class="pin-stick"></span><span class="pin-head"></span>';
    }
    return el;
  }

  function carIconHtml(id, suffix) {
    if (window.NavCar3D && typeof window.NavCar3D.iconSvg === "function") {
      return window.NavCar3D.iconSvg(id || window.NavCar3D.id(), suffix);
    }
    return "";
  }

  function makeCarEl() {
    const el = document.createElement("div");
    el.className = "car3d";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = carIconHtml(state.carModel || (window.NavCar3D && window.NavCar3D.id()), "puck");
    return el;
  }

  function paintPuckIcon() {
    if (!state.puck) return;
    const el = state.puck.getElement();
    if (!el) return;
    el.innerHTML = carIconHtml(state.carModel || (window.NavCar3D && window.NavCar3D.id()), "puck");
  }

  function snapLimit() {
    const acc = state.gpsAcc || 0;
    const fast = (state.speed || 0) > 22;
    return Math.max(fast ? 78 : 42, acc > 28 ? Math.min(90, acc + 22) : 42);
  }

  function offRouteLimit() {
    return Math.max(snapLimit() + 8, (state.speed || 0) > 22 ? 80 : 45);
  }

  function snappedPosition() {
    if (!state.coords.length) {
      AppState.snappedPosition = null;
      return null;
    }
    const snap = state.lastSnap;
    const along = alongLine(state.coords, state.traveled || (snap && snap.traveled) || 0);
    if (!along || !Number.isFinite(along.lat) || !Number.isFinite(along.lng)) {
      AppState.snappedPosition = null;
      return null;
    }
    const pos = {
      lat: along.lat,
      lng: along.lng,
      dist: snap && Number.isFinite(snap.dist) ? snap.dist : 0,
      traveled: state.traveled || (snap && snap.traveled) || 0,
      bearing: (snap && snap.bearing) || routeTangent(state.coords, state.traveled || 0)
    };
    AppState.snappedPosition = pos;
    return pos;
  }

  function isSnappedToRoute() {
    return !!snappedPosition();
  }

  function unlockNavVoice() {
    if (window.NavVoice && typeof window.NavVoice.unlock === "function") {
      window.NavVoice.unlock();
    }
  }

  function playNavCue(eventId, key) {
    if (!eventId || !window.NavVoice || typeof window.NavVoice.playEvent !== "function") return;
    if (key) {
      if (state.audioCue[key] === eventId) return;
      state.audioCue[key] = eventId;
    }
    unlockNavVoice();
    window.NavVoice.playEvent(eventId);
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

  function setOrigin(lngLat, heading, speed, fromSmooth) {
    if (Number.isFinite(speed) && speed >= 0) {
      state.speed = speed;
      AppState.speed = speed;
    }
    const kmh = (state.speed || 0) * 3.6;
    let display = { lng: lngLat.lng, lat: lngLat.lat };
    if (state.coords.length >= 2) {
      const locked = lockToRoute(display, {
        speed: state.speed,
        heading: heading,
        fromSmooth: !!fromSmooth
      });
      if (locked) {
        display = { lng: locked.lng, lat: locked.lat };
        if (state.simulating || kmh < PATH_HEADING_KMH) state.heading = locked.bearing;
        else state.heading = locked.bearing;
      } else if (Number.isFinite(heading) && kmh >= PATH_HEADING_KMH) {
        state.heading = heading;
      }
      state.origin = display;
      drawRoute();
      updateNav();
      updateRoadFromRoute();
    } else {
      if (Number.isFinite(heading) && kmh >= PATH_HEADING_KMH) state.heading = heading;
      else if (Number.isFinite(heading) && !Number.isFinite(state.heading)) state.heading = heading;
      state.origin = display;
      locateRoad();
      AppState.snappedPosition = null;
    }

    $("speed").hidden = false;
    $("kmh").textContent = String(Math.round(kmh));
    if (window.NavCar3D && window.NavCar3D.setSpeed) window.NavCar3D.setSpeed(state.speed);
    paintCar();
    if (state.navigating) syncFloatMarks();
  }

  function setDest(lngLat, label) {
    state.dest = lngLat;
    state.destLabel = label || "";
    if ($("destName")) $("destName").textContent = state.destLabel || "Cél —";
    fetchWeather(lngLat.lat, lngLat.lng);
    if (state.map) {
      if (!state.pin) {
        state.pin = new maplibregl.Marker({
          element: makeEl("pin"),
          anchor: "bottom",
          draggable: true
        })
          .setLngLat([lngLat.lng, lngLat.lat])
          .addTo(state.map);
        bindPinMarker(state.pin);
      } else {
        if (!state.pinDragging) state.pin.setLngLat([lngLat.lng, lngLat.lat]);
      }
    }
    showPinAdjust();
    paintCar();
  }

  function bindPinMarker(marker) {
    if (!marker || marker._navPinBound) return;
    marker._navPinBound = true;
    marker.on("dragstart", function () {
      state.pinDragging = true;
      state.follow = false;
      if ($("follow")) {
        $("follow").classList.remove("is-on");
        $("follow").setAttribute("aria-pressed", "false");
      }
      /* pin help removed */
    });
    marker.on("dragend", function () {
      const ll = marker.getLngLat();
      state.dest = { lat: ll.lat, lng: ll.lng };
      reversePlace(ll.lat, ll.lng)
        .then(function (place) {
          const label = (place && (place.display_name || place.title)) || "Pontosított cím";
          state.destLabel = label;
          if ($("destName")) $("destName").textContent = label;
          if ($("q")) $("q").value = label;
          if (state.origin && (state.navigating || state.route)) return plan(!!state.navigating);
        })
        .catch(function () {
          showPinAdjust();
        })
        .finally(function () {
          state.pinDragging = false;
        });
    });
  }

  function showPinAdjust() {
    const bar = $("pinAdjust");
    if (bar) bar.hidden = true;
  }

  function focusDest(lngLat) {
    if (!state.map || !lngLat || !Number.isFinite(lngLat.lat) || !Number.isFinite(lngLat.lng)) return;
    state.follow = false;
    if ($("follow")) {
      $("follow").classList.remove("is-on");
      $("follow").setAttribute("aria-pressed", "false");
    }
    try {
      state.map.easeTo({
        center: [lngLat.lng, lngLat.lat],
        zoom: Math.max(Number(state.map.getZoom()) || 0, 17.4),
        pitch: Math.min(Number(state.map.getPitch()) || 0, 48),
        duration: 700
      });
    } catch (_e) {}
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
      if (window.NavCar3D && typeof window.NavCar3D.setWeather === "function") {
        window.NavCar3D.setWeather(Number(code) || 0, temp);
      }
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

  function stripRaster() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    const st = state.map.getStyle() || {};
    (st.layers || []).slice().forEach(function (ly) {
      if (ly && ly.type === "raster") {
        try {
          state.map.removeLayer(ly.id);
        } catch (_e) {}
      }
    });
    Object.keys(st.sources || {}).forEach(function (id) {
      const src = st.sources[id];
      if (src && src.type === "raster") {
        try {
          state.map.removeSource(id);
        } catch (_e2) {}
      }
    });
  }

  function syncSatellite() {
    stripRaster();
  }

  function addArcadeExtras() {
    if (!state.map) return;
    const layers = (state.map.getStyle() && state.map.getStyle().layers) || [];
    let bSrc = null;
    let bLayer = null;
    let tSrc = null;
    let tLayer = null;
    layers.forEach(function (ly) {
      const sl = ly["source-layer"] || "";
      if (!bSrc && (sl === "building" || sl === "buildings")) {
        bSrc = ly.source;
        bLayer = sl;
      }
      if (!tSrc && (sl === "transportation" || sl === "roads")) {
        tSrc = ly.source;
        tLayer = sl;
      }
    });
    function insert(spec) {
      if (state.map.getLayer(spec.id)) return;
      let before;
      const all = (state.map.getStyle() && state.map.getStyle().layers) || [];
      for (let i = 0; i < all.length; i++) {
        if (all[i].type === "symbol" || all[i].id === "route-outline") {
          before = all[i].id;
          break;
        }
      }
      try {
        if (before) state.map.addLayer(spec, before);
        else state.map.addLayer(spec);
      } catch (_e) {}
    }
    if (bSrc) {
      layers.forEach(function (ly) {
        if (!ly || ly.type !== "fill-extrusion") return;
        if (ly.id === "arcade-buildings") return;
        const sl = ly["source-layer"] || "";
        if (sl !== "building" && sl !== "buildings") return;
        try {
          state.map.setLayoutProperty(ly.id, "visibility", "none");
        } catch (_e2) {}
      });
      insert({
        id: "arcade-data-buildings",
        type: "fill",
        source: bSrc,
        "source-layer": bLayer,
        minzoom: 12,
        layout: { visibility: "visible" },
        paint: { "fill-color": "#000000", "fill-opacity": 0 }
      });
      insert({
        id: "arcade-buildings",
        type: "fill-extrusion",
        source: bSrc,
        "source-layer": bLayer,
        minzoom: 15,
        paint: {
            "fill-extrusion-color": "#243044",
          "fill-extrusion-height": [
            "coalesce",
            ["to-number", ["get", "render_height"]],
            ["to-number", ["get", "height"]],
            14
          ],
          "fill-extrusion-base": [
            "coalesce",
            ["to-number", ["get", "render_min_height"]],
            ["to-number", ["get", "min_height"]],
            0
          ],
          "fill-extrusion-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            15,
            0,
            15.15,
            0.86,
            18,
            0.8,
            20.5,
            0.68
          ]
        }
      });
    }
    if (tSrc) {
      insert({
        id: "arcade-data-roads",
        type: "line",
        source: tSrc,
        "source-layer": tLayer,
        minzoom: 12,
        layout: { visibility: "visible" },
        paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 1 }
      });
      insert({
        id: "arcade-lanes",
        type: "line",
        source: tSrc,
        "source-layer": tLayer,
        minzoom: 15,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "class"], "motorway", "#f5c518", "trunk", "#f5c518", "#f8fafc"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 18, 2.1],
          "line-dasharray": [2.2, 2.4],
          "line-opacity": 0.88
        }
      });
    }
  }

  function paintArcadeNight() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    stripRaster();
    function setPaint(id, prop, val) {
      try {
        if (state.map.getLayer(id)) state.map.setPaintProperty(id, prop, val);
      } catch (_e) {}
    }
    setPaint("background", "background-color", "#d8f0a8");
    setPaint("water", "fill-color", "#8fd4f0");
    setPaint("waterway", "line-color", "#7ac8e8");
    setPaint("landuse_residential", "fill-color", "#f4e7b0");
    setPaint("landuse_park", "fill-color", "#9ee07a");
    setPaint("landcover_wood", "fill-color", "#7ecf6a");
    const asphalt = "#fff1b0";
    const asphaltHi = "#ffe27a";
    const casing = "#e8c96a";
    setPaint("highway_path", "line-color", "#f3e2a0");
    setPaint("highway_minor", "line-color", asphalt);
    setPaint("highway_major_inner", "line-color", asphaltHi);
    setPaint("highway_major_casing", "line-color", casing);
    setPaint("highway_major_subtle", "line-color", "#f6e7a8");
    setPaint("highway_motorway_inner", "line-color", "#ffd36a");
    setPaint("highway_motorway_casing", "line-color", "#d7b24c");
    setPaint("highway_motorway_subtle", "line-color", "#f0cf7a");
    setPaint("building", "fill-opacity", 0.18);
    setPaint("building", "fill-color", "#f3d7a8");
    setPaint("earth", "fill-color", "#d8f0a8");
    setPaint("landcover", "fill-color", "#b6e57a");
    setPaint("place_label_city", "text-color", "#3b4a1f");
    setPaint("places", "text-color", "#3b4a1f");
    const layers = (state.map.getStyle() && state.map.getStyle().layers) || [];
    layers.forEach(function (ly) {
      if (!ly) return;
      const sl = ly["source-layer"] || "";
      if (ly.type === "line" && (sl === "transportation" || sl === "roads")) {
        if (/casing|case/i.test(ly.id)) setPaint(ly.id, "line-color", casing);
        else if (/motorway|trunk/i.test(ly.id)) setPaint(ly.id, "line-color", "#ffd36a");
        else if (!/rail|dash/i.test(ly.id)) setPaint(ly.id, "line-color", asphalt);
      }
      if (ly.type === "background") setPaint(ly.id, "background-color", "#d8f0a8");
      if (ly.type === "fill" && (sl === "earth" || sl === "landcover" || sl === "landuse" || ly.id === "bg" || ly.id === "earth")) {
        if (/water/i.test(ly.id)) setPaint(ly.id, "fill-color", "#8fd4f0");
        else if (/park|wood|forest|grass/i.test(ly.id)) setPaint(ly.id, "fill-color", "#9ee07a");
        else setPaint(ly.id, "fill-color", "#d8f0a8");
      }
    });
    addArcadeExtras();
    applySky();
  }

  function applySky() {
    if (!state.map) return;
    const zenith = "#6b8fd4";
    const horizon = "#ffb06a";
    const fog = "#f3c4b0";
    try {
      if (typeof state.map.setSky === "function") {
        state.map.setSky({
          "sky-color": zenith,
          "horizon-color": horizon,
          "fog-color": fog,
          "sky-horizon-blend": 0.62,
          "horizon-fog-blend": 0.92,
          "fog-ground-blend": 0.38,
          "atmosphere-blend": 0.72
        });
      }
    } catch (_e) {}
    try {
      if (typeof state.map.setFog === "function") {
        state.map.setFog({
          color: fog,
          "high-color": zenith,
          "space-color": "#6b8fd4",
          "horizon-blend": 0.14,
          range: [0.35, 5.8]
        });
      }
    } catch (_e2) {}
  }

  function addLayers() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    paintArcadeNight();
    if (!state.map.getSource("route")) {
      state.map.addSource("route", { type: "geojson", data: EMPTY, lineMetrics: true });
      state.map.addLayer({
        id: "route-outline",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#04140c",
          "line-width": 22,
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
          "line-width": 34,
          "line-opacity": 0.38,
          "line-blur": 10
        }
      });
      state.map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#00ff66",
          "line-width": 16
        }
      });
      state.map.addLayer({
        id: "route-edge-y",
        type: "line",
        source: "route",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "#f5c518",
          "line-width": 3.2,
          "line-offset": -8.4,
          "line-opacity": 0.95
        }
      });
      state.map.addLayer({
        id: "route-edge-w",
        type: "line",
        source: "route",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "#f8fafc",
          "line-width": 3.2,
          "line-offset": 8.4,
          "line-opacity": 0.95
        }
      });
    }
    ensureMarkLayer();
    if (state.coords.length) drawRoute();
    paintCar();
    applyRouteStyle();
    if (state.navigating) {
      setArcadeMapMode(true);
      syncFloatMarks(true);
    } else {
      setArcadeMapMode(false);
    }
    if (window.NavCar3D) window.NavCar3D.ensure(state.map);
    pushArcadeWorld();
    addHouseNumbers();
    AppState.targetPos.lat = BUDAPEST[1];
    AppState.targetPos.lng = BUDAPEST[0];
    startSmooth();
  }

  function addHouseNumbers() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    window.NavMap = state.map;
    try {
      if (state.map.getLayer("arcade-buildings")) {
        state.map.setPaintProperty("arcade-buildings", "fill-extrusion-opacity", [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          0,
          15.15,
          0.86,
          18,
          0.8,
          20.5,
          0.68
        ]);
      }
    } catch (_flat) {}
    if (state.map.getLayer("nav-housenumbers")) {
      try {
        if (state.map.getLayer("nav-housenumbers-dot")) state.map.moveLayer("nav-housenumbers-dot");
        state.map.moveLayer("nav-housenumbers");
      } catch (_mv) {}
      bindHouseNumberPick();
      return;
    }
    const st = state.map.getStyle() || {};
    const open = st.sources && st.sources.openmaptiles;
    if (!open) return;
    if (!state.map.getSource("nav-houses")) {
      try {
        const spec = { type: "vector", maxzoom: 14 };
        if (open.url) spec.url = open.url;
        if (open.tiles) spec.tiles = open.tiles;
        if (open.attribution) spec.attribution = open.attribution;
        state.map.addSource("nav-houses", spec);
      } catch (_e) {
        return;
      }
    }
    let fonts = ["Noto Sans Regular"];
    (st.layers || []).some(function (ly) {
      const f = ly && ly.layout && ly.layout["text-font"];
      if (f && f.length) {
        fonts = f;
        return true;
      }
      return false;
    });
    const dark = document.documentElement.classList.contains("dark");
    try {
      if (!state.map.getLayer("nav-housenumbers-dot")) {
        state.map.addLayer({
          id: "nav-housenumbers-dot",
          type: "circle",
          source: "nav-houses",
          "source-layer": "housenumber",
          minzoom: 14,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.2, 17, 4],
            "circle-color": dark ? "#e2e8f0" : "#0f172a",
            "circle-stroke-width": 1,
            "circle-stroke-color": dark ? "#020617" : "#ffffff"
          }
        });
      }
      state.map.addLayer({
        id: "nav-housenumbers",
        type: "symbol",
        source: "nav-houses",
        "source-layer": "housenumber",
        minzoom: 14,
        layout: {
          "text-field": ["to-string", ["get", "housenumber"]],
          "text-font": fonts,
          "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 16, 14, 18, 18],
          "text-padding": 1,
          "text-pitch-alignment": "viewport",
          "text-rotation-alignment": "viewport",
          "text-allow-overlap": true,
          "text-ignore-placement": true
        },
        paint: {
          "text-color": dark ? "#f8fafc" : "#0f172a",
          "text-halo-color": dark ? "#020617" : "#ffffff",
          "text-halo-width": 1.8
        }
      });
    } catch (err) {
      console.warn("[házszám]", err && err.message ? err.message : err);
    }
    bindHouseNumberPick();
  }

  function bindHouseNumberPick() {
    if (!state.map || state.map._navHousePick) return;
    if (!state.map.getLayer("nav-housenumbers") && !state.map.getLayer("nav-housenumbers-dot")) return;
    state.map._navHousePick = true;
    function onHouse(e) {
      if (!e || !e.lngLat) return;
      if (e.originalEvent) e.originalEvent.preventDefault();
      const f = e.features && e.features[0];
      const props = (f && f.properties) || {};
      const num = props.housenumber || props.number || "";
      const street = props.street || props.name || "";
      const title = [street, num].filter(Boolean).join(" ") || (num ? "Ház " + num : "Házszám");
      choose(
        {
          lat: e.lngLat.lat,
          lon: e.lngLat.lng,
          title: title,
          subtitle: "Házszám",
          display_name: title
        },
        { autoPlan: false }
      );
    }
    ["nav-housenumbers", "nav-housenumbers-dot"].forEach(function (id) {
      try {
        state.map.on("click", id, onHouse);
        state.map.on("mouseenter", id, function () {
          state.map.getCanvas().style.cursor = "pointer";
        });
        state.map.on("mouseleave", id, function () {
          state.map.getCanvas().style.cursor = "";
        });
      } catch (_e) {}
    });
  }

  function hash01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function tomtomKey() {
    if (TOMTOM_API_KEY) return TOMTOM_API_KEY;
    try {
      const q = new URLSearchParams(location.search).get("ttkey");
      if (q) return q;
      const stored = localStorage.getItem("nav2_tomtom_key");
      if (stored) return stored;
    } catch (_e) {}
    return "";
  }

  function tomtomAvoidQs() {
    const o = routeOpts();
    const avoid = [];
    if (o.avoidMotorway) avoid.push("motorways");
    if (o.avoidToll) avoid.push("tollRoads");
    return avoid.length ? "&avoid=" + avoid.join(",") : "";
  }

  function tomtomManeuver(type) {
    const t = String(type || "").toUpperCase();
    if (/ARRIVE/.test(t)) return { type: "arrive", modifier: "" };
    if (/DEPART|START/.test(t)) return { type: "depart", modifier: "" };
    if (/ROUNDABOUT.*EXIT|EXIT.ROUND/.test(t)) return { type: "exit roundabout", modifier: "" };
    if (/ROUNDABOUT/.test(t)) return { type: "roundabout", modifier: "" };
    if (/UTURN|U_TURN/.test(t)) return { type: "turn", modifier: "uturn" };
    if (/SHARP.*LEFT/.test(t)) return { type: "turn", modifier: "sharp left" };
    if (/SHARP.*RIGHT/.test(t)) return { type: "turn", modifier: "sharp right" };
    if (/SLIGHT.*LEFT|KEEP.LEFT/.test(t)) return { type: "turn", modifier: "slight left" };
    if (/SLIGHT.*RIGHT|KEEP.RIGHT/.test(t)) return { type: "turn", modifier: "slight right" };
    if (/LEFT/.test(t)) return { type: "turn", modifier: "left" };
    if (/RIGHT/.test(t)) return { type: "turn", modifier: "right" };
    if (/MERGE/.test(t)) return { type: "merge", modifier: "" };
    if (/FORK/.test(t)) return { type: "fork", modifier: "" };
    return { type: "continue", modifier: "" };
  }

  function trafficLevelFromDelay(mag, speed) {
    if (mag >= 4) return 0.95;
    if (mag === 3) return 0.82;
    if (mag === 2) return 0.58;
    if (mag === 1) return 0.42;
    if (Number.isFinite(speed) && speed < 8) return 0.92;
    if (Number.isFinite(speed) && speed < 18) return 0.78;
    if (Number.isFinite(speed) && speed < 38) return 0.48;
    return 0.18;
  }

  function trafficFromTomTom(route) {
    const points = [];
    (route.legs || []).forEach(function (leg) {
      (leg.points || []).forEach(function (p) {
        if (Number.isFinite(p.longitude) && Number.isFinite(p.latitude)) {
          points.push([p.longitude, p.latitude]);
        }
      });
    });
    const traveled = [0];
    let i;
    for (i = 1; i < points.length; i++) {
      traveled[i] =
        traveled[i - 1] +
        haversine(
          { lng: points[i - 1][0], lat: points[i - 1][1] },
          { lng: points[i][0], lat: points[i][1] }
        );
    }
    const out = [];
    const sections = (route.sections || []).filter(function (s) {
      return /traffic/i.test(String((s && s.sectionType) || ""));
    });
    sections.forEach(function (sec) {
      const a = traveled[Math.max(0, Number(sec.startPointIndex) || 0)] || 0;
      const b = traveled[Math.min(traveled.length - 1, Number(sec.endPointIndex) || 0)] || a;
      const mid = (a + b) * 0.5;
      const p =
        points[
          Math.min(
            points.length - 1,
            Math.round(((Number(sec.startPointIndex) || 0) + (Number(sec.endPointIndex) || 0)) / 2)
          )
        ] || points[0];
      out.push({
        traveled: mid,
        start: a,
        end: Math.max(a + 8, b),
        level: trafficLevelFromDelay(Number(sec.magnitudeOfDelay), Number(sec.effectiveSpeedInKmh)),
        lng: p && p[0],
        lat: p && p[1]
      });
    });
    if (!out.length && points.length) {
      const sum = route.summary || {};
      const delay = Math.max(0, (sum.travelTimeInSeconds || 0) - (sum.noTrafficTravelTimeInSeconds || sum.travelTimeInSeconds || 0));
      const level = delay > 400 ? 0.72 : delay > 90 ? 0.46 : 0.18;
      out.push({ traveled: traveled[traveled.length - 1] * 0.5, start: 0, end: traveled[traveled.length - 1], level: level, lng: points[0][0], lat: points[0][1] });
    }
    return out;
  }

  function tomtomToRoute(data) {
    const route = data && data.routes && data.routes[0];
    if (!route) throw new Error("Nincs útvonal");
    const coords = [];
    (route.legs || []).forEach(function (leg) {
      (leg.points || []).forEach(function (p) {
        if (Number.isFinite(p.longitude) && Number.isFinite(p.latitude)) {
          coords.push([p.longitude, p.latitude]);
        }
      });
    });
    if (coords.length < 2) throw new Error("Nincs útvonal");
    const steps = [];
    const instructions =
      (route.guidance && route.guidance.instructions) ||
      ((route.legs || []).reduce(function (all, leg) {
        return all.concat(leg.instructions || []);
      }, []));
    instructions.forEach(function (ins) {
      const man = tomtomManeuver(ins.instructionType || ins.maneuver || ins.type);
      const pt = ins.point || {};
      steps.push({
        maneuver: { type: man.type, modifier: man.modifier },
        name: ins.street || ins.roadNumbers || "",
        distance: Number(ins.routeOffsetInMeters) || 0,
        duration: 0,
        geometry: {
          coordinates:
            Number.isFinite(pt.longitude) && Number.isFinite(pt.latitude)
              ? [[pt.longitude, pt.latitude]]
              : []
        }
      });
    });
    const summary = route.summary || {};
    return {
      distance: Number(summary.lengthInMeters) || lineLen(coords),
      duration: Number(summary.travelTimeInSeconds) || 0,
      geometry: { coordinates: coords },
      legs: [{ steps: steps }],
      traffic: trafficFromTomTom(route)
    };
  }

  async function fetchTomTomRoute(from, to) {
    const key = tomtomKey();
    if (!key) throw new Error("Nincs TomTom kulcs");
    const loc =
      Number(from.lat).toFixed(6) +
      "," +
      Number(from.lng).toFixed(6) +
      ":" +
      Number(to.lat).toFixed(6) +
      "," +
      Number(to.lng).toFixed(6);
    const url =
      "https://api.tomtom.com/routing/1/calculateRoute/" +
      loc +
      "/json?key=" +
      encodeURIComponent(key) +
      "&traffic=true&travelMode=car&sectionType=traffic&routeRepresentation=polyline&computeTravelTimeFor=all&instructionsType=text&language=hu-HU" +
      tomtomAvoidQs();
    const res = await fetch(url);
    if (!res.ok) throw new Error("TomTom " + res.status);
    const data = await res.json();
    return tomtomToRoute(data);
  }

  function buildTrafficProfile(coords) {
    const list = coords || [];
    const out = [];
    if (list.length < 2) return out;
    let acc = 0;
    const hour = new Date().getHours();
    const rush = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
    let i;
    for (i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const d = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
      const mid = acc + d * 0.5;
      if (!out.length || mid - out[out.length - 1].traveled >= 70) {
        const n = hash01(Math.round(a[1] * 180) * 13 + Math.round(a[0] * 180) * 7 + hour);
        let level = n * (rush ? 0.95 : 0.52);
        if (n < 0.42) level *= 0.32;
        out.push({
          traveled: mid,
          level: Math.min(1, level),
          lng: (a[0] + b[0]) * 0.5,
          lat: (a[1] + b[1]) * 0.5
        });
      }
      acc += d;
    }
    return out;
  }

  function trafficColor(level) {
    if (level >= 0.9) return "#8b1020";
    if (level >= 0.65) return "#e23b4a";
    if (level >= 0.38) return "#f2b84b";
    return "#3dce6a";
  }

  function applyTrafficRouteStyle() {
    if (!state.map || !state.map.getLayer("route-line")) return;
    const samples = state.traffic || [];
    const len = state.routeLen || lineLen(state.coords || []);
    if (!samples.length || !(len > 1)) {
      applyRouteStyle();
      return;
    }
    const grad = ["interpolate", ["linear"], ["line-progress"]];
    samples.forEach(function (s) {
      const t = Math.max(0, Math.min(1, (s.traveled || 0) / len));
      grad.push(t, trafficColor(s.level));
    });
    try {
      state.map.setPaintProperty("route-line", "line-gradient", grad);
      state.map.setPaintProperty("route-glow", "line-color", "#fff4c2");
    } catch (_e) {
      applyRouteStyle();
    }
  }

  let trafficTimer = 0;
  let tomtomBusy = false;

  function applyTrafficSamples(samples) {
    state.traffic = samples || [];
    if (window.NavCar3D && typeof window.NavCar3D.setTraffic === "function") {
      window.NavCar3D.setTraffic(state.traffic, true);
    }
    applyTrafficRouteStyle();
  }

  function refreshTraffic() {
    if (state.route && state.route.traffic && state.route.traffic.length) {
      applyTrafficSamples(state.route.traffic);
      return;
    }
    applyTrafficSamples(buildTrafficProfile(state.coords));
  }

  function stopTrafficPoll() {
    if (trafficTimer) {
      clearInterval(trafficTimer);
      trafficTimer = 0;
    }
  }

  function startTrafficPoll() {
    stopTrafficPoll();
    if (!tomtomKey()) return;
    trafficTimer = setInterval(pollTomTomTraffic, TOMTOM_POLL_MS);
  }

  async function pollTomTomTraffic() {
    if (tomtomBusy || !state.dest) return;
    const from =
      state.navigating && AppState.currentPos && Number.isFinite(AppState.currentPos.lat)
        ? { lat: AppState.currentPos.lat, lng: AppState.currentPos.lng }
        : state.origin;
    if (!from || !Number.isFinite(from.lat) || !Number.isFinite(from.lng)) return;
    tomtomBusy = true;
    try {
      const route = await fetchTomTomRoute(from, state.dest);
      if (route && route.traffic && route.traffic.length) {
        state.route = state.route || route;
        state.route.traffic = route.traffic;
        applyTrafficSamples(route.traffic);
      }
    } catch (_e) {
    } finally {
      tomtomBusy = false;
    }
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
        state.map.setPaintProperty("route-outline", "line-width", 22);
      }
      state.map.setPaintProperty("route-glow", "line-color", c.glow);
      state.map.setPaintProperty("route-glow", "line-width", 34);
      state.map.setPaintProperty("route-line", "line-color", c.line);
      state.map.setPaintProperty("route-line", "line-width", 16);
    } catch (_e) {}
  }

  function remainingCoords() {
    return windowCoords();
  }

  function windowCoords() {
    return sliceRouteCoords(90, 720, false);
  }

  function arcadeCoords() {
    return sliceRouteCoords(180, 720, false);
  }

  function sliceRouteCoords(behind, ahead, snapToCar) {
    const coords = state.coords || [];
    if (coords.length < 2) return [];
    const here = state.traveled || 0;
    const out = [];
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const seg = haversine(a, b);
      const mid = acc + seg * 0.5;
      if (mid >= here - behind && mid <= here + ahead) {
        if (!out.length) out.push([a.lng, a.lat]);
        out.push([b.lng, b.lat]);
      }
      acc += seg;
    }
    if (snapToCar) {
      const cur = AppState.currentPos;
      if (out.length >= 2 && Number.isFinite(cur.lng) && Number.isFinite(cur.lat)) {
        const first = { lng: out[0][0], lat: out[0][1] };
        if (haversine(first, { lng: cur.lng, lat: cur.lat }) < 80) {
          out[0] = [cur.lng, cur.lat];
        }
      }
    }
    return out;
  }

  function arcadeOrigin() {
    const cur = AppState.currentPos;
    return {
      lng: Number.isFinite(cur.lng) ? cur.lng : state.origin && state.origin.lng,
      lat: Number.isFinite(cur.lat) ? cur.lat : state.origin && state.origin.lat
    };
  }

  function setMapLayerVis(hideVisual) {
    if (!state.map || !state.map.isStyleLoaded()) return;
    addArcadeExtras();
    const layers = (state.map.getStyle() && state.map.getStyle().layers) || [];
    layers.forEach(function (ly) {
      if (!ly || !ly.id) return;
      if (ly.id.indexOf("arcade-data-") === 0) {
        try {
          state.map.setLayoutProperty(ly.id, "visibility", "visible");
        } catch (_keep) {}
        return;
      }
      try {
        state.map.setLayoutProperty(ly.id, "visibility", hideVisual ? "none" : "visible");
      } catch (_e) {}
    });
  }

  function setNavGestures(lock) {
    if (!state.map) return;
    try {
      if (lock) {
        state.map.dragPan.disable();
        if (state.map.dragRotate) state.map.dragRotate.disable();
        if (state.map.keyboard) state.map.keyboard.disable();
        if (state.map.touchPitch) state.map.touchPitch.disable();
        if (state.map.touchZoomRotate && state.map.touchZoomRotate.disableRotation) {
          state.map.touchZoomRotate.disableRotation();
        }
      } else {
        state.map.dragPan.enable();
        if (state.map.dragRotate) state.map.dragRotate.enable();
        if (state.map.keyboard) state.map.keyboard.enable();
        if (state.map.touchPitch) state.map.touchPitch.enable();
        state.map.touchZoomRotate.enable();
      }
    } catch (_ctl) {}
  }

  function setArcadeMapMode(on) {
    if (window.NavCar3D) {
      window.NavCar3D.onArcadeLive = function (live) {
        setMapLayerVis(!!live);
        if (live) {
          setNavGestures(true);
          state._3dRouteAt = null;
          pushArcadeWorld();
        }
      };
      if (window.NavCar3D.setArcade) window.NavCar3D.setArcade(on);
    }
    if (!on) {
      setMapLayerVis(false);
      setNavGestures(false);
      return;
    }
    setMapLayerVis(false);
    setNavGestures(true);
  }

  function boxRing(center, heading, alongM, acrossM) {
    const left = (heading + 270) % 360;
    const corners = [
      offsetLngLat(offsetLngLat(center, heading, alongM / 2), left, acrossM / 2),
      offsetLngLat(offsetLngLat(center, heading, alongM / 2), left, -acrossM / 2),
      offsetLngLat(offsetLngLat(center, heading, -alongM / 2), left, -acrossM / 2),
      offsetLngLat(offsetLngLat(center, heading, -alongM / 2), left, acrossM / 2)
    ];
    const ring = corners.map(function (p) {
      return [p.lng, p.lat];
    });
    ring.push(ring[0]);
    return ring;
  }

  function seedGlassBlocks(origin) {
    const coords = remainingCoords() || state.coords || [];
    const extra = [];
    if (!origin || coords.length < 5) return extra;
    for (let i = 2; i < coords.length && extra.length < 22; i += 3) {
      const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
      const b = { lng: coords[i][0], lat: coords[i][1] };
      const hdg = bearing(a, b);
      extra.push({
        ring: boxRing(offsetLngLat(b, (hdg + 270) % 360, 32 + (i % 3) * 3), hdg, 15, 11),
        h: 12 + (i % 6) * 4
      });
      extra.push({
        ring: boxRing(offsetLngLat(b, (hdg + 90) % 360, 34 + ((i + 1) % 3) * 3), hdg, 13, 10),
        h: 10 + ((i + 3) % 6) * 5
      });
    }
    return extra;
  }

  function collectArcadeBuildings(origin) {
    if (!origin) return seedGlassBlocks(origin);
    const layers = (state.map && state.map.getStyle() && state.map.getStyle().layers) || [];
    const tried = {};
    let feats = [];
    layers.forEach(function (ly) {
      const sl = ly["source-layer"] || "";
      if (sl !== "building" && sl !== "buildings") return;
      const key = ly.source + ":" + sl;
      if (tried[key]) return;
      tried[key] = 1;
      try {
        const got = state.map.querySourceFeatures(ly.source, { sourceLayer: sl });
        for (let i = 0; i < got.length; i++) feats.push(got[i]);
      } catch (_e) {}
    });
    if (!feats.length && state.map && state.map.getLayer("arcade-data-buildings")) {
      try {
        feats = state.map.queryRenderedFeatures({ layers: ["arcade-data-buildings"] });
      } catch (_e2) {
        feats = [];
      }
    }
    const out = [];
    const seen = {};
    const cos = Math.cos((origin.lat * Math.PI) / 180);
    for (let i = 0; i < feats.length && out.length < 64; i++) {
      const f = feats[i];
      const g = f && f.geometry;
      if (!g) continue;
      const rings =
        g.type === "Polygon"
          ? [g.coordinates[0]]
          : g.type === "MultiPolygon"
            ? g.coordinates.map(function (poly) { return poly[0]; })
            : null;
      if (!rings || !rings[0] || rings[0].length < 3) continue;
      const ring = rings[0];
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < ring.length; k++) {
        cx += ring[k][0];
        cy += ring[k][1];
      }
      cx /= ring.length;
      cy /= ring.length;
      const dx = (cx - origin.lng) * 111320 * cos;
      const dy = (cy - origin.lat) * 111320;
      if (dx * dx + dy * dy > 250 * 250) continue;
      let minD = Infinity;
      for (let k = 0; k < ring.length; k++) {
        const vx = (ring[k][0] - origin.lng) * 111320 * cos;
        const vy = (ring[k][1] - origin.lat) * 111320;
        const vd = Math.hypot(vx, vy);
        if (vd < minD) minD = vd;
      }
      if (minD < 8) continue;
      const key = cx.toFixed(5) + "," + cy.toFixed(5);
      if (seen[key]) continue;
      seen[key] = 1;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < ring.length; k++) {
        if (ring[k][0] < minX) minX = ring[k][0];
        if (ring[k][0] > maxX) maxX = ring[k][0];
        if (ring[k][1] < minY) minY = ring[k][1];
        if (ring[k][1] > maxY) maxY = ring[k][1];
      }
      const span = Math.hypot((maxX - minX) * 111320 * cos, (maxY - minY) * 111320);
      if (span > 90) continue;
      const props = f.properties || {};
      out.push({
        ring: ring,
        h: Math.max(8, Number(props.render_height || props.height) || 16),
        minH: Number(props.render_min_height || props.min_height) || 0
      });
    }
    if (out.length < 8) {
      seedGlassBlocks(origin).forEach(function (b) {
        out.push(b);
      });
    }
    return out;
  }

  function collectArcadeRoads(origin) {
    if (!state.map || !origin) return [];
    const layers = (state.map.getStyle() && state.map.getStyle().layers) || [];
    let src = null;
    let layer = null;
    layers.forEach(function (ly) {
      const sl = ly["source-layer"] || "";
      if (!src && (sl === "transportation" || sl === "roads")) {
        src = ly.source;
        layer = sl;
      }
    });
    let feats = [];
    try {
      if (src) feats = state.map.querySourceFeatures(src, { sourceLayer: layer });
    } catch (_e) {
      feats = [];
    }
    const out = [];
    const seen = {};
    const cos = Math.cos((origin.lat * Math.PI) / 180);
    for (let i = 0; i < feats.length && out.length < 36; i++) {
      const f = feats[i];
      const g = f && f.geometry;
      if (!g) continue;
      const lines =
        g.type === "LineString"
          ? [g.coordinates]
          : g.type === "MultiLineString"
            ? g.coordinates
            : null;
      if (!lines) continue;
      lines.forEach(function (line) {
        if (!line || line.length < 2 || out.length >= 36) return;
        const mid = line[Math.floor(line.length / 2)];
        const dx = (mid[0] - origin.lng) * 111320 * cos;
        const dy = (mid[1] - origin.lat) * 111320;
        if (dx * dx + dy * dy > 180 * 180) return;
        const key = mid[0].toFixed(5) + "," + mid[1].toFixed(5) + ":" + line.length;
        if (seen[key]) return;
        seen[key] = 1;
        out.push(line);
      });
    }
    return out;
  }

  function pushArcadeWorld() {
    if (!window.NavCar3D) return;
    const origin = arcadeOrigin();
    if (!Number.isFinite(origin.lng) || !Number.isFinite(origin.lat)) return;
    if (!state.traffic || !state.traffic.length) state.traffic = buildTrafficProfile(state.coords);
    if (window.NavCar3D.setTraffic) window.NavCar3D.setTraffic(state.traffic, false);
    const here = state.traveled || 0;
    const routeMissing =
      window.NavCar3D.routeReady && !window.NavCar3D.routeReady();
    if (
      window.NavCar3D.setRoute &&
      (routeMissing || state._3dRouteAt == null || Math.abs(here - state._3dRouteAt) > 140)
    ) {
      state._3dRouteAt = here;
      window.NavCar3D.setRoute(arcadeCoords(), origin);
    }
    if (window.NavCar3D.setMarkers && state.navigating) {
      const marks = [];
      let shown = 0;
      for (let i = 0; i < state.limits.length && shown < 5; i++) {
        const seg = state.limits[i];
        if (seg.start < here + 70) continue;
        if (seg.start > here + 2600) break;
        if (i > 0 && state.limits[i - 1].limit === seg.limit) continue;
        if (!seg.limit) continue;
        const p = alongLine(state.coords, seg.start);
        if (!p) continue;
        marks.push({ kind: "limit", label: String(seg.limit), lng: p.lng, lat: p.lat });
        shown += 1;
      }
      (state.cameras || []).forEach(function (cam) {
        if (cam.traveled < here + 70 || cam.traveled > here + 2200) return;
        marks.push({ kind: "cam", label: "", lng: cam.lng, lat: cam.lat });
      });
      window.NavCar3D.setMarkers(marks, origin);
    } else if (window.NavCar3D.setMarkers) {
      window.NavCar3D.setMarkers([], origin);
    }
    if (window.NavCar3D.setBuildings) {
      window.NavCar3D.setBuildings([], origin);
    }
    if (window.NavCar3D.setRoads) {
      window.NavCar3D.setRoads([], origin);
    }
  }

  function drawRoute() {
    const src = state.map.getSource("route");
    if (!src) return;
    src.setData(splitLine(state.coords, state.traveled));
    if (!state.traffic || !state.traffic.length) {
      if (state.route && state.route.traffic && state.route.traffic.length) state.traffic = state.route.traffic;
      else state.traffic = buildTrafficProfile(state.coords);
    }
    applyTrafficRouteStyle();
    pushArcadeWorld();
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
    if (state.navigating) return Math.max(1.4, Math.min(3.2, 1.8 + kmh * 0.01));
    return Math.max(2.2, Math.min(4.2, 2.6 + kmh * 0.01));
  }

  function lookAhead(from, heading) {
    if (!from) return from;
    return offsetLngLat(from, heading, lookAheadMeters());
  }

  let padCache = { t: 0, nav: false, ar: false, pad: { top: 8, bottom: 8, left: 8, right: 8 } };

  function camPad() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - padCache.t < 400 && padCache.nav === state.navigating && padCache.ar === state.ar) {
      return padCache.pad;
    }
    const box = state.map ? state.map.getContainer() : null;
    const h = box ? box.clientHeight : window.innerHeight;
    const fabs = $("fabBar");
    let right = 8;
    if (fabs) {
      const r = fabs.getBoundingClientRect();
      if (r.left > 0) right = Math.max(8, Math.round(window.innerWidth - r.left + 6));
    }
    const pad = state.ar
      ? { top: 6, bottom: 10, left: 6, right: 6 }
      : {
          top: Math.round(h * (state.navigating ? 0.04 : 0.07)),
          bottom: Math.round(h * (state.navigating ? 0.22 : 0.26)),
          left: 8,
          right: right
        };
    padCache = { t: now, nav: state.navigating, ar: state.ar, pad: pad };
    return pad;
  }

  function paintCompass() {
    const el = $("compassN");
    if (!el) return;
    const dial = el.querySelector(".compass-dial");
    if (!dial) return;
    const h = Number(state.heading || AppState.currentPos.bearing || 0);
    dial.style.transform = "rotate(" + (-h) + "deg)";
  }

  function updateCarLean(heading) {
    const now = performance.now();
    const h = Number(heading);
    if (!Number.isFinite(h)) return state.carLean || 0;
    if (state.leanHeading == null) {
      state.leanHeading = h;
      state.leanAt = now;
      return state.carLean || 0;
    }
    const dt = Math.max(0.016, (now - (state.leanAt || now)) / 1000);
    state.leanAt = now;
    const dh = angDelta(state.leanHeading, h);
    state.leanHeading = h;
    const yawRate = dh / dt;
    const want = Math.max(-14, Math.min(14, yawRate * 0.28));
    state.carLean = (state.carLean || 0) * 0.82 + want * 0.18;
    if (Math.abs(state.carLean) < 0.08) state.carLean = 0;
    return state.carLean;
  }

  function placePuck(ll, heading) {
    if (!state.map || !ll) return;
    const lean = updateCarLean(heading);
    if (window.NavCar3D) window.NavCar3D.setPose(ll.lng, ll.lat, heading, lean, state.speed);
    const use3d = window.NavCar3D && window.NavCar3D.ready;
    if (use3d) {
      if (state.puck) {
        try {
          state.puck.remove();
        } catch (_e) {}
        state.puck = null;
      }
      return;
    }
    if (!state.puck) {
      state.puck = new maplibregl.Marker({ element: makeCarEl(), anchor: "center" })
        .setLngLat([ll.lng, ll.lat])
        .addTo(state.map);
    } else {
      state.puck.setLngLat([ll.lng, ll.lat]);
      paintPuckIcon();
    }
    const mapBearing = state.map.getBearing();
    state.puck.setRotation((Number.isFinite(heading) ? heading : 0) - mapBearing);
  }

  const CAM_LERP = 0.16;
  const CAM_PITCH_NAV = 75;
  let lastOffTick = 0;
  let lastSmoothT = 0;

  function lerp(start, end, amt) {
    if (!Number.isFinite(start)) return end;
    if (!Number.isFinite(end)) return start;
    return (1 - amt) * start + amt * end;
  }

  let smoothRaf = 0;

  function startSmooth() {
    if (smoothRaf) return;
    smoothRaf = requestAnimationFrame(animateFrame);
  }

  function setTarget(ll, heading) {
    if (!ll) return;
    if (Number.isFinite(ll.lat) && Number.isFinite(ll.lng)) {
      AppState.targetPos.lat = ll.lat;
      AppState.targetPos.lng = ll.lng;
    }
    if (Number.isFinite(heading)) AppState.targetPos.bearing = heading;
    startSmooth();
  }

  function followK(dt, tau) {
    return 1 - Math.exp(-Math.max(0.008, dt) / Math.max(0.04, tau));
  }

  function coastTarget(dt) {
    const tgt = AppState.targetPos;
    if (!Number.isFinite(tgt.lat) || !Number.isFinite(tgt.lng)) return;
    const speed = Number(AppState.speed);
    if (!(speed > COAST_MIN_SPEED) || !(dt > 0)) return;
    const heading = Number.isFinite(tgt.bearing) ? tgt.bearing : state.heading || 0;
    if (state.coords.length >= 2 && (state.traveled > 0 || state.navigating || state.simulating)) {
      const pace =
        window.NavCar3D && typeof window.NavCar3D.trafficPace === "function"
          ? Math.max(0.06, Number(window.NavCar3D.trafficPace()) || 1)
          : 1;
      const step = (state.simulating ? SIM_MS : speed) * pace;
      if (state.simulating) {
        state.speed = SIM_MS * pace;
        AppState.speed = state.speed;
      }
      state.traveled = (state.traveled || 0) + step * dt;
      if (state.simulating && state.routeLen && state.traveled >= state.routeLen - 1) {
        state.traveled = state.routeLen;
        stopSimDrive({ arrived: true });
        return;
      }
      const along = alongLine(state.coords, state.traveled);
      if (along) {
        tgt.lat = along.lat;
        tgt.lng = along.lng;
      }
      tgt.bearing = routeTangent(state.coords, state.traveled);
      return;
    }
    const next = offsetLngLat({ lng: tgt.lng, lat: tgt.lat }, heading, speed * dt);
    if (next) {
      tgt.lat = next.lat;
      tgt.lng = next.lng;
    }
  }

  function animateFrame(stamp) {
    smoothRaf = requestAnimationFrame(animateFrame);
    const now = stamp || (typeof performance !== "undefined" ? performance.now() : Date.now());
    const dt = lastSmoothT ? Math.min(0.05, Math.max(0.008, (now - lastSmoothT) / 1000)) : 0.016;
    lastSmoothT = now;
    const tgt = AppState.targetPos;
    const cur = AppState.currentPos;
    if (Number.isFinite(tgt.lat) && Number.isFinite(tgt.lng)) {
      coastTarget(dt);
      if (!cur._seeded) {
        cur.lat = tgt.lat;
        cur.lng = tgt.lng;
        cur.bearing = tgt.bearing || 0;
        if (state.coords.length >= 2) {
          const glued0 = alongLine(state.coords, state.traveled || 0);
          if (glued0) {
            cur.lat = glued0.lat;
            cur.lng = glued0.lng;
          }
          cur.bearing = routeTangent(state.coords, state.traveled || 0);
        }
        cur._seeded = true;
      } else {
        cur.lat = lerp(cur.lat, tgt.lat, POS_LERP);
        cur.lng = lerp(cur.lng, tgt.lng, POS_LERP);
        if ((AppState.speed || 0) * 3.6 >= PATH_HEADING_KMH && !state.simulating) {
          cur.bearing = mixHeading(cur.bearing || 0, tgt.bearing || 0, HEAD_LERP);
        } else if (state.coords.length >= 2) {
          cur.bearing = routeTangent(state.coords, state.traveled || 0);
        }
      }
      if (state.coords.length >= 2) {
        const glued = alongLine(state.coords, state.traveled || 0);
        if (glued) {
          cur.lat = glued.lat;
          cur.lng = glued.lng;
          tgt.lat = glued.lat;
          tgt.lng = glued.lng;
        }
        cur.bearing = routeTangent(state.coords, state.traveled || 0);
        if (state.simulating || (AppState.speed || 0) * 3.6 < PATH_HEADING_KMH) {
          tgt.bearing = cur.bearing;
        }
      }
      const pose = { lng: cur.lng, lat: cur.lat };
      state.heading = Number.isFinite(cur.bearing) ? cur.bearing : state.heading;
      if (state.map) {
        placePuck(pose, state.heading || cur.bearing);
      }
    }
    const wall = Date.now();
    if (wall - lastOffTick > 220) {
      lastOffTick = wall;
      if (state.map && Number.isFinite(cur.lat) && Number.isFinite(cur.lng)) {
        setOrigin({ lng: cur.lng, lat: cur.lat }, cur.bearing, AppState.speed, true);
      }
      if (state.navigating) pushArcadeWorld();
      tickGpsHud();
      if (state.pendingPlan && state.dest && state.origin && !state.route && !state.planning) {
        state.pendingPlan = false;
        fetchRoute(false);
      } else {
        maybeReroute();
      }
    }
    if (!state.map) return;
    paintCompass();
    if (!state.follow && !state.arcadePreview) return;
    const pose = { lng: cur.lng, lat: cur.lat };
    const heading = state.heading || cur.bearing || 0;
    if (!state.view) state.view = copyPose(pose, heading);
    const v = state.view;
    const ck = followK(dt, CAM_LERP);
    v.lat = lerp(v.lat, pose.lat, ck);
    v.lng = lerp(v.lng, pose.lng, ck);
    v.heading = mixHeading(v.heading || 0, heading, ck);
    state.camHeading = v.heading;
    const kmh = (state.speed || AppState.speed || 0) * 3.6;
    const wantZoom = state.navigating
        ? kmh > 110 ? 20.35 : kmh > 70 ? 20.7 : 20.95
        : kmh > 90 ? 20.1 : 20.45;
    v.zoom = lerp(Number.isFinite(v.zoom) ? v.zoom : wantZoom, wantZoom, 0.08);
    const ahead = lookAhead(v, v.heading);
    const pad = camPad();
    try {
      state.map.jumpTo({
        center: [ahead.lng, ahead.lat],
        bearing: v.heading || 0,
        pitch: CAM_PITCH_NAV,
        zoom: v.zoom,
        padding: pad
      });
    } catch (_e) {
      try {
        state.map.setPitch(CAM_PITCH_NAV);
        state.map.setZoom(v.zoom);
        state.map.setBearing(v.heading || 0);
        state.map.setCenter([ahead.lng, ahead.lat]);
      } catch (_e2) {}
    }
  }

  function updateCamera(force) {
    const cur = AppState.currentPos;
    if (!state.origin && !(cur.lat || cur.lng)) return;
    if (force) {
      const pose = state.origin || { lng: cur.lng, lat: cur.lat };
      const heading = state.heading || cur.bearing || 0;
      state.view = copyPose(pose, heading);
      state.camHeading = heading;
      placePuck(pose, heading);
    }
    startSmooth();
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
      const posted = Number(edge.speed_limit) >= 5 && Number(edge.speed_limit) <= 140;
      const limit = posted ? Number(edge.speed_limit) : defaultLimit(cls);
      const urban = inferUrban(limit, cls);
      const grade = Number(edge.weighted_grade);
      const g = Number.isFinite(grade) ? grade : 0;
      const last = segs[segs.length - 1];
      if (last && last.limit === limit && last.urban === urban && last.cls === cls && last.posted === posted) {
        last.end += meters;
        if (Math.abs(g) > Math.abs(last.grade || 0)) last.grade = g;
      } else {
        segs.push({ start: at, end: at + meters, limit, urban, cls, posted: posted, grade: g });
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
    if (state.navigating && limit && kmh > limit + 3 && Date.now() - (state.lastSpeedWarn || 0) > 25000) {
      state.lastSpeedWarn = Date.now();
      playNavCue("speed-warning");
    }
    const chip = $("placeChip");
    const chipText = $("placeText");
    const label = placeLabel(urban, state.place);
    if (chip && chipText) {
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
      if (nxt && nxt.dist < 900 && nxt.limit && nxt.limit !== limit) {
        roadThen.hidden = false;
        roadThenText.textContent = fmtDist(nxt.dist) + " múlva " + nxt.limit;
      } else {
        roadThen.hidden = true;
      }
    }
    const hz = $("hazardThen");
    if (hz) hz.hidden = true;
  }

  function canvasIcon(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    return {
      width: w,
      height: h,
      data: new Uint8Array(g.getImageData(0, 0, w, h).data)
    };
  }

  function markIconId(kind, label) {
    return "nav-" + kind + "-" + String(label || "").replace(/\s+/g, "_").slice(0, 24);
  }

  function ensureMarkIcon(kind, label) {
    if (!state.map) return "";
    const id = kind === "cam" ? "nav-cam" : markIconId(kind, label);
    if (state.map.hasImage(id)) return id;
    let img = null;
    if (kind === "cam") {
      img = canvasIcon(128, 128, function (g, w) {
        g.beginPath();
        g.arc(w / 2, w / 2, w * 0.42, 0, Math.PI * 2);
        g.fillStyle = "#fff";
        g.fill();
        g.lineWidth = w * 0.08;
        g.strokeStyle = "#111";
        g.stroke();
        g.beginPath();
        g.arc(w / 2, w / 2, w * 0.14, 0, Math.PI * 2);
        g.strokeStyle = "#111";
        g.lineWidth = w * 0.06;
        g.stroke();
        g.fillStyle = "#111";
        g.beginPath();
        g.arc(w * 0.38, w * 0.4, w * 0.045, 0, Math.PI * 2);
        g.fill();
      });
    } else if (kind === "limit") {
      img = canvasIcon(128, 128, function (g, w) {
        g.beginPath();
        g.arc(w / 2, w / 2, w * 0.42, 0, Math.PI * 2);
        g.fillStyle = "#fff";
        g.fill();
        g.lineWidth = w * 0.12;
        g.strokeStyle = "#e11d2e";
        g.stroke();
        g.fillStyle = "#111";
        g.font = "700 " + Math.round(w * 0.34) + "px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(label || ""), w / 2, w / 2 + 1);
      });
    } else {
      const text = String(label || "");
      img = canvasIcon(256, 96, function (g, w, h) {
        const x = 8;
        const y = 10;
        const rw = w - 16;
        const rh = h - 20;
        const r = rh / 2;
        g.beginPath();
        g.moveTo(x + r, y);
        g.lineTo(x + rw - r, y);
        g.arcTo(x + rw, y, x + rw, y + r, r);
        g.arcTo(x + rw, y + rh, x + rw - r, y + rh, r);
        g.lineTo(x + r, y + rh);
        g.arcTo(x, y + rh, x, y + r, r);
        g.arcTo(x, y, x + r, y, r);
        g.closePath();
        g.fillStyle = "#fff";
        g.fill();
        g.lineWidth = 6;
        g.strokeStyle = "#111";
        g.stroke();
        g.fillStyle = "#111";
        g.font = "800 36px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(text, w / 2, h / 2 + 1);
      });
    }
    try {
      state.map.addImage(id, img);
    } catch (_e) {
      return "";
    }
    return id;
  }

  function markIconSize() {
    const w = window.innerWidth || 400;
    const h = window.innerHeight || 800;
    const vmin = Math.min(w, h);
    const portrait = h > w * 1.12;
    const base = Math.max(0.24, Math.min(0.5, vmin / 1500));
    return {
      dist: portrait ? base * 0.72 : base * 0.84,
      sign: portrait ? base * 0.82 : base
    };
  }

  function applyMarkSize() {
    if (!state.map || !state.map.getLayer("nav-marks-sym")) return;
    const s = markIconSize();
    try {
      state.map.setLayoutProperty("nav-marks-sym", "icon-size", [
        "match",
        ["get", "kind"],
        "dist",
        s.dist,
        s.sign
      ]);
    } catch (_e) {}
  }

  function ensureMarkLayer() {
    if (!state.map || !state.map.isStyleLoaded()) return;
    if (!state.map.getSource("nav-marks")) {
      state.map.addSource("nav-marks", { type: "geojson", data: EMPTY });
    }
    if (!state.map.getLayer("nav-marks-sym")) {
      state.map.addLayer({
        id: "nav-marks-sym",
        type: "symbol",
        source: "nav-marks",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["match", ["get", "kind"], "dist", markIconSize().dist, markIconSize().sign],
          "icon-anchor": "bottom",
          "icon-pitch-alignment": "viewport",
          "icon-rotation-alignment": "viewport",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });
    }
    applyMarkSize();
  }

  function setMarkData(features) {
    ensureMarkLayer();
    const src = state.map && state.map.getSource("nav-marks");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: features || []
    });
  }

  function markFeature(ll, kind, label) {
    const icon = ensureMarkIcon(kind, label);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
      properties: { kind: kind, label: label || "", icon: icon }
    };
  }

  function clearFloatMarks() {
    state.floatKey = "";
    if (state.map && state.map.getSource("nav-marks")) setMarkData([]);
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
      if (state.floatKey) clearFloatMarks();
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
    const feats = [];
    const here = state.traveled || 0;
    const nearM = 90;
    let shown = 0;
    for (let i = 0; i < state.limits.length && shown < 5; i++) {
      const seg = state.limits[i];
      if (seg.start < here + nearM) continue;
      if (seg.start > here + 2600) break;
      if (i > 0 && state.limits[i - 1].limit === seg.limit) continue;
      if (!seg.limit) continue;
      const p = alongLine(state.coords, seg.start);
      if (!p) continue;
      feats.push(markFeature(p, "limit", String(seg.limit)));
      shown += 1;
    }
    (state.cameras || []).forEach(function (cam) {
      if (cam.traveled < here + nearM) return;
      if (cam.traveled > here + 2200) return;
      feats.push(markFeature(cam, "cam", ""));
    });
    if (cur && cur.until > 70 && cur.until < 1400) {
      const loc = cur.step && cur.step.maneuver && cur.step.maneuver.location;
      const p =
        loc && Number.isFinite(loc[0])
          ? { lng: loc[0], lat: loc[1] }
          : alongLine(state.coords, here + Math.max(nearM, cur.until));
      if (p) {
        const extra = nxt && nxt.dist < 220 && nxt.limit ? " · " + nxt.limit : "";
        feats.push(markFeature(p, "dist", fmtTurnDist(cur.until) + extra));
      }
    }
    setMarkData(feats);
    pushArcadeWorld();
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
            attributes: ["edge.speed_limit", "edge.road_class", "edge.length", "edge.names", "edge.weighted_grade"],
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
      const posted = Number(raw) >= 5 && Number(raw) <= 140;
      const limit = posted ? Number(raw) : legalLimit(raw, cls);
      const urban = inferUrban(limit, cls);
      const gradeRaw = Number(
        (hit.edge && hit.edge.weighted_grade) ||
          (hit.edge_info && hit.edge_info.weighted_grade)
      );
      applyRoad(
        {
          limit,
          urban,
          cls,
          posted: posted,
          grade: Number.isFinite(gradeRaw) ? gradeRaw : 0
        },
        true
      );
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
    if ($("status") && !$("status").classList.contains("is-err")) {
      setStatus(kind.label + (kind.street ? " · " + kind.street : ""));
    }
    paintLanes(kind.highway);
    const thenRow = $("thenRow");
    const thenSoon = then && then.kind && then.kind.cat !== "arrive" && then.until - cur.until < 420;
    if (thenSoon) {
      thenRow.hidden = false;
      $("thenIcon").textContent = then.kind.icon;
      $("thenText").textContent = "Majd: " + then.kind.label;
    } else {
      thenRow.hidden = true;
    }
    if (kind.cat !== "arrive" && cur.until <= warn && isSnappedToRoute()) {
      const ev = window.NavVoice && window.NavVoice.eventFromCat ? window.NavVoice.eventFromCat(kind.cat) : "";
      if (ev) playNavCue(ev, "step:" + cur.index);
    }
    paintArHud();
    syncFloatMarks();
    if ((kind.cat === "arrive" && cur.until < 40 && !state.arrived) || (r.m < 35 && !state.arrived)) {
      state.arrived = true;
      stopNav({ arrived: true });
    }
  }

  function routeOpts() {
    return {
      avoidMotorway: !!( ($("avoidMotorway") && $("avoidMotorway").checked) || state.kaland ),
      avoidToll: !!( $("avoidToll") && $("avoidToll").checked )
    };
  }

  function osrmExcludeQs() {
    if (state.kaland) return "";
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

  function pickOsrmRoute(routes, from, to) {
    if (!routes || !routes[0]) throw new Error("Nincs útvonal");
    if (!state.kaland || routes.length < 2) return routes[0];
    const straight = Math.max(1, haversine(from, to));
    let best = routes[0];
    let bestScore = -1;
    routes.forEach(function (r) {
      const dist = Number(r.distance) || 0;
      let steps = 0;
      (r.legs || []).forEach(function (leg) {
        steps += (leg.steps || []).length;
      });
      let motor = 0;
      (r.legs || []).forEach(function (leg) {
        (leg.steps || []).forEach(function (s) {
          const hint = String(s.name || "") + " " + String(s.ref || "");
          if (/motorway|autópálya|\bM\d/i.test(hint)) motor += Number(s.distance) || 0;
        });
      });
      const pts = (r.geometry && r.geometry.coordinates && r.geometry.coordinates.length) || 0;
      const score = dist / straight + steps * 0.02 + pts * 0.0004 - motor / Math.max(dist, 1);
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    });
    return best;
  }

  async function fetchOsrm(from, to, extraQs) {
    const rad = Math.max(25, Math.min(80, Math.round((state.gpsAcc || 35) + 8)));
    const baseSnap = state.kaland
      ? ""
      : "&continue_straight=true&radiuses=" + rad + ";" + rad;
    let qs = extraQs || "";
    if (state.kaland) qs = qs.replace(/&?exclude=[^&]*/gi, "");
    function pathWith(snapQs) {
      const kalandQs = state.kaland
        ? "?geometries=geojson&overview=full&alternatives=true&steps=true"
        : "?overview=full&geometries=geojson&steps=true";
      return (
        from.lng +
        "," +
        from.lat +
        ";" +
        to.lng +
        "," +
        to.lat +
        kalandQs +
        snapQs +
        qs
      );
    }
    function tryPath(snapQs) {
      const path = pathWith(snapQs);
      const jobs = OSRM.map(function (base) {
        const url = base + "/" + path;
        state.lastOsrmUrl = url;
        return fetchJson(url, null, 6500).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        }).then(function (data) {
          if (data.code !== "Ok" || !data.routes || !data.routes[0]) throw new Error("Nincs útvonal");
          return pickOsrmRoute(data.routes, from, to);
        });
      });
      return Promise.any(jobs);
    }
    try {
      if (!state.kaland && state.navigating && Number.isFinite(state.heading) && (state.speed || 0) > 3) {
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
      const tries = state.kaland
        ? [
            function () { return fetchOsrm(state.origin, state.dest, ""); },
            function () { return fetchValhalla(state.origin, state.dest); }
          ]
        : exclude
        ? [
            function () { return fetchTomTomRoute(state.origin, state.dest); },
            function () { return fetchValhalla(state.origin, state.dest); },
            function () { return fetchOsrm(state.origin, state.dest, exclude); }
          ]
        : [
            function () { return fetchTomTomRoute(state.origin, state.dest); },
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
      state.traffic = (route.traffic && route.traffic.length) ? route.traffic : null;
      AppState.activeRoute = { coords: state.coords, distance: Number(route.distance) || 0 };
      state.steps = [];
      state.limits = [];
      state.snapI = 1;
      state.routeLen = Number(route.distance) || lineLen(state.coords);
      (route.legs || []).forEach((leg) => (leg.steps || []).forEach((s) => state.steps.push(s)));
      if (reroute && state.coords.length) state.traveled = nearest(state.coords, state.origin).traveled;
      else state.traveled = 0;
      state.arrived = false;
      state.audioCue = {};
      state.lastSpeedWarn = 0;
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

  function fetchRoute(reroute) {
    return plan(reroute);
  }

  function seedDemoRoute() {
    const o = { lng: BUDAPEST[0], lat: BUDAPEST[1] };
    state.origin = o;
    const coords = [];
    let heading = 12;
    let p = { lng: o.lng, lat: o.lat };
    coords.push([p.lng, p.lat]);
    for (let i = 0; i < 90; i++) {
      heading += Math.sin(i / 5.5) * 9;
      if (i === 16) heading = 78;
      if (i === 28) heading = 142;
      if (i === 40) heading = 88;
      if (i === 54) heading = 198;
      if (i === 68) heading = 255;
      if (i === 80) heading = 310;
      p = offsetLngLat(p, heading, 22);
      coords.push([p.lng, p.lat]);
    }
    const dest = { lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1] };
    setDest(dest, "Szimuláció");
    state.route = {
      distance: lineLen(coords),
      duration: 28 * 60,
      geometry: { coordinates: coords },
      legs: [{ steps: [] }]
    };
    state.coords = coords;
    state.routeLen = state.route.distance;
    state.steps = [];
    state.traveled = 8;
    state.limits = [
      { start: 0, end: 90, limit: 50, urban: true, cls: "residential" },
      { start: 90, end: 420, limit: 70, urban: false, cls: "primary" },
      { start: 420, end: 1400, limit: 50, urban: true, cls: "residential" },
      { start: 1400, end: 99999, limit: 50, urban: true, cls: "residential" }
    ];
    const cam = alongLine(coords, 160);
    const cam2 = alongLine(coords, 380);
    state.cameras = [];
    if (cam) state.cameras.push({ lng: cam.lng, lat: cam.lat, traveled: 160 });
    if (cam2) state.cameras.push({ lng: cam2.lng, lat: cam.lat, traveled: 380 });
    state.road = { limit: 50, urban: true, cls: "residential" };
    state.simOwnedRoute = true;
    state.arcadePreview = true;
    addLayers();
    drawRoute();
    paintRoadUi();
    return coords;
  }

  function syncSimBtn() {
    const btn = $("simDriveBtn");
    if (!btn) return;
    const on = !!state.simulating;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Szimuláció leállítása" : "Tesztvezetés 50 km/h";
    const label = btn.querySelector("span");
    if (label) label.textContent = on ? "Stop" : "Teszt 50";
  }

  function beginSimDrive() {
    if (state.coords.length < 2) return setStatus("Előbb tervezz útvonalat.", true);
    state.simulating = true;
    state.speed = SIM_MS;
    AppState.speed = SIM_MS;
    if (!(state.traveled > 0)) state.traveled = 4;
    const along = alongLine(state.coords, state.traveled);
    const br = routeTangent(state.coords, state.traveled);
    if (along) {
      AppState.targetPos.lat = along.lat;
      AppState.targetPos.lng = along.lng;
      AppState.targetPos.bearing = br;
      AppState.targetPos._coasting = true;
      AppState.currentPos.lat = along.lat;
      AppState.currentPos.lng = along.lng;
      AppState.currentPos.bearing = br;
      AppState.currentPos._seeded = true;
      state.origin = { lng: along.lng, lat: along.lat };
      state.heading = br;
      state.camHeading = br;
      if (window.NavCar3D && typeof window.NavCar3D.setPose === "function") {
        window.NavCar3D.setPose(along.lng, along.lat, br, 0, SIM_MS);
      }
    }
    state.follow = true;
    if ($("follow")) {
      $("follow").classList.add("is-on");
      $("follow").setAttribute("aria-pressed", "true");
    }
    if (!state.navigating) startNav();
    unlockNavVoice();
    if (window.NavCar3D && typeof window.NavCar3D.setOverview === "function") {
      window.NavCar3D.setOverview(false);
    }
    setStatus("Szimuláció 50 km/h");
    syncSimBtn();
    startSmooth();
    state._3dRouteAt = null;
    if (window.NavCar3D && typeof window.NavCar3D.invalidateWorld === "function") {
      window.NavCar3D.invalidateWorld();
    }
    pushArcadeWorld();
    startTrafficPoll();
  }

  function startSimDrive() {
    if (state.simulating) return;
    if (state.coords.length < 2) seedDemoRoute();
    beginSimDrive();
  }

  function stopSimDrive(opts) {
    if (!state.simulating && !(opts && opts.arrived)) {
      syncSimBtn();
      return;
    }
    state.simulating = false;
    state.speed = 0;
    AppState.speed = 0;
    syncSimBtn();
    if (opts && opts.arrived) {
      setStatus("Szimuláció vége");
      stopNav({ arrived: true });
      return;
    }
    if (state.arcadePreview || state.simOwnedRoute) {
      stopNav(opts);
      return;
    }
    setStatus("Szimuláció ki — GPS");
  }

  function maybeArcadePreview() {
    if (!/[?&](?:arcade|demo)=1/.test(location.search) || state.navigating || state.arcadePreview) return;
    seedDemoRoute();
    startSimDrive();
  }

  function startNav() {
    if (!state.route) return;
    state.pendingPlan = false;
    state.navigating = true;
    $("app").classList.add("is-nav");
    document.documentElement.classList.add("is-nav");
    fitDashLayout();
    $("trip").hidden = false;
    $("banner").hidden = false;
    setArcadeMapMode(true);
    pushArcadeWorld();
    closeDrawer("keep");
    closeSearch("keep");
    armBack();
    window.scrollTo(0, 0);
    spyNav();
    if (state.map) state.map.resize();
    state.follow = true;
    $("follow").classList.add("is-on");
    $("follow").setAttribute("aria-pressed", "true");
    try {
      if (state.map) {
        state.map.setPitch(CAM_PITCH_NAV);
        state.map.setZoom(20.25);
      }
    } catch (_cam) {}
    if (state.coords.length >= 2) {
      state.heading = bearing(
        { lng: state.coords[0][0], lat: state.coords[0][1] },
        { lng: state.coords[1][0], lat: state.coords[1][1] }
      );
      state.camHeading = state.heading;
    }
    startTrafficPoll();
    unlockNavVoice();
    setStatus(state.kaland ? "Kaland mód" : "Navigáció");
    showPinAdjust();
    if (window.NavVoice && window.NavVoice.close) window.NavVoice.close();
    updateNav();
    updateRoadFromRoute();
    updateCamera(true);
    paintArHud();
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
      if (!lock) return;
      wakeLock = lock;
      on(lock, "release", function () {
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
    stopTrafficPoll();
    state.navigating = false;
    state.arcadePreview = false;
    state.simulating = false;
    state.simOwnedRoute = false;
    state.follow = false;
    syncSimBtn();
    if ($("follow")) {
      $("follow").classList.remove("is-on");
      $("follow").setAttribute("aria-pressed", "false");
    }
    state.pendingPlan = false;
    $("app").classList.remove("is-nav");
    document.documentElement.classList.remove("is-nav");
    fitDashLayout();
    $("trip").hidden = true;
    $("banner").hidden = true;
    setArcadeMapMode(false);
    if (window.NavCar3D) {
      if (window.NavCar3D.setRoute) window.NavCar3D.setRoute([], arcadeOrigin());
      if (window.NavCar3D.setMarkers) window.NavCar3D.setMarkers([], arcadeOrigin());
      if (window.NavCar3D.setBuildings) window.NavCar3D.setBuildings([], arcadeOrigin());
    }
    if ($("lanes")) {
      $("lanes").hidden = true;
      $("lanes").innerHTML = "";
    }
    if ($("roadThen")) $("roadThen").hidden = true;
    if ($("hazardThen")) $("hazardThen").hidden = true;
    setStatus(opts && opts.arrived ? "Megérkeztél" : "Megállítva");
    if (opts && opts.arrived) playNavCue("arrived", "arrived");
    paintArHud();
    AppState.activeRoute = null;
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
    if (window.NavSw && window.NavSw.applyPending) window.NavSw.applyPending();
    showPinAdjust();
  }

  function maybeReroute() {
    if (state.arcadePreview || state.simulating) return;
    if (!state.navigating || !state.dest || state.planning) return;
    const coords =
      (AppState.activeRoute && AppState.activeRoute.coords) || state.coords || [];
    if (!coords.length) return;
    const raw = state.rawGps || {};
    const here = {
      lat: Number.isFinite(raw.lat) ? raw.lat : AppState.currentPos.lat,
      lng: Number.isFinite(raw.lng) ? raw.lng : AppState.currentPos.lng
    };
    if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) return;
    const snap = nearest(coords, here);
    if (!(snap.dist > OFF_ROUTE_M)) {
      state.offHits = 0;
      return;
    }
    state.offHits += 1;
    if (state.offHits < 2) return;
    if (Date.now() - state.lastOff < 6000) return;
    state.lastOff = Date.now();
    state.offHits = 0;
    playNavCue("recalculating");
    fetchRoute(true);
  }

  function ingestGps(pos) {
    if (state.arcadePreview || state.simulating) return;
    const c = pos && pos.coords;
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
    const acc = Number(c.accuracy);
    const raw = { lat: c.latitude, lng: c.longitude };
    const now = Date.now();
    let spd = c.speed;
    if ((spd == null || isNaN(spd) || spd < 0) && state.lastFix) {
      const dt = (now - state.lastFix.t) / 1000;
      if (dt > 0.4 && dt < 8) spd = haversine(state.lastFix.ll, raw) / dt;
    }
    if (spd == null || isNaN(spd) || spd < 0) spd = AppState.speed || 0;
    if (!plausibleJump(state.lastFix, { ll: raw, t: now, speed: spd || 0 }, acc)) {
      state.fixRejects = (state.fixRejects || 0) + 1;
      if (state.fixRejects < 3) return;
    }
    state.fixRejects = 0;
    if (!state.weatherSeeded) {
      state.weatherSeeded = true;
      fetchWeather(raw.lat, raw.lng);
    }
    const kmh = (spd || 0) * 3.6;
    const gpsHeading = Number.isFinite(c.heading) && kmh >= PATH_HEADING_KMH ? c.heading : AppState.targetPos.bearing;
    state.rawGps = raw;
    state.lastFix = { ll: raw, t: now, speed: spd || 0, heading: gpsHeading };
    AppState.accuracy = acc;
    state.gpsAcc = acc;
    AppState.speed = spd;
    const tgt = AppState.targetPos;
    const locked = lockToRoute(raw, { speed: spd, heading: gpsHeading });
    if (locked) {
      tgt.lat = locked.lat;
      tgt.lng = locked.lng;
      tgt.bearing = locked.bearing;
      if (!tgt._coasting) {
        AppState.currentPos.lat = locked.lat;
        AppState.currentPos.lng = locked.lng;
        AppState.currentPos.bearing = locked.bearing;
        AppState.currentPos._seeded = true;
      }
    } else if (tgt._coasting && Number.isFinite(tgt.lat) && Number.isFinite(tgt.lng)) {
      tgt.lat = lerp(tgt.lat, raw.lat, GPS_CORRECT);
      tgt.lng = lerp(tgt.lng, raw.lng, GPS_CORRECT);
    } else {
      tgt.lat = raw.lat;
      tgt.lng = raw.lng;
      AppState.currentPos.lat = raw.lat;
      AppState.currentPos.lng = raw.lng;
      if (kmh >= PATH_HEADING_KMH) AppState.currentPos.bearing = gpsHeading || 0;
      AppState.currentPos._seeded = true;
    }
    tgt._coasting = true;
    if (!locked && Number.isFinite(c.heading) && kmh >= PATH_HEADING_KMH) {
      tgt.bearing = mixHeading(tgt.bearing || gpsHeading, gpsHeading, 0.55);
    }
    startSmooth();
  }

  function tickGpsHud() {
    const raw = state.lastFix && state.lastFix.ll;
    if (raw) watchPark(raw, AppState.speed);
    const acc = AppState.accuracy || 0;
    if (state.navigating && acc > 50) {
      state.gpsHits += 1;
      if (state.gpsHits >= 3 && Date.now() - state.lastGpsWarn > 40000) {
        state.lastGpsWarn = Date.now();
        setStatus("Gyenge GPS", true);
      }
    } else {
      state.gpsHits = 0;
      if (!state.navigating && !state.arrived && raw) setStatus("GPS kész");
    }
    if (state.navigating && state.gpsHits === 0) paintRoadUi();
  }

  function onPos(pos) {
    ingestGps(pos);
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
    const title = street || p.name || p.city || p.county || "Hely";
    const kind = p.housenumber || /house|building/i.test(String(p.type || p.osm_value || ""))
      ? "house"
      : p.osm_value || p.type;
    return finishPlace(
      c[1],
      c[0],
      title,
      [street, p.district, p.city || p.county, p.country],
      kind
    );
  }

  function fromNominatim(item) {
    const a = item.address || {};
    const street = [a.road || a.pedestrian || a.residential, a.house_number].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.municipality || a.county || "";
    const title = street || item.name || city || "Hely";
    const kind = a.house_number || /house|building/i.test(String(item.addresstype || item.type || ""))
      ? "house"
      : item.addresstype || item.type;
    return finishPlace(
      item.lat,
      item.lon,
      title,
      [street, a.suburb || a.neighbourhood || a.city_district, city, a.country],
      kind
    );
  }

  function parseAddress(q) {
    const raw = String(q || "").trim().replace(/\s+/g, " ");
    let city = "";
    let rest = raw;
    const postal = rest.match(/^(\d{4})\s+([^,]+?)(?:,\s*|\s+)(.+)$/);
    if (postal) {
      city = postal[2].trim();
      rest = postal[3].trim();
    } else {
      const comma = rest.match(/^(.+),\s*([^,]+)$/);
      if (comma) {
        const left = comma[1].trim();
        const right = comma[2].trim();
        if (/\d/.test(left) && !/\d/.test(right)) {
          rest = left;
          city = right;
        } else if (/\d/.test(right) && !/\d/.test(left)) {
          city = left;
          rest = right;
        }
      }
    }
    const m = rest.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:[\/.\-]\d+[a-zA-Z]?)?)\.?$/);
    if (!m || String(m[1]).trim().length < 2) {
      return { raw: raw, street: "", number: "", city: city };
    }
    return {
      raw: raw,
      street: m[1].replace(/,\s*$/, "").trim(),
      number: m[2],
      city: city
    };
  }

  function photonQuery(q, layer) {
    let u = "https://photon.komoot.io/api/?limit=12&lang=hu&q=" + encodeURIComponent(q);
    if (layer) u += "&layer=" + encodeURIComponent(layer);
    const o = state.origin;
    if (o && Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
      u += "&lat=" + o.lat + "&lon=" + o.lng;
    }
    return u;
  }

  async function fetchPhoton(q, layer) {
    const res = await fetch(photonQuery(q, layer));
    if (!res.ok) return [];
    const data = await res.json();
    if (data && data.lang) return [];
    return (data.features || []).map(fromPhoton).filter(function (p) {
      return Number.isFinite(p.lat) && Number.isFinite(p.lon);
    });
  }

  async function fetchNominatim(q, parsed) {
    let url = NOMINATIM + "?format=jsonv2&addressdetails=1&limit=8&countrycodes=hu&accept-language=hu";
    if (parsed && parsed.number && parsed.street) {
      url += "&street=" + encodeURIComponent(parsed.street + " " + parsed.number);
      if (parsed.city) url += "&city=" + encodeURIComponent(parsed.city);
    } else {
      url += "&q=" + encodeURIComponent(q);
    }
    const o = state.origin;
    if (o && Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
      const d = 0.35;
      url += "&viewbox=" + (o.lng - d) + "," + (o.lat + d) + "," + (o.lng + d) + "," + (o.lat - d);
    }
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("A keresés sikertelen.");
    const data = await res.json();
    return (data || []).map(fromNominatim).filter(function (p) {
      return Number.isFinite(p.lat) && Number.isFinite(p.lon);
    });
  }

  async function reversePlace(lat, lng) {
    const fallback = {
      lat: lat,
      lon: lng,
      title: Number(lat).toFixed(5) + ", " + Number(lng).toFixed(5),
      subtitle: "Térképpont",
      display_name: Number(lat).toFixed(5) + ", " + Number(lng).toFixed(5)
    };
    try {
      const url =
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=hu&lat=" +
        lat +
        "&lon=" +
        lng;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const item = await res.json();
        if (item && (item.lat || item.lon || item.address)) {
          const p = fromNominatim(item);
          if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
        }
      }
    } catch (_e) {}
    try {
      const res = await fetch("https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lng + "&lang=hu");
      if (res.ok) {
        const data = await res.json();
        const f = data && data.features && data.features[0];
        if (f) {
          const p = fromPhoton(f);
          if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
        }
      }
    } catch (_e2) {}
    return fallback;
  }

  function houseScore(p, parsed) {
    const title = String((p && p.title) || "");
    const sub = String((p && p.subtitle) || "").toLowerCase();
    let s = 5;
    if (sub.indexOf("házszám") >= 0) s = 0;
    else if (sub.indexOf("utca") >= 0) s = 3;
    if (parsed && parsed.number) {
      const n = String(parsed.number).replace(/\s/g, "");
      const re = new RegExp("(^|\\s)" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?!\\d)", "i");
      if (re.test(title)) s -= 2;
    }
    if (parsed && parsed.city) {
      const blob = (title + " " + String((p && p.subtitle) || "")).toLowerCase();
      if (blob.indexOf(String(parsed.city).toLowerCase()) >= 0) s -= 1;
    }
    return s;
  }

  function mergePlaces(lists, parsed) {
    const seen = {};
    const out = [];
    lists.forEach(function (list) {
      (list || []).forEach(function (p) {
        if (!p) return;
        const k = Number(p.lat).toFixed(5) + "," + Number(p.lon).toFixed(5) + "|" + String(p.title || "");
        if (seen[k]) return;
        seen[k] = true;
        out.push(p);
      });
    });
    out.sort(function (a, b) {
      return houseScore(a, parsed) - houseScore(b, parsed);
    });
    return out;
  }

  async function geocode(q) {
    const parsed = parseAddress(q);
    const jobs = [];
    if (parsed.number) jobs.push(fetchPhoton(q, "house").catch(function () { return []; }));
    jobs.push(fetchPhoton(q).catch(function () { return []; }));
    jobs.push(fetchNominatim(q, parsed).catch(function () { return []; }));
    if (parsed.number && parsed.street && parsed.city) {
      jobs.push(fetchNominatim(parsed.street + " " + parsed.number + ", " + parsed.city, {
        street: parsed.street,
        number: parsed.number,
        city: ""
      }).catch(function () { return []; }));
    }
    const batches = await Promise.all(jobs);
    const list = mergePlaces(batches, parsed);
    if (!list.length) throw new Error("Nincs találat.");
    return list.slice(0, 10);
  }

  function showResults(list) {
    const box = $("results");
    if (!box) return;
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
      on(btn, "click", function () {
        choose(p);
      });
      li.appendChild(btn);
      box.appendChild(li);
    });
    box.hidden = !list.length;
  }

  async function choose(place, opts) {
    opts = opts || {};
    if ($("results")) $("results").hidden = true;
    closeSearch("keep");
    showHome();
    const label = place.title || place.display_name || "";
    const dest = { lat: Number(place.lat), lng: Number(place.lon) };
    setDest(dest, label);
    paintCar();
    if ($("q")) $("q").value = label;
    focusDest(dest);
    if (!state.origin) state.origin = { lng: BUDAPEST[0], lat: BUDAPEST[1] };
    try {
      await plan(false);
    } catch (_e) {}
    startSimDrive();
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
      startSimDrive();
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

  function seedOriginFromCar() {
    if (state.origin) return;
    if (!state.car || !Number.isFinite(state.car.lat) || !Number.isFinite(state.car.lng)) return;
    state.origin = { lat: state.car.lat, lng: state.car.lng };
    AppState.targetPos.lat = state.car.lat;
    AppState.targetPos.lng = state.car.lng;
    AppState.currentPos.lat = state.car.lat;
    AppState.currentPos.lng = state.car.lng;
    AppState.currentPos._seeded = true;
  }

  function fitDashLayout() {
    var w = window.innerWidth || document.documentElement.clientWidth || 0;
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    if (window.visualViewport) {
      if (window.visualViewport.width) w = window.visualViewport.width;
      if (window.visualViewport.height) h = window.visualViewport.height;
    }
    var home = $("kezdolap");
    var mapEl = $("map");
    var arcade = $("arcade3d");
    if (home && h) {
      home.style.height = h + "px";
      home.style.minHeight = h + "px";
    }
    [mapEl, arcade].forEach(function (el) {
      if (!el) return;
      el.style.top = "0px";
      el.style.right = "0px";
      el.style.bottom = "0px";
      el.style.left = "0px";
      el.style.width = "100%";
      el.style.height = "100%";
    });
    if (state.map && typeof state.map.resize === "function") {
      try {
        state.map.resize();
      } catch (_r) {}
    }
    if (w && h) document.documentElement.classList.toggle("is-portrait", h >= w);
  }

  function loadPlaces() {
    try {
      state.places = Object.assign({ home: null, work: null }, JSON.parse(localStorage.getItem(PLACE_KEY) || "{}"));
    } catch (_e) {
      state.places = { home: null, work: null };
    }
    loadCar();
    seedOriginFromCar();
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

  function pastelFallbackStyle(dark) {
    return {
      version: 8,
      name: "toonnavi-pastel",
      sources: {},
      layers: [
        {
          id: "bg",
          type: "background",
          paint: { "background-color": "#d8f0a8" }
        }
      ]
    };
  }

  async function probePmtiles() {
    const url = europePmtilesUrl();
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-15" },
        cache: "no-store"
      });
      if (!res.ok) return false;
      const buf = await res.arrayBuffer();
      const u8 = new Uint8Array(buf);
      return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4d;
    } catch (_e) {
      return false;
    }
  }

  async function fetchRemoteStyle(dark) {
    const url = dark ? STYLES.dark : STYLES.light;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("style " + res.status);
    return res.json();
  }

  async function resolveMapStyle(dark) {
    if (await probePmtiles()) {
      try {
        const local = await loadEuropeStyle(false);
        if (local) {
          state.mapOffline = true;
          return local;
        }
      } catch (_e) {}
    }
    try {
      const remote = await fetchRemoteStyle(false);
      state.mapOffline = false;
      return remote;
    } catch (_e2) {
      state.mapOffline = false;
      return pastelFallbackStyle(dark);
    }
  }

  function localVectorSource() {
    try {
      const q = new URLSearchParams(location.search);
      const tiles = String(q.get("tiles") || "").trim();
      if (tiles.indexOf("{z}") !== -1) {
        return {
          type: "vector",
          tiles: [tiles],
          attribution: "© OpenStreetMap"
        };
      }
      if (tiles) {
        const url = /^pmtiles:\/\//i.test(tiles) ? tiles : "pmtiles://" + tiles;
        return {
          type: "vector",
          url: url,
          attribution: "© OpenStreetMap © Protomaps"
        };
      }
    } catch (_e) {}
    return {
      type: "vector",
      url: "pmtiles://" + europePmtilesUrl(),
      attribution: "© OpenStreetMap © Protomaps"
    };
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
    let base = null;
    try {
      const res = await fetch(LOCAL_STYLE, { cache: "no-store" });
      if (res.ok) base = await res.json();
    } catch (_e) {}
    let layers = base && Array.isArray(base.layers) ? base.layers : null;
    if (!layers) {
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
    }
    const source = localVectorSource();
    if (layers && !dark) {
      layers = layers.map(function (layer) {
        if (!layer || layer.id !== "bg") return layer;
        return Object.assign({}, layer, {
          paint: Object.assign({}, layer.paint, { "background-color": "#d8f0a8" })
        });
      });
    }
    return {
      version: 8,
      name: (base && base.name) || "Navigáció offline",
      glyphs: (base && base.glyphs) || "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sprite: (base && base.sprite) || "https://protomaps.github.io/basemaps-assets/sprites/v4/" + flavor,
      sources: {
        protomaps: source
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
      on(v, ev, function () {
        if (!camVideoLive()) return;
        const root = $("app");
        if (root) root.classList.add("has-ar-cam");
        markCamOk();
      });
    });
    on(v, "error", function () {
      const root = $("app");
      if (root) root.classList.remove("has-ar-cam");
      if (state.ar && !native360Pinned()) markCamError();
    });
    ["stalled", "emptied", "suspend"].forEach(function (ev) {
      on(v, ev, function () {
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
      stripRaster();
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
    resolveMapStyle(dark)
      .then(function (st) {
        state.map.setStyle(st || pastelFallbackStyle(dark));
        done();
      })
      .catch(function () {
        state.mapOffline = false;
        state.map.setStyle(pastelFallbackStyle(dark));
        done();
      });
  }

  function bindMapEvents(dark) {
    window.NavMap = state.map;
    state.map.on("idle", addHouseNumbers);
    startSmooth();
    let ready = false;
    state.map.once("load", function () {
      ready = true;
    });
    window.setTimeout(function () {
      if (ready) return;
      if (state.mapOffline) {
        state.mapOffline = false;
        state.map.setStyle(dark ? STYLES.dark : STYLES.light);
        state.map.once("style.load", addLayers);
        setStatus("Online utcaszintű térkép");
      }
    }, 8000);
    state.map.on("error", function (e) {
      const msg = String((e && e.error && (e.error.message || e.error.statusText)) || "");
      if (!msg) return;
      if (!state.tileFallback && /failed to fetch|404|pmtiles|networkerror|load tile/i.test(msg)) {
        state.tileFallback = true;
        try {
          state.map.setStyle(pastelFallbackStyle(document.documentElement.classList.contains("dark")));
        } catch (_fb) {}
      }
    });
    state.map.on("load", function () {
      addLayers();
      maybeArcadePreview();
    });
    state.map.on("style.load", function () {
      addLayers();
      applyMarkSize();
      maybeArcadePreview();
    });
    on(window, "resize", applyMarkSize);
    try {
      state.map.dragPan.enable();
      state.map.touchZoomRotate.enable();
      if (state.map.touchPitch) state.map.touchPitch.enable();
    } catch (_e3) {}
    function unlockFollow(ev) {
      if (ev && ev.type !== "dragstart" && !ev.originalEvent) return;
      if (!state.follow) return;
      state.follow = false;
      if ($("follow")) {
        $("follow").classList.remove("is-on");
        $("follow").setAttribute("aria-pressed", "false");
      }
      if (window.NavCar3D && typeof window.NavCar3D.setOverview === "function") {
        window.NavCar3D.setOverview(true);
      }
    }
    state.map.on("dragstart", unlockFollow);
    state.map.on("rotatestart", unlockFollow);
    state.map.on("pitchstart", unlockFollow);
    state.map.on("zoomstart", unlockFollow);
    let t = 0;
    let start = null;
    function armLongPress(lngLat, ev) {
      clearTimeout(t);
      const tgt = ev && ev.originalEvent && ev.originalEvent.target;
      if (state.pinDragging) return;
      if (tgt && tgt.closest && tgt.closest(".pin")) return;
      start = lngLat;
      t = window.setTimeout(function () {
        const ll = start;
        if (!ll) return;
        reversePlace(ll.lat, ll.lng).then(function (place) {
          choose(place, { autoPlan: true });
        });
      }, 550);
    }
    state.map.on("mousedown", (e) => armLongPress(e.lngLat, e));
    state.map.on("touchstart", (e) => {
      if (e.points && e.points.length > 1) {
        clearTimeout(t);
        return;
      }
      armLongPress(e.lngLat, e);
    });
    ["mouseup", "mousemove", "dragstart", "touchend", "touchmove"].forEach((ev) =>
      state.map.on(ev, () => clearTimeout(t))
    );
  }

  function createNavMap(style) {
    const container = $("map");
    if (!container) throw new Error("Hiányzik a térkép konténer (#map).");
    return new maplibregl.Map({
      container: container,
      style: style,
      center: BUDAPEST,
      zoom: 13.5,
      pitch: 78,
      maxPitch: 85,
      fadeDuration: 0,
      renderWorldCopies: false,
      attributionControl: true
    });
  }

  function initMap() {
    if (typeof maplibregl === "undefined") {
      setStatus("A térképkönyvtár nem töltődött be. Frissítsd az oldalt.", true);
      return Promise.resolve();
    }
    registerPmtiles();
    try {
      if (!localStorage.getItem(THEME_KEY)) localStorage.setItem(THEME_KEY, "dark");
      if (TOMTOM_API_KEY) localStorage.setItem("nav2_tomtom_key", TOMTOM_API_KEY);
    } catch (_e) {}
    const dark = localStorage.getItem(THEME_KEY) !== "light";
    document.documentElement.classList.toggle("dark", dark);
    if ($("dark")) $("dark").checked = dark;
    return resolveMapStyle(dark)
      .then(function (st) {
        state.map = createNavMap(st || pastelFallbackStyle(dark));
        bindMapEvents(dark);
      })
      .catch(function () {
        state.mapOffline = false;
        state.map = createNavMap(pastelFallbackStyle(dark));
        bindMapEvents(dark);
      });
  }

  function bindInstall() {
    const btn = $("installBtn");
    const hint = $("installHint");
    if (!btn) return;
    let deferred = null;
    function standalone() {
      return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    }
    on(window, "beforeinstallprompt", function (ev) {
      ev.preventDefault();
      deferred = ev;
      btn.hidden = false;
      if (hint) hint.textContent = "Nyomd meg: Telepítés a fejegységre. Fekvő standalone app, offline cache-ből nyílik.";
    });
    on(btn, "click", function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.finally(function () {
          deferred = null;
        });
        return;
      }
      if (standalone()) {
        setStatus("Már telepítve van.");
        return;
      }
      setStatus("Chrome menü: Telepítés alkalmazásként");
      if (hint) hint.textContent = "Chrome jobb felső menü → Telepítés alkalmazásként, vagy Hozzáadás a kezdőképernyőhöz.";
    });
    if (standalone()) btn.textContent = "Telepítve — offline kész";
    on(window, "appinstalled", function () {
      deferred = null;
      btn.textContent = "Telepítve — offline kész";
      setStatus("Telepítve. A következő indítás a cache-ből megy.");
    });
  }

  function bind() {
    bindInstall();
    on("pinAdjustGo", "click", function () {
      startSimDrive();
    });
    on("searchForm", "submit", onSearch);
    on("q", "input", onQueryInput);
    on("stop", "click", stopNav);
    on("simDriveBtn", "click", function () {
      unlockNavVoice();
      if (state.simulating) stopSimDrive();
      else startSimDrive();
    });
    syncSimBtn();
    const follow = $("follow");
    let followHold = 0;
    let followMenu = false;
    on(follow, "click", function (ev) {
      if (followMenu) {
        followMenu = false;
        ev.preventDefault();
        return;
      }
      state.follow = !state.follow;
      follow.classList.toggle("is-on", state.follow);
      follow.setAttribute("aria-pressed", state.follow ? "true" : "false");
      if (window.NavCar3D && typeof window.NavCar3D.setOverview === "function") {
        window.NavCar3D.setOverview(!state.follow);
      }
      if (state.follow) {
        updateCamera(true);
      }
    });
    on(follow, "pointerdown", function () {
      followHold = window.setTimeout(function () {
        followHold = 0;
        followMenu = true;
        openDrawer();
      }, 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
      on(follow, ev, function () {
        if (followHold) clearTimeout(followHold);
        followHold = 0;
      });
    });
    on("arBtn", "click", function () {
      applyAr(!state.ar);
    });
    on("arCheck", "change", function () {
      applyAr($("arCheck") && $("arCheck").checked);
    });
    on(window, "message", function (ev) {
      const d = ev && ev.data;
      if (!d || (d.source !== "nav360" && d.type !== "nav360")) return;
      if (d.state === "error" || d.ok === false) markCamError();
      else markCamOk();
    });
    on("searchBtn", "click", function () {
      toggleSearch();
    });
    on("hamburgerBtn", "click", openDrawer);
    function hideDrawer(ev) {
      if (ev) {
        try {
          ev.preventDefault();
          ev.stopPropagation();
        } catch (_e) {}
      }
      if (!drawerOpen()) return;
      closeDrawer();
    }
    on("closeBtn", "click", hideDrawer);
    on("closeBtn", "pointerup", hideDrawer);
    on("drawerOverlay", "click", hideDrawer);
    on("drawerOverlay", "pointerup", hideDrawer);

    document.querySelectorAll(".nav-link, .mobile-link").forEach(function (link) {
      on(link, "click", function (ev) {
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

    on(window, "scroll", spyNav, { passive: true });
    on(window, "popstate", onPopState);
    on(window, "resize", function () {
      fitDashLayout();
      if (state.navigating && state.follow) updateCamera(true);
    });
    on(window, "orientationchange", function () {
      window.setTimeout(fitDashLayout, 120);
    });
    on(window.visualViewport, "resize", fitDashLayout);
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("portrait").catch(function () {});
      }
    } catch (_or) {}
    on(document, "visibilitychange", function () {
      if (document.visibilityState === "visible" && state.navigating) holdWake();
    });
    spyNav();
    on("homeGo", "click", function () { goPlace("home"); });
    on("workGo", "click", function () { goPlace("work"); });
    on("homeSet", "click", function () { savePlace("home"); });
    on("workSet", "click", function () { savePlace("work"); });
    on("dark", "change", function () {
      applyTheme($("dark") && $("dark").checked);
    });
    ["avoidMotorway", "avoidToll"].forEach(function (id) {
      on(id, "change", function () {
        saveNavOpts();
        const el = $(id);
        const checked = !!(el && el.checked);
        const name = id === "avoidMotorway" ? "Autópálya elkerülése" : "Fizetős utak elkerülése";
        setStatus(name + (checked ? " bekapcsolva" : " kikapcsolva"));
        if (state.origin && state.dest) plan(true);
      });
    });
    on("kalandCheck", "change", function () {
      applyKaland($("kalandCheck") && $("kalandCheck").checked);
    });
    bindGarage();
  }

  function paintGarage() {
    const grid = $("garageGrid");
    if (!grid || !window.NavCar3D) return;
    const models = window.NavCar3D.carModels || {};
    const cur = AppState.selectedCar || (window.NavCar3D && window.NavCar3D.id());
    state.carModel = cur;
    grid.innerHTML = "";
    Object.keys(models).forEach(function (id) {
      const spec = models[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "garage-card" + (id === cur ? " is-on" : "");
      btn.setAttribute("data-car", id);
      btn.setAttribute("aria-pressed", id === cur ? "true" : "false");
      btn.innerHTML =
        '<span class="garage-preview">' +
        '<canvas data-car-preview="' +
        id +
        '" width="320" height="200" aria-hidden="true"></canvas>' +
        '<span class="garage-swatch">' +
        carIconHtml(id, "g-" + id) +
        "</span></span><span class=\"garage-brand\">" +
        (spec.brand || "") +
        '</span><span class="garage-type">' +
        (spec.type || spec.name || id) +
        '</span><span class="garage-hint">' +
        (spec.hint || "") +
        "</span>";
      on(btn, "click", function () {
        chooseCar(id);
      });
      grid.appendChild(btn);
    });
  }

  function chooseCar(id) {
    const models = (window.NavCar3D && window.NavCar3D.carModels) || {};
    if (!models[id]) id = "verso";
    AppState.selectedCar = id;
    state.carModel = id;
    try {
      localStorage.setItem(CAR_LS_KEY, id);
      localStorage.setItem(GARAGE_LS_KEY, id);
    } catch (_e) {}
    window.dispatchEvent(new CustomEvent("carModelChanged", { detail: id }));
    const grid = $("garageGrid");
    if (grid && grid.querySelector(".garage-card")) {
      grid.querySelectorAll(".garage-card").forEach(function (btn) {
        const on = btn.getAttribute("data-car") === id;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    } else {
      paintGarage();
    }
    paintPuckIcon();
    const spec = models[id];
    if (!state.navigating) setStatus(spec ? spec.brand + " " + spec.type : id);
    const pose = state.origin || {
      lng: AppState.currentPos.lng,
      lat: AppState.currentPos.lat
    };
    if (pose && Number.isFinite(pose.lng)) placePuck(pose, state.heading || AppState.currentPos.bearing);
    if (state.map) state.map.triggerRepaint();
  }

  function bindGarage() {
    paintGarage();
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
    return loadScript("./vendor/pmtiles.js").catch(function () {
      return loadScript("https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js");
    }).catch(function () {
      return loadScript("https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/dist/pmtiles.js");
    });
  }

  function loadMapLibre() {
    const cssHrefs = [
      "./vendor/maplibre-gl.css",
      "https://cdn.jsdelivr.net/npm/maplibre-gl@5.5.0/dist/maplibre-gl.css"
    ];
    const jsHrefs = [
      "./vendor/maplibre-gl.js",
      "https://cdn.jsdelivr.net/npm/maplibre-gl@5.5.0/dist/maplibre-gl.js",
      "https://unpkg.com/maplibre-gl@5.5.0/dist/maplibre-gl.js"
    ];
    if (!document.querySelector("link[data-maplibre]") && !document.querySelector("link[href*='maplibre-gl.css']")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = cssHrefs[0];
      css.setAttribute("data-maplibre", "1");
      css.onerror = function () {
        css.href = cssHrefs[1];
      };
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

  function initGps() {
    seedOriginFromCar();
    if (!navigator.geolocation) {
      if (state.origin) setStatus("Mentett helyzet, GPS nélkül.");
      else setStatus("Nincs GPS ebben a böngészőben.", true);
    } else {
      const opts = { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 };
      navigator.geolocation.getCurrentPosition(
        onPos,
        function (e) {
          if (state.origin) setStatus("Mentett helyzet, várom a GPS-t…");
          else setStatus(e.message || "GPS hiba", true);
        },
        opts
      );
      navigator.geolocation.watchPosition(
        onPos,
        function () {
          if (!state.origin) setStatus("GPS jel gyenge", true);
        },
        opts
      );
    }
  }

  function boot() {
    loadPlaces();
    loadNavOpts();
    fitDashLayout();
    if (window.NavCar3D) {
      state.carModel = window.NavCar3D.id();
      AppState.selectedCar = state.carModel;
    }
    loadMapLibre()
      .then(function () {
        return initMap();
      })
      .then(function () {
        try {
          bind();
        } catch (_e) {}
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
      AppState.accuracy = 8;
      if (Number.isFinite(speed)) AppState.speed = speed;
      const raw = { lat: lat, lng: lng };
      state.rawGps = raw;
      const locked = lockToRoute(raw, { speed: speed, heading: heading });
      if (locked) {
        AppState.targetPos.lat = locked.lat;
        AppState.targetPos.lng = locked.lng;
        AppState.targetPos.bearing = locked.bearing;
      } else {
        AppState.targetPos.lat = lat;
        AppState.targetPos.lng = lng;
        if (Number.isFinite(heading) && !(Number.isFinite(speed) && speed < DEADBAND_MS)) {
          AppState.targetPos.bearing = heading;
        }
      }
      startSmooth();
    },
    sim: function (on) {
      if (on === false) stopSimDrive();
      else startSimDrive();
      return !!state.simulating;
    },
    go: function (lng, lat, label) {
      if (!state.map) return Promise.reject(new Error("nincs térkép"));
      setDest({ lng: lng, lat: lat }, label || "Cél");
      return plan(false);
    },
    pitch: function () {
      return state.map ? Math.round(state.map.getPitch()) : 0;
    },
    zoom: function () {
      return state.map ? Math.round(state.map.getZoom() * 10) / 10 : 0;
    },
    kaland: function (on) {
      applyKaland(!!on);
    },
    osrm: function () {
      return state.lastOsrmUrl || "";
    },
    road: function (limit, posted, grade) {
      applyRoad(
        {
          limit: Number(limit) || 70,
          urban: true,
          cls: "residential",
          start: 0,
          end: 1e9,
          posted: posted !== false,
          grade: Number(grade) || 0
        },
        true
      );
    },
    snapped: function () {
      return isSnappedToRoute();
    },
    garage: function (id) {
      chooseCar(id);
      return state.carModel;
    },
    lean: function (deg) {
      const pose = state.origin || {
        lng: AppState.currentPos.lng,
        lat: AppState.currentPos.lat
      };
      const n = Number(deg) || 0;
      if (window.NavCar3D && pose) window.NavCar3D.setPose(pose.lng, pose.lat, state.heading || 0, n);
      return n;
    }
  };

  boot();
})();
