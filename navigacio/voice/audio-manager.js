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
  const GAP = 0.03;

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
    }

    log(msg, err) {
      this.onLog(msg, !!err);
      if (err) console.warn("[NavVoice]", msg);
    }

    url(file) {
      const name = String(file || "").replace(/^\//, "");
      if (!/\.ogg$/i.test(name)) return BASE + name + ".ogg";
      return BASE + name;
    }

    /**
     * Indító gomb: feloldja az autoplay-t, lejátssza a start.ogg-et.
     * @returns {Promise<boolean>}
     */
    async start() {
      const ok = await this.unlock();
      if (!ok) return false;
      this.started = true;
      this.log("Hang indítva. Forrás: " + BASE);
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
        this.log("A sor üres: egyik fájl sem tölthető.", true);
        return;
      }
      this.queue = played.slice();
      this.schedule(buffers);
      this.log("Sor: " + played.join(" → "));
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
      if (phrase.prefer) {
        const one = await this.loadFile(phrase.prefer);
        if (one) {
          this.log("Lejátszás: " + phrase.prefer);
          if (this.ctx) await this.ctx.resume();
          this.stop();
          this.queue = [phrase.prefer];
          this.schedule([one]);
          return;
        }
      }
      await this.enqueue(phrase.mosaic, { interrupt: true });
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
      const files = [];
      if (until > 400) {
        files.push("prepare_" + stem + ".ogg");
        files.push("prepare_" + stem + "_" + d + ".ogg");
      }
      files.push(stem + "_" + d + ".ogg");
      files.push("and_then_" + stem + "_" + d + ".ogg");
      files.push(stem + ".ogg");

      const unique = [];
      files.forEach((f) => {
        if (unique.indexOf(f) === -1) unique.push(f);
      });

      const bufs = [];
      const names = [];
      for (let i = 0; i < unique.length; i++) {
        const buf = await this.loadFile(unique[i], true);
        if (buf) {
          bufs.push(buf);
          names.push(unique[i]);
          break;
        }
      }
      if (!bufs.length) {
        this.log("Nincs hang ehhez: " + stem + " /hungary_jf/" + stem + "_" + d + ".ogg", true);
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
      return this.unlocked;
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
