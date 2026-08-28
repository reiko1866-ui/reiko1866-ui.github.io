/**
 * Hangnavigáció — a feltöltött csomag. Kanyar, aztán poén. Soha nem két hang egyszerre.
 */
(function (global) {
  "use strict";

  const BRANCH = "cursor/terkep-navigacio-925b";
  const REPO = "reiko1866-ui/reiko1866-ui.github.io";
  const ENC = encodeURIComponent(BRANCH);
  const OGG_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/hungary_jf/";
  const APP_CDN = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + ENC + "/navigacio/";

  const PHRASES = {
    start: { cat: "start" },
    finish: { cat: "arrive" },
    recomputing: { cat: "recompute" },
    "left-100": { cat: "left" },
    "right-500": { cat: "right" },
    "now-left": { cat: "left" },
    "now-right": { cat: "right" },
    "right-100": { cat: "right" },
    "left-500": { cat: "left" },
    "exit-left-100": { cat: "motorwayOff" },
    "exit-right-100": { cat: "motorwayOff" },
    straight: { cat: "straight" },
    uTurn: { cat: "uturn" },
    "keep-left": { cat: "leftKeep" },
    "keep-right": { cat: "rightKeep" },
    "sharp-left": { cat: "leftSharp" },
    "sharp-right": { cat: "rightSharp" },
    roundabout: { cat: "roundabout" },
    "motorway-on": { cat: "motorwayOn" },
    "motorway-off": { cat: "motorwayOff" },
    ferry: { cat: "ferryOn" },
    gps: { cat: "gps" },
    speed: { cat: "speed" }
  };

  const FALLBACK = {
    leftSharp: ["left"],
    leftKeep: ["left"],
    rightSharp: ["right"],
    rightKeep: ["right"],
    motorwayOff: ["right"],
    motorwayOn: ["straight"],
    ferryOn: ["motorwayOn", "straight"],
    ferryOff: ["motorwayOff", "right"],
    roundabout: ["straight"],
    uturn: ["left"],
    start: [],
    speed: []
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

  function hushSpeech() {
    try {
      if (global.speechSynthesis) global.speechSynthesis.cancel();
    } catch (_e) {}
  }

  function isAbort(err) {
    const name = err && err.name;
    return name === "AbortError" || name === "NotAllowedError";
  }

  class AudioManager {
    /**
     * @param {{ onLog?: (msg: string, err?: boolean) => void }} [opts]
     */
    constructor(opts) {
      this.onLog = (opts && opts.onLog) || function () {};
      this.started = false;
      /** @type {Record<string, string[]>} */
      this.catalog = {};
      this.lastName = "";
      this.playId = 0;
      /** @type {Record<string, { name: string, href: string }>} */
      this.warm = {};
      this.player = document.getElementById("navVoiceEl") || new Audio();
      this.player.setAttribute("playsinline", "true");
      this.player.setAttribute("webkit-playsinline", "true");
      this.player.preload = "auto";
      this.player.muted = false;
      this.player.volume = 1;
      this.player.addEventListener("playing", () => {
        this.player.muted = false;
        this.player.volume = 1;
        this.log("Szól: " + (this.player.src || "").split("/").pop());
      });
      this.player.addEventListener("ended", () => this.log("Kész."));
    }

    log(msg, err) {
      this.onLog(msg, !!err);
      if (err) console.warn("[NavVoice]", msg);
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
      if (name === this.lastName && matches.length > 1) {
        name = matches[(matches.indexOf(name) + 1) % matches.length];
      }
      this.lastName = name;
      return name;
    }

    hrefsForName(oggName) {
      if (!oggName) return [];
      const mp3Name = oggName.replace(/\.ogg$/i, ".mp3");
      return unique([
        rel("./voice/clips/" + mp3Name),
        "/navigacio/voice/clips/" + mp3Name,
        APP_CDN + "voice/clips/" + mp3Name,
        OGG_CDN + oggName,
        rel("../hungary_jf/" + oggName),
        "/hungary_jf/" + oggName
      ]);
    }

    playNow(hrefs) {
      hushSpeech();
      const urls = (hrefs || []).filter(Boolean);
      if (!urls.length) {
        this.log("Nincs fájl ehhez a hanghoz.", true);
        return false;
      }
      const id = ++this.playId;
      const tryAt = (i) => {
        if (id !== this.playId) return;
        if (i >= urls.length) {
          this.log("A feltöltött hang nem játszható.", true);
          return;
        }
        const href = urls[i];
        const onErr = (ev) => {
          this.player.removeEventListener("error", onErr);
          if (id !== this.playId) return;
          const aborted = ev && ev.type === "abort";
          if (aborted) return;
          this.log("Próbálom a következő fájlt…");
          tryAt(i + 1);
        };
        try {
          this.player.muted = false;
          this.player.volume = 1;
          this.player.pause();
          this.player.removeEventListener("error", onErr);
          this.player.addEventListener("error", onErr, { once: true });
          this.player.src = href;
          const p = this.player.play();
          this.log("Lejátszás: " + decodeURIComponent(href.split("/").pop() || href));
          if (p && p.catch) {
            p.catch((err) => {
              if (id !== this.playId || isAbort(err)) return;
              onErr();
            });
          }
        } catch (_e) {
          tryAt(i + 1);
        }
      };
      tryAt(0);
      return true;
    }

    warmCat(cat) {
      if (!cat || this.warm[cat]) return;
      const name = this.pickName(cat);
      if (!name) return;
      const href = this.hrefsForName(name)[0];
      if (!href) return;
      try {
        const pre = new Audio();
        pre.preload = "auto";
        pre.src = href;
      } catch (_e) {}
      this.warm[cat] = { name, href };
    }

    playCat(cat) {
      hushSpeech();
      if (!cat) return false;
      const order = [cat].concat(FALLBACK[cat] || []);
      for (let i = 0; i < order.length; i++) {
        const key = order[i];
        const held = this.warm[key];
        const name = held && held.name ? held.name : this.pickName(key);
        if (held) delete this.warm[key];
        if (!name) continue;
        return this.playNow(this.hrefsForName(name));
      }
      this.log("Nincs feltöltött hang: " + cat, true);
      return false;
    }

    announce(cat) {
      return this.playCat(cat);
    }

    unlock() {
      hushSpeech();
      const href = rel("./voice/clips/left.mp3");
      const id = this.playId;
      this.player.muted = true;
      this.player.volume = 0;
      try {
        this.player.src = href;
        const p = this.player.play();
        const done = () => {
          if (this.playId !== id) return;
          try {
            this.player.pause();
            this.player.currentTime = 0;
          } catch (_e) {}
          this.player.muted = false;
          this.player.volume = 1;
        };
        if (p && p.then) p.then(done).catch(done);
        else done();
      } catch (_e) {
        this.player.muted = false;
        this.player.volume = 1;
      }
    }

    start() {
      hushSpeech();
      if (this.started) return true;
      this.started = true;
      this.unlock();
      this.findSounds().then(() => {
        this.log("Hang kész. Kanyarnál a csomag szól.");
      });
      return true;
    }

    playPhrase(key) {
      const phrase = PHRASES[key];
      if (!phrase) {
        this.log("Nincs ilyen utasítás: " + key, true);
        return;
      }
      if (!phrase.cat) {
        this.start();
        return;
      }
      this.started = true;
      this.playCat(phrase.cat);
    }

    announceTurn(copy) {
      return this.playCat(copy && copy.cat);
    }

    stop() {
      this.playId += 1;
      hushSpeech();
      try {
        this.player.pause();
      } catch (_e) {}
    }

    hasPack() {
      return this.filesFor("left").length > 0 || this.filesFor("right").length > 0;
    }

    isBusy() {
      try {
        if (this.player && !this.player.paused && !this.player.ended) return true;
      } catch (_e) {}
      try {
        if (global.speechSynthesis && global.speechSynthesis.speaking) return true;
      } catch (_e2) {}
      return false;
    }

    async findSounds() {
      this.log("Hangok betöltése…");
      const urls = unique([rel("./voice/catalog.json"), APP_CDN + "voice/catalog.json"]);
      for (let i = 0; i < urls.length; i++) {
        try {
          const res = await fetch(urls[i], { cache: "no-store" });
          if (!res.ok) continue;
          const data = await res.json();
          const files = data && data.files ? data.files : data;
          if (!files || !files.left) continue;
          this.catalog = files;
          const n =
            (files.left || []).length +
            (files.right || []).length +
            (files.roundabout || []).length +
            (files.straight || []).length +
            (files.start || []).length;
          this.log(
            "Kész, " +
              n +
              "+ klip. Kanyarnál a csomag, utána a poén. Egyszerre egy hang."
          );
          return files;
        } catch (_e) {}
      }
      this.log("A hanglista nem töltődött.", true);
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
      hushSpeech();
      return api.instance.findSounds().then(() => api.instance);
    },
    playCat(cat) {
      return api.instance ? api.instance.playCat(cat) : false;
    }
  };

  global.NavVoice = api;
})(window);
