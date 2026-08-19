/**
 * Hangnavigáció — a feltöltött csomag vegyes poénok, a fájlnév NEM az irány.
 * catalog.json a Whisper-átirat alapján sorolja a kanyarokat.
 * Távot a telefon magyar hangja mondja (Google Maps mód); a kanyarnál a clip szól.
 */
(function (global) {
  "use strict";

  const BRANCH = "cursor/terkep-navigacio-925b";
  const REPO = "reiko1866-ui/reiko1866-ui.github.io";
  const ENC = encodeURIComponent(BRANCH);
  const OGG_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/hungary_jf/";
  const APP_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/navigacio/";

  const PHRASES = {
    start: { cat: "", tts: "Hang kész.", phase: "soon" },
    finish: { cat: "arrive", tts: "Megérkeztél.", phase: "now" },
    recomputing: { cat: "recompute", tts: "Újratervezés.", phase: "now" },
    "left-100": { cat: "left", tts: "Száz méter múlva fordulj balra.", phase: "near" },
    "right-500": { cat: "right", tts: "Ötszáz méter múlva fordulj jobbra.", phase: "soon" },
    "now-left": { cat: "left", tts: "Fordulj balra.", phase: "now" },
    "now-right": { cat: "right", tts: "Fordulj jobbra.", phase: "now" },
    "right-100": { cat: "right", tts: "Száz méter múlva fordulj jobbra.", phase: "near" },
    "left-500": { cat: "left", tts: "Ötszáz méter múlva fordulj balra.", phase: "soon" },
    "exit-left-100": { cat: "motorwayOff", tts: "Száz méter múlva hajts le balra.", phase: "near" },
    "exit-right-100": { cat: "motorwayOff", tts: "Száz méter múlva hajts le jobbra.", phase: "near" },
    straight: { cat: "straight", tts: "Haladj tovább egyenesen.", phase: "now" },
    uTurn: { cat: "uturn", tts: "Fordulj vissza.", phase: "now" },
    "keep-left": { cat: "leftKeep", tts: "Tarts balra.", phase: "now" },
    "keep-right": { cat: "rightKeep", tts: "Tarts jobbra.", phase: "now" },
    "sharp-left": { cat: "leftSharp", tts: "Fordulj élesen balra.", phase: "now" },
    "sharp-right": { cat: "rightSharp", tts: "Fordulj élesen jobbra.", phase: "now" },
    roundabout: { cat: "roundabout", tts: "Hajts be a körforgalomba.", phase: "now" },
    "motorway-on": { cat: "motorwayOn", tts: "Hajts fel az autópályára.", phase: "now" },
    "motorway-off": { cat: "motorwayOff", tts: "Hajts le az autópályáról.", phase: "now" },
    gps: { cat: "gps", tts: "A GPS-vétel gyenge.", phase: "now" }
  };

  const FALLBACK = {
    leftSharp: ["left"],
    leftKeep: ["left"],
    rightSharp: ["right"],
    rightKeep: ["right"],
    motorwayOff: ["right"],
    motorwayOn: ["straight"],
    roundabout: ["straight"],
    uturn: ["left"],
    arrive: [],
    recompute: [],
    gps: [],
    straight: [],
    left: [],
    right: []
  };

  function unique(list) {
    const out = [];
    list.forEach((x) => {
      if (x && out.indexOf(x) === -1) out.push(x);
    });
    return out;
  }

  function rel(path) {
    try {
      return new URL(path, document.baseURI).href;
    } catch (_e) {
      return path;
    }
  }

  function canPlayOgg() {
    try {
      const a = document.createElement("audio");
      return !!a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"') !== "";
    } catch (_e) {
      return false;
    }
  }

  class AudioManager {
    /**
     * @param {{ onLog?: (msg: string, err?: boolean) => void, onFallback?: (text: string) => void }} [opts]
     */
    constructor(opts) {
      this.onLog = (opts && opts.onLog) || function () {};
      this.onFallback = (opts && opts.onFallback) || null;
      this.ogg = canPlayOgg();
      this.started = false;
      /** @type {Record<string, string[]>} */
      this.catalog = {};
      this.lastName = "";
      this.player = document.getElementById("navVoiceEl") || new Audio();
      this.player.setAttribute("playsinline", "true");
      this.player.preload = "auto";
      this.player.addEventListener("playing", () => this.log("Szól: " + (this.player.src || "").split("/").pop()));
      this.player.addEventListener("ended", () => this.log("Kész."));
      this.player.addEventListener("error", () => {
        const err = this.player.error;
        this.log("Lejátszás hiba" + (err ? " (" + err.code + ")" : ""), true);
      });
    }

    log(msg, err) {
      this.onLog(msg, !!err);
      if (err) console.warn("[NavVoice]", msg);
    }

    fallback(text) {
      if (text && this.onFallback) this.onFallback(text);
    }

    setBase() {}

    filesFor(cat) {
      const list = this.catalog[cat];
      return list && list.length ? list : [];
    }

    pickName(cat) {
      const matches = this.filesFor(cat);
      if (!matches.length) return "";
      if (matches.length === 1) return matches[0];
      let name = matches[Math.floor(Math.random() * matches.length)];
      if (name === this.lastName) name = matches[Math.floor(Math.random() * matches.length)];
      this.lastName = name;
      return name;
    }

    hrefsForName(oggName) {
      if (!oggName) return [];
      const mp3Name = oggName.replace(/\.ogg$/i, ".mp3");
      if (this.ogg) {
        return unique([OGG_CDN + oggName, rel("../hungary_jf/" + oggName), "/hungary_jf/" + oggName]);
      }
      return unique([rel("./voice/clips/" + mp3Name), APP_CDN + "voice/clips/" + mp3Name]);
    }

    hushSpeech() {
      try {
        if (global.speechSynthesis) global.speechSynthesis.cancel();
      } catch (_e) {}
    }

    playNow(hrefs, tts) {
      const urls = (hrefs || []).filter(Boolean);
      if (!urls.length) {
        this.fallback(tts || "");
        return false;
      }
      const href = urls[0];
      try {
        this.hushSpeech();
        this.player.pause();
        this.player.src = href;
        const p = this.player.play();
        this.log("Lejátszás: " + decodeURIComponent(href.split("/").pop() || href));
        if (p && p.catch) {
          p.catch(() => {
            if (urls[1]) {
              this.player.src = urls[1];
              const p2 = this.player.play();
              if (p2 && p2.catch) p2.catch(() => this.fallback(tts || ""));
            } else this.fallback(tts || "");
          });
        }
        return true;
      } catch (_e) {
        this.fallback(tts || "");
        return false;
      }
    }

    playCat(cat, tts) {
      const order = [cat].concat(FALLBACK[cat] || []);
      for (let i = 0; i < order.length; i++) {
        const name = this.pickName(order[i]);
        if (!name) continue;
        return this.playNow(this.hrefsForName(name), tts);
      }
      this.fallback(tts || "");
      return false;
    }

    /**
     * soon/near: csak TTS (táv + utasítás). now: a kategória clipje.
     * @param {string} cat
     * @param {{ phase?: string, tts?: string }} [opts]
     */
    announce(cat, opts) {
      const phase = (opts && opts.phase) || "now";
      const tts = (opts && opts.tts) || "";
      if (phase === "now" || phase === "clip") return this.playCat(cat, tts);
      this.fallback(tts);
      return false;
    }

    start() {
      this.started = true;
      this.fallback(PHRASES.start.tts);
      this.findSounds();
      return true;
    }

    playPhrase(key) {
      const phrase = PHRASES[key];
      if (!phrase) {
        this.log("Nincs ilyen utasítás: " + key, true);
        return;
      }
      this.announce(phrase.cat, { phase: phrase.phase, tts: phrase.tts });
    }

    announceTurn(copy, until, phase) {
      const cat = copy && copy.cat ? copy.cat : "";
      const tts = copy && copy.tts ? copy.tts : "";
      return this.announce(cat, { phase: phase || "now", tts: tts || "" });
    }

    stop() {
      try {
        this.player.pause();
        this.player.removeAttribute("src");
        this.player.load();
      } catch (_e) {}
    }

    hasPack() {
      return this.filesFor("left").length > 0 || this.filesFor("right").length > 0;
    }

    async findSounds() {
      this.log("Hangok rendezése navigációs utasítás szerint…");
      const urls = unique([rel("./voice/catalog.json"), APP_CDN + "voice/catalog.json"]);
      for (let i = 0; i < urls.length; i++) {
        try {
          const res = await fetch(urls[i], { cache: "no-store" });
          if (!res.ok) continue;
          const data = await res.json();
          const files = data && data.files ? data.files : data;
          if (!files || !files.left) continue;
          this.catalog = files;
          this.log(
            "Kész: " +
              (files.left || []).length +
              " balra, " +
              (files.right || []).length +
              " jobbra, " +
              (files.leftKeep || []).length +
              " tarts balra, " +
              (files.roundabout || []).length +
              " körforgalom, " +
              (files.recompute || []).length +
              " újratervezés, " +
              (files.arrive || []).length +
              " megérkezés. Távot a telefon mondja, kanyarnál a csomag szól."
          );
          return files;
        } catch (_e) {}
      }
      this.log("A hanglista nem töltődött, a kanyarokhoz a telefon hangja szól.", true);
      return null;
    }
  }

  const api = {
    PHRASES,
    AudioManager,
    /** @type {AudioManager|null} */
    instance: null,
    init(opts) {
      api.instance = new AudioManager(opts);
      return api.instance.findSounds().then(() => api.instance);
    },
    playCat(cat, tts) {
      return api.instance ? api.instance.playCat(cat, tts) : false;
    }
  };

  global.NavVoice = api;
})(window);
