/**
 * Hangnavigáció — ETS2 .ogg mozaikok, lejátszási sor, autoplay-feloldás.
 *
 * A feltöltött csomag (hungary_jf) jelenleg csak két szótőt tartalmaz:
 *   and_then_exit_left_*.ogg  (479)
 *   and_then_exit_right_*.ogg (219)
 * start / finish / recomputing nincs — azokra TTS megy.
 *
 * Amíg a GitHub Pages a main ágat szolgálja ki, a fájlok CDN-ről
 * (jsDelivr / raw.githubusercontent) töltődnek. Merge után /hungary_jf/ is él.
 */
(function (global) {
  "use strict";

  const PAGES_BASE = "/hungary_jf/";
  const BRANCH = "cursor/terkep-navigacio-925b";
  const REPO = "reiko1866-ui/reiko1866-ui.github.io";
  const CDN_BRANCH =
    "https://cdn.jsdelivr.net/gh/" + REPO + "@" + BRANCH + "/hungary_jf/";
  const RAW_BRANCH =
    "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/hungary_jf/";
  const CDN_MAIN = "https://cdn.jsdelivr.net/gh/" + REPO + "@main/hungary_jf/";
  const BASE = PAGES_BASE;
  const BASE_KEY = "nav2_voice_base";
  const GAP = 0.03;

  const LEFT_STEM = "and_then_exit_left";
  const RIGHT_STEM = "and_then_exit_right";

  /**
   * Pontos fájlnevek. `stem` + `prefer`: a feltöltött csomag számozott változatai.
   * Ha nincs egyezés, véletlen fájl ugyanabból a szótőből.
   * @typedef {{ stem?: string, prefer?: string, files?: string[] }} Phrase
   */
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
      this.base = BASE;
      /** @type {Set<string>} */
      this.inventory = new Set();
      try {
        const saved = localStorage.getItem(BASE_KEY);
        if (saved) this.base = saved;
      } catch (_e) {}
    }

    log(msg, err) {
      this.onLog(msg, !!err);
      if (err) console.warn("[NavVoice]", msg);
    }

    /**
     * @param {string} path
     */
    setBase(path) {
      let b = String(path || "").trim() || BASE;
      if (!/\/$/.test(b)) b += "/";
      if (b === this.base) return;
      this.base = b;
      this.cache.clear();
      this.inventory = new Set();
      try {
        localStorage.setItem(BASE_KEY, b);
      } catch (_e) {}
      api.BASE = b;
      this.log("Útvonal: " + this.base);
    }

    fallback(text) {
      if (text && this.onFallback) this.onFallback(text);
    }

    candidateBases() {
      let here = "./";
      try {
        here = new URL("./", document.baseURI).href;
      } catch (_e) {}
      return unique([
        this.base,
        PAGES_BASE,
        CDN_BRANCH,
        RAW_BRANCH,
        CDN_MAIN,
        new URL("hungary_jf/", here).href,
        "/navigacio/hungary_jf/"
      ]).map((b) => (/\/$/.test(b) ? b : b + "/"));
    }

    url(file) {
      const name = String(file || "").replace(/^\//, "");
      const fileName = /\.ogg$/i.test(name) ? name : name + ".ogg";
      return this.base + fileName;
    }

    persistBase() {
      try {
        localStorage.setItem(BASE_KEY, this.base);
      } catch (_e) {}
      api.BASE = this.base;
    }

    /**
     * @returns {Promise<string[]>}
     */
    async findSounds() {
      this.inventory = new Set();
      const bases = this.candidateBases();
      const probes = [
        "index.json",
        "and_then_exit_left_100.ogg",
        "and_then_exit_right_100.ogg"
      ];

      for (let b = 0; b < bases.length; b++) {
        this.base = bases[b];
        this.log("Keresés: " + this.base);

        const listed = await this.loadIndex();
        if (listed.length) {
          listed.forEach((f) => this.inventory.add(f));
          this.persistBase();
          this.logPackFound();
          return Array.from(this.inventory).sort();
        }

        const dir = await this.listDirectory();
        if (dir.length) {
          dir.forEach((f) => this.inventory.add(f));
          this.persistBase();
          this.logPackFound();
          return Array.from(this.inventory).sort();
        }

        let hit = false;
        for (let i = 0; i < probes.length; i++) {
          if (probes[i] === "index.json") continue;
          if (await this.exists(this.url(probes[i]))) {
            this.inventory.add(probes[i]);
            hit = true;
          }
        }
        if (hit) {
          this.persistBase();
          this.logPackFound();
          return Array.from(this.inventory).sort();
        }
      }

      this.log(
        "A .ogg fájlok nincsenek a weben (404). Próbált: " +
          bases.join(" ") +
          " — a gombok most a telefon magyar hangját használják.",
        true
      );
      return [];
    }

    logPackFound() {
      const left = this.filesForStem(LEFT_STEM).length;
      const right = this.filesForStem(RIGHT_STEM).length;
      this.log(
        "Megvan " +
          this.inventory.size +
          " hang itt: " +
          this.base +
          " (balra " +
          left +
          ", jobbra " +
          right +
          "). Start / cél / újratervezés: beszédszintetizátor."
      );
    }

    /**
     * @returns {Promise<string[]>}
     */
    async loadIndex() {
      try {
        const res = await fetch(this.base + "index.json", { cache: "no-store" });
        if (!res.ok) return [];
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

    /**
     * @returns {Promise<string[]>}
     */
    async listDirectory() {
      try {
        const res = await fetch(this.base);
        if (!res.ok) return [];
        const html = await res.text();
        if (!/href\s*=/i.test(html) || html.length > 2e6) return [];
        const out = [];
        const re = /href\s*=\s*["']([^"']+\.ogg)["']/gi;
        let m;
        while ((m = re.exec(html))) {
          const raw = decodeURIComponent(m[1].split("?")[0]);
          const baseName = raw.replace(/^.*\//, "");
          if (baseName && out.indexOf(baseName) === -1) out.push(baseName);
        }
        return out;
      } catch (_e) {
        return [];
      }
    }

    known(file) {
      const name = /\.ogg$/i.test(file) ? file : file + ".ogg";
      if (!this.inventory.size) return false;
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

    /**
     * Előnyben a kért sorszám (pl. _100), különben véletlen ugyanabból a szótőből.
     * @param {string} stem
     * @param {string} [prefer]
     * @returns {string}
     */
    pickFromStem(stem, prefer) {
      if (prefer) {
        const exact = stem + "_" + prefer + ".ogg";
        if (this.known(exact)) return exact;
      }
      const matches = this.filesForStem(stem);
      if (!matches.length) {
        const bare = stem + ".ogg";
        return this.known(bare) ? bare : "";
      }
      return matches[Math.floor(Math.random() * matches.length)];
    }

    /**
     * @param {string} href
     * @returns {Promise<boolean>}
     */
    async exists(href) {
      try {
        let res = await fetch(href, { method: "HEAD" });
        if (res.status === 405 || res.status === 501) {
          res = await fetch(href, { method: "GET" });
        }
        return res.ok;
      } catch (_e) {
        return false;
      }
    }

    /**
     * Indító gomb: feloldja az autoplay-t. A csomagban nincs start.ogg.
     * @returns {Promise<boolean>}
     */
    async start() {
      const ok = await this.unlock();
      if (!ok) return false;
      this.started = true;
      if (!this.inventory.size) await this.findSounds();
      if (!this.inventory.size) {
        this.log(
          "Nincs .ogg a weben. A fájlok a repo gyökerében: hungary_jf/. Most a telefon hangja szól.",
          true
        );
        this.fallback(TTS.start);
        return false;
      }
      this.log("Hang indítva. Forrás: " + this.base + " (" + this.inventory.size + " fájl)");
      this.fallback(TTS.start);
      return true;
    }

    /**
     * @returns {Promise<boolean>}
     */
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

    /**
     * @param {string} file
     * @param {boolean} [quiet]
     * @returns {Promise<AudioBuffer|null>}
     */
    async loadFile(file, quiet) {
      const href = this.url(file);
      if (this.cache.has(href)) return this.cache.get(href);
      try {
        const res = await fetch(href);
        if (!res.ok) {
          this.cache.set(href, null);
          if (!quiet) this.log("Hiányzik: " + href, true);
          return null;
        }
        if (!this.ctx) await this.unlock();
        const raw = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(raw.slice(0));
        this.cache.set(href, buf);
        return buf;
      } catch (e) {
        this.cache.set(href, null);
        if (!quiet) this.log("Nem játszható: " + href, true);
        return null;
      }
    }

    /**
     * @param {string[]} files
     * @param {{ interrupt?: boolean }} [opts]
     */
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
        this.log("Nincs .ogg itt: " + this.url(files[0] || "and_then_exit_left_100.ogg"), true);
        return false;
      }
      this.queue = played.slice();
      this.schedule(buffers);
      this.log("Sor: " + played.join(" → "));
      return true;
    }

    /**
     * @param {AudioBuffer[]} buffers
     */
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

    /**
     * @param {string} key
     */
    async playPhrase(key) {
      const phrase = PHRASES[key];
      if (!phrase) {
        this.log("Nincs ilyen utasítás: " + key, true);
        return;
      }
      if (!this.inventory.size) await this.findSounds();

      const files = [];
      if (phrase.stem) {
        const picked = this.pickFromStem(phrase.stem, phrase.prefer);
        if (picked) files.push(picked);
      }
      if (!files.length && phrase.files) {
        phrase.files.forEach((f) => {
          if (this.known(f)) files.push(f);
        });
      }

      if (!files.length) {
        this.fallback(TTS[key] || "");
        return;
      }
      const ok = await this.enqueue(files, { interrupt: true });
      if (!ok) this.fallback(TTS[key] || "");
    }

    /**
     * @param {{ text: string }} copy
     * @param {number} until
     */
    async announceTurn(copy, until) {
      const text = String(copy && copy.text ? copy.text : "");
      if (/Megérkezt/i.test(text)) return this.playPhrase("finish");

      const maneuver = MANEUVER_FILE[text] || "go_straight";
      if (maneuver === "start" || maneuver === "finish") return this.playPhrase(maneuver);

      const stem = packStem(maneuver);
      if (!stem) {
        this.fallback(
          (until >= 1000
            ? Math.round(until / 100) / 10 + " kilométer, "
            : Math.max(20, Math.round(until / 10) * 10) + " méter, ") +
            text.toLowerCase() +
            "."
        );
        return;
      }

      if (!this.inventory.size) await this.findSounds();
      const d = distBucket(until);
      const picked = this.pickFromStem(stem, String(d));
      if (!picked) {
        this.fallback(
          (until >= 1000
            ? Math.round(until / 100) / 10 + " kilométer, "
            : Math.max(20, Math.round(until / 10) * 10) + " méter, ") +
            text.toLowerCase() +
            "."
        );
        return;
      }

      const buf = await this.loadFile(picked, true);
      if (!buf) {
        this.fallback(
          (until >= 1000
            ? Math.round(until / 100) / 10 + " kilométer, "
            : Math.max(20, Math.round(until / 10) * 10) + " méter, ") +
            text.toLowerCase() +
            "."
        );
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
      return this.inventory.size > 0;
    }
  }

  const api = {
    BASE,
    PHRASES,
    AudioManager,
    /** @type {AudioManager|null} */
    instance: null,
    /**
     * @param {{ onLog?: (msg: string, err?: boolean) => void, onFallback?: (text: string) => void }} [opts]
     */
    init(opts) {
      api.instance = new AudioManager(opts);
      return api.instance.findSounds().then(() => api.instance);
    }
  };

  global.NavVoice = api;
})(window);
