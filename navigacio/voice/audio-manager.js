/**
 * Hangnavigáció — HTMLAudio, azonnali play() a kattintás gesztusában.
 * iPhone: MP3 (Safari nem játssza az .ogg-ot). Android: .ogg a CDN-ről.
 */
(function (global) {
  "use strict";

  const BRANCH = "cursor/terkep-navigacio-925b";
  const REPO = "reiko1866-ui/reiko1866-ui.github.io";
  const ENC = encodeURIComponent(BRANCH);
  const OGG_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/hungary_jf/";
  const APP_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/navigacio/";
  const PROBE = "and_then_exit_left_100.ogg";
  const LEFT_STEM = "and_then_exit_left";
  const RIGHT_STEM = "and_then_exit_right";
  const BASE_KEY = "nav2_voice_base";

  const PHRASES = {
    start: { side: "left", tts: "Hang kész." },
    finish: { tts: "Megérkeztél." },
    recomputing: { tts: "Újratervezés." },
    "left-100": { side: "left", ogg: LEFT_STEM + "_100.ogg", tts: "100 méter, fordulj balra." },
    "right-500": { side: "right", ogg: RIGHT_STEM + "_100.ogg", tts: "500 méter, fordulj jobbra." },
    "right-100": { side: "right", ogg: RIGHT_STEM + "_100.ogg", tts: "100 méter, fordulj jobbra." },
    "left-500": { side: "left", ogg: LEFT_STEM + "_100.ogg", tts: "500 méter, fordulj balra." },
    "exit-left-100": { side: "left", ogg: LEFT_STEM + "_100.ogg", tts: "100 méter, hajts le balra." },
    "exit-right-100": { side: "right", ogg: RIGHT_STEM + "_100.ogg", tts: "100 méter, hajts le jobbra." },
    straight: { tts: "Haladj tovább." },
    uTurn: { side: "left", tts: "Fordulj vissza." }
  };

  const MANEUVER_FILE = {
    "Fordulj jobbra": "right",
    "Fordulj balra": "left",
    "Tarts jobbra": "right",
    "Tarts balra": "left",
    "Élesen jobbra": "right",
    "Élesen balra": "left",
    "Fordulj vissza": "left",
    "Hajts ki": "right",
    "Hajts fel": "right",
    "Hajts le": "right",
    Csatlakozz: "right",
    "Jobb elágazás": "right",
    "Bal elágazás": "left"
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
      this.base = OGG_CDN;
      this.started = false;
      this.inventory = new Set();
      this.player = document.getElementById("navVoiceEl") || new Audio();
      this.player.setAttribute("playsinline", "true");
      this.player.preload = "auto";
      this.player.addEventListener("playing", () => this.log("Szól: " + (this.player.src || "").split("/").pop()));
      this.player.addEventListener("ended", () => this.log("Kész."));
      this.player.addEventListener("error", () => {
        const err = this.player.error;
        this.log("Lejátszás hiba" + (err ? " (" + err.code + ")" : ""), true);
      });
      try {
        const saved = localStorage.getItem(BASE_KEY);
        if (saved && /^https?:/i.test(saved) && saved.indexOf("hungary_jf") !== -1) this.base = saved;
      } catch (_e) {}
    }

    log(msg, err) {
      this.onLog(msg, !!err);
      if (err) console.warn("[NavVoice]", msg);
    }

    fallback(text) {
      if (text && this.onFallback) this.onFallback(text);
    }

    setBase(path) {
      const b = String(path || "").trim();
      if (!b) return;
      this.base = /\/$/.test(b) ? b : b + "/";
      this.log("Útvonal: " + this.base);
    }

    mp3Urls(side) {
      const name = side === "right" ? "right.mp3" : "left.mp3";
      return unique([APP_CDN + "voice/clips/" + name, rel("./voice/clips/" + name)]);
    }

    oggUrls(file) {
      const name = /\.ogg$/i.test(file) ? file : file + ".ogg";
      return unique([this.base + name, OGG_CDN + name]);
    }

    hrefsFor(phrase) {
      if (phrase.ogg && this.ogg) return this.oggUrls(phrase.ogg);
      if (phrase.side) return this.mp3Urls(phrase.side);
      return [];
    }

    /**
     * Azonnali lejátszás — nincs await a play() előtt (kattintás gesztusa).
     * @param {string[]} hrefs
     * @param {string} [tts]
     */
    playNow(hrefs, tts) {
      const urls = (hrefs || []).filter(Boolean);
      if (!urls.length) {
        this.fallback(tts || "");
        return false;
      }
      const href = urls[0];
      try {
        this.player.pause();
        this.player.src = href;
        const p = this.player.play();
        this.log("Lejátszás: " + href.split("/").pop());
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

    start() {
      this.started = true;
      this.playNow(this.ogg ? this.oggUrls(PROBE) : this.mp3Urls("left"), PHRASES.start.tts);
      this.findSounds();
      return true;
    }

    playPhrase(key) {
      const phrase = PHRASES[key];
      if (!phrase) {
        this.log("Nincs ilyen utasítás: " + key, true);
        return;
      }
      const hrefs = this.hrefsFor(phrase);
      if (!hrefs.length) {
        this.fallback(phrase.tts || "");
        return;
      }
      this.playNow(hrefs, phrase.tts);
    }

    announceTurn(copy, until) {
      const text = String(copy && copy.text ? copy.text : "");
      if (/Megérkezt/i.test(text)) return this.playPhrase("finish");
      const side = MANEUVER_FILE[text];
      const distText =
        (until >= 1000
          ? Math.round(until / 100) / 10 + " kilométer, "
          : Math.max(20, Math.round(until / 10) * 10) + " méter, ") +
        text.toLowerCase() +
        ".";
      if (!side) {
        this.fallback(distText);
        return;
      }
      const phrase = { side: side, ogg: (side === "right" ? RIGHT_STEM : LEFT_STEM) + "_100.ogg", tts: distText };
      this.playNow(this.hrefsFor(phrase), distText);
    }

    stop() {
      try {
        this.player.pause();
        this.player.removeAttribute("src");
        this.player.load();
      } catch (_e) {}
    }

    hasPack() {
      return true;
    }

    async findSounds() {
      this.log("Hangok keresése…");
      const urls = unique([rel("./voice/pack.json"), APP_CDN + "voice/pack.json", OGG_CDN + "index.json"]);
      for (let i = 0; i < urls.length; i++) {
        try {
          const res = await fetch(urls[i], { cache: "no-store" });
          if (!res.ok) continue;
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          const names = list.filter((n) => /\.ogg$/i.test(String(n)));
          if (!names.length) continue;
          this.inventory = new Set(names);
          this.log(
            "Megvan " +
              names.length +
              " hang. Lejátszás: " +
              (this.ogg ? "Ogg/CDN" : "MP3 (iPhone/Safari)") +
              ". A tesztgomb azonnal szóljon."
          );
          return names;
        } catch (_e) {}
      }
      this.log("A lista nem töltődött, a tesztgombok akkor is a CDN/MP3 fájlt játsszák.");
      return [];
    }
  }

  const api = {
    BASE: OGG_CDN,
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
