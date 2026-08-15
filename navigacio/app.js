(function () {
  "use strict";

  const DEFAULT_CENTER = [19.0402, 47.4979];
  const THEME_KEY = "nav_theme";
  const VIEW_KEY = "nav_view_mode";
  const GMAPS_KEY = "nav_gmaps_key";
  const HAZARD_KEY = "nav_hazards_v1";
  const PLACE_KEY = "nav_places_v1";
  const CHATTY_KEY = "nav_chatty";
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const PINK = "#e20074";
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  const OSRM_QUERY = "overview=full&geometries=geojson&alternatives=false&steps=true";
  const VALHALLA_URLS = [
    "https://valhalla1.openstreetmap.de/route"
  ];
  const VALHALLA_COSTING = { driving: "auto", biking: "bicycle", foot: "pedestrian" };
  const VALHALLA_MANEUVER = {
    1: ["depart", ""],
    2: ["depart", "right"],
    3: ["depart", "left"],
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
    17: ["on ramp", "straight"],
    18: ["on ramp", "right"],
    19: ["on ramp", "left"],
    20: ["off ramp", "right"],
    21: ["off ramp", "left"],
    22: ["continue", "straight"],
    23: ["fork", "right"],
    24: ["fork", "left"],
    25: ["merge", ""],
    26: ["roundabout", ""],
    27: ["exit roundabout", ""],
    37: ["merge", "right"],
    38: ["merge", "left"]
  };
  const REROUTE_METERS = 45;
  const EMPTY_LINE = { type: "FeatureCollection", features: [] };

  function satelliteStyle() {
    return {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
          attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics"
        },
        roads: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19
        },
        places: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19
        }
      },
      layers: [
        { id: "sat", type: "raster", source: "satellite" },
        { id: "sat-roads", type: "raster", source: "roads", paint: { "raster-opacity": 0.72 } },
        { id: "sat-places", type: "raster", source: "places" }
      ]
    };
  }

  const STYLES = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark"
  };

  const HAZARD_META = {
    baleset: { icon: "💥", label: "Baleset" },
    katyu: { icon: "🕳️", label: "Kátyú" },
    dugo: { icon: "🚗", label: "Dugó" },
    veszely: { icon: "⚠️", label: "Veszély" },
    munka: { icon: "🚧", label: "Útépítés" },
    rendor: { icon: "🚓", label: "Rendőr" },
    traffipax: { icon: "📷", label: "Traffipax" }
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
    voice: true,
    lastSpokenStep: -1,
    lastSpokenLane: -1,
    overlaysReady: false,
    streetPano: null,
    googleReady: false,
    lastStreet: null,
    streetLoading: false,
    ghostMarker: null,
    arrived: false,
    lastMovedAt: Date.now(),
    lastIdleSpeak: 0,
    lastFlavorAt: 0,
    cinema: true,
    mood: "day",
    satellite: true,
    streetViewOn: false,
    navigating: false,
    avoidMotorway: false,
    avoidToll: false,
    hazards: [],
    hazardMarkers: [],
    lastHazardSpeak: "",
    lastSpeedSpeak: 0,
    vias: [],
    truckMode: false,
    chatty: true,
    hud: false,
    gpsAccuracy: 0,
    speedLimit: 0,
    lastLimitAt: 0,
    lastVibrateStep: -1,
    lastSpokenText: "",
    lastOsmWarn: "",
    wakeLock: null,
    deferredInstall: null,
    places: { home: null, work: null, recents: [] },
    poiMarkers: [],
    tapLngLat: null,
    tripStart: null,
    altFast: null,
    altAvoid: null,
    chosenAlt: "",
    osmExtras: [],
    sectionWarn: "",
    weatherText: ""
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

  function lanesFromStep(step) {
    const intersections = step && Array.isArray(step.intersections) ? step.intersections : [];
    for (let i = 0; i < intersections.length; i++) {
      const lanes = intersections[i] && intersections[i].lanes;
      if (Array.isArray(lanes) && lanes.length) return lanes;
    }
    return [];
  }

  function laneArrow(indications) {
    const ind = (indications || []).map((x) => String(x).toLowerCase());
    if (ind.includes("uturn") || ind.includes("u-turn")) return "↩";
    if (ind.includes("sharp left")) return "↙";
    if (ind.includes("sharp right")) return "↘";
    if (ind.includes("slight left")) return "↖";
    if (ind.includes("slight right")) return "↗";
    if (ind.includes("left") && ind.includes("straight")) return "↑←";
    if (ind.includes("right") && ind.includes("straight")) return "↑→";
    if (ind.includes("left")) return "←";
    if (ind.includes("right")) return "→";
    if (ind.includes("straight") || ind.includes("none") || !ind.length) return "↑";
    return "↑";
  }

  function laneHintText(lanes) {
    if (!lanes.length) return "";
    const valid = [];
    lanes.forEach((lane, i) => {
      if (lane.valid) valid.push(i);
    });
    if (!valid.length) return "Nincs sávadat ehhez a kanyarhoz.";
    if (valid.length === lanes.length) return "Bármelyik sáv jó.";
    const n = lanes.length;
    const left = valid.filter((i) => i < n / 3).length;
    const right = valid.filter((i) => i >= (2 * n) / 3).length;
    const mid = valid.length - left - right;
    if (right && !left && !mid) return "Válaszd a jobb oldali sávot.";
    if (left && !right && !mid) return "Válaszd a bal oldali sávot.";
    if (mid && !left && !right) return "Tartsd a középső sávot.";
    return "A zöld sávokat tartsd. A szürkék nem a te irányod.";
  }

  function renderLanes(lanes, hint) {
    const box = $("laneAssist");
    const row = $("laneRow");
    if (!lanes.length) {
      box.hidden = true;
      row.innerHTML = "";
      return;
    }
    box.hidden = false;
    row.innerHTML = "";
    lanes.forEach((lane) => {
      const el = document.createElement("div");
      el.className = "lane" + (lane.valid ? " is-valid" : "");
      el.textContent = laneArrow(lane.indications);
      row.appendChild(el);
    });
    $("laneHint").textContent = hint || "";
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function currentMood() {
    const h = new Date().getHours();
    if (h >= 5 && h < 8) return "dawn";
    if (h >= 17 && h < 21) return "golden";
    if (h >= 21 || h < 5) return "night";
    return "day";
  }

  function moodMeta(mood) {
    const map = {
      dawn: {
        label: "Hajnali köd",
        sky: "#f4a261",
        horizon: "#ffd6a5",
        fog: "#fde2c8",
        building: "#c9b8a8"
      },
      day: {
        label: "Nappali menet",
        sky: "#5ec8ff",
        horizon: "#ffffff",
        fog: "#dfe9f3",
        building: "#d9dde3"
      },
      golden: {
        label: "Aranyóra",
        sky: "#ff7b54",
        horizon: "#ffd93d",
        fog: "#ffc38b",
        building: "#e8c9a4"
      },
      night: {
        label: "Éjszakai neon",
        sky: "#070b16",
        horizon: "#2a1650",
        fog: "#12081f",
        building: "#3a2a55"
      }
    };
    return map[mood] || map.day;
  }

  function applyMood(force) {
    const mood = currentMood();
    if (!force && mood === state.mood) return;
    state.mood = mood;
    document.querySelector(".app").setAttribute("data-mood", mood);
    const chip = $("moodChip");
    if (chip) chip.textContent = moodMeta(mood).label;
    if (state.overlaysReady) add3dWorld();
  }

  function shortPlace(label) {
    const first = String(label || "").split(",")[0].trim();
    return first || "ismeretlen végállomás";
  }

  function missionTitle(label) {
    const place = shortPlace(label);
    const mood = currentMood();
    const titles = {
      dawn: ["Hajnali küldetés: " + place, "Mielőtt a város felébred: " + place],
      day: ["A nappali futam: " + place, "Küldetés: " + place],
      golden: ["Aranyórai jelenet: " + place, "Naplemente, irány " + place],
      night: ["Éjszakai neon: " + place, "Az éjjel hőse: " + place]
    };
    return pick(titles[mood] || titles.day);
  }

  function flavorLine() {
    return pick([
      "A kék vonal a forgatókönyv. Te vagy a főszereplő.",
      "Ha eltévednénk, az is egy jelenet lenne. De nem fogunk.",
      "A sávok nem díszlet. A zöld a te utad.",
      "Negyedik dimenzió: tér, idő, és egy kicsi türelmetlenség.",
      "A Street View a kulissza. A kanyar a poén.",
      "Lassíts, ha kell. A film nem a sebességről szól.",
      "Valahol előtted már megérkeztél. Csak utol kell érni.",
      "Ez nem dugó. Ez feszültségkeltés."
    ]);
  }

  function rotateFlavor(force) {
    const el = $("flavorLine");
    if (!el || !state.route) {
      if (el) el.hidden = true;
      return;
    }
    const now = Date.now();
    if (!force && now - state.lastFlavorAt < 28000) return;
    state.lastFlavorAt = now;
    el.hidden = false;
    el.textContent = flavorLine();
  }

  function presenterLine(copy, until, laneHint) {
    const dist =
      until >= 1000
        ? Math.round(until / 100) / 10 + " kilométer"
        : Math.max(10, Math.round(until / 10) * 10) + " méter";
    const street = copy.street ? " — " + copy.street : "";
    if (/Megérkezt/i.test(copy.text)) {
      return pick([
        "Kedves utazó! Megérkeztünk. Gratulálok, ez egy szép menet volt.",
        "Vége a jelenetnek. Lehúzhatod a kulisszát, itt a cél.",
        "Állj! Ez már nem az út. Ez a megérkezés."
      ]);
    }
    if (/Indulás/i.test(copy.text)) {
      return pick([
        "Kedves utazó! Indulhatunk. Kövesd a kék vonalat, én majd szólok időben.",
        "Csend a stúdióban. Motor, kamera, navigáció.",
        "A nagy utazás most kezdődik. Én bemondom, te viszed."
      ]);
    }
    const heads = [
      "Figyelem!",
      "Kedves utazó!",
      "Most jön a lényeg.",
      "Egy kis dráma az úton:"
    ];
    let line = pick(heads) + " " + dist + " múlva " + copy.text.toLowerCase() + street + ".";
    if (laneHint) {
      line += " " + pick([
        laneHint.replace("Válaszd", "Szépen válasszuk").replace("Tartsd", "Tartsuk"),
        "A zöld sáv a VIP-bejáró. Oda tartunk.",
        "Sávasszisztens belép: " + laneHint.toLowerCase()
      ]);
    }
    return line;
  }

  function pickPresenterVoice() {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const hu = voices.filter((v) => /hu(-|_)?HU|Hungarian|Magyar/i.test((v.lang || "") + " " + (v.name || "")));
    const male = hu.filter((v) => /male|férfi|man|istván|istvan|gábor|gabor|lászló|laszlo|béla|bela/i.test(v.name));
    return male[0] || hu[0] || voices.find((v) => String(v.lang || "").toLowerCase().startsWith("hu")) || null;
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

  function speak(text, force) {
    if (!text) return;
    state.lastSpokenText = text;
    if (!state.voice || !window.speechSynthesis) return;
    if (!force && !state.chatty && !state.navigating) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hu-HU";
    u.rate = 0.88;
    u.pitch = 0.72;
    const voice = pickPresenterVoice();
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  }

  function speakNav(text) {
    speak(text, true);
  }

  function repeatInstruction() {
    if (state.lastSpokenText) speakNav(state.lastSpokenText);
    else if (state.navigating) {
      const cur = currentStep();
      if (cur) speakNav(presenterLine(maneuverCopy(cur.step), cur.until, ""));
    }
  }

  function streetViewUrl(lat, lng, heading) {
    const h = Math.round(((heading % 360) + 360) % 360);
    return (
      "https://www.google.com/maps?layer=c&cbll=" +
      lat +
      "," +
      lng +
      "&cbp=12," +
      h +
      ",,0,0&hl=hu&output=svembed"
    );
  }

  function streetViewOpenUrl(lat, lng, heading) {
    return (
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" +
      lat +
      "," +
      lng +
      "&heading=" +
      Math.round(heading) +
      "&pitch=0"
    );
  }

  function loadGoogleMaps(key) {
    if (state.googleReady && window.google && window.google.maps) return Promise.resolve();
    if (!key) return Promise.reject(new Error("no-key"));
    if (window.google && window.google.maps) {
      state.googleReady = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const existing = document.getElementById("gmapsScript");
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("gmaps")));
        return;
      }
      const s = document.createElement("script");
      s.id = "gmapsScript";
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key);
      s.async = true;
      s.onload = () => {
        state.googleReady = true;
        resolve();
      };
      s.onerror = () => reject(new Error("gmaps"));
      document.head.appendChild(s);
    });
  }

  function swapStreetIframe(url) {
    const a = $("streetViewFrame");
    const b = $("streetViewFrameB");
    if (!a || !b) return;
    const shown = a.classList.contains("is-front") ? a : b;
    const hidden = shown === a ? b : a;
    if (shown.getAttribute("src") === url || hidden.getAttribute("src") === url) {
      state.streetLoading = false;
      return;
    }
    state.streetLoading = true;
    hidden.onload = () => {
      hidden.classList.add("is-front");
      shown.classList.remove("is-front");
      state.streetLoading = false;
    };
    hidden.src = url;
  }

  function streetLookAhead(lat, lng, heading) {
    if (state.routeCoords.length) {
      const ahead = alongLine(state.routeCoords, state.traveledMeters + 28);
      if (ahead) return { lat: ahead.lat, lng: ahead.lng, heading: ahead.bearing };
    }
    return { lat, lng, heading: heading || 0 };
  }

  function updateStreetView(lat, lng, heading, force) {
    if (!state.streetViewOn) return;
    const pane = $("streetViewPane");
    const jsBox = $("streetViewJs");
    const open = $("streetViewOpen");
    if (!pane || lat == null || lng == null) return;
    pane.hidden = false;
    const look = streetLookAhead(lat, lng, heading);
    if (open) open.href = streetViewOpenUrl(look.lat, look.lng, look.heading);
    const now = performance.now();
    if (!force && state.lastStreet) {
      const moved = haversineMeters(state.lastStreet, { lat: look.lat, lng: look.lng });
      const turn = Math.abs(((look.heading || 0) - state.lastStreet.heading + 540) % 360 - 180);
      if ((moved < 70 && turn < 40) || now - state.lastStreet.t < 4500 || state.streetLoading) return;
    }
    state.lastStreet = { lat: look.lat, lng: look.lng, heading: look.heading || 0, t: now };

    const key = String($("gmapsKey")?.value || localStorage.getItem(GMAPS_KEY) || "").trim();
    if (key && window.google && window.google.maps && state.streetPano) {
      $("streetViewFrame").hidden = true;
      $("streetViewFrameB").hidden = true;
      jsBox.hidden = false;
      state.streetPano.setPosition({ lat: look.lat, lng: look.lng });
      state.streetPano.setPov({ heading: look.heading || 0, pitch: 0 });
      return;
    }
    if (key) {
      loadGoogleMaps(key)
        .then(() => {
          if (!state.streetViewOn) return;
          $("streetViewFrame").hidden = true;
          $("streetViewFrameB").hidden = true;
          jsBox.hidden = false;
          jsBox.style.display = "block";
          if (!state.streetPano) {
            state.streetPano = new window.google.maps.StreetViewPanorama(jsBox, {
              position: { lat: look.lat, lng: look.lng },
              pov: { heading: look.heading || 0, pitch: 0 },
              zoom: 1,
              addressControl: false,
              fullscreenControl: false,
              motionTracking: false
            });
          } else {
            state.streetPano.setPosition({ lat: look.lat, lng: look.lng });
            state.streetPano.setPov({ heading: look.heading || 0, pitch: 0 });
          }
        })
        .catch(() => {
          jsBox.hidden = true;
          swapStreetIframe(streetViewUrl(look.lat, look.lng, look.heading || 0));
        });
      return;
    }
    if (jsBox) jsBox.hidden = true;
    swapStreetIframe(streetViewUrl(look.lat, look.lng, look.heading || 0));
  }

  function setStreetView(on, refresh) {
    state.streetViewOn = !!on;
    document.querySelector(".app").classList.toggle("is-streetview", state.streetViewOn);
    $("streetBtn").classList.toggle("is-on", state.streetViewOn);
    $("streetBtn").setAttribute("aria-pressed", state.streetViewOn ? "true" : "false");
    $("streetViewPane").hidden = !state.streetViewOn;
    if (!state.streetViewOn) {
      ["streetViewFrame", "streetViewFrameB"].forEach((id) => {
        const frame = $(id);
        if (frame) {
          frame.removeAttribute("src");
          frame.classList.toggle("is-front", id === "streetViewFrame");
        }
      });
      state.lastStreet = null;
      state.streetLoading = false;
      return;
    }
    if (state.origin) {
      updateStreetView(state.origin.lat, state.origin.lng, state.heading, true);
    }
  }

  function syncStreetViewPane() {
    document.querySelector(".app").classList.toggle("is-4d", state.viewMode === "4d");
    $("streetViewPane").hidden = !state.streetViewOn;
  }

  function updateManeuverUi() {
    const banner = $("maneuverBanner");
    if (!state.route || !state.steps.length) {
      banner.hidden = true;
      renderLanes([], "");
      return;
    }
    const cur = currentStep();
    if (!cur) {
      banner.hidden = true;
      renderLanes([], "");
      return;
    }
    const copy = maneuverCopy(cur.step);
    const lanes = lanesFromStep(cur.step);
    const hint = laneHintText(lanes);
    banner.hidden = false;
    $("maneuverIcon").textContent = copy.icon;
    $("maneuverDistance").textContent = formatDistance(cur.until);
    $("maneuverInstruction").textContent = copy.text;
    $("maneuverStreet").textContent = copy.street;
    renderLanes(state.gpsAccuracy > 28 ? [] : lanes, state.gpsAccuracy > 28 ? "A GPS pontatlan a sávhoz." : hint);
    updateHud(copy, cur.until);
    if (state.navigating && cur.until < 320 && cur.index !== state.lastVibrateStep) {
      state.lastVibrateStep = cur.index;
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    }
    if (cur.index !== state.lastSpokenStep && cur.until < 220 && state.navigating) {
      state.lastSpokenStep = cur.index;
      speakNav(presenterLine(copy, cur.until, state.chatty ? hint : ""));
    } else if (lanes.length && cur.index !== state.lastSpokenLane && cur.until < 90 && state.navigating) {
      state.lastSpokenLane = cur.index;
      if (hint) speak("Sávasszisztens. " + hint.replace("Válaszd", "Szépen válasszuk").replace("Tartsd", "Tartsuk"));
    }
    drawJunction();
    warnNearbyHazards();
  }

  function updateHud(copy, until) {
    const box = $("hudOverlay");
    if (!box) return;
    box.hidden = !state.hud;
    if (!state.hud) return;
    $("hudDist").textContent = formatDistance(until || 0);
    $("hudIcon").textContent = (copy && copy.icon) || "↑";
    $("hudText").textContent = ((copy && copy.text) || "") + (copy && copy.street ? " · " + copy.street : "");
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
    $("startBtn").hidden = !state.route || state.navigating;
    $("stopBtn").hidden = !state.navigating;
    $("driveEta").textContent = formatClock(sec);
    const cur = currentStep();
    $("driveRoad").textContent = (cur && cur.step && cur.step.name) || shortPlace(state.destinationLabel);
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
        const sky = moodMeta(state.mood);
        const nightish = state.mood === "night" || state.theme === "dark";
        state.map.setSky({
          "sky-color": nightish && state.mood !== "golden" ? sky.sky : sky.sky,
          "sky-horizon-blend": 0.62,
          "horizon-color": sky.horizon,
          "horizon-fog-blend": 0.72,
          "fog-color": sky.fog,
          "fog-ground-blend": 0.48
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
              "fill-extrusion-color": moodMeta(state.mood).building,
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
      const show = !state.satellite && state.viewMode !== "2d";
      state.map.setLayoutProperty("3d-buildings", "visibility", show ? "visible" : "none");
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
        paint: { "line-color": "#fff", "line-width": 14, "line-opacity": 0.95 }
      });
      state.map.addLayer({
        id: "route-rest-line",
        type: "line",
        source: "route-rest",
        paint: { "line-color": PINK, "line-width": 8, "line-opacity": 1, "line-blur": 0.15 }
      });
      state.map.addLayer({
        id: "route-done-line",
        type: "line",
        source: "route-done",
        paint: { "line-color": "#9aa0a6", "line-width": 6, "line-opacity": 0.85 }
      });
    }
  }

  function paintRouteMood() {
    if (!state.map || !state.map.getLayer("route-rest-line")) return;
    const frac = Math.max(0, Math.min(1, state.traveledMeters / (lineLength(state.routeCoords) || 1)));
    const color = frac > 0.8 ? "#05c46b" : PINK;
    state.map.setPaintProperty("route-rest-line", "line-color", color);
  }

  function ensureOverlays() {
    add3dWorld();
    addRouteLayers();
    state.overlaysReady = true;
    if (state.routeCoords.length) drawRouteProgress();
    loadHazardsOntoMap();
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
    paintRouteMood();
  }

  function resizeJunction() {
    const canvas = $("junctionCanvas");
    const pane = $("junctionPane");
    if (!canvas || !pane || pane.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const w = pane.clientWidth;
    const h = pane.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }

  function drawJunction() {
    const pane = $("junctionPane");
    const canvas = $("junctionCanvas");
    if (!pane || !canvas) return;
    pane.hidden = !state.navigating;
    if (!state.navigating) return;
    resizeJunction();
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    sky.addColorStop(0, state.mood === "night" ? "#0b1220" : "#7ec8ff");
    sky.addColorStop(1, state.mood === "night" ? "#1b2838" : "#d7eefc");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.42);
    ctx.fillStyle = state.mood === "night" ? "#16351d" : "#3fa34d";
    ctx.fillRect(0, h * 0.38, w, h);
    ctx.beginPath();
    ctx.moveTo(w * 0.36, h * 0.4);
    ctx.lineTo(w * 0.64, h * 0.4);
    ctx.lineTo(w * 1.05, h);
    ctx.lineTo(-w * 0.05, h);
    ctx.closePath();
    ctx.fillStyle = "#4a4f55";
    ctx.fill();
    ctx.strokeStyle = "#2e3236";
    ctx.lineWidth = 8;
    ctx.stroke();
    const cur = currentStep();
    const lanes = cur ? lanesFromStep(cur.step) : [];
    const n = Math.max(lanes.length, 3);
    const copy = cur ? maneuverCopy(cur.step) : { icon: "↑", text: "Haladj tovább", street: "" };
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.setLineDash([18, 22]);
      ctx.lineWidth = 4;
      const topX = w * (0.36 + t * 0.28);
      const botX = w * (-0.05 + t * 1.1);
      ctx.moveTo(topX, h * 0.42);
      ctx.lineTo(botX, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const valid = [];
    for (let i = 0; i < n; i++) {
      if (!lanes.length || (lanes[i] && lanes[i].valid)) valid.push(i);
    }
    valid.forEach((i) => {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      ctx.beginPath();
      ctx.moveTo(w * (0.36 + t0 * 0.28), h * 0.42);
      ctx.lineTo(w * (0.36 + t1 * 0.28), h * 0.42);
      ctx.lineTo(w * (-0.05 + t1 * 1.1), h);
      ctx.lineTo(w * (-0.05 + t0 * 1.1), h);
      ctx.closePath();
      ctx.fillStyle = "rgba(226,0,116,0.38)";
      ctx.fill();
    });
    ctx.fillStyle = PINK;
    ctx.beginPath();
    const mid = valid.length ? (valid[0] + valid[valid.length - 1] + 1) / 2 / n : 0.5;
    const ax = w * (0.36 + mid * 0.28);
    const bx = w * (-0.05 + mid * 1.1);
    ctx.moveTo(ax, h * 0.46);
    ctx.lineTo(ax + w * 0.05, h * 0.58);
    ctx.lineTo(ax + w * 0.02, h * 0.58);
    ctx.lineTo(bx + w * 0.03, h * 0.92);
    ctx.lineTo(bx - w * 0.03, h * 0.92);
    ctx.lineTo(ax - w * 0.02, h * 0.58);
    ctx.lineTo(ax - w * 0.05, h * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1a73e8";
    const gw = w * 0.72;
    const gx = (w - gw) / 2;
    ctx.fillRect(gx, h * 0.06, gw, h * 0.2);
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + Math.round(h * 0.055) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    const dist = cur ? formatDistance(cur.until) : "";
    ctx.fillText(copy.icon + "  " + dist, w / 2, h * 0.14);
    ctx.font = "800 " + Math.round(h * 0.048) + "px system-ui, sans-serif";
    ctx.fillText((copy.street || copy.text).slice(0, 28), w / 2, h * 0.21);
  }

  function startNavigation() {
    if (!state.route) return;
    state.navigating = true;
    document.querySelector(".app").classList.add("is-nav");
    $("driveBar").hidden = false;
    $("startBtn").hidden = true;
    $("stopBtn").hidden = false;
    $("sidebar").classList.remove("is-expanded");
    setCinema(false);
    setFollow(true);
    drawJunction();
    window.setTimeout(() => {
      if (state.map) state.map.resize();
      drawJunction();
    }, 280);
    state.tripStart = state.origin ? { lat: state.origin.lat, lng: state.origin.lng, label: "Indulás" } : null;
    speakNav(pick([
      "Kedves utazó! Indulhatunk. Kövesd a rózsaszín vonalat.",
      "Csend a stúdióban. Motor, kamera, navigáció.",
      "A nagy utazás most kezdődik. Én bemondom, te viszed."
    ]));
    setStatus("Navigáció elindult");
    requestWakeLock();
    updateCamera(true);
  }

  function stopNavigation() {
    state.navigating = false;
    document.querySelector(".app").classList.remove("is-nav");
    $("driveBar").hidden = true;
    $("junctionPane").hidden = true;
    $("startBtn").hidden = !state.route;
    $("stopBtn").hidden = true;
    setFollow(false);
    releaseWakeLock();
    if (state.map) window.setTimeout(() => state.map.resize(), 280);
    setStatus("Navigáció leállítva");
  }

  function loadStoredHazards() {
    try {
      state.hazards = JSON.parse(localStorage.getItem(HAZARD_KEY) || "[]");
    } catch (_e) {
      state.hazards = [];
    }
    if (!Array.isArray(state.hazards)) state.hazards = [];
  }

  function saveHazards() {
    localStorage.setItem(HAZARD_KEY, JSON.stringify(state.hazards.slice(-80)));
  }

  function addHazardMarker(h) {
    if (!state.map) return;
    const el = document.createElement("div");
    el.className = "hazard-map-pin";
    el.textContent = (HAZARD_META[h.type] || HAZARD_META.veszely).icon;
    const marker = new maplibregl.Marker({ element: el }).setLngLat([h.lng, h.lat]).addTo(state.map);
    state.hazardMarkers.push(marker);
  }

  function loadHazardsOntoMap() {
    state.hazardMarkers.forEach((m) => m.remove());
    state.hazardMarkers = [];
    state.hazards.forEach(addHazardMarker);
  }

  function reportHazard(type) {
    if (!state.origin) {
      setStatus("Előbb kell GPS-pozíció a jelzéshez.", true);
      return;
    }
    const h = {
      type,
      lat: state.origin.lat,
      lng: state.origin.lng,
      at: Date.now(),
      label: (HAZARD_META[type] || HAZARD_META.veszely).label
    };
    state.hazards.push(h);
    saveHazards();
    addHazardMarker(h);
    speak(hazardReportLine(h.type));
    setStatus(h.label + " jelzés a térképen.");
  }

  function hazardReportLine(type) {
    if (type === "rendor") {
      return pick([
        "Rendőr a környéken. Mosolyogjunk. A kamera azt szereti.",
        "Köszönöm. A törvény keze felkerült a térképre.",
        "Rendőrség. Mostantól mindenki mintadiák."
      ]);
    }
    if (type === "traffipax") {
      return pick([
        "Traffipax rögzítve. A lábunkat vegyük le a gázról, a büszkeségünket tartsuk.",
        "Sebességmérő. Ő nem viccel. Mi igen, de ő nem.",
        "Köszönöm. A vaku innentől a mi barátunk. Elvileg."
      ]);
    }
    return "Köszönöm. " + (HAZARD_META[type] || HAZARD_META.veszely).label + " jelzés rögzítve.";
  }

  function hazardWarnLine(type, kmh) {
    if (type === "rendor") {
      return pick([
        "Figyelem! Rendőr elöl. Integetni szabad, gyorsítani nem.",
        "Kedves utazó! A törvény keze közeledik. Mi lassítsunk, ők majd integetnek.",
        "Rendőr a láthatáron. Mostantól mindenki mintaszerűen közlekedik. Még te is."
      ]);
    }
    if (type === "traffipax") {
      if (kmh >= 60) {
        return pick([
          "Traffipax! Mondd csak, nem mész egy kicsit gyorsan?!",
          "Sebességmérő, és te épp sztár szeretnél lenni a fotón. Lassíts!",
          "Vaku közeleg. A láb, a gáz, a büntetés: válassz kettőt. Inkább egyet: a lábat."
        ]);
      }
      return pick([
        "Traffipax elöl. Szépen, ahogy a nagykönyvben megírták.",
        "Sebességmérő. Te most egy reklámfilm hőse vagy: szabályos, nyugodt, filmcsillogás.",
        "Mérőpont. A radar számol. Mi mosolygunk."
      ]);
    }
    return "Figyelem! " + (HAZARD_META[type] || HAZARD_META.veszely).label + " az úton, lassíts.";
  }

  function maybeSpeedingQuip() {
    if (!state.navigating || !state.voice) return;
    const kmh = Math.round((state.speedMps || 0) * 3.6);
    const now = Date.now();
    if (now - state.lastSpeedSpeak < 50000) return;
    const nearCam = state.origin && state.hazards.find((h) =>
      (h.type === "traffipax" || h.type === "rendor") &&
      haversineMeters(state.origin, { lat: h.lat, lng: h.lng }) < 220
    );
    if (nearCam && kmh >= 55) {
      state.lastSpeedSpeak = now;
      speak(pick([
        "Mondd csak, nem mész egy kicsit gyorsan?!",
        "A traffipax is lát. És nem nevet.",
        "Lassíts, mielőtt a vaku a főszereplővé tesz."
      ]));
      return;
    }
    const limit = state.speedLimit || 0;
    if (limit && kmh >= limit + 8) {
      state.lastSpeedSpeak = now;
      speakNav(pick([
        "Mondd csak, nem mész egy kicsit gyorsan?!",
        "A tábla " + limit + ". Te " + kmh + ". Vegyük vissza.",
        "Sebességkorlát " + limit + ". Most " + kmh + " vagy. Lassítsunk."
      ]));
      return;
    }
    if (!state.chatty) return;
    if (kmh >= 115) {
      state.lastSpeedSpeak = now;
      speak(pick([
        "Mondd csak, nem mész egy kicsit gyorsan?!",
        "Ez már nem utazás, ez űrprogram. A földön maradunk, köszönöm.",
        "Kedves utazó! A pedál nem versenyző. Engedd el egy kicsit."
      ]));
    } else if (kmh >= 95) {
      state.lastSpeedSpeak = now;
      speak(pick([
        "Mondd csak, nem mész egy kicsit gyorsan?!",
        "Szép a lendület, de a bírság még szebb szokott lenni. Lassítsunk.",
        "Egy kicsit vissza a gázból. A filmnek nincs szüksége üldözéses jelenetre."
      ]));
    }
  }

  function warnNearbyHazards() {
    if (!state.navigating || !state.origin) return;
    const near = state.hazards.find((h) => haversineMeters(state.origin, { lat: h.lat, lng: h.lng }) < 160);
    if (!near) return;
    const key = near.type + ":" + near.lat.toFixed(4);
    if (state.lastHazardSpeak === key) return;
    state.lastHazardSpeak = key;
    const kmh = Math.round((state.speedMps || 0) * 3.6);
    speak(hazardWarnLine(near.type, kmh));
    setStatus((HAZARD_META[near.type] || HAZARD_META.veszely).label + " közeleg");
  }

  async function fetchOsmHazards() {
    if (!state.routeCoords.length) return;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    state.routeCoords.forEach((c) => {
      minLng = Math.min(minLng, c[0]);
      maxLng = Math.max(maxLng, c[0]);
      minLat = Math.min(minLat, c[1]);
      maxLat = Math.max(maxLat, c[1]);
    });
    const box = minLat + "," + minLng + "," + maxLat + "," + maxLng;
    const q =
      "[out:json][timeout:15];(" +
      'way["highway"="construction"](' + box + ");" +
      'way["construction"]["highway"](' + box + ");" +
      'node["hazard"](' + box + ");" +
      'node["highway"="speed_camera"](' + box + ");" +
      'node["enforcement"="maxspeed"](' + box + ");" +
      'node["amenity"="police"](' + box + ");" +
      ");out center 80;";
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: "data=" + encodeURIComponent(q)
      });
      if (!res.ok) return;
      const data = await res.json();
      (data.elements || []).forEach((el) => {
        const lat = el.lat || (el.center && el.center.lat);
        const lng = el.lon || (el.center && el.center.lon);
        if (lat == null) return;
        const tags = el.tags || {};
        let type = "munka";
        if (tags.highway === "speed_camera" || tags.enforcement === "maxspeed") type = "traffipax";
        else if (tags.amenity === "police") type = "rendor";
        else if (tags.hazard) type = "veszely";
        const h = { type, lat, lng, at: Date.now(), label: (HAZARD_META[type] || HAZARD_META.munka).label };
        if (!state.hazards.some((x) => haversineMeters(x, h) < 40)) {
          state.hazards.push(h);
          addHazardMarker(h);
        }
      });
    } catch (_e) {}
  }

  function setSatellite(on) {
    state.satellite = !!on;
    $("satBtn").classList.toggle("is-on", state.satellite);
    $("satBtn").setAttribute("aria-pressed", state.satellite ? "true" : "false");
    if (!state.map) return;
    state.overlaysReady = false;
    state.map.setStyle(state.satellite ? satelliteStyle() : STYLES[state.theme]);
  }

  function cameraForMode(center, bearing) {
    const mode = state.viewMode;
    const kmh = (state.speedMps || 0) * 3.6;
    const zOff = kmh < 20 ? 0.35 : kmh < 50 ? 0 : kmh < 90 ? -0.85 : -1.55;
    if (mode === "2d") {
      return { center, zoom: 16.2 + zOff, pitch: 0, bearing: 0, padding: { top: 80, bottom: 180, left: 0, right: 0 } };
    }
    if (mode === "3d") {
      return {
        center,
        zoom: 17.4 + zOff,
        pitch: 58,
        bearing: state.follow ? bearing : state.map.getBearing(),
        padding: { top: 40, bottom: 220, left: 0, right: 0 }
      };
    }
    const look = alongLine(state.routeCoords.length ? state.routeCoords : [[center[0], center[1]]], state.traveledMeters + 55);
    return {
      center: look ? [look.lng, look.lat] : center,
      zoom: 18.05 + zOff,
      pitch: 68,
      bearing: state.follow ? (look ? look.bearing : bearing) : state.map.getBearing(),
      padding: { top: 20, bottom: 260, left: 0, right: 0 }
    };
  }

  function updateCamera(force) {
    if (!state.map || !state.origin || !state.follow || state.previewing || !state.navigating) return;
    const now = performance.now();
    if (!force && now - state.lastCameraAt < 900) return;
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
    syncStreetViewPane();
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
      state.map.setStyle(state.satellite ? satelliteStyle() : STYLES[state.theme]);
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

  function updateGhost() {
    if (!state.routeCoords.length || state.viewMode === "2d") {
      if (state.ghostMarker) state.ghostMarker.getElement().style.display = "none";
      return;
    }
    const ahead = alongLine(state.routeCoords, state.traveledMeters + Math.max(40, (state.speedMps || 8) * 12));
    if (!ahead) return;
    if (!state.ghostMarker) {
      const el = document.createElement("div");
      el.className = "ghost-puck";
      el.title = "A 12 másodperccel későbbi te";
      state.ghostMarker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([ahead.lng, ahead.lat])
        .addTo(state.map);
    } else {
      state.ghostMarker.getElement().style.display = "";
      state.ghostMarker.setLngLat([ahead.lng, ahead.lat]);
    }
  }

  function burstConfetti() {
    const canvas = $("fxCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.hidden = false;
    const bits = Array.from({ length: 90 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 80,
      r: 3 + Math.random() * 4,
      v: 2.2 + Math.random() * 4,
      c: pick(["#05c46b", "#8ab4f8", "#f4a261", "#e879f9", "#fff"])
    }));
    let frames = 0;
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bits.forEach((b) => {
        b.y += b.v;
        b.x += Math.sin(b.y / 18) * 1.4;
        ctx.fillStyle = b.c;
        ctx.fillRect(b.x, b.y, b.r, b.r * 1.6);
      });
      frames += 1;
      if (frames < 90) requestAnimationFrame(tick);
      else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.hidden = true;
      }
    }
    tick();
  }

  function showArrival() {
    if (state.arrived) return;
    state.arrived = true;
    const overlay = $("arrivalOverlay");
    overlay.hidden = false;
    $("arrivalTitle").textContent = pick(["Megérkeztél", "Vége. Felirat.", "Cél. Poén."]);
    $("arrivalSub").textContent = "Küldetés teljesítve: " + shortPlace(state.destinationLabel);
    burstConfetti();
    speak(pick([
      "Kedves utazó! Megérkeztünk. Gratulálok, ez egy szép menet volt.",
      "Vége a jelenetnek. Itt a cél, itt a taps.",
      "Állj. Ez már nem az út. Ez a megérkezés."
    ]));
    if (state.origin && state.map) {
      state.map.easeTo({
        center: [state.origin.lng, state.origin.lat],
        zoom: 17.2,
        pitch: 72,
        bearing: state.map.getBearing() + 40,
        duration: 1800
      });
    }
  }

  function maybeArrival() {
    if (!state.route || state.arrived) return;
    const left = (lineLength(state.routeCoords) || 0) - state.traveledMeters;
    if (left < 28) showArrival();
  }

  function maybeIdleQuip() {
    if (!state.route || state.arrived || !state.voice) return;
    const now = Date.now();
    if (state.speedMps > 1.2) {
      state.lastMovedAt = now;
      return;
    }
    if (!state.chatty) return;
    if (now - state.lastMovedAt > 90000 && now - state.lastIdleSpeak > 90000) {
      state.lastIdleSpeak = now;
      speak(pick([
        "Állunk. Ez most szünet, vagy a főhős gondolkodik?",
        "A jelenet itt elidőzik. Ha készen állsz, indulhatunk tovább.",
        "Csend. Csak a motor és a térkép lélegzik."
      ]));
    }
  }

  function setCinema(on) {
    state.cinema = !!on;
    document.querySelector(".app").classList.toggle("is-cinema", state.cinema);
    $("cinemaBtn").classList.toggle("is-on", state.cinema);
    $("cinemaBtn").setAttribute("aria-pressed", state.cinema ? "true" : "false");
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
    if ($("driveSpeed")) $("driveSpeed").textContent = String(kmh);
    const badge = $("speedBadge");
    if (badge) badge.classList.toggle("is-over", state.speedLimit > 0 && kmh > state.speedLimit + 4);
    document.querySelector(".app").classList.toggle("is-driver", kmh >= 30);
    refreshSpeedLimitUi();
    updateGpsAccUi();
    maybeOsmRoadWarn();
    const puckEl = state.puckMarker.getElement();
    if (puckEl) puckEl.classList.toggle("is-fast", kmh >= 48);
    if (state.routeCoords.length) {
      const snap = nearestOnLine(state.routeCoords, lngLat);
      state.traveledMeters = snap.traveled;
      if (snap.dist < 40 && Number.isFinite(snap.bearing)) state.heading = snap.bearing;
      drawRouteProgress();
      updateManeuverUi();
      updateEtaUi();
      updateGhost();
      maybeArrival();
      rotateFlavor(false);
    }
    maybeIdleQuip();
    maybeSpeedingQuip();
    updateStreetView(lngLat.lat, lngLat.lng, state.heading, false);
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

  function syncAvoidOptions() {
    const motor = $("avoidMotorway");
    const toll = $("avoidToll");
    if (motor) state.avoidMotorway = !!motor.checked;
    if (toll) state.avoidToll = !!toll.checked;
  }

  function wantsAvoidRouting(mode) {
    return (mode || state.travelMode) === "driving" && (state.avoidMotorway || state.avoidToll);
  }

  function decodePolyline(str, precision) {
    const factor = Math.pow(10, precision == null ? 6 : precision);
    const coords = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const text = String(str || "");
    while (index < text.length) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = text.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;
      result = 0;
      shift = 0;
      do {
        byte = text.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;
      coords.push([lng / factor, lat / factor]);
    }
    return coords;
  }

  function isMotorwayLabel(ref, name) {
    const refs = String(ref || "")
      .split(/[;,/]/)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    if (refs.some((part) => /^M\d{1,3}[A-Z]?$/.test(part))) return true;
    const text = String(name || "");
    return /aut[oó]p[aá]lya/i.test(text);
  }

  function routeUsesMotorway(route) {
    if (!route) return false;
    if (route.hasHighway === true) return true;
    if (route.hasHighway === false) return false;
    const legs = route.legs || [];
    for (let i = 0; i < legs.length; i++) {
      const steps = legs[i].steps || [];
      for (let j = 0; j < steps.length; j++) {
        if (isMotorwayLabel(steps[j].ref, steps[j].name)) return true;
      }
    }
    return false;
  }

  function valhallaTripToOsrm(trip) {
    const legs = trip.legs || [];
    const osrmLegs = [];
    const allCoords = [];
    let duration = 0;
    let distance = 0;
    legs.forEach((leg) => {
      const shapeCoords = decodePolyline(leg.shape, 6);
      if (shapeCoords.length) {
        const start = allCoords.length ? 1 : 0;
        for (let i = start; i < shapeCoords.length; i++) allCoords.push(shapeCoords[i]);
      }
      const steps = (leg.maneuvers || []).map((man) => {
        const pair = VALHALLA_MANEUVER[man.type] || ["continue", ""];
        const begin = Math.max(0, Number(man.begin_shape_index || 0));
        const loc = shapeCoords[Math.min(begin, Math.max(0, shapeCoords.length - 1))] || [0, 0];
        const names = Array.isArray(man.street_names) ? man.street_names : [];
        return {
          distance: Number(man.length || 0) * 1000,
          duration: Number(man.time || 0),
          name: names[0] || "",
          ref: names.slice(1).join(";") || "",
          maneuver: {
            type: pair[0],
            modifier: pair[1],
            location: loc,
            exit: man.roundabout_exit_count
          },
          intersections: [{ location: loc }]
        };
      });
      const summary = leg.summary || {};
      osrmLegs.push({
        steps,
        distance: Number(summary.length || 0) * 1000,
        duration: Number(summary.time || 0)
      });
      duration += Number(summary.time || 0);
      distance += Number(summary.length || 0) * 1000;
    });
    const summary = trip.summary || {};
    return {
      duration: duration || Number(summary.time || 0),
      distance: distance || Number(summary.length || 0) * 1000,
      geometry: { type: "LineString", coordinates: allCoords },
      legs: osrmLegs,
      hasHighway: !!summary.has_highway,
      hasToll: !!summary.has_toll
    };
  }

  function routeWaypoints(from, to) {
    const pts = [];
    if (from) pts.push(from);
    (state.vias || []).forEach((v) => pts.push(v));
    if (to) pts.push(to);
    return pts;
  }

  function valhallaCosting(mode) {
    if (state.truckMode && (mode || "driving") === "driving") return "truck";
    return VALHALLA_COSTING[mode] || "auto";
  }

  async function fetchValhallaRoute(from, to, mode, extraOpts) {
    const costing = valhallaCosting(mode);
    const options = Object.assign({}, extraOpts || {});
    if (state.avoidMotorway || (extraOpts && extraOpts.use_highways === 0)) options.use_highways = 0;
    if (state.avoidToll) options.use_tolls = 0;
    if (costing === "truck") {
      const h = Number($("truckHeight") && $("truckHeight").value);
      if (h > 0) options.height = h;
    }
    const pts = routeWaypoints(from, to);
    const body = {
      locations: pts.map((p) => ({ lat: p.lat, lon: p.lng })),
      costing,
      costing_options: { [costing]: options },
      units: "kilometers",
      language: "hu",
      directions_options: { units: "kilometers", language: "hu" }
    };
    let lastError = null;
    for (const url of VALHALLA_URLS) {
      const attempts = [
        () =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body)
          }),
        () => fetch(url + "?json=" + encodeURIComponent(JSON.stringify(body)), { headers: { Accept: "application/json" } })
      ];
      for (let a = 0; a < attempts.length; a++) {
        try {
          const res = await attempts[a]();
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.error || data.error_code) {
            lastError = new Error(data.error || "Az elkerülő útvonaltervező nem elérhető.");
            continue;
          }
          const trip = data.trip;
          if (!trip || (trip.status !== 0 && trip.status !== undefined) || !(trip.legs || []).length) {
            lastError = new Error(trip && trip.status_message ? trip.status_message : "Nincs elkerülő útvonal.");
            continue;
          }
          return valhallaTripToOsrm(trip);
        } catch (err) {
          lastError = err;
        }
      }
    }
    throw lastError || new Error("Az elkerülő útvonalat nem sikerült kiszámolni.");
  }

  async function fetchOsrmRoute(from, to, mode) {
    const coord = routeWaypoints(from, to)
      .map((p) => p.lng + "," + p.lat)
      .join(";");
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

  async function fetchRoute(from, to, mode) {
    syncAvoidOptions();
    if (wantsAvoidRouting(mode) || state.truckMode) {
      const route = await fetchValhallaRoute(from, to, mode);
      if (state.avoidMotorway && routeUsesMotorway(route)) {
        route.avoidIncomplete = true;
      }
      return route;
    }
    return fetchOsrmRoute(from, to, mode);
  }

  function avoidStatusMessage(route) {
    if (route && route.avoidIncomplete) {
      return "Útvonal kész, de autópálya nélkül nem lehetett teljesen megoldani.";
    }
    if (state.avoidMotorway && state.avoidToll) {
      return "Útvonal kész, autópálya és fizetős utak nélkül. Nyomd meg: Indulhatunk.";
    }
    if (state.avoidMotorway) {
      return "Útvonal kész, autópálya nélkül. Nyomd meg: Indulhatunk.";
    }
    if (state.avoidToll) {
      return "Útvonal kész, fizetős utak nélkül. Nyomd meg: Indulhatunk.";
    }
    return "Útvonal kész. Nyomd meg: Indulhatunk.";
  }

  async function planRoute() {
    if (!state.origin || !state.destination) return;
    try {
      syncAvoidOptions();
      setStatus(wantsAvoidRouting(state.travelMode) ? "Elkerülő útvonal tervezése…" : "Útvonal tervezése…");
      const route = await fetchRoute(state.origin, state.destination, state.travelMode);
      state.route = route;
      state.routeCoords = route.geometry && route.geometry.coordinates ? route.geometry.coordinates : [];
      state.steps = [];
      (route.legs || []).forEach((leg) => {
        (leg.steps || []).forEach((step) => state.steps.push(step));
      });
      state.lastRouteOrigin = { lat: state.origin.lat, lng: state.origin.lng };
      state.traveledMeters = 0;
      state.lastSpokenStep = -1;
      state.lastSpokenLane = -1;
      state.arrived = false;
      $("arrivalOverlay").hidden = true;
      const mission = $("missionTitle");
      mission.hidden = false;
      mission.textContent = missionTitle(state.destinationLabel);
      rotateFlavor(true);
      if (state.overlaysReady) drawRouteProgress();
      updateManeuverUi();
      updateEtaUi();
      $("startBtn").hidden = false;
      $("stopBtn").hidden = true;
      $("previewBtn").hidden = false;
      if (state.routeCoords.length && state.map) {
        const b = new maplibregl.LngLatBounds(state.routeCoords[0], state.routeCoords[0]);
        state.routeCoords.forEach((c) => b.extend(c));
        state.map.fitBounds(b, { padding: 70, maxZoom: 15, duration: 900, pitch: state.satellite ? 45 : 0 });
      }
      setFollow(false);
      loadHazardsOntoMap();
      fetchOsmHazards();
      setStatus(avoidStatusMessage(route));
      drawJunction();
      afterRouteReady();
    } catch (err) {
      setStatus(err.message || "Az útvonaltervezés sikertelen.", true);
    }
  }

  async function choosePlace(place) {
    const lngLat = { lat: Number(place.lat), lng: Number(place.lon) };
    setDestination(lngLat, place.display_name);
    rememberRecent(lngLat, place.display_name);
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
    const coord = parseCoordQuery(query);
    if (coord) {
      await choosePlace({ lat: coord.lat, lon: coord.lng, display_name: coord.lat.toFixed(5) + ", " + coord.lng.toFixed(5) });
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
    if (!state.origin || !state.destination || state.previewing || !state.navigating) return;
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
    state.gpsAccuracy = Number(pos.coords.accuracy) || 0;
    setOrigin(lngLat, heading, pos.coords.speed);
    maybeReroute();
    maybeFetchSpeedLimit();
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
      style: satelliteStyle(),
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
    state.map.on("load", setupMapPress);
  }

  function parseCoordQuery(query) {
    const m = String(query || "").trim().match(/^(-?\d+(?:[.,]\d+))\s*[,;\s]\s*(-?\d+(?:[.,]\d+))$/);
    if (!m) return null;
    const a = Number(m[1].replace(",", "."));
    const b = Number(m[2].replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
    if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lng: a };
    return null;
  }

  function loadPlaces() {
    try {
      const raw = JSON.parse(localStorage.getItem(PLACE_KEY) || "{}");
      state.places = {
        home: raw.home || null,
        work: raw.work || null,
        recents: Array.isArray(raw.recents) ? raw.recents.slice(0, 6) : []
      };
    } catch (_e) {
      state.places = { home: null, work: null, recents: [] };
    }
    renderRecents();
  }

  function savePlaces() {
    localStorage.setItem(PLACE_KEY, JSON.stringify(state.places));
    renderRecents();
  }

  function rememberRecent(lngLat, label) {
    const item = { lat: lngLat.lat, lng: lngLat.lng, label: shortPlace(label), at: Date.now() };
    state.places.recents = [item].concat(state.places.recents.filter((r) => haversineMeters(r, item) > 80)).slice(0, 6);
    savePlaces();
  }

  function renderRecents() {
    const box = $("recentPlaces");
    if (!box) return;
    box.innerHTML = "";
    state.places.recents.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip-btn";
      btn.textContent = r.label || "Cél";
      btn.addEventListener("click", () => goToSaved(r));
      box.appendChild(btn);
    });
  }

  async function goToSaved(place) {
    if (!place) {
      setStatus("Előbb állítsd be ezt a helyet a jelenlegi célból.", true);
      return;
    }
    await choosePlace({ lat: place.lat, lon: place.lng, display_name: place.label || "Mentett hely" });
  }

  function setSavedPlace(kind) {
    const src = state.destination || state.origin;
    if (!src) {
      setStatus("Nincs cél vagy GPS a mentéshez.", true);
      return;
    }
    state.places[kind] = { lat: src.lat, lng: src.lng, label: state.destinationLabel || kind };
    savePlaces();
    setStatus((kind === "home" ? "Otthon" : "Munka") + " elmentve.");
  }

  function shareRouteUrl() {
    if (!state.destination) return location.href.split("#")[0];
    const base = location.href.split("#")[0];
    return (
      base +
      "#cel=" +
      state.destination.lat.toFixed(6) +
      "," +
      state.destination.lng.toFixed(6) +
      "&n=" +
      encodeURIComponent(shortPlace(state.destinationLabel))
    );
  }

  async function copyShare() {
    const url = shareRouteUrl();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Navigáció", text: state.destinationLabel || "Útvonal", url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setStatus("Link a vágólapon.");
      } else {
        setStatus(url);
      }
    } catch (_e) {
      setStatus("A megosztás megszakadt.");
    }
  }

  function parseLaunchHash() {
    const raw = String(location.hash || "").replace(/^#/, "");
    if (!raw) return;
    const params = new URLSearchParams(raw.includes("=") ? raw : "cel=" + raw);
    const cel = params.get("cel") || params.get("d");
    const parsed = parseCoordQuery(cel || "");
    if (!parsed) return;
    const name = params.get("n") || parsed.lat.toFixed(5) + ", " + parsed.lng.toFixed(5);
    choosePlace({ lat: parsed.lat, lon: parsed.lng, display_name: decodeURIComponent(name) });
  }

  function updateExtMaps() {
    const box = $("extMaps");
    if (!state.destination) {
      if (box) box.hidden = true;
      return;
    }
    if (box) box.hidden = false;
    const d = state.destination;
    const o = state.origin;
    const g = $("gmapsLink");
    const a = $("amapsLink");
    if (g) {
      g.href = o
        ? "https://www.google.com/maps/dir/?api=1&origin=" + o.lat + "," + o.lng + "&destination=" + d.lat + "," + d.lng + "&travelmode=driving"
        : "https://www.google.com/maps/search/?api=1&query=" + d.lat + "," + d.lng;
    }
    if (a) {
      a.href = "https://maps.apple.com/?daddr=" + d.lat + "," + d.lng + (o ? "&saddr=" + o.lat + "," + o.lng : "");
    }
  }

  function downloadGpx() {
    if (!state.routeCoords.length) return;
    const pts = state.routeCoords
      .map((c) => '<trkpt lat="' + c[1].toFixed(6) + '" lon="' + c[0].toFixed(6) + '"></trkpt>')
      .join("");
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Navigacio 4D"><trk><name>' +
      (shortPlace(state.destinationLabel) || "utvonal") +
      "</name><trkseg>" +
      pts +
      "</trkseg></trk></gpx>";
    const blob = new Blob([xml], { type: "application/gpx+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "utvonal.gpx";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function reverseRoute() {
    const start = state.tripStart || state.lastRouteOrigin;
    if (!start) {
      setStatus("Nincs visszaút: előbb menj el valahova.", true);
      return;
    }
    const dest = { lat: start.lat, lng: start.lng };
    state.vias = [];
    await choosePlace({ lat: dest.lat, lon: dest.lng, display_name: start.label || "Visszaút" });
  }

  function formatMins(sec) {
    return Math.max(1, Math.round((sec || 0) / 60)) + " perc";
  }

  function renderAlts() {
    const line = $("compareLine");
    const row = $("altRow");
    if (!line || !row) return;
    if (!state.altFast && !state.altAvoid) {
      line.hidden = true;
      row.hidden = true;
      return;
    }
    const fast = state.altFast;
    const avoid = state.altAvoid;
    const parts = [];
    if (fast) parts.push("Autópályával " + formatMins(fast.duration));
    if (avoid) parts.push("nélkül " + formatMins(avoid.duration));
    line.textContent = parts.join(" · ");
    line.hidden = !parts.length;
    row.hidden = !(fast && avoid);
    $("altFast").classList.toggle("is-on", state.chosenAlt === "fast" || (!state.avoidMotorway && state.chosenAlt !== "avoid"));
    $("altAvoid").classList.toggle("is-on", state.chosenAlt === "avoid" || state.avoidMotorway);
  }

  function applyChosenRoute(route, kind) {
    if (!route) return;
    state.chosenAlt = kind;
    if (kind === "avoid") {
      state.avoidMotorway = true;
      if ($("avoidMotorway")) $("avoidMotorway").checked = true;
    }
    if (kind === "fast") {
      state.avoidMotorway = false;
      if ($("avoidMotorway")) $("avoidMotorway").checked = false;
    }
    state.route = route;
    state.routeCoords = route.geometry && route.geometry.coordinates ? route.geometry.coordinates : [];
    state.steps = [];
    (route.legs || []).forEach((leg) => (leg.steps || []).forEach((step) => state.steps.push(step)));
    if (state.overlaysReady) drawRouteProgress();
    updateManeuverUi();
    updateEtaUi();
    renderAlts();
    setStatus(kind === "avoid" ? "Autópálya nélküli útvonal." : "Gyors útvonal.");
    afterRouteReady({ skipAlts: true });
  }

  async function loadAlternatives() {
    if (state.travelMode !== "driving" || !state.origin || !state.destination) return;
    try {
      const saved = state.avoidMotorway;
      if (!saved) {
        state.altFast = state.route;
        state.avoidMotorway = true;
        state.altAvoid = await fetchValhallaRoute(state.origin, state.destination, "driving");
        state.avoidMotorway = saved;
        state.chosenAlt = "fast";
      } else {
        state.altAvoid = state.route;
        state.avoidMotorway = false;
        state.altFast = await fetchOsrmRoute(state.origin, state.destination, "driving");
        state.avoidMotorway = saved;
        state.chosenAlt = "avoid";
      }
      renderAlts();
    } catch (_e) {
      renderAlts();
    }
  }

  function sunsetHour(month) {
    return [16.4, 17.3, 18.4, 19.5, 20.4, 20.8, 20.6, 19.8, 18.6, 17.3, 16.3, 16.0][month];
  }

  function arrivalIsDark() {
    const when = new Date(Date.now() + remainingSeconds() * 1000);
    const h = when.getHours() + when.getMinutes() / 60;
    return h >= sunsetHour(when.getMonth()) || h < 6.5;
  }

  function weatherLabel(code, temp) {
    let sky = "felhős";
    if (code === 0) sky = "derült";
    else if (code <= 3) sky = "fátyolfelhős";
    else if (code <= 48) sky = "köd";
    else if (code <= 67) sky = "eső";
    else if (code <= 77) sky = "hó";
    else if (code <= 82) sky = "zápor";
    else sky = "zivatar";
    return Math.round(temp) + "° · " + sky;
  }

  async function loadWeather() {
    if (!state.destination) return;
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast?latitude=" +
        state.destination.lat +
        "&longitude=" +
        state.destination.lng +
        "&current=temperature_2m,weather_code";
      const res = await fetch(url);
      const data = await res.json();
      const cur = data.current || {};
      state.weatherText = weatherLabel(Number(cur.weather_code || 0), Number(cur.temperature_2m || 0));
      const chip = $("weatherChip");
      chip.hidden = false;
      chip.textContent = "Cél: " + state.weatherText;
    } catch (_e) {}
  }

  function sampleRoute(n) {
    const coords = state.routeCoords;
    if (!coords.length) return [];
    const total = lineLength(coords);
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = alongLine(coords, (total * i) / Math.max(1, n - 1));
      if (p) out.push(p);
    }
    return out;
  }

  async function loadElevation() {
    const box = $("elevBox");
    if (!box) return;
    if (state.travelMode === "driving" || state.routeCoords.length < 4) {
      box.hidden = true;
      return;
    }
    const samples = sampleRoute(24);
    if (samples.length < 4) return;
    try {
      const url =
        "https://api.open-meteo.com/v1/elevation?latitude=" +
        samples.map((p) => p.lat.toFixed(4)).join(",") +
        "&longitude=" +
        samples.map((p) => p.lng.toFixed(4)).join(",");
      const res = await fetch(url);
      const data = await res.json();
      const elev = data.elevation || [];
      if (elev.length < 2) return;
      box.hidden = false;
      const canvas = $("elevCanvas");
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const min = Math.min.apply(null, elev);
      const max = Math.max.apply(null, elev);
      ctx.beginPath();
      elev.forEach((z, i) => {
        const x = (i / (elev.length - 1)) * w;
        const y = h - 6 - ((z - min) / Math.max(8, max - min)) * (h - 12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#1a73e8";
      ctx.lineWidth = 2;
      ctx.stroke();
      let gain = 0;
      for (let i = 1; i < elev.length; i++) gain += Math.max(0, elev[i] - elev[i - 1]);
      $("elevMeta").textContent = "Szintemelkedés kb. " + Math.round(gain) + " m";
    } catch (_e) {
      box.hidden = true;
    }
  }

  function routeHasVignette() {
    return (state.steps || []).some((s) => isMotorwayLabel(s.ref, s.name)) || !!(state.route && state.route.hasHighway);
  }

  async function loadParkingLastMile() {
    const el = $("lastMile");
    if (!el || !state.destination) return;
    el.hidden = true;
    if (state.travelMode === "foot") return;
    try {
      const q =
        "[out:json][timeout:12];node[\"amenity\"=\"parking\"](around:350," +
        state.destination.lat +
        "," +
        state.destination.lng +
        ");out 8;";
      const res = await fetch(OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(q) });
      const data = await res.json();
      const first = (data.elements || []).find((n) => n.lat != null);
      if (!first) return;
      const walk = haversineMeters({ lat: first.lat, lng: first.lon }, state.destination);
      el.hidden = false;
      el.textContent = "Parkoló a célnál, utána kb. " + formatDistance(walk) + " gyalog.";
    } catch (_e) {}
  }

  function afterRouteReady(opts) {
    const has = !!state.route;
    if ($("shareBtn")) $("shareBtn").hidden = !has;
    if ($("gpxBtn")) $("gpxBtn").hidden = !has;
    if ($("reverseBtn")) $("reverseBtn").hidden = !has;
    updateExtMaps();
    renderViaLine();
    if ($("vignetteChip")) {
      const need = state.travelMode === "driving" && routeHasVignette();
      $("vignetteChip").hidden = !need;
      if (need && state.chatty) {
        /* reminder only once per route via status */
      }
    }
    if (!opts || !opts.skipAlts) loadAlternatives();
    loadWeather();
    loadElevation();
    loadParkingLastMile();
    fetchOsmRoadExtras();
    if (arrivalIsDark() && has) {
      const extra = " Sötétben érsz oda.";
      if ($("statusText") && $("statusText").textContent.indexOf("Sötétben") < 0) {
        setStatus(($("statusText").textContent || "Útvonal kész.") + extra);
      }
    }
  }

  function renderViaLine() {
    const el = $("viaLine");
    if (!el) return;
    if (!state.vias.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = "Megállók: " + state.vias.map((v, i) => v.label || i + 1 + ".").join(" · ");
  }

  function clearPoiMarkers() {
    state.poiMarkers.forEach((m) => m.remove());
    state.poiMarkers = [];
  }

  function addPoiMarker(lat, lng, icon, label) {
    const el = document.createElement("div");
    el.className = "hazard-map-pin";
    el.textContent = icon;
    el.title = label || "";
    const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(state.map);
    el.addEventListener("click", () => {
      state.tapLngLat = { lat, lng, label };
      showMapToast(label || "POI");
    });
    state.poiMarkers.push(marker);
  }

  async function searchPoi(kind) {
    if (!state.origin && !state.routeCoords.length) {
      setStatus("Kell GPS vagy útvonal a kereséshez.", true);
      return;
    }
    const tags = {
      fuel: ['node["amenity"="fuel"]', "⛽"],
      cafe: ['node["amenity"="cafe"]', "☕"],
      toilets: ['node["amenity"="toilets"]', "🚻"],
      charging: ['node["amenity"="charging_station"]', "🔌"],
      parking: ['node["amenity"="parking"]', "🅿️"]
    };
    const spec = tags[kind];
    if (!spec) return;
    const here = state.origin || { lat: state.destination.lat, lng: state.destination.lng };
    const samples = state.routeCoords.length ? sampleRoute(5) : [here];
    const parts = samples
      .map((p) => spec[0] + "(around:900," + p.lat + "," + p.lng + ");")
      .join("");
    setStatus("Keresés az úton…");
    try {
      const q = "[out:json][timeout:14];(" + parts + ");out center 24;";
      const res = await fetch(OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(q) });
      const data = await res.json();
      clearPoiMarkers();
      let n = 0;
      (data.elements || []).forEach((el) => {
        const lat = el.lat || (el.center && el.center.lat);
        const lng = el.lon || (el.center && el.center.lon);
        if (lat == null || n > 20) return;
        addPoiMarker(lat, lng, spec[1], (el.tags && (el.tags.name || el.tags.brand)) || kind);
        n += 1;
      });
      setStatus(n ? n + " hely az úton. Koppints a markerre: cél vagy megálló." : "Nincs találat a közelben.");
    } catch (_e) {
      setStatus("A helykereső most nem elérhető.", true);
    }
  }

  function showMapToast(text) {
    const box = $("mapToast");
    $("mapToastText").textContent = text || "Ide megyek?";
    box.hidden = false;
  }

  function hideMapToast() {
    $("mapToast").hidden = true;
  }

  async function toastAsDest() {
    if (!state.tapLngLat) return;
    hideMapToast();
    await choosePlace({
      lat: state.tapLngLat.lat,
      lon: state.tapLngLat.lng,
      display_name: state.tapLngLat.label || "Térképpont"
    });
  }

  async function toastAsVia() {
    if (!state.tapLngLat) return;
    hideMapToast();
    if (!state.destination) {
      await toastAsDest();
      return;
    }
    state.vias.push({
      lat: state.tapLngLat.lat,
      lng: state.tapLngLat.lng,
      label: state.tapLngLat.label || "Megálló"
    });
    renderViaLine();
    if (state.origin) await planRoute();
  }

  function setupMapPress() {
    if (!state.map) return;
    let pressTimer = 0;
    let start = null;
    state.map.on("mousedown", (e) => {
      start = e.lngLat;
      pressTimer = window.setTimeout(() => {
        state.tapLngLat = { lat: start.lat, lng: start.lng, label: "Térképpont" };
        showMapToast("Hosszú nyomás: cél vagy megálló");
      }, 520);
    });
    ["mouseup", "mousemove", "dragstart"].forEach((ev) => {
      state.map.on(ev, () => window.clearTimeout(pressTimer));
    });
    state.map.getCanvas().addEventListener("touchstart", (e) => {
      if (!e.touches[0] || !state.map) return;
      const p = state.map.unproject([e.touches[0].clientX, e.touches[0].clientY]);
      start = p;
      pressTimer = window.setTimeout(() => {
        state.tapLngLat = { lat: start.lat, lng: start.lng, label: "Térképpont" };
        showMapToast("Cél vagy megálló?");
      }, 560);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((ev) => {
      state.map.getCanvas().addEventListener(ev, () => window.clearTimeout(pressTimer), { passive: true });
    });
  }

  function refreshSpeedLimitUi() {
    const el = $("speedLimit");
    if (!el) return;
    if (state.speedLimit > 0) {
      el.hidden = false;
      el.textContent = String(state.speedLimit);
    } else {
      el.hidden = true;
    }
  }

  function updateGpsAccUi() {
    const el = $("gpsAcc");
    if (!el) return;
    if (!state.gpsAccuracy) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = "± " + Math.round(state.gpsAccuracy) + " m";
    el.style.opacity = state.gpsAccuracy > 28 ? "1" : "0.7";
  }

  async function maybeFetchSpeedLimit() {
    if (!state.origin || !state.navigating) return;
    if (Date.now() - state.lastLimitAt < 14000) return;
    state.lastLimitAt = Date.now();
    const q =
      "[out:json][timeout:8];way(around:18," +
      state.origin.lat +
      "," +
      state.origin.lng +
      ')["highway"]["maxspeed"];out tags 1;';
    try {
      const res = await fetch(OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(q) });
      const data = await res.json();
      const way = (data.elements || []).find((el) => el.tags && el.tags.maxspeed);
      if (!way) return;
      const n = parseInt(String(way.tags.maxspeed).replace(/[^\d]/g, ""), 10);
      if (n > 0 && n < 200) {
        state.speedLimit = n;
        refreshSpeedLimitUi();
      }
    } catch (_e) {}
  }

  async function fetchOsmRoadExtras() {
    if (!state.routeCoords.length) return;
    const samples = sampleRoute(6);
    const parts = samples
      .map((p) => {
        const a = p.lat + "," + p.lng;
        return (
          'node["traffic_calming"~"bump|hump|table"](around:700,' + a + ");" +
          'node["railway"="level_crossing"](around:700,' + a + ");" +
          'node["enforcement"="average_speed"](around:1200,' + a + ");" +
          'node["highway"="speed_camera"](around:900,' + a + ");"
        );
      })
      .join("");
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        body: "data=" + encodeURIComponent("[out:json][timeout:14];(" + parts + ");out center 40;")
      });
      const data = await res.json();
      state.osmExtras = (data.elements || []).map((el) => {
        const tags = el.tags || {};
        let kind = "other";
        if (tags.traffic_calming) kind = "bump";
        else if (tags.railway === "level_crossing") kind = "rail";
        else if (tags.enforcement === "average_speed") kind = "section";
        else if (tags.highway === "speed_camera") kind = "cam";
        return {
          kind,
          lat: el.lat || (el.center && el.center.lat),
          lng: el.lon || (el.center && el.center.lon),
          max: parseInt(String(tags.maxspeed || ""), 10) || 0
        };
      }).filter((x) => x.lat != null);
    } catch (_e) {}
  }

  function maybeOsmRoadWarn() {
    if (!state.navigating || !state.origin) return;
    const near = state.osmExtras.find((x) => haversineMeters(state.origin, x) < 140);
    if (!near) {
      if ($("sectionChip")) $("sectionChip").hidden = true;
      return;
    }
    const key = near.kind + ":" + near.lat.toFixed(4);
    if (near.kind === "section") {
      const chip = $("sectionChip");
      if (chip) {
        chip.hidden = false;
        chip.textContent = "Átlagsebesség" + (near.max ? " " + near.max : "");
      }
    }
    if (state.lastOsmWarn === key) return;
    state.lastOsmWarn = key;
    if (near.kind === "bump") speakNav("Fekvőrendőr. Lassíts.");
    else if (near.kind === "rail") speakNav("Vasúti átjáró. Állj meg, ha kell.");
    else if (near.kind === "section") speakNav("Átlagsebesség-mérő szakasz. Tartsd a korlátot.");
  }

  async function requestWakeLock() {
    try {
      if (navigator.wakeLock) state.wakeLock = await navigator.wakeLock.request("screen");
    } catch (_e) {}
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      state.wakeLock.release().catch(() => {});
      state.wakeLock = null;
    }
  }

  function setupWakeAndBg() {
    document.addEventListener("visibilitychange", () => {
      const warn = $("bgWarn");
      if (document.hidden && state.navigating) {
        if (warn) warn.hidden = false;
      } else {
        if (warn) warn.hidden = true;
        if (state.navigating) requestWakeLock();
      }
    });
  }

  function setHud(on) {
    state.hud = !!on;
    document.querySelector(".app").classList.toggle("is-hud", state.hud);
    $("hudBtn").classList.toggle("is-on", state.hud);
    $("hudBtn").setAttribute("aria-pressed", state.hud ? "true" : "false");
    $("hudOverlay").hidden = !state.hud;
    const cur = currentStep();
    if (cur) updateHud(maneuverCopy(cur.step), cur.until);
  }

  function startVoiceSearch() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      setStatus("Ez a böngésző nem tud magyar beszédfelismerést.", true);
      return;
    }
    const rec = new Rec();
    rec.lang = "hu-HU";
    rec.interimResults = false;
    $("micBtn").classList.add("is-on");
    rec.onresult = (e) => {
      const text = e.results[0] && e.results[0][0] && e.results[0][0].transcript;
      $("micBtn").classList.remove("is-on");
      if (text) {
        $("addressInput").value = text;
        searchAddress();
      }
    };
    rec.onerror = () => {
      $("micBtn").classList.remove("is-on");
      setStatus("A mikrofon most nem értette.", true);
    };
    rec.onend = () => $("micBtn").classList.remove("is-on");
    rec.start();
  }

  function setupInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      state.deferredInstall = e;
      $("installBanner").hidden = false;
    });
    const install = async () => {
      if (state.deferredInstall) {
        state.deferredInstall.prompt();
        await state.deferredInstall.userChoice;
        state.deferredInstall = null;
        $("installBanner").hidden = true;
        return;
      }
      $("helpOverlay").hidden = false;
    };
    $("installBtn").addEventListener("click", install);
    $("installBtn2").addEventListener("click", install);
    $("installDismiss").addEventListener("click", () => {
      $("installBanner").hidden = true;
    });
    $("installHelpBtn").addEventListener("click", () => {
      $("helpOverlay").hidden = false;
    });
    $("helpClose").addEventListener("click", () => {
      $("helpOverlay").hidden = true;
    });
    if (!window.matchMedia("(display-mode: standalone)").matches) {
      window.setTimeout(() => {
        if (!$("installBanner").hidden) return;
        $("installBanner").hidden = false;
      }, 1200);
    }
  }

  function registerSw() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  function bindUi() {
    $("searchForm").addEventListener("submit", searchAddress);
    $("themeToggle").addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark", true));
    $("followBtn").addEventListener("click", () => setFollow(!state.follow));
    $("previewBtn").addEventListener("click", playPreview);
    $("cinemaBtn").addEventListener("click", () => setCinema(!state.cinema));
    $("startBtn").addEventListener("click", startNavigation);
    $("stopBtn").addEventListener("click", stopNavigation);
    $("satBtn").addEventListener("click", () => setSatellite(!state.satellite));
    $("streetBtn").addEventListener("click", () => setStreetView(!state.streetViewOn, true));
    $("streetRefresh").addEventListener("click", () => {
      if (state.origin) updateStreetView(state.origin.lat, state.origin.lng, state.heading, true);
    });
    const savedAvoid = localStorage.getItem("nav_avoid");
    if (savedAvoid) {
      try {
        const av = JSON.parse(savedAvoid);
        $("avoidMotorway").checked = !!av.motor;
        $("avoidToll").checked = !!av.toll;
        syncAvoidOptions();
      } catch (_e) {}
    }
    $("avoidMotorway").addEventListener("change", () => {
      state.avoidMotorway = $("avoidMotorway").checked;
      localStorage.setItem("nav_avoid", JSON.stringify({ motor: state.avoidMotorway, toll: $("avoidToll").checked }));
      if (state.origin && state.destination) planRoute();
    });
    $("avoidToll").addEventListener("change", () => {
      state.avoidToll = $("avoidToll").checked;
      localStorage.setItem("nav_avoid", JSON.stringify({ motor: $("avoidMotorway").checked, toll: state.avoidToll }));
      if (state.origin && state.destination) planRoute();
    });
    document.querySelectorAll("[data-hazard]").forEach((btn) => {
      btn.addEventListener("click", () => reportHazard(btn.getAttribute("data-hazard")));
    });
    window.addEventListener("resize", () => {
      if (state.map) state.map.resize();
      drawJunction();
    });
    $("arrivalOk").addEventListener("click", () => {
      $("arrivalOverlay").hidden = true;
      state.arrived = false;
    });
    $("voiceBtn").addEventListener("click", () => {
      state.voice = !state.voice;
      $("voiceBtn").classList.toggle("is-on", state.voice);
      $("voiceBtn").setAttribute("aria-pressed", state.voice ? "true" : "false");
      $("voiceBtn").textContent = state.voice ? "🔊" : "🔇";
      if (state.voice) speak("Kedves utazó! A bemondó hang bekapcsolva. Én navigálok.");
    });
    const keyInput = $("gmapsKey");
    if (keyInput) {
      keyInput.value = localStorage.getItem(GMAPS_KEY) || "";
      keyInput.addEventListener("change", () => {
        localStorage.setItem(GMAPS_KEY, keyInput.value.trim());
        state.streetPano = null;
        state.googleReady = false;
        if (state.origin) updateStreetView(state.origin.lat, state.origin.lng, state.heading, true);
      });
    }
    document.querySelectorAll('input[name="travelMode"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.travelMode = selectedTravelMode();
        if (state.origin && state.destination) planRoute();
      });
    });
    document.querySelectorAll('input[name="viewMode"]').forEach((input) => {
      input.addEventListener("change", () => applyViewMode(selectedViewMode()));
    });
    $("hudBtn").addEventListener("click", () => setHud(!state.hud));
    $("repeatBtn").addEventListener("click", repeatInstruction);
    $("micBtn").addEventListener("click", startVoiceSearch);
    $("homeGo").addEventListener("click", () => goToSaved(state.places.home));
    $("workGo").addEventListener("click", () => goToSaved(state.places.work));
    $("homeSet").addEventListener("click", () => setSavedPlace("home"));
    $("workSet").addEventListener("click", () => setSavedPlace("work"));
    $("shareBtn").addEventListener("click", copyShare);
    $("gpxBtn").addEventListener("click", downloadGpx);
    $("reverseBtn").addEventListener("click", reverseRoute);
    $("altFast").addEventListener("click", () => applyChosenRoute(state.altFast, "fast"));
    $("altAvoid").addEventListener("click", () => applyChosenRoute(state.altAvoid, "avoid"));
    $("toastDest").addEventListener("click", toastAsDest);
    $("toastVia").addEventListener("click", toastAsVia);
    $("toastCancel").addEventListener("click", hideMapToast);
    $("chattyVoice").checked = state.chatty;
    $("chattyVoice").addEventListener("change", () => {
      state.chatty = $("chattyVoice").checked;
      localStorage.setItem(CHATTY_KEY, state.chatty ? "1" : "0");
    });
    $("truckMode").addEventListener("change", () => {
      state.truckMode = $("truckMode").checked;
      $("truckHeight").hidden = !state.truckMode;
      $("truckHeightWrap").hidden = !state.truckMode;
      if (state.origin && state.destination) planRoute();
    });
    document.querySelectorAll("[data-poi]").forEach((btn) => {
      btn.addEventListener("click", () => searchPoi(btn.getAttribute("data-poi")));
    });
  }

  state.theme = preferredTheme();
  state.viewMode = preferredView();
  state.chatty = localStorage.getItem(CHATTY_KEY) !== "0";
  applyTheme(state.theme, false);
  applyViewMode(state.viewMode);
  applyMood(true);
  setCinema(false);
  loadStoredHazards();
  loadPlaces();
  initMap();
  bindUi();
  setupSheet();
  setupWakeAndBg();
  setupInstall();
  registerSw();
  startGpsTracking();
  parseLaunchHash();
  window.setInterval(() => applyMood(false), 60000);
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", () => {});
  }
})();
