/**
 * Hangnavigáció — a feltöltött hungary_jf csomag (bal/jobb kijárat .ogg).
 * A lista a navigacio/voice/pack.json-ból jön; a hangfájlok CDN-ről,
 * amíg a GitHub Pages (main) nem szolgálja ki a /hungary_jf/ mappát.
 */
(function (global) {
  "use strict";

  const BRANCH = "cursor/terkep-navigacio-925b";
  const REPO = "reiko1866-ui/reiko1866-ui.github.io";
  const CDN =
    "https://cdn.jsdelivr.net/gh/" + REPO + "@" + encodeURIComponent(BRANCH) + "/hungary_jf/";
  const RAW =
    "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/hungary_jf/";
  const PROBE = "and_then_exit_left_100.ogg";
  const BASE_KEY = "nav2_voice_base";
  const GAP = 0.03;
  const LEFT_STEM = "and_then_exit_left";
  const RIGHT_STEM = "and_then_exit_right";

  const PHRASES = {
    start: { files: ["start.ogg"] },
    finish: { files: ["finish.ogg"] },
    recomputing: { files: ["recomputing.ogg"] },
    "left-100": { stem: LEFT_STEM, prefer: "100" },
    "right-500": { stem: RIGHT_STEM, prefer: "500" },
    "right-100": { stem: RIGHT_STEM, prefer: "100" },
    "left-500": { stem: LEFT_STEM, prefer: "500" },
    "exit-left-100": { stem: LEFT_STEM, prefer: "100" },
    "exit-right-100": { stem: RIGHT_STEM, prefer: "100" },
    straight: { files: ["go_straight.ogg"] },
    uTurn: { files: ["u_turn.ogg"] }
  };

  const MANEUVER_FILE = {
    "Fordulj jobbra": "turn_right",
    "Fordulj balra": "turn_left",
    "Tarts jobbra": "keep_right",
    "Tarts balra": "keep_left",
    "Élesen jobbra": "turn_right",
    "Élesen balra": "turn_left",
    "Fordulj vissza": "u_turn",
    Indulás: "start",
    "Megérkeztél": "finish",
    Körforgalom: "roundabout_1",
    "Hajts ki": "exit_now",
    "Hajts fel": "keep_right",
    "Hajts le": "exit_right",
    Csatlakozz: "keep_right",
    "Jobb elágazás": "keep_right",
    "Bal elágazás": "keep_left",
    "Haladj tovább": "go_straight"
  };

  const TTS = {
    start: "Hang kész.",
    finish: "Megérkeztél.",
    recomputing: "Újratervezés.",
    "left-100": "100 méter, fordulj balra.",
    "right-500": "500 méter, fordulj jobbra.",
    "right-100": "100 méter, fordulj jobbra.",
    "left-500": "500 méter, fordulj balra.",
    "exit-left-100": "100 méter, hajts le balra.",
    "exit-right-100": "100 méter, hajts le jobbra.",
    straight: "Haladj tovább.",
    uTurn: "Fordulj vissza."
  };

  function unique(list) {
    const out = [];
    list.forEach((x) => {
      if (x && out.indexOf(x) === -1) out.push(x);
    });
    return out;
  }

  function withSlash(path) {
    const b = String(path || "");
    return /\/$/.test(b) ? b : b + "/";
  }

  function rel(path) {
    try {
      return new URL(path, document.baseURI).href;
    } catch (_e) {
      return path;
    }
  }

  function distBucket(m) {
    if (m >= 1500) return 2000;
    if (m >= 750) return 1000;
    if (m >= 350) return 500;
    if (m >= 150) return 200;
    return 100;
  }

  function packStem(maneuver) {
    const s = String(maneuver || "");
    if (/left|u_turn|roundabout/i.test(s)) return LEFT_STEM;
    if (/right|exit_now/i.test(s)) return RIGHT_STEM;
    return "";
  }

  class AudioManager {
    /**
     * @param {{ onLog?: (msg: string, err?: boolean) => void, onFallback?: (text: string) => void }} [opts]
     */
    constructor(opts) {
      this.onLog = (opts && opts.onLog) || function () {};
      this.onFallback = (opts && opts.onFallback) || null;
      this.ctx = null;
      this.gain = null;
      this.unlocked = false;
      /** @type {AudioBufferSourceNode[]} */
      this.sources = [];
      /** @type {string[]} */
      this.queue = [];
      /** @type {Map<string, AudioBuffer|null>} */
      this.cache = new Map();
      this.started = false;
      this.base = CDN;
      this.searchGen = 0;
      /** @type {Set<string>} */
      this.inventory = new Set();
      try {
        const saved = localStorage.getItem(BASE_KEY);
        if (saved && saved !== "/hungary_jf/" && saved !== "/navigacio/hungary_jf/") {
          this.base = withSlash(saved);
        }
      } catch (_e) {}
    }

    log(msg, err) {
      this.onLog(msg, !!err);
      if (err) console.warn("[NavVoice]", msg);
    }

    setBase(path) {
      let b = String(path || "").trim() || CDN;
      b = withSlash(b);
      if (b === this.base) return;
      this.base = b;
      this.cache.clear();
      try {
        localStorage.setItem(BASE_KEY, b);
      } catch (_e) {}
      api.BASE = b;
      this.log("Útvonal: " + this.base);
    }

    fallback(text) {
      if (text && this.onFallback) this.onFallback(text);
    }

    persistBase() {
      try {
        localStorage.setItem(BASE_KEY, this.base);
      } catch (_e) {}
      api.BASE = this.base;
    }

    candidateBases() {
      return unique([
        CDN,
        RAW,
        rel("../hungary_jf/"),
        rel("./hungary_jf/"),
        "/hungary_jf/",
        this.base
      ]).map(withSlash);
    }

    indexUrls() {
      return unique([
        rel("./voice/pack.json"),
        CDN + "index.json",
        RAW + "index.json",
        rel("../hungary_jf/index.json"),
        rel("./hungary_jf/index.json"),
        "/hungary_jf/index.json"
      ]);
    }

    url(file, base) {
      const name = String(file || "").replace(/^\//, "");
      const fileName = /\.ogg$/i.test(name) ? name : name + ".ogg";
      return withSlash(base || this.base) + fileName;
    }

    /**
     * Párhuzamos keresés: lista (pack.json / index.json) + egy próba .ogg.
     * @returns {Promise<string[]>}
     */
    async findSounds() {
      const gen = ++this.searchGen;
      this.log("Hangok keresése…");
      const namesP = this.loadAnyIndex();
      const baseP = this.probeAudioBase();
      const names = await namesP;
      const base = await baseP;
      if (gen !== this.searchGen) return Array.from(this.inventory);
      this.inventory = new Set(names.length ? names : [PROBE, "and_then_exit_right_100.ogg"]);

      if (!base) {
        this.log(
          "A hangfájlok a github.io-n még nincsenek (a Pages a main ágat szolgálja). A CDN sem elérhető ebből a böngészőből.",
          true
        );
        return [];
      }
      this.base = base;
      this.persistBase();
      this.logPackFound();
      return Array.from(this.inventory).sort();
    }

    logPackFound() {
      const left = this.filesForStem(LEFT_STEM).length;
      const right = this.filesForStem(RIGHT_STEM).length;
      this.log(
        "Megvan " +
          this.inventory.size +
          " hang. Forrás: " +
          this.base +
          " (balra " +
          left +
          ", jobbra " +
          right +
          "). Start / cél / újratervezés: beszédszintetizátor."
      );
    }

    fetchTimeout(href, ms) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (ctrl) ctrl.abort();
      }, ms || 7000);
      return fetch(href, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined }).finally(() =>
        clearTimeout(timer)
      );
    }

    async fetchJsonList(href) {
      try {
        const res = await this.fetchTimeout(href, 7000);
        if (!res.ok) return [];
        const type = (res.headers.get("content-type") || "").toLowerCase();
        if (type.indexOf("text/html") !== -1) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : data && data.files;
        if (!Array.isArray(list)) return [];
        return list
          .map((n) => String(n || "").replace(/^.*\//, ""))
          .filter((n) => /\.ogg$/i.test(n));
      } catch (_e) {
        return [];
      }
    }

    firstMatch(tasks) {
      return new Promise((resolve) => {
        let pending = tasks.length;
        let done = false;
        if (!pending) {
          resolve(null);
          return;
        }
        function good(value) {
          if (value == null || value === "") return false;
          if (Array.isArray(value) && !value.length) return false;
          return true;
        }
        tasks.forEach((task) => {
          Promise.resolve()
            .then(task)
            .then((value) => {
              if (!done && good(value)) {
                done = true;
                resolve(value);
              }
            })
            .catch(() => {})
            .then(() => {
              pending -= 1;
              if (!pending && !done) resolve(null);
            });
        });
      });
    }

    async loadAnyIndex() {
      const urls = this.indexUrls();
      const hit = await this.firstMatch(urls.map((href) => () => this.fetchJsonList(href)));
      return hit || [];
    }

    /**
     * @returns {Promise<string>}
     */
    async probeAudioBase() {
      const bases = this.candidateBases();
      const hit = await this.firstMatch(
        bases.map((base) => async () => ((await this.isOgg(this.url(PROBE, base))) ? base : ""))
      );
      return hit || "";
    }

    /**
     * GET, nem HEAD (a HEAD gyakran CORS-hiba). OggS mágikus szám.
     * @param {string} href
     * @returns {Promise<boolean>}
     */
    async isOgg(href) {
      try {
        const res = await this.fetchTimeout(href, 7000);
        if (!res.ok) return false;
        const type = (res.headers.get("content-type") || "").toLowerCase();
        if (type.indexOf("text/html") !== -1) return false;
        const raw = await res.arrayBuffer();
        if (raw.byteLength < 8) return false;
        const b = new Uint8Array(raw);
        return b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53;
      } catch (_e) {
        return false;
      }
    }

    known(file) {
      const name = /\.ogg$/i.test(file) ? file : file + ".ogg";
      if (!this.inventory.size) return true;
      return this.inventory.has(name);
    }

    filesForStem(stem) {
      const prefix = stem + "_";
      const out = [];
      this.inventory.forEach((name) => {
        if (name.indexOf(prefix) === 0 && /\.ogg$/i.test(name)) out.push(name);
      });
      return out;
    }

    pickFromStem(stem, prefer) {
      if (prefer) {
        const exact = stem + "_" + prefer + ".ogg";
        if (!this.inventory.size || this.inventory.has(exact)) return exact;
      }
      const matches = this.filesForStem(stem);
      if (!matches.length) {
        const fallback = stem + (prefer ? "_" + prefer : "_100") + ".ogg";
        return fallback;
      }
      return matches[Math.floor(Math.random() * matches.length)];
    }

    async start() {
      const ok = await this.unlock();
      if (!ok) return false;
      this.started = true;
      if (!this.inventory.size) await this.findSounds();
      this.log("Hang indítva. Forrás: " + this.base + " (" + this.inventory.size + " fájl)");
      this.fallback(TTS.start);
      return true;
    }

    async unlock() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
          this.log("Nincs Web Audio ebben a böngészőben.", true);
          return false;
        }
        if (!this.ctx) {
          this.ctx = new Ctx();
          this.gain = this.ctx.createGain();
          this.gain.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") await this.ctx.resume();
        if (!this.unlocked) {
          const silent = this.ctx.createBuffer(1, 1, 22050);
          const src = this.ctx.createBufferSource();
          src.buffer = silent;
          src.connect(this.gain);
          src.start(0);
          this.unlocked = true;
        }
        return this.ctx.state === "running" || this.ctx.state === "suspended";
      } catch (e) {
        this.log("A hangot nem lehetett feloldani.", true);
        return false;
      }
    }

    async loadFile(file, quiet) {
      const name = /\.ogg$/i.test(file) ? file : file + ".ogg";
      const hrefs = unique([this.url(name), this.url(name, CDN), this.url(name, RAW)]);
      for (let i = 0; i < hrefs.length; i++) {
        const href = hrefs[i];
        if (this.cache.has(href) && this.cache.get(href)) return this.cache.get(href);
        if (this.cache.has(href) && this.cache.get(href) === null) continue;
        try {
          const res = await fetch(href);
          if (!res.ok) {
            this.cache.set(href, null);
            continue;
          }
          if (!this.ctx) await this.unlock();
          const raw = await res.arrayBuffer();
          const view = new Uint8Array(raw);
          if (raw.byteLength < 8 || view[0] !== 0x4f) {
            this.cache.set(href, null);
            continue;
          }
          const buf = await this.ctx.decodeAudioData(raw.slice(0));
          this.cache.set(href, buf);
          const slash = href.lastIndexOf("/") + 1;
          this.base = href.slice(0, slash);
          this.persistBase();
          return buf;
        } catch (e) {
          this.cache.set(href, null);
        }
      }
      if (!quiet) this.log("Hiányzik: " + name, true);
      return null;
    }

    async enqueue(files, opts) {
      const interrupt = !opts || opts.interrupt !== false;
      if (!(await this.unlock())) return false;
      if (interrupt) this.stop();

      const buffers = [];
      const played = [];
      for (let i = 0; i < files.length; i++) {
        const buf = await this.loadFile(files[i]);
        if (buf) {
          buffers.push(buf);
          played.push(files[i]);
        }
      }
      if (!buffers.length) {
        this.log("Nincs lejátszható .ogg: " + (files[0] || PROBE), true);
        return false;
      }
      this.queue = played.slice();
      this.schedule(buffers);
      this.log("Sor: " + played.join(" → "));
      return true;
    }

    schedule(buffers) {
      if (!this.ctx || !this.gain) return;
      let t = this.ctx.currentTime + 0.02;
      buffers.forEach((buf, i) => {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.gain);
        src.start(t);
        src.onended = () => {
          this.queue.shift();
          const idx = this.sources.indexOf(src);
          if (idx >= 0) this.sources.splice(idx, 1);
          if (i === buffers.length - 1) this.log("Kész.");
        };
        this.sources.push(src);
        t += buf.duration + GAP;
      });
    }

    async playPhrase(key) {
      const phrase = PHRASES[key];
      if (!phrase) {
        this.log("Nincs ilyen utasítás: " + key, true);
        return;
      }
      if (!this.inventory.size) {
        this.findSounds().catch(() => {});
      }

      const files = [];
      if (phrase.stem) {
        const picked = this.pickFromStem(phrase.stem, phrase.prefer);
        if (picked) files.push(picked);
      } else if (phrase.files && phrase.files.length) {
        files.push.apply(files, phrase.files.filter((f) => this.known(f)));
      }

      if (!files.length) {
        this.fallback(TTS[key] || "");
        return;
      }
      const ok = await this.enqueue(files, { interrupt: true });
      if (!ok) this.fallback(TTS[key] || "");
    }

    async announceTurn(copy, until) {
      const text = String(copy && copy.text ? copy.text : "");
      if (/Megérkezt/i.test(text)) return this.playPhrase("finish");

      const maneuver = MANEUVER_FILE[text] || "go_straight";
      if (maneuver === "start" || maneuver === "finish") return this.playPhrase(maneuver);

      const stem = packStem(maneuver);
      const distText =
        (until >= 1000
          ? Math.round(until / 100) / 10 + " kilométer, "
          : Math.max(20, Math.round(until / 10) * 10) + " méter, ") +
        text.toLowerCase() +
        ".";
      if (!stem) {
        this.fallback(distText);
        return;
      }

      const d = distBucket(until);
      const picked = this.pickFromStem(stem, String(d));
      const buf = await this.loadFile(picked, true);
      if (!buf) {
        this.fallback(distText);
        return;
      }
      this.log("Menet: " + picked);
      this.stop();
      this.queue = [picked];
      this.schedule([buf]);
    }

    stop() {
      this.sources.forEach((src) => {
        try {
          src.onended = null;
          src.stop();
        } catch (_e) {}
      });
      this.sources = [];
      this.queue = [];
    }

    hasPack() {
      return this.inventory.size > 0 || this.base === CDN || this.base === RAW;
    }
  }

  const api = {
    BASE: CDN,
    PHRASES,
    AudioManager,
    /** @type {AudioManager|null} */
    instance: null,
    init(opts) {
      api.instance = new AudioManager(opts);
      return api.instance.findSounds().then(() => api.instance);
    }
  };

  global.NavVoice = api;
})(window);
