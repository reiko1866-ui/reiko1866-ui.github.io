/**
 * ETS2 / SCS hangnavigáció — .ogg mozaikok sorból.
 *
 * Fájlok: ./hungary_jf/ vagy /hungary_jf/
 * Névkonvenció: SCS voice navigation prefixek (turn_left.ogg, recomputing.ogg, …)
 * és opcionális távolság-toldalék (turn_left_100.ogg).
 */
(function (global) {
  "use strict";

  const EXT = ".ogg";
  const BASES = ["./hungary_jf/", "/hungary_jf/", "../hungary_jf/"];
  const VARIANT_MAX = 4;
  const GAP_SEC = 0.04;

  /** @type {Record<string, string>} */
  const PREFIX = {
    turnLeft: "turn_left",
    turnRight: "turn_right",
    keepLeft: "keep_left",
    keepRight: "keep_right",
    exitLeft: "exit_left",
    exitRight: "exit_right",
    straight: "go_straight",
    uTurn: "u_turn",
    start: "start",
    finish: "finish",
    recomputing: "recomputing",
    exitNow: "exit_now",
    roundabout1: "roundabout_1"
  };

  /**
   * Egy teszt/menet utasítás: slotok, mindegyikben fallback fájlstemmek.
   * A lejátszó a slotból az első betölthető clipet választja, majd a következőt.
   * @type {Record<string, string[][]>}
   */
  const PHRASES = {
    "left-100": [["100", "in_100", "start_100"], ["turn_left_100", "turn_left"]],
    "right-500": [["500", "in_500", "start_500"], ["turn_right_500", "turn_right"]],
    "left-200": [["200", "in_200", "start_200"], ["turn_left_200", "turn_left"]],
    "right-100": [["100", "in_100", "start_100"], ["turn_right_100", "turn_right"]],
    recomputing: [["recomputing"]],
    finish: [["finish"]],
    start: [["start"]],
    straight: [["go_straight"]],
    uTurn: [["u_turn"]]
  };

  /**
   * @param {string} msg
   * @param {unknown} [detail]
   */
  function logWarn(msg, detail) {
    if (detail !== undefined) console.warn("[NavVoice]", msg, detail);
    else console.warn("[NavVoice]", msg);
  }

  class AudioManager {
    /**
     * @param {{ onLog?: (line: string, isError?: boolean) => void }} [opts]
     */
    constructor(opts) {
      this.onLog = (opts && opts.onLog) || null;
      this.baseUrl = BASES[0];
      this.ctx = null;
      this.gain = null;
      this.unlocked = false;
      this.busy = false;
      /** @type {AudioBuffer[]} */
      this.queue = [];
      /** @type {AudioBufferSourceNode | null} */
      this.source = null;
      /** @type {Map<string, AudioBuffer | null>} */
      this.cache = new Map();
      this.packReady = false;
      this.unlockBound = this.unlock.bind(this);
    }

    /**
     * Első user-gesztus: Autoplay tiltás feloldása.
     * Csatlakoztatni kell pointerdown/keydown/touchend előtt.
     */
    attachUnlock() {
      ["pointerdown", "keydown", "touchend"].forEach((ev) => {
        document.addEventListener(ev, this.unlockBound, { capture: true, passive: true });
      });
    }

    /**
     * @returns {Promise<boolean>}
     */
    async unlock() {
      try {
        if (!this.ctx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) {
            this.note("A böngésző nem támogatja a Web Audio API-t.", true);
            return false;
          }
          this.ctx = new Ctx();
          this.gain = this.ctx.createGain();
          this.gain.gain.value = 1;
          this.gain.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") await this.ctx.resume();
        if (!this.unlocked) {
          const buf = this.ctx.createBuffer(1, 1, 22050);
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.gain);
          src.start(0);
          this.unlocked = true;
          this.note("Hang feloldva.");
          ["pointerdown", "keydown", "touchend"].forEach((ev) => {
            document.removeEventListener(ev, this.unlockBound, { capture: true });
          });
        }
        return this.ctx.state === "running";
      } catch (err) {
        this.note("A hangot nem sikerült feloldani.", true);
        logWarn("unlock", err);
        return false;
      }
    }

    /**
     * Megkeresi a hungary_jf mappát, és ellenőrzi, hogy van-e legalább egy ismert clip.
     * @returns {Promise<boolean>}
     */
    async detectPack() {
      const probes = ["turn_left", "turn_right", "finish", "recomputing", "start", "go_straight"];
      for (let b = 0; b < BASES.length; b++) {
        this.baseUrl = BASES[b];
        for (let i = 0; i < probes.length; i++) {
          const buf = await this.loadStem(probes[i]);
          if (buf) {
            this.packReady = true;
            this.note("Csomag: " + this.baseUrl);
            return true;
          }
        }
      }
      this.packReady = false;
      this.note("Nincs .ogg a hungary_jf mappában — TTS marad.", true);
      return false;
    }

    /**
     * @param {string} line
     * @param {boolean} [isError]
     */
    note(line, isError) {
      if (this.onLog) this.onLog(line, !!isError);
    }

    /**
     * @param {string} stem  kiterjesztés nélkül
     * @returns {string[]}
     */
    candidateNames(stem) {
      const names = [stem];
      const stripped = stem.replace(/_(\d+)$/, "");
      if (stripped !== stem) names.push(stripped);
      for (let n = 1; n <= VARIANT_MAX; n++) names.push(stem + "_" + n);
      if (stripped !== stem) {
        for (let n = 1; n <= VARIANT_MAX; n++) names.push(stripped + "_" + n);
      }
      return names;
    }

    /**
     * @param {string} url
     * @returns {Promise<AudioBuffer | null>}
     */
    async fetchDecode(url) {
      if (this.cache.has(url)) return this.cache.get(url) || null;
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) {
          this.cache.set(url, null);
          return null;
        }
        const raw = await res.arrayBuffer();
        if (!this.ctx) await this.unlock();
        if (!this.ctx) return null;
        const buf = await this.ctx.decodeAudioData(raw.slice(0));
        this.cache.set(url, buf);
        return buf;
      } catch (err) {
        this.cache.set(url, null);
        logWarn("Nem tölthető: " + url, err);
        return null;
      }
    }

    /**
     * @param {string} stem
     * @returns {Promise<AudioBuffer | null>}
     */
    async loadStem(stem) {
      const names = this.candidateNames(stem);
      for (let i = 0; i < names.length; i++) {
        const url = this.baseUrl + names[i] + EXT;
        const buf = await this.fetchDecode(url);
        if (buf) return buf;
      }
      return null;
    }

    /**
     * Egy slot: az első létező clip.
     * @param {string[]} alts
     * @returns {Promise<AudioBuffer | null>}
     */
    async resolveSlot(alts) {
      for (let i = 0; i < alts.length; i++) {
        const buf = await this.loadStem(alts[i]);
        if (buf) return buf;
      }
      this.note("Hiányzik: " + alts.join(" | "), true);
      return null;
    }

    /**
     * Mozaik: slotok egymás után a sorba.
     * @param {string[][]} slots
     * @param {{ interrupt?: boolean }} [opts]
     */
    async enqueueSlots(slots, opts) {
      const interrupt = !opts || opts.interrupt !== false;
      if (!(await this.unlock())) return;
      if (interrupt) this.stop(false);
      const buffers = [];
      for (let i = 0; i < slots.length; i++) {
        const buf = await this.resolveSlot(slots[i]);
        if (buf) buffers.push(buf);
      }
      if (!buffers.length) {
        this.note("Egyik mozaik sem tölthető.", true);
        return;
      }
      this.queue.push.apply(this.queue, buffers);
      if (!this.busy) this.pump();
    }

    /**
     * @param {string} key  PHRASES kulcs
     */
    async playPhrase(key) {
      const slots = PHRASES[key];
      if (!slots) {
        this.note("Ismeretlen utasítás: " + key, true);
        return;
      }
      if (!this.packReady) await this.detectPack();
      this.note("Lejátszás: " + key);
      await this.enqueueSlots(slots, { interrupt: true });
    }

    /**
     * @param {string} prefix  SCS stem
     * @param {number} [meters]
     */
    async announcePrefix(prefix, meters) {
      const slots = [];
      if (Number.isFinite(meters) && meters >= 80) {
        const bucket = this.distanceBucket(meters);
        slots.push([prefix + "_" + bucket, String(bucket), "in_" + bucket, "start_" + bucket]);
      }
      slots.push([prefix]);
      await this.enqueueSlots(slots, { interrupt: true });
    }

    /**
     * @param {number} meters
     * @returns {string}
     */
    distanceBucket(meters) {
      if (meters >= 1500) return "2000";
      if (meters >= 750) return "1000";
      if (meters >= 350) return "500";
      if (meters >= 150) return "200";
      return "100";
    }

    /**
     * @param {{ text: string, street?: string }} copy
     * @param {number} until
     */
    async announceTurn(copy, until) {
      const prefix = this.prefixFromCopy(copy);
      if (prefix === PREFIX.finish) return this.playPhrase("finish");
      if (until > 400) {
        const prep = prefix
          .replace(/^turn_/, "prepare_turn_")
          .replace(/^exit_/, "prepare_exit_");
        const slots = [[prep, prefix]];
        await this.enqueueSlots(slots, { interrupt: true });
        return;
      }
      await this.announcePrefix(prefix, until);
    }

    /**
     * @param {{ text: string }} copy
     * @returns {string}
     */
    prefixFromCopy(copy) {
      const t = String(copy && copy.text ? copy.text : "");
      if (/Megérkezt/i.test(t)) return PREFIX.finish;
      if (/vissza/i.test(t)) return PREFIX.uTurn;
      if (/Körforgalom/i.test(t)) return PREFIX.roundabout1;
      if (/Hajts ki/i.test(t)) return PREFIX.exitNow;
      if (/Hajts le/i.test(t)) return PREFIX.exitRight;
      if (/Hajts fel|Csatlakozz/i.test(t)) return PREFIX.keepRight;
      if (/Tarts jobbra|Jobb elágazás/i.test(t)) return PREFIX.keepRight;
      if (/Tarts balra|Bal elágazás/i.test(t)) return PREFIX.keepLeft;
      if (/jobbra/i.test(t)) return PREFIX.turnRight;
      if (/balra/i.test(t)) return PREFIX.turnLeft;
      if (/Haladj|Indulás/i.test(t)) return PREFIX.straight;
      return PREFIX.straight;
    }

    pump() {
      if (this.busy || !this.queue.length || !this.ctx || !this.gain) return;
      this.busy = true;
      const buf = this.queue.shift();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      this.source = src;
      src.onended = () => {
        this.source = null;
        this.busy = false;
        if (this.queue.length) {
          window.setTimeout(() => this.pump(), GAP_SEC * 1000);
        }
      };
      try {
        src.start();
      } catch (err) {
        logWarn("start", err);
        this.source = null;
        this.busy = false;
        this.pump();
      }
    }

    /**
     * @param {boolean} [clearQueue]
     */
    stop(clearQueue) {
      if (clearQueue !== false) this.queue.length = 0;
      if (this.source) {
        try {
          this.source.onended = null;
          this.source.stop();
        } catch (_e) {}
        this.source = null;
      }
      this.busy = false;
    }

    hasPack() {
      return this.packReady;
    }
  }

  const api = {
    AudioManager,
    PHRASES,
    PREFIX,
    /** @type {AudioManager | null} */
    instance: null,
    /**
     * @param {{ onLog?: (line: string, isError?: boolean) => void }} [opts]
     */
    async init(opts) {
      const mgr = new AudioManager(opts);
      api.instance = mgr;
      mgr.attachUnlock();
      await mgr.detectPack();
      return mgr;
    }
  };

  global.NavVoice = api;
})(window);
