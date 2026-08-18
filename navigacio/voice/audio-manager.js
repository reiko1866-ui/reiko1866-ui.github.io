/**
 * Hangnavigáció — a feltöltött csomag vegyes poénok, a fájlnév NEM az irány.
 * catalog.json a Whisper-átirat alapján sorolja: left/right/straight/uturn/...
 */
(function (global) {
  "use strict";

  const BRANCH = "cursor/terkep-navigacio-925b";
  const REPO = "reiko1866-ui/reiko1866-ui.github.io";
  const ENC = encodeURIComponent(BRANCH);
  const OGG_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/hungary_jf/";
  const APP_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/navigacio/";

  const PHRASES = {
    start: { cat: "", tts: "Hang kész." },
    finish: { cat: "arrive", tts: "Megérkeztél." },
    recomputing: { cat: "recompute", tts: "Újratervezés." },
    "left-100": { cat: "left", tts: "Fordulj balra." },
    "right-500": { cat: "right", tts: "Fordulj jobbra." },
    "right-100": { cat: "right", tts: "Fordulj jobbra." },
    "left-500": { cat: "left", tts: "Fordulj balra." },
    "exit-left-100": { cat: "left", tts: "Hajts le balra." },
    "exit-right-100": { cat: "right", tts: "Hajts le jobbra." },
    straight: { cat: "straight", tts: "Haladj tovább." },
    uTurn: { cat: "uturn", tts: "Fordulj vissza." }
  };

  const MANEUVER_CAT = {
    "Fordulj jobbra": "right",
    "Fordulj balra": "left",
    "Tarts jobbra": "right",
    "Tarts balra": "left",
    "Élesen jobbra": "right",
    "Élesen balra": "left",
    "Fordulj vissza": "uturn",
    "Hajts ki": "right",
    "Hajts fel": "motorway",
    "Hajts le": "motorway",
    Csatlakozz: "motorway",
    "Jobb elágazás": "right",
    "Bal elágazás": "left",
    "Haladj tovább": "straight",
    Körforgalom: "roundabout",
    "Megérkeztél": "arrive"
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
      return unique([
        rel("./voice/clips/" + mp3Name),
        APP_CDN + "voice/clips/" + mp3Name
      ]);
    }

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
      if (!cat) {
        this.fallback(tts || "");
        return false;
      }
      const name = this.pickName(cat);
      if (!name) {
        this.fallback(tts || "");
        return false;
      }
      return this.playNow(this.hrefsForName(name), tts);
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
      this.playCat(phrase.cat, phrase.tts);
    }

    announceTurn(copy, until) {
      const text = String(copy && copy.text ? copy.text : "");
      if (/Megérkezt/i.test(text)) return this.playPhrase("finish");
      const cat = MANEUVER_CAT[text] || "";
      const distText =
        (until >= 1000
          ? Math.round(until / 100) / 10 + " kilométer, "
          : Math.max(20, Math.round(until / 10) * 10) + " méter, ") +
        text.toLowerCase() +
        ".";
      if (!cat || !this.filesFor(cat).length) {
        this.fallback(distText);
        return;
      }
      this.playCat(cat, distText);
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
      this.log("Hangok rendezése tartalom szerint…");
      const urls = unique([rel("./voice/catalog.json"), APP_CDN + "voice/catalog.json"]);
      for (let i = 0; i < urls.length; i++) {
        try {
          const res = await fetch(urls[i], { cache: "no-store" });
          if (!res.ok) continue;
          const data = await res.json();
          const files = data && data.files ? data.files : data;
          if (!files || !files.left) continue;
          this.catalog = files;
          const n = (files.left || []).length;
          const r = (files.right || []).length;
          this.log(
            "Kész: " +
              n +
              " balra, " +
              r +
              " jobbra, " +
              (files.straight || []).length +
              " egyenes, " +
              (files.roundabout || []).length +
              " körforgalom, " +
              (files.recompute || []).length +
              " újratervezés. A többi poén nem megy kanyarra."
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
    }
  };

  global.NavVoice = api;
})(window);
