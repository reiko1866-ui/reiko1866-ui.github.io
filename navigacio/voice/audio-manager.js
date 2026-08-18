/**
 * Hangnavigáció — ETS2 .ogg mozaikok, lejátszási sor, autoplay-feloldás.
 *
 * Feltétel: a fájlok a webgyökér /hungary_jf/ mappában vannak,
 * pontos névvel, pl. /hungary_jf/and_then_exit_left_100.ogg
 *
 * Használat:
 *   await NavVoice.init({ onLog });
 *   await NavVoice.instance.start();          // Indító gomb
 *   await NavVoice.instance.playPhrase("left-100");
 */
(function (global) {
  "use strict";

  /** Webes gyökér, ahogy kérted. */
  const BASE = "/hungary_jf/";
  const BASE_KEY = "nav2_voice_base";
  const GAP = 0.03;
  const DISTS = ["", "_50", "_100", "_200", "_300", "_500", "_800", "_1000", "_2000"];
  const STEMS = [
    "start",
    "finish",
    "recomputing",
    "u_turn",
    "go_straight",
    "turn_left",
    "turn_right",
    "keep_left",
    "keep_right",
    "exit_left",
    "exit_right",
    "exit_now",
    "speed_warning",
    "speed_signal",
    "roundabout_1",
    "roundabout_2",
    "roundabout_3",
    "roundabout_4",
    "roundabout_5",
    "roundabout_6",
    "prepare_turn_left",
    "prepare_turn_right",
    "prepare_exit_left",
    "prepare_exit_right",
    "compound_turn_left",
    "compound_turn_right",
    "compound_keep_left",
    "compound_keep_right",
    "compound_exit_left",
    "compound_exit_right",
    "compound_go_straight",
    "and_then_turn_left",
    "and_then_turn_right",
    "and_then_keep_left",
    "and_then_keep_right",
    "and_then_exit_left",
    "and_then_exit_right",
    "and_then_go_straight"
  ];

  function catalog() {
    const files = ["50.ogg", "100.ogg", "200.ogg", "300.ogg", "500.ogg", "800.ogg", "1000.ogg", "2000.ogg"];
    STEMS.forEach((stem) => {
      DISTS.forEach((d) => files.push(stem + d + ".ogg"));
    });
    return files;
  }

  /**
   * Pontos fájlnevek. `prefer`: egyben; ha nincs, `mosaic` megy a sorba.
   * @typedef {{ prefer?: string, mosaic: string[] }} Phrase
   * @type {Record<string, Phrase>}
   */
  const PHRASES = {
    start: { mosaic: ["start.ogg"] },
    finish: { mosaic: ["finish.ogg"] },
    recomputing: { mosaic: ["recomputing.ogg"] },
    "left-100": {
      prefer: "turn_left_100.ogg",
      mosaic: ["100.ogg", "turn_left.ogg"]
    },
    "right-500": {
      prefer: "turn_right_500.ogg",
      mosaic: ["500.ogg", "turn_right.ogg"]
    },
    "right-100": {
      prefer: "turn_right_100.ogg",
      mosaic: ["100.ogg", "turn_right.ogg"]
    },
    "left-500": {
      prefer: "turn_left_500.ogg",
      mosaic: ["500.ogg", "turn_left.ogg"]
    },
    "exit-left-100": {
      prefer: "and_then_exit_left_100.ogg",
      mosaic: ["100.ogg", "and_then_exit_left.ogg", "exit_left.ogg"]
    },
    "exit-right-100": {
      prefer: "and_then_exit_right_100.ogg",
      mosaic: ["100.ogg", "and_then_exit_right.ogg", "exit_right.ogg"]
    },
    straight: { mosaic: ["go_straight.ogg"] },
    uTurn: { mosaic: ["u_turn.ogg"] }
  };

  const MANEUVER_FILE = {
    "Fordulj jobbra": "turn_right",
    "Fordulj balra": "turn_left",
    "Tarts jobbra": "keep_right",
    "Tarts balra": "keep_left",
    "Élesen jobbra": "turn_right",
    "Élesen balra": "turn_left",
    "Fordulj vissza": "u_turn",
    "Indulás": "start",
    "Megérkeztél": "finish",
    "Körforgalom": "roundabout_1",
    "Hajts ki": "exit_now",
    "Hajts fel": "keep_right",
    "Hajts le": "exit_right",
    "Csatlakozz": "keep_right",
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

  class AudioManager {
    /**
     * @param {{ onLog?: (msg: string, err?: boolean) => void }} [opts]
     */
    constructor(opts) {
      this.onLog = (opts && opts.onLog) || function () {};
      this.onFallback = (opts && opts.onFallback) || null;
      this.ctx = null;
      this.gain = null;
      this.unlocked = false;
      /** @type {AudioBufferSourceNode[]} */
      this.sources = [];
      /** @type {string[]} fájlnevek, amik még mennek */
      this.queue = [];
      /** @type {Map<string, AudioBuffer|null>} */
      this.cache = new Map();
      this.started = false;
      this.base = BASE;
      /** @type {Set<string>} minden megtalált .ogg ugyanabból a mappából */
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
     * @param {string} path  pl. /hungary_jf/ vagy https://pelda.hu/hungary_jf/
     */
    setBase(path) {
      let b = String(path || "").trim() || BASE;
      if (!/\/$/.test(b)) b += "/";
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
        new URL("hungary_jf/", here).href,
        "/navigacio/hungary_jf/",
        "/hungary_jf/"
      ]).map((b) => (/\/$/.test(b) ? b : b + "/"));
    }

    url(file) {
      const name = String(file || "").replace(/^\//, "");
      const fileName = /\.ogg$/i.test(name) ? name : name + ".ogg";
      return this.base + fileName;
    }

    /**
     * Végignézi a lehetséges mappákat, gyors próbával (start/turn_left/finish).
     * @returns {Promise<string[]>}
     */
    async findSounds() {
      this.inventory = new Set();
      const bases = this.candidateBases();
      const probes = ["start.ogg", "turn_left.ogg", "finish.ogg", "recomputing.ogg", "turn_left_100.ogg"];
      for (let b = 0; b < bases.length; b++) {
        this.base = bases[b];
        this.log("Keresés: " + this.base);
        const listed = await this.listDirectory();
        if (listed.length) {
          listed.forEach((f) => this.inventory.add(f));
          this.log("Megvan " + listed.length + " hang itt: " + this.base);
          return Array.from(this.inventory).sort();
        }
        let hit = false;
        for (let i = 0; i < probes.length; i++) {
          if (await this.exists(this.url(probes[i]))) {
            this.inventory.add(probes[i]);
            hit = true;
          }
        }
        if (hit) {
          const names = catalog();
          for (let i = 0; i < names.length; i += 8) {
            const slice = names.slice(i, i + 8);
            const hits = await Promise.all(
              slice.map(async (f) => ((await this.exists(this.url(f))) ? f : null))
            );
            hits.forEach((f) => {
              if (f) this.inventory.add(f);
            });
          }
          this.log("Megvan " + this.inventory.size + " hang itt: " + this.base);
          try {
            localStorage.setItem(BASE_KEY, this.base);
          } catch (_e) {}
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
      if (!this.inventory.size) return true;
      return this.inventory.has(name);
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
     * Indító gomb: feloldja az autoplay-t, lejátssza a start.ogg-et.
     * @returns {Promise<boolean>}
     */
    async start() {
      const ok = await this.unlock();
      if (!ok) return false;
      this.started = true;
      if (!this.inventory.size) await this.findSounds();
      if (!this.inventory.size) {
        this.log(
          "Nincs .ogg a weben. Tedd a fájlokat a navigacio/hungary_jf mappába, vagy a repo gyökerébe: hungary_jf/. Most a telefon hangja szól.",
          true
        );
        this.fallback(TTS.start);
        return false;
      }
      this.log("Hang indítva. Forrás: " + this.base + " (" + this.inventory.size + " fájl)");
      await this.playPhrase("start");
      return true;
    }

    /**
     * Autoplay tiltás feloldása (kötelező user gesztus).
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
     * Pontos fájlnév betöltése. 404 / decode hiba → null, a sor megy tovább.
     * @param {string} file
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
     * Fájlnevek a sorba, egymás után, zökkenőmentesen.
     * @param {string[]} files
     * @param {{ interrupt?: boolean }} [opts]
     */
    async enqueue(files, opts) {
      const interrupt = !opts || opts.interrupt !== false;
      if (!(await this.unlock())) return;
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
        this.log("Nincs .ogg itt: " + this.url(files[0] || "start.ogg"), true);
        return false;
      }
      this.queue = played.slice();
      this.schedule(buffers);
      this.log("Sor: " + played.join(" → "));
      return true;
    }

    /**
     * Bufferök időzítése az AudioContext óráján (nincs hézag a klipek között).
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
      if (phrase.prefer && this.known(phrase.prefer)) {
        const one = await this.loadFile(phrase.prefer, true);
        if (one) {
          this.log("Lejátszás: " + phrase.prefer);
          if (this.ctx) await this.ctx.resume();
          this.stop();
          this.queue = [phrase.prefer];
          this.schedule([one]);
          return;
        }
      }
      const mosaic = phrase.mosaic.filter((f) => this.known(f));
      const ok = await this.enqueue(mosaic.length ? mosaic : phrase.mosaic, { interrupt: true });
      if (!ok) this.fallback(TTS[key] || "");
    }

    /**
     * Menet közben: kanyar + távolság → pontos .ogg nevek.
     * @param {{ text: string }} copy
     * @param {number} until
     */
    async announceTurn(copy, until) {
      const text = String(copy && copy.text ? copy.text : "");
      if (/Megérkezt/i.test(text)) return this.playPhrase("finish");

      const stem = MANEUVER_FILE[text] || "go_straight";
      if (stem === "start" || stem === "finish") return this.playPhrase(stem);

      const d = distBucket(until);
      const files = [
        stem + "_" + d + ".ogg",
        "and_then_" + stem + "_" + d + ".ogg",
        "prepare_" + stem + "_" + d + ".ogg",
        "compound_" + stem + "_" + d + ".ogg",
        "prepare_" + stem + ".ogg",
        "compound_" + stem + ".ogg",
        "and_then_" + stem + ".ogg",
        stem + ".ogg"
      ];
      if (until > 400) {
        files.unshift("prepare_" + stem + "_" + d + ".ogg");
        files.unshift("prepare_" + stem + ".ogg");
      }

      const unique = [];
      files.forEach((f) => {
        if (unique.indexOf(f) === -1) unique.push(f);
      });

      const bufs = [];
      const names = [];
      for (let i = 0; i < unique.length; i++) {
        if (!this.known(unique[i])) continue;
        const buf = await this.loadFile(unique[i], true);
        if (buf) {
          bufs.push(buf);
          names.push(unique[i]);
          break;
        }
      }
      if (!bufs.length) {
        this.log("Nincs .ogg ehhez: " + stem, true);
        this.fallback((until >= 1000 ? Math.round(until / 100) / 10 + " kilométer, " : Math.max(20, Math.round(until / 10) * 10) + " méter, ") + text.toLowerCase() + ".");
        return;
      }
      this.log("Menet: " + names.join(" → "));
      this.stop();
      this.queue = names.slice();
      this.schedule(bufs);
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
     * @param {{ onLog?: (msg: string, err?: boolean) => void }} [opts]
     */
    init(opts) {
      api.instance = new AudioManager(opts);
      return Promise.resolve(api.instance);
    }
  };

  global.NavVoice = api;
})(window);
