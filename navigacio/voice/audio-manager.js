(function (global) {
  "use strict";

  var MAP_KEY = "nav2_audio_map";
  var LIST_KEY = "nav2_audio_selected";
  var DIR_KEY = "nav2_audio_dirs";
  var FILES_URL = "./voice/files.json";
  var PACK_URL = "./voice/pack.json";
  var EVENTS = [
    { id: "turn-left", label: "Balra", pan: -0.9 },
    { id: "turn-right", label: "Jobbra", pan: 0.9 },
    { id: "turn-left-sharp", label: "Élesen balra", pan: -1 },
    { id: "turn-right-sharp", label: "Élesen jobbra", pan: 1 },
    { id: "keep-left", label: "Tarts balra", pan: -0.55 },
    { id: "keep-right", label: "Tarts jobbra", pan: 0.55 },
    { id: "straight", label: "Egyenesen / Tartsuk az irányt", pan: 0 },
    { id: "uturn", label: "Megfordulás", pan: -0.7 },
    { id: "roundabout", label: "Körforgalom", pan: 0 },
    { id: "motorway-on", label: "Autópályára", pan: 0 },
    { id: "motorway-off", label: "Lehajtó", pan: 0 },
    { id: "recalculating", label: "Újratervezés", pan: 0 },
    { id: "speed-warning", label: "Gyorshajtás", pan: 0 },
    { id: "arrived", label: "Megérkeztél", pan: 0 }
  ];
  var EVENT_BY_ID = {};
  EVENTS.forEach(function (ev) {
    EVENT_BY_ID[ev.id] = ev;
  });
  var CAT_EVENT = {
    left: "turn-left",
    right: "turn-right",
    leftSharp: "turn-left-sharp",
    rightSharp: "turn-right-sharp",
    leftKeep: "keep-left",
    rightKeep: "keep-right",
    straight: "straight",
    uturn: "uturn",
    roundabout: "roundabout",
    motorwayOn: "motorway-on",
    motorwayOff: "motorway-off",
    arrive: "arrived"
  };
  var EVENT_FALLBACK = {
    "keep-left": "turn-left",
    "turn-left-sharp": "turn-left",
    "keep-right": "turn-right",
    "turn-right-sharp": "turn-right"
  };

  var files = [];
  var autoDirs = {};
  var ready = null;
  var audio = null;
  var unlocked = false;
  var uiBound = false;
  var audioCtx = null;
  var mediaSrc = null;
  var panner = null;
  var filterTimer = 0;
  var lastUrl = "";
  var playing = false;

  function on(el, type, fn, opts) {
    try {
      if (typeof el === "string") el = document.getElementById(el);
      if (!el || typeof el.addEventListener !== "function") return false;
      el.addEventListener(type, fn, opts);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function clipUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (/^https?:/i.test(s)) return s;
    s = s.replace(/\.ogg$/i, ".mp3");
    if (s.indexOf("/") === -1) s = "./voice/clips/" + s;
    if (s.indexOf("./") !== 0 && s.indexOf("/") !== 0) s = "./voice/clips/" + s.replace(/^.*\//, "");
    return s;
  }

  function fileLabel(path) {
    var s = clipUrl(path);
    var i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function fileStem(path) {
    return fileLabel(path)
      .toLowerCase()
      .replace(/\.(mp3|ogg|wav|m4a)$/i, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function isEventId(id) {
    return !!(id && EVENT_BY_ID[id]);
  }

  function looksLikeFileKey(key) {
    var s = String(key || "");
    return /\.mp3($|\?)/i.test(s) || s.indexOf("voice/") >= 0 || s.indexOf("/") >= 0;
  }

  function hasToken(stem, tokens) {
    var n = "_" + stem + "_";
    for (var i = 0; i < tokens.length; i++) {
      if (n.indexOf("_" + tokens[i] + "_") >= 0) return true;
    }
    return false;
  }

  function guessEvent(path) {
    var n = fileStem(path);
    if (!n) return "";
    if (hasToken(n, ["u_turn", "uturn", "u_turn_left", "u_turn_right"])) return "uturn";
    if (hasToken(n, ["roundabout", "round_about", "rotary"])) return "roundabout";
    if (hasToken(n, ["recalculating", "recalculate", "reroute", "recompute", "new_route"])) return "recalculating";
    if (hasToken(n, ["arrived", "arrive", "destination", "you_have_arrived"])) return "arrived";
    if (hasToken(n, ["speed_warning", "speeding", "speed_camera", "speed"])) return "speed-warning";
    if (hasToken(n, ["motorway_off", "off_ramp", "exit_motorway", "leave_motorway"])) return "motorway-off";
    if (hasToken(n, ["motorway_on", "on_ramp", "enter_motorway"])) return "motorway-on";
    var left = hasToken(n, ["left", "exit_left", "turn_left"]);
    var right = hasToken(n, ["right", "exit_right", "turn_right"]);
    var sharp = hasToken(n, ["sharp", "sharply"]);
    var keep = hasToken(n, ["keep"]);
    if (sharp && left && !right) return "turn-left-sharp";
    if (sharp && right) return "turn-right-sharp";
    if (keep && left && !right) return "keep-left";
    if (keep && right) return "keep-right";
    if (left && !right) return "turn-left";
    if (right) return "turn-right";
    if (hasToken(n, ["straight", "continue", "keep", "keep_going"])) return "straight";
    return "";
  }

  function rebuildAuto() {
    autoDirs = {};
    files.forEach(function (url) {
      var ev = guessEvent(url);
      if (ev) autoDirs[url] = ev;
    });
    return autoDirs;
  }

  function readRaw(key) {
    try {
      var val = JSON.parse(localStorage.getItem(key) || "{}");
      if (val && typeof val === "object" && !Array.isArray(val)) return val;
    } catch (_e) {}
    return {};
  }

  function migrateOldMap(old) {
    var dirs = {};
    Object.keys(old || {}).forEach(function (k) {
      if (looksLikeFileKey(k) && isEventId(old[k])) {
        dirs[clipUrl(k)] = old[k];
        return;
      }
      if (isEventId(k)) {
        var u = clipUrl(old[k]);
        if (u) dirs[u] = k;
      }
    });
    return dirs;
  }

  function readDirs() {
    var dirs = migrateOldMap(readRaw(DIR_KEY));
    if (Object.keys(dirs).length) return dirs;
    return migrateOldMap(readRaw(MAP_KEY));
  }

  function resolvedDirs() {
    var out = {};
    Object.keys(autoDirs).forEach(function (url) {
      out[url] = autoDirs[url];
    });
    var man = readDirs();
    Object.keys(man).forEach(function (url) {
      out[url] = man[url];
    });
    return out;
  }

  function filesForEvent(id, seen) {
    if (!isEventId(id)) return [];
    seen = seen || {};
    if (seen[id]) return [];
    seen[id] = true;
    var dirs = resolvedDirs();
    var out = [];
    Object.keys(dirs).forEach(function (url) {
      if (dirs[url] === id) out.push(url);
    });
    if (!out.length && EVENT_FALLBACK[id]) {
      return filesForEvent(EVENT_FALLBACK[id], seen);
    }
    out.sort(function (a, b) {
      return fileLabel(a).localeCompare(fileLabel(b), "hu");
    });
    return out;
  }

  function writeDirs(dirs) {
    var clean = {};
    var eventMap = {};
    var urls = [];
    Object.keys(dirs || {}).forEach(function (raw) {
      var u = clipUrl(raw);
      var ev = dirs[raw];
      if (!u || !isEventId(ev)) return;
      clean[u] = ev;
      urls.push(u);
      if (!eventMap[ev]) eventMap[ev] = u;
    });
    try {
      localStorage.setItem(DIR_KEY, JSON.stringify(clean));
      localStorage.setItem(MAP_KEY, JSON.stringify(eventMap));
      localStorage.setItem(LIST_KEY, JSON.stringify(urls));
    } catch (_e) {}
    if (global.NavSw && typeof global.NavSw.cacheSounds === "function") {
      global.NavSw.cacheSounds();
    }
    return clean;
  }

  function setFileDir(url, eventId) {
    var dirs = readDirs();
    url = clipUrl(url);
    if (!url) return dirs;
    var auto = autoDirs[url] || "";
    if (isEventId(eventId)) {
      if (eventId === auto) delete dirs[url];
      else dirs[url] = eventId;
    } else {
      delete dirs[url];
    }
    return writeDirs(dirs);
  }

  function panFor(eventId) {
    var ev = EVENT_BY_ID[eventId];
    return ev ? ev.pan : 0;
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = document.createElement("audio");
    audio.setAttribute("playsinline", "");
    audio.setAttribute("preload", "auto");
    audio.style.display = "none";
    document.body.appendChild(audio);
    on(audio, "playing", function () {
      playing = true;
    });
    on(audio, "ended", function () {
      playing = false;
    });
    on(audio, "pause", function () {
      if (!audio || audio.ended || audio.paused) playing = false;
    });
    on(audio, "error", function () {
      playing = false;
    });
    return audio;
  }

  function ensureGraph() {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    var el = ensureAudio();
    if (!mediaSrc) {
      mediaSrc = audioCtx.createMediaElementSource(el);
      if (audioCtx.createStereoPanner) {
        panner = audioCtx.createStereoPanner();
        mediaSrc.connect(panner);
        panner.connect(audioCtx.destination);
      } else {
        mediaSrc.connect(audioCtx.destination);
      }
    }
    return audioCtx;
  }

  function applyPan(eventId) {
    if (!panner) return;
    try {
      panner.pan.value = panFor(eventId);
    } catch (_e) {}
  }

  function isBusy() {
    if (!audio) return false;
    if (audio.ended) return false;
    if (audio.paused) return false;
    return !!(audio.src && !audio.paused && !audio.ended);
  }

  function resumeContext() {
    try {
      var ctx = ensureGraph();
      if (ctx && ctx.state === "suspended" && ctx.resume) ctx.resume();
      return ctx;
    } catch (_e) {
      return null;
    }
  }

  function unlock() {
    unlocked = true;
    resumeContext();
  }

  function pickRandom(list) {
    if (!list || !list.length) return "";
    if (list.length === 1) return list[0];
    var pick = list[Math.floor(Math.random() * list.length)];
    if (pick === lastUrl) {
      pick = list[Math.floor(Math.random() * list.length)];
    }
    return pick;
  }

  function playFile(path, eventId, force) {
    var url = clipUrl(path);
    if (!url) return false;
    var el = ensureAudio();
    if (!force && isBusy()) return false;
    resumeContext();
    applyPan(eventId || resolvedDirs()[url] || "");
    if (force) {
      try { el.pause(); } catch (_e) {}
    }
    el.src = url;
    lastUrl = url;
    playing = true;
    try { el.currentTime = 0; } catch (_e2) {}
    var p = el.play();
    if (p && p.catch) {
      p.catch(function () {
        playing = false;
      });
    }
    return true;
  }

  function playEvent(id, force) {
    if (!isEventId(id)) return false;
    if (!files.length) {
      loadFiles().then(function () {
        if (force || !isBusy()) playEvent(id, force);
      });
      return true;
    }
    var list = filesForEvent(id);
    if (!list.length) return false;
    return playFile(pickRandom(list), id, !!force);
  }

  function playCat(cat, force) {
    var id = CAT_EVENT[cat];
    return id ? playEvent(id, force) : false;
  }

  function loadFiles() {
    if (ready) return ready;
    ready = fetch(FILES_URL)
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .catch(function () {
        return fetch(PACK_URL).then(function (res) { return res.ok ? res.json() : []; });
      })
      .then(function (list) {
        var seen = {};
        files = [];
        (Array.isArray(list) ? list : []).forEach(function (item) {
          var u = clipUrl(item);
          if (!u || seen[u]) return;
          seen[u] = true;
          files.push(u);
        });
        files.sort(function (a, b) {
          return fileLabel(a).localeCompare(fileLabel(b), "hu");
        });
        rebuildAuto();
        return files;
      })
      .catch(function () {
        files = [];
        autoDirs = {};
        return files;
      });
    return ready;
  }

  function fillDirSelect(sel, current) {
    sel.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "— nincs irány";
    sel.appendChild(empty);
    EVENTS.forEach(function (ev) {
      var opt = document.createElement("option");
      opt.value = ev.id;
      opt.textContent = ev.label;
      sel.appendChild(opt);
    });
    sel.value = isEventId(current) ? current : "";
  }

  function filterFiles(q) {
    q = String(q || "").trim().toLowerCase();
    var dirs = resolvedDirs();
    var assigned = [];
    var rest = [];
    files.forEach(function (url) {
      if (q && fileLabel(url).toLowerCase().indexOf(q) < 0 && url.toLowerCase().indexOf(q) < 0) return;
      if (dirs[url]) assigned.push(url);
      else rest.push(url);
    });
    return assigned.concat(rest);
  }

  function countByEvent() {
    var dirs = resolvedDirs();
    var counts = {};
    Object.keys(dirs).forEach(function (url) {
      var id = dirs[url];
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }

  function paintCount() {
    var el = document.getElementById("mapperCount");
    if (!el) return;
    var counts = countByEvent();
    var n = 0;
    var bits = [];
    EVENTS.forEach(function (ev) {
      var c = counts[ev.id] || 0;
      if (!c) return;
      n += c;
      bits.push(ev.label + " " + c);
    });
    el.textContent = n
      ? n + " hang automatikusan besorolva · " + bits.join(" · ")
      : "Még nincs irány — a fájlnevek alapján automatikusan soroljuk be.";
  }

  function renderPanel() {
    var list = document.getElementById("mapperList");
    var search = document.getElementById("mapperSearch");
    if (!list) return;
    list.innerHTML = "";
    var dirs = resolvedDirs();
    var q = search ? search.value : "";
    var shown = filterFiles(q);
    var cap = q ? 120 : 80;
    var extra = shown.length - cap;
    shown.slice(0, cap).forEach(function (url) {
      var row = document.createElement("div");
      row.className = "mapper-row";
      var lab = document.createElement("label");
      lab.className = "mapper-file";
      lab.setAttribute("for", "mapDir-" + fileLabel(url));
      lab.textContent = fileLabel(url);
      lab.title = url;
      var sel = document.createElement("select");
      sel.id = "mapDir-" + fileLabel(url);
      sel.setAttribute("data-file", url);
      fillDirSelect(sel, dirs[url] || "");
      on(sel, "change", function () {
        setFileDir(url, sel.value);
        paintCount();
      });
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Teszt";
      on(btn, "click", function () {
        unlock();
        playFile(url, sel.value, true);
      });
      row.appendChild(lab);
      row.appendChild(sel);
      row.appendChild(btn);
      list.appendChild(row);
    });
    if (extra > 0) {
      var more = document.createElement("p");
      more.className = "hint mapper-more";
      more.textContent = "Még " + extra + " hang. Írd be a fájl nevét a keresőbe.";
      list.appendChild(more);
    }
    paintCount();
  }

  function scheduleRender() {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(function () {
      filterTimer = 0;
      renderPanel();
    }, 80);
  }

  function openMapper() {
    var modal = document.getElementById("audioMapper");
    var overlay = document.getElementById("mapperOverlay");
    if (!modal) return;
    loadFiles().then(function () {
      renderPanel();
      if (overlay) overlay.classList.add("open");
      modal.classList.add("open");
      var search = document.getElementById("mapperSearch");
      if (search) {
        try { search.focus(); } catch (_e) {}
      }
    });
  }

  function closeMapper() {
    var modal = document.getElementById("audioMapper");
    var overlay = document.getElementById("mapperOverlay");
    if (overlay) overlay.classList.remove("open");
    if (modal) modal.classList.remove("open");
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    on("mapperBtn", "click", openMapper);
    on("mapperClose", "click", closeMapper);
    on("mapperOverlay", "click", closeMapper);
    on("mapperSearch", "input", scheduleRender);
    on(document, "pointerdown", unlock);
    on("go", "click", unlock);
    on("simDriveBtn", "click", unlock);
    on("pinAdjustGo", "click", unlock);
    on("searchForm", "submit", unlock);
  }

  function boot() {
    bindUi();
    loadFiles();
  }

  if (document.readyState === "loading") on(document, "DOMContentLoaded", boot);
  else boot();

  global.NavVoice = {
    events: EVENTS,
    files: function () { return files.slice(); },
    init: loadFiles,
    unlock: unlock,
    guessEvent: guessEvent,
    playCat: playCat,
    playFile: playFile,
    playEvent: playEvent,
    playFromCat: playCat,
    eventFromCat: function (cat) {
      return CAT_EVENT[cat] || "";
    },
    open: openMapper,
    close: closeMapper,
    map: function () {
      var dirs = resolvedDirs();
      var eventMap = {};
      Object.keys(dirs).forEach(function (url) {
        var ev = dirs[url];
        if (!eventMap[ev]) eventMap[ev] = url;
      });
      return eventMap;
    },
    dirs: resolvedDirs,
    autoDirs: function () { return Object.assign({}, autoDirs); },
    busy: isBusy
  };
})(typeof window !== "undefined" ? window : this);
