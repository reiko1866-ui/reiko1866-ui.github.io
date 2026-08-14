(function () {
  "use strict";

  const DEFAULT_CENTER = [19.0402, 47.4979];
  const THEME_KEY = "nav_theme";
  const VIEW_KEY = "nav_view_mode";
  const GMAPS_KEY = "nav_gmaps_key";
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
    voice: true,
    lastSpokenStep: -1,
    lastSpokenLane: -1,
    overlaysReady: false,
    streetPano: null,
    googleReady: false,
    lastStreet: null,
    ghostMarker: null,
    arrived: false,
    lastMovedAt: Date.now(),
    lastIdleSpeak: 0,
    lastFlavorAt: 0,
    cinema: true,
    mood: "day"
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

  function speak(text) {
    if (!state.voice || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hu-HU";
    u.rate = 0.88;
    u.pitch = 0.72;
    const voice = pickPresenterVoice();
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
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

  function updateStreetView(lat, lng, heading, force) {
    if (state.viewMode !== "4d") return;
    const pane = $("streetViewPane");
    const frame = $("streetViewFrame");
    const jsBox = $("streetViewJs");
    const open = $("streetViewOpen");
    if (!pane || lat == null || lng == null) return;
    pane.hidden = false;
    if (open) open.href = streetViewOpenUrl(lat, lng, heading || 0);
    const now = performance.now();
    if (!force && state.lastStreet) {
      const moved = haversineMeters(state.lastStreet, { lat, lng });
      const turn = Math.abs(((heading || 0) - state.lastStreet.heading + 540) % 360 - 180);
      if (moved < 16 && turn < 18 && now - state.lastStreet.t < 1600) return;
    }
    state.lastStreet = { lat, lng, heading: heading || 0, t: now };

    const key = String($("gmapsKey")?.value || localStorage.getItem(GMAPS_KEY) || "").trim();
    if (key && window.google && window.google.maps && state.streetPano) {
      frame.hidden = true;
      jsBox.hidden = false;
      state.streetPano.setPosition({ lat, lng });
      state.streetPano.setPov({ heading: heading || 0, pitch: 0 });
      return;
    }
    if (key) {
      loadGoogleMaps(key)
        .then(() => {
          frame.hidden = true;
          jsBox.hidden = false;
          jsBox.style.display = "block";
          if (!state.streetPano) {
            state.streetPano = new window.google.maps.StreetViewPanorama(jsBox, {
              position: { lat, lng },
              pov: { heading: heading || 0, pitch: 0 },
              zoom: 1,
              addressControl: false,
              fullscreenControl: false,
              motionTracking: false
            });
          } else {
            state.streetPano.setPosition({ lat, lng });
            state.streetPano.setPov({ heading: heading || 0, pitch: 0 });
          }
        })
        .catch(() => {
          frame.hidden = false;
          jsBox.hidden = true;
          if (frame.src !== streetViewUrl(lat, lng, heading || 0)) {
            frame.src = streetViewUrl(lat, lng, heading || 0);
          }
        });
      return;
    }
    frame.hidden = false;
    jsBox.hidden = true;
    const next = streetViewUrl(lat, lng, heading || 0);
    if (frame.src !== next) frame.src = next;
  }

  function syncStreetViewPane() {
    const on = state.viewMode === "4d";
    document.querySelector(".app").classList.toggle("is-4d", on);
    $("streetViewPane").hidden = !on;
    if (state.map) {
      window.setTimeout(() => state.map.resize(), 280);
    }
    if (on && state.origin) {
      updateStreetView(state.origin.lat, state.origin.lng, state.heading, true);
    }
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
    renderLanes(lanes, hint);
    if (cur.index !== state.lastSpokenStep && cur.until < 220) {
      state.lastSpokenStep = cur.index;
      speak(presenterLine(copy, cur.until, hint));
    } else if (lanes.length && cur.index !== state.lastSpokenLane && cur.until < 90) {
      state.lastSpokenLane = cur.index;
      if (hint) speak("Sávasszisztens. " + hint.replace("Válaszd", "Szépen válasszuk").replace("Tartsd", "Tartsuk"));
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
        paint: { "line-color": "#1a73e8", "line-width": 7, "line-opacity": 1, "line-blur": 0.2 }
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
    const color =
      state.mood === "night" ? (frac > 0.7 ? "#e879f9" : "#7c3aed") :
      state.mood === "golden" ? (frac > 0.7 ? "#2a9d8f" : "#e76f51") :
      state.mood === "dawn" ? "#e07a3d" :
      frac > 0.75 ? "#05c46b" : "#1a73e8";
    state.map.setPaintProperty("route-rest-line", "line-color", color);
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
    paintRouteMood();
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
      setFollow(true);
      updateCamera(true);
      setStatus("4D navigáció aktív");
      const first = currentStep();
      if (first) {
        const copy = maneuverCopy(first.step);
        const lanes = lanesFromStep(first.step);
        speak(presenterLine(copy, first.until, laneHintText(lanes)));
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
        updateStreetView(here.lat, here.lng, here.bearing, false);
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
    $("cinemaBtn").addEventListener("click", () => setCinema(!state.cinema));
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
  }

  state.theme = preferredTheme();
  state.viewMode = preferredView();
  applyTheme(state.theme, false);
  applyViewMode(state.viewMode);
  applyMood(true);
  setCinema(true);
  initMap();
  bindUi();
  setupSheet();
  startGpsTracking();
  window.setInterval(() => applyMood(false), 60000);
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", () => {});
  }
})();
