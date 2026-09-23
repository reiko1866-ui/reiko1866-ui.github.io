(function (global) {
  "use strict";

  var GARAGE_KEY = "nav2_car_model";
  var LAYER_ID = "ego-car-3d";
  var TARGET_METERS = 7.2;
  var CHIBI_SCALE = 1;
  var CAM_FAR = 340;
  var BUILD_RANGE = 300;
  var ENV_RANGE = 300;
  var ENV_KEEP = 360;
  var ENV_STEP = 42;
  var BUILD_ZOOM_MIN = 15;
  var FOG_COLOR = 0xf3c4b0;
  var FOG_DENSITY = 0.0026;
  var CLAY_GROUND = 0x7ecf7a;
  var CANOPY_COLORS = [0xff8fb3, 0xa8e86a, 0xd8e85a, 0xff6eb4, 0xf7b3d0, 0x9be37a];
  var CAM_FOV_CHASE = 78;
  var CAM_FOV_DASH = 70;
  var CLAY_ROAD = 0x5c616a;
  var CLAY_ROUTE = 0xf2b84b;
  var DEADBAND_KMH = 3;
  var SMOOTH_LERP = 0.1;
  var TURN_TAU = 0.22;
  var CAM_TAU = 0.14;
  var CAM_BACK = 13.5;
  var CAM_HEIGHT = 5.2;
  var CAM_LOOK = 18;
  var CAM_BLEND_TAU = 0.28;
  var CAM_DASH_FWD = 0.78;
  var CAM_DASH_HEIGHT = 1.18;
  var CAM_DASH_LOOK = 28;
  var ROAD_Y = 0.05;
  var PAINT_Y = 0.1;
  var ROAD_TEX_GAIN = 0.1;
  var THREE_LOCAL = "./vendor/three.min.js";
  var GLTF_LOCAL = "./vendor/GLTFLoader.js";
  var THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
  var GLTF_CDN = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js";

  function on(el, type, fn, opts) {
    try {
      if (!el || typeof el.addEventListener !== "function") return false;
      el.addEventListener(type, fn, opts);
      return true;
    } catch (_e) {
      return false;
    }
  }

  var carModels = {
    verso: {
      url: "./models/verso.glb",
      brand: "Toyota",
      type: "Mini Verso",
      name: "Mini Verso",
      hint: "Rövid orr, magas kabin",
      color: "#d4d7de",
      lamp: "#e11d48"
    },
    scross: {
      url: "./models/scross.glb",
      brand: "Suzuki",
      type: "Mini SX4 S-Cross",
      name: "Mini SX4 S-Cross",
      hint: "Crossover, króm rács",
      color: "#f3efe6",
      lamp: "#fb7185"
    },
    bmw3: {
      url: "./models/bmw3.glb",
      brand: "BMW",
      type: "Mini 3er / M3",
      name: "Mini 3er / M3",
      hint: "Dupla vese, hosszú orr",
      color: "#b7c0cb",
      lamp: "#ef4444"
    },
    merc_e: {
      url: "./models/merc_e.glb",
      brand: "Mercedes-Benz",
      type: "Mini E-Class",
      name: "Mini E-Class",
      hint: "Csillag, LED-sáv",
      color: "#1c1f26",
      lamp: "#f87171"
    },
    korando: {
      url: "./models/korando.glb",
      brand: "SsangYong",
      type: "Mini Korando",
      name: "Mini Korando",
      hint: "Magas SUV, tetősín",
      color: "#6a7180",
      lamp: "#dc2626"
    },
    golf: {
      url: "./models/golf.glb",
      brand: "Volkswagen",
      type: "Mini Golf",
      name: "Mini Golf",
      hint: "Ferdehátú, VW rács",
      color: "#b91c1c",
      lamp: "#fecaca"
    }
  };

  var api = {
    carModels: carModels,
    ready: false,
    currentId: "",
    THREE: null,
    GLTFLoader: null
  };

  var pose = { lng: 19.0402, lat: 47.4979, heading: 0, lean: 0, alt: 0, speed: 0, headingSeeded: false };
  var shown = { lng: 19.0402, lat: 47.4979, heading: 0, lean: 0, seeded: false };
  var lastPoseT = 0;

  function angDeltaDeg(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  function lerpNum(a, b, t) {
    if (!Number.isFinite(a)) return b;
    if (!Number.isFinite(b)) return a;
    if (api.THREE && api.THREE.MathUtils && typeof api.THREE.MathUtils.lerp === "function") {
      return api.THREE.MathUtils.lerp(a, b, t);
    }
    return a + (b - a) * t;
  }

  function expK(dt, tau) {
    return 1 - Math.exp(-Math.max(0.001, dt) / Math.max(0.04, tau || 0.14));
  }

  function lerpRad(from, to, t) {
    var two = Math.PI * 2;
    var d = ((to - from + Math.PI) % two + two) % two - Math.PI;
    return lerpNum(from, from + d, t);
  }

  function movingEnough() {
    return (Number(pose.speed) || 0) * 3.6 >= DEADBAND_KMH;
  }

  function lerpPose(now) {
    if (!shown.seeded) {
      shown.lng = pose.lng;
      shown.lat = pose.lat;
      shown.heading = pose.heading;
      shown.lean = pose.lean;
      shown.seeded = true;
      lastPoseT = now;
      return shown;
    }
    lastPoseT = now;
    shown.lng = lerpNum(shown.lng, pose.lng, SMOOTH_LERP);
    shown.lat = lerpNum(shown.lat, pose.lat, SMOOTH_LERP);
    shown.heading = (shown.heading + angDeltaDeg(shown.heading, pose.heading) * SMOOTH_LERP + 360) % 360;
    shown.lean = lerpNum(shown.lean, pose.lean, SMOOTH_LERP);
    shown.headingLocked = true;
    return shown;
  }
  var cache = {};
  var loadingId = "";
  var layer = null;
  var mapRef = null;
  var loadP = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error(src));
      };
      document.head.appendChild(s);
    });
  }

  function loadThree() {
    if (api.THREE && api.GLTFLoader) return Promise.resolve();
    if (global.THREE && global.THREE.GLTFLoader) {
      api.THREE = global.THREE;
      api.GLTFLoader = global.THREE.GLTFLoader;
      return Promise.resolve();
    }
    if (loadP) return loadP;
    function adopt() {
      api.THREE = global.THREE;
      api.GLTFLoader = global.THREE && global.THREE.GLTFLoader;
      if (!api.THREE || !api.GLTFLoader) throw new Error("Three.js nem töltődött be");
    }
    loadP = loadScript(THREE_LOCAL)
      .then(function () {
        return loadScript(GLTF_LOCAL);
      })
      .then(adopt)
      .catch(function () {
        return loadScript(THREE_CDN).then(function () {
          return loadScript(GLTF_CDN);
        }).then(adopt);
      })
      .catch(function (err) {
        loadP = null;
        throw err;
      });
    return loadP;
  }

  function savedId() {
    try {
      var id = String(localStorage.getItem("selectedCar") || localStorage.getItem(GARAGE_KEY) || "");
      if (carModels[id]) return id;
    } catch (_e) {}
    return "verso";
  }

  function persist(id) {
    try {
      localStorage.setItem(GARAGE_KEY, id);
      localStorage.setItem("selectedCar", id);
    } catch (_e) {}
  }

  function showFallback() {
    api.ready = false;
    document.documentElement.classList.remove("has-car3d");
    var app = document.getElementById("app");
    if (app) app.classList.remove("is-car3d");
  }

  function hideFallback() {
    api.ready = true;
    document.documentElement.classList.add("has-car3d");
    var app = document.getElementById("app");
    if (app) app.classList.add("is-car3d");
  }

  function iconSvg(id, suffix) {
    var spec = carModels[id] || carModels.verso;
    var uid = (id || "verso") + "-" + (suffix || "m");
    var paint = spec.color || "#c8ccd1";
    var lamp = spec.lamp || "#e11d48";
    var bodies = {
      verso:
        "M42 78c4-18 18-32 42-30 22 2 40 16 46 38l10 62c2 16-8 28-48 32-38 4-56-10-58-28z",
      scross:
        "M40 84c6-20 20-34 44-32 24 2 42 18 48 40l8 56c2 16-8 30-50 34-40 4-56-12-58-28z",
      bmw3:
        "M48 102c10-22 26-34 46-30 18 4 32 18 36 40l6 40c2 14-10 24-44 28-32 4-50-8-52-22z",
      merc_e:
        "M50 104c12-20 26-32 44-28 18 4 32 16 36 36l6 40c2 14-8 24-42 28-32 4-50-8-52-22z",
      korando:
        "M38 72c6-18 20-30 46-28 24 2 44 16 50 40l10 66c2 16-10 30-52 34-42 4-60-12-62-30z",
      golf:
        "M50 108c8-22 24-34 42-30 16 4 28 16 32 36l6 36c2 12-8 22-40 26-30 4-46-8-48-20z"
    };
    var roof = {
      verso: "M56 62c10-14 28-20 46-16 14 4 24 16 28 30l4 18H52z",
      scross: "M54 68c10-14 28-20 48-14 14 4 24 16 28 30l3 16H50z",
      bmw3: "M62 78c8-14 24-20 40-16 12 3 20 14 24 26l3 14H58z",
      merc_e: "M64 80c8-12 22-18 38-14 12 3 20 12 24 24l3 14H60z",
      korando: "M52 56c12-14 30-18 50-12 14 4 24 16 28 32l4 18H48z",
      golf: "M64 86c8-14 22-18 36-14 12 3 20 12 24 24l2 12H60z"
    };
    var lamps = {
      verso:
        '<rect x="48" y="108" width="16" height="42" rx="3" fill="' + lamp + '"/>' +
        '<rect x="116" y="104" width="16" height="42" rx="3" fill="' + lamp + '"/>' +
        '<rect x="50" y="110" width="4" height="38" fill="#fecaca"/>',
      scross:
        '<rect x="50" y="126" width="80" height="10" rx="4" fill="' + lamp + '"/>' +
        '<rect x="50" y="114" width="18" height="28" rx="3" fill="' + lamp + '"/>' +
        '<rect x="112" y="112" width="18" height="28" rx="3" fill="' + lamp + '"/>' +
        '<rect x="58" y="154" width="64" height="6" rx="2" fill="#e2e8f0"/>',
      bmw3:
        '<path d="M54 120h30l6 22H52z" fill="' + lamp + '"/>' +
        '<path d="M96 118h30l-8 24H90z" fill="' + lamp + '"/>' +
        '<path d="M78 86c6-8 16-8 24 0" fill="none" stroke="#94a3b8" stroke-width="2"/>',
      merc_e:
        '<rect x="52" y="124" width="76" height="9" rx="4" fill="' + lamp + '"/>' +
        '<rect x="52" y="118" width="18" height="20" rx="4" fill="' + lamp + '"/>' +
        '<rect x="110" y="116" width="18" height="20" rx="4" fill="' + lamp + '"/>' +
        '<circle cx="80" cy="156" r="5" fill="#dbe4ee" stroke="#94a3b8"/>',
      korando:
        '<rect x="46" y="104" width="18" height="46" rx="3" fill="' + lamp + '"/>' +
        '<rect x="116" y="100" width="18" height="46" rx="3" fill="' + lamp + '"/>' +
        '<rect x="70" y="150" width="40" height="10" rx="2" fill="#111"/>',
      golf:
        '<rect x="54" y="128" width="30" height="14" rx="3" fill="' + lamp + '"/>' +
        '<rect x="96" y="126" width="30" height="14" rx="3" fill="' + lamp + '"/>' +
        '<rect x="62" y="132" width="56" height="5" rx="2" fill="#fecaca"/>'
    };
    var extras = {
      verso: '<rect x="70" y="154" width="40" height="8" rx="1" fill="#334155"/>',
      scross: '<rect x="72" y="88" width="36" height="6" rx="1" fill="#cbd5e1"/>',
      bmw3: '<rect x="74" y="150" width="28" height="8" rx="1" fill="#111"/>',
      merc_e: '<rect x="58" y="148" width="64" height="4" rx="2" fill="#cbd5e1"/>',
      korando: '<rect x="44" y="92" width="92" height="6" fill="#1e293b" opacity=".5"/>',
      golf: '<rect x="76" y="150" width="28" height="8" rx="1" fill="#111"/>'
    };
    var key = bodies[id] ? id : "verso";
    var hi = id === "merc_e" || id === "golf" ? "#94a3b8" : "#0f172a";
    return (
      '<svg viewBox="0 0 160 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      "<defs>" +
      '<linearGradient id="p-' + uid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fff"/><stop offset=".38" stop-color="' + paint + '"/>' +
      '<stop offset="1" stop-color="#334155"/></linearGradient>' +
      '<linearGradient id="w-' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#93c5fd"/><stop offset="1" stop-color="#0f172a"/></linearGradient>' +
      "</defs>" +
      '<ellipse cx="84" cy="188" rx="48" ry="8" fill="rgba(0,0,0,.5)"/>' +
      '<path d="' + bodies[key] + '" fill="url(#p-' + uid + ')" stroke="' + hi + '" stroke-width="1.6"/>' +
      '<path d="' + roof[key] + '" fill="url(#w-' + uid + ')" opacity=".95"/>' +
      '<path d="M50 118h80l-4 14H54z" fill="#e2e8f0" opacity=".88"/>' +
      lamps[key] +
      extras[key] +
      '<ellipse cx="42" cy="116" rx="10" ry="5.5" fill="#f8fafc" stroke="#0f172a" stroke-width="1.2"/>' +
      '<ellipse cx="128" cy="108" rx="9" ry="5" fill="#f8fafc" stroke="#0f172a" stroke-width="1.2"/>' +
      '<ellipse cx="56" cy="168" rx="12" ry="7" fill="#111"/><ellipse cx="120" cy="160" rx="12" ry="7" fill="#111"/>' +
      "</svg>"
    );
  }

  function cloneGltf(root) {
    var copy = root.clone(true);
    var drop = [];
    copy.traverse(function (node) {
      if (node.isLight) drop.push(node);
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
        if (node.material) {
          if (Array.isArray(node.material)) {
            node.material = node.material.map(function (m) {
              return m.clone();
            });
          } else node.material = node.material.clone();
        }
      }
    });
    drop.forEach(function (light) {
      if (light.parent) light.parent.remove(light);
    });
    copy.rotation.set(0, 0, 0);
    copy.position.set(0, 0, 0);
    copy.scale.set(1, 1, 1);
    return copy;
  }

  function alignAndFit(model) {
    var THREE = api.THREE;
    /* Pivot = bounding-box alja + XZ közepe, hogy kanyarban ne a far körül forogjon. */
    model.rotation.set(0, 0, 0);
    model.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    var longest = Math.max(size.x, size.z, 0.001);
    var s = (TARGET_METERS / longest) * CHIBI_SCALE;
    model.scale.setScalar(s);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    var center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
  }

  function recenterOnFloor(model) {
    var THREE = api.THREE;
    if (!model || !THREE) return;
    model.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(model);
    var center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
  }

  function boxInLocal(THREE, obj) {
    obj.updateMatrixWorld(true);
    var world = new THREE.Box3().setFromObject(obj);
    var inv = obj.matrixWorld.clone().invert();
    var pts = [
      new THREE.Vector3(world.min.x, world.min.y, world.min.z),
      new THREE.Vector3(world.min.x, world.min.y, world.max.z),
      new THREE.Vector3(world.min.x, world.max.y, world.min.z),
      new THREE.Vector3(world.min.x, world.max.y, world.max.z),
      new THREE.Vector3(world.max.x, world.min.y, world.min.z),
      new THREE.Vector3(world.max.x, world.min.y, world.max.z),
      new THREE.Vector3(world.max.x, world.max.y, world.min.z),
      new THREE.Vector3(world.max.x, world.max.y, world.max.z)
    ];
    var local = new THREE.Box3();
    var i;
    for (i = 0; i < pts.length; i++) local.expandByPoint(pts[i].applyMatrix4(inv));
    return local;
  }

  function boxInParent(THREE, obj, parent) {
    obj.updateMatrixWorld(true);
    parent.updateMatrixWorld(true);
    var world = new THREE.Box3().setFromObject(obj);
    var inv = parent.matrixWorld.clone().invert();
    var pts = [
      new THREE.Vector3(world.min.x, world.min.y, world.min.z),
      new THREE.Vector3(world.min.x, world.min.y, world.max.z),
      new THREE.Vector3(world.min.x, world.max.y, world.min.z),
      new THREE.Vector3(world.min.x, world.max.y, world.max.z),
      new THREE.Vector3(world.max.x, world.min.y, world.min.z),
      new THREE.Vector3(world.max.x, world.min.y, world.max.z),
      new THREE.Vector3(world.max.x, world.max.y, world.min.z),
      new THREE.Vector3(world.max.x, world.max.y, world.max.z)
    ];
    var local = new THREE.Box3();
    var i;
    for (i = 0; i < pts.length; i++) local.expandByPoint(pts[i].applyMatrix4(inv));
    return local;
  }

  function partKind(node) {
    var n = String(node.name || "").toLowerCase();
    var p = node.parent ? String(node.parent.name || "").toLowerCase() : "";
    var s = n + " " + p;
    if (/wheel|tyre|tire|rim/.test(s)) return "wheel";
    if (/glass|window|windshield|windscreen/.test(s)) return "glass";
    if (/light|lamp|headlamp|tail/.test(s)) return "lamp";
    return "body";
  }

  function makeStudioEnv(THREE, renderer) {
    if (!renderer || !THREE.PMREMGenerator) return null;
    try {
      var c = document.createElement("canvas");
      c.width = 512;
      c.height = 256;
      var g = c.getContext("2d");
      var grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, "#dbe6f5");
      grd.addColorStop(0.42, "#4a5c78");
      grd.addColorStop(0.5, "#151820");
      grd.addColorStop(1, "#2c3340");
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = "#fff4dc";
      g.fillRect(168, 18, 176, 78);
      g.fillStyle = "#ffe9b0";
      g.fillRect(200, 28, 110, 48);
      g.fillStyle = "#ff7a38";
      g.fillRect(8, 70, 64, 100);
      g.fillStyle = "#6ea8ff";
      g.fillRect(440, 70, 64, 100);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillRect(240, 200, 90, 18);
      var tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
      tex.needsUpdate = true;
      var pmrem = new THREE.PMREMGenerator(renderer);
      if (pmrem.compileEquirectangularShader) pmrem.compileEquirectangularShader();
      var rt = pmrem.fromEquirectangular(tex);
      pmrem.dispose();
      if (rt && rt.texture) {
        tex.dispose();
        return rt.texture;
      }
      return tex;
    } catch (_e) {
      return null;
    }
  }

  function toonRamp(THREE) {
    if (toonRamp.tex && toonRamp.THREE === THREE) return toonRamp.tex;
    var c = document.createElement("canvas");
    c.width = 4;
    c.height = 1;
    var g = c.getContext("2d");
    var stops = ["#2c2c2c", "#6a6a6a", "#b0b0b0", "#ffffff"];
    var i;
    for (i = 0; i < 4; i++) {
      g.fillStyle = stops[i];
      g.fillRect(i, 0, 1, 1);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    toonRamp.tex = tex;
    toonRamp.THREE = THREE;
    return tex;
  }

  function toonMaterial(THREE, opts) {
    if (THREE.MeshStandardMaterial) {
      var std = new THREE.MeshStandardMaterial({
        color: opts.color,
        map: opts.map || null,
        transparent: !!opts.transparent,
        opacity: opts.opacity != null ? opts.opacity : 1,
        side: opts.side || THREE.FrontSide,
        depthWrite: opts.depthWrite !== false,
        fog: opts.fog !== false,
        roughness: opts.roughness != null ? opts.roughness : 0.8,
        metalness: opts.metalness != null ? opts.metalness : 0.02,
        flatShading: true
      });
      if (opts.emissive && std.emissive) {
        std.emissive = opts.emissive.clone ? opts.emissive.clone() : new THREE.Color(opts.emissive);
        if (std.emissiveIntensity !== undefined) std.emissiveIntensity = opts.emissiveIntensity || 0.45;
      }
      return std;
    }
    var Ctor = THREE.MeshToonMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
    var mat = new Ctor({
      color: opts.color,
      map: opts.map || null,
      transparent: !!opts.transparent,
      opacity: opts.opacity != null ? opts.opacity : 1,
      side: opts.side || THREE.FrontSide,
      depthWrite: opts.depthWrite !== false,
      fog: opts.fog !== false
    });
    if (mat.flatShading !== undefined) mat.flatShading = true;
    if (mat.gradientMap !== undefined) mat.gradientMap = toonRamp(THREE);
    if (opts.emissive && mat.emissive) {
      mat.emissive = opts.emissive.clone ? opts.emissive.clone() : new THREE.Color(opts.emissive);
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = opts.emissiveIntensity || 1;
    }
    return mat;
  }

  function addBlackOutline(THREE, node) {
    if (!node || !node.isMesh || !node.geometry || node.userData.toonOutline) return;
    try {
      var edges = new THREE.EdgesGeometry(node.geometry, 28);
      var line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x000000, fog: true })
      );
      line.userData.toonOutline = true;
      line.raycast = function () {};
      node.add(line);
      node.userData.toonOutline = true;
    } catch (_e) {}
  }

  function applyCarMaterials(mesh) {
    var THREE = api.THREE;
    if (!mesh || !THREE) return;
    mesh.traverse(function (node) {
      if (!node.isMesh || !node.material) return;
      node.frustumCulled = false;
      node.castShadow = false;
      node.receiveShadow = false;
      var src = Array.isArray(node.material) ? node.material[0] : node.material;
      if (!src) return;
      var kind = partKind(node);
      var map = src.map || null;
      var color = src.color ? src.color.clone() : new THREE.Color(0xc8ccd1);
      var next;
      if (kind === "wheel") {
        next = toonMaterial(THREE, { color: map ? 0xffffff : color, map: map });
      } else if (kind === "glass") {
        next = toonMaterial(THREE, {
          color: 0x1a2740,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false
        });
      } else if (kind === "lamp") {
        next = toonMaterial(THREE, {
          color: color,
          map: map,
          emissive: color.clone().multiplyScalar(0.85),
          emissiveIntensity: 1.35
        });
      } else {
        next = toonMaterial(THREE, { color: map ? 0xffffff : color, map: map });
      }
      node.material = next;
      if (kind !== "glass") addBlackOutline(THREE, node);
    });
  }

  function contactShadowTexture(THREE) {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    var g = c.getContext("2d");
    var grd = g.createRadialGradient(128, 148, 8, 128, 128, 124);
    grd.addColorStop(0, "rgba(0,0,0,0.62)");
    grd.addColorStop(0.38, "rgba(0,0,0,0.28)");
    grd.addColorStop(0.72, "rgba(0,0,0,0.08)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function clearTagged(root, tag) {
    if (!root) return;
    var i;
    for (i = root.children.length - 1; i >= 0; i--) {
      if (root.children[i].userData && root.children[i].userData[tag]) {
        root.remove(root.children[i]);
      }
    }
  }

  function decorateCar(THREE, mesh) {
    if (!mesh) return;
    var box = boxInLocal(THREE, mesh);
    var size = box.getSize(new THREE.Vector3());
    var c = box.getCenter(new THREE.Vector3());
    var glassMat = toonMaterial(THREE, {
      color: 0x121c28,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var cabin = new THREE.Group();
    cabin.userData.carGlass = true;
    var windW = size.x * 0.7;
    var windH = Math.max(0.32, size.y * 0.2);
    var wind = new THREE.Mesh(new THREE.PlaneGeometry(windW, windH), glassMat);
    wind.position.set(c.x, box.min.y + size.y * 0.74, box.max.z - size.z * 0.2);
    wind.rotation.x = -0.52;
    cabin.add(wind);
    var rear = new THREE.Mesh(new THREE.PlaneGeometry(windW * 0.88, windH * 0.82), glassMat);
    rear.position.set(c.x, box.min.y + size.y * 0.78, box.min.z - 0.06);
    rear.rotation.x = 0.22;
    rear.rotation.y = Math.PI;
    cabin.add(rear);
    var sideH = Math.max(0.22, size.y * 0.16);
    var sideL = size.z * 0.36;
    var left = new THREE.Mesh(new THREE.PlaneGeometry(sideL, sideH), glassMat);
    left.position.set(box.min.x + 0.04, box.min.y + size.y * 0.7, c.z + size.z * 0.02);
    left.rotation.y = Math.PI / 2;
    cabin.add(left);
    var right = left.clone();
    right.position.x = box.max.x - 0.04;
    right.rotation.y = -Math.PI / 2;
    cabin.add(right);
    mesh.add(cabin);
    var headMat = toonMaterial(THREE, {
      color: 0xfff3d0,
      emissive: new THREE.Color(0xffe7a8),
      emissiveIntensity: 1.6
    });
    var tailMat = new THREE.MeshBasicMaterial({
      color: 0xff0000
    });
    if (tailMat.emissive) tailMat.emissive.setHex(0xff0000);
    var yLamp = box.min.y + size.y * 0.54;
    var xLamp = size.x * 0.33;
    var headGeo = new THREE.BoxGeometry(size.x * 0.15, size.y * 0.08, 0.1);
    var headL = new THREE.Mesh(headGeo, headMat);
    headL.position.set(-xLamp, box.min.y + size.y * 0.4, box.max.z + 0.02);
    var headR = new THREE.Mesh(headGeo, headMat);
    headR.position.set(xLamp, box.min.y + size.y * 0.4, box.max.z + 0.02);
    var tailGeo = new THREE.BoxGeometry(size.x * 0.13, size.y * 0.065, 0.05);
    var tailL = new THREE.Mesh(tailGeo, tailMat);
    tailL.position.set(-xLamp * 0.92, yLamp, box.min.z - 0.04);
    var tailR = new THREE.Mesh(tailGeo, tailMat);
    tailR.position.set(xLamp * 0.92, yLamp, box.min.z - 0.04);
    mesh.add(headL);
    mesh.add(headR);
    mesh.add(tailL);
    mesh.add(tailR);
  }

  function attachHeadlights(THREE, host, mesh) {
    if (!host || !mesh) return;
    clearTagged(host, "carLights");
    var box = boxInParent(THREE, mesh, host);
    var size = box.getSize(new THREE.Vector3());
    var yLamp = box.min.y + size.y * 0.38;
    var xLamp = size.x * 0.3;
    var zf = box.max.z - 0.02;
    var fx = new THREE.Group();
    fx.userData.carLights = true;
    var beamL = lightCone(THREE, 0xffffff, 15, 0.95, 0.3);
    beamL.position.set(-xLamp, yLamp, zf);
    var beamR = lightCone(THREE, 0xffffff, 15, 0.95, 0.3);
    beamR.position.set(xLamp, yLamp, zf);
    fx.add(beamL);
    fx.add(beamR);
    host.add(fx);
  }

  function installContactShadow(THREE, carRoot, mesh) {
    clearTagged(carRoot, "contactShadow");
    if (!carRoot || !mesh) return;
    mesh.updateMatrixWorld(true);
    var box = boxInParent(THREE, mesh, carRoot);
    var size = box.getSize(new THREE.Vector3());
    var shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(2.1, size.x * 0.95), Math.max(3.6, size.z * 0.92)),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(THREE),
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        fog: true
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.032, size.z * 0.02);
    shadow.renderOrder = 2;
    shadow.userData.contactShadow = true;
    carRoot.add(shadow);
  }

  function fetchModel(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    var spec = carModels[id];
    if (!spec) return Promise.reject(new Error("ismeretlen autó"));
    var Loader = api.GLTFLoader;
    var loader = new Loader();
    return new Promise(function (resolve, reject) {
      loader.load(
        spec.url,
        function (gltf) {
          cache[id] = gltf.scene || gltf.scenes[0];
          resolve(cache[id]);
        },
        undefined,
        reject
      );
    });
  }

  function putMesh(id) {
    showFallback();
    if (!layer || !layer.carRoot || !api.THREE) return;
    var slot = layer.carSlot || layer.carRoot;
    loadingId = id;
    fetchModel(id)
      .then(function (src) {
        if (loadingId !== id || !layer.carRoot) return;
        var THREE = api.THREE;
        slot = layer.carSlot || layer.carRoot;
        while (slot.children.length) slot.remove(slot.children[0]);
        var mesh = cloneGltf(src);
        applyCarMaterials(mesh);
        alignAndFit(mesh);
        decorateCar(THREE, mesh);
        recenterOnFloor(mesh);
        slot.add(mesh);
        attachHeadlights(THREE, slot, mesh);
        installContactShadow(THREE, layer.carRoot, mesh);
        api.currentId = id;
        hideFallback();
        if (mapRef) mapRef.triggerRepaint();
      })
      .catch(function (err) {
        console.warn("[NavCar3D] modell", id, err);
        showFallback();
      });
  }

  function lightCone(THREE, color, len, radius, opacity) {
    var geo = new THREE.ConeGeometry(radius, len, 12, 1, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, len / 2);
    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
  }

  function glassTexture(THREE) {
    var c = document.createElement("canvas");
    c.width = 128;
    c.height = 256;
    var g = c.getContext("2d");
    g.fillStyle = "#10263d";
    g.fillRect(0, 0, 128, 256);
    var y;
    var x;
    for (y = 8; y < 250; y += 18) {
      for (x = 8; x < 122; x += 16) {
        if (Math.random() < 0.18) continue;
        var lit = Math.random() > 0.62;
        g.fillStyle = lit ? "rgba(255,214,150,0.55)" : "rgba(70,140,190,0.22)";
        g.fillRect(x, y, 10, 12);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 3);
    tex.needsUpdate = true;
    return tex;
  }

  function asphaltShader(THREE, tex) {
    if (tex) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    var uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: tex },
        uOffset: { value: new THREE.Vector2(0, 0) },
        uHead: { value: new THREE.Vector3(0, 0.7, 1.8) },
        uHeadDir: { value: new THREE.Vector3(0, -0.08, 1) }
      }
    ]);
    return new THREE.ShaderMaterial({
      uniforms: uniforms,
      fog: true,
      vertexShader:
        "varying vec2 vUv; varying vec3 vWorld;\n" +
        "#include <fog_pars_vertex>\n" +
        "void main(){\n" +
        "  vUv = uv;\n" +
        "  vec4 w = modelMatrix * vec4(position,1.0);\n" +
        "  vWorld = w.xyz;\n" +
        "  vec4 mvPosition = viewMatrix * w;\n" +
        "  gl_Position = projectionMatrix * mvPosition;\n" +
        "  #include <fog_vertex>\n" +
        "}",
      fragmentShader:
        "uniform sampler2D uMap; uniform vec2 uOffset; uniform vec3 uHead; uniform vec3 uHeadDir;\n" +
        "varying vec2 vUv; varying vec3 vWorld;\n" +
        "#include <fog_pars_fragment>\n" +
        "void main(){\n" +
        "  vec3 base = texture2D(uMap, vUv + uOffset).rgb * 0.78;\n" +
        "  vec3 toP = vWorld - uHead;\n" +
        "  float dist = length(toP);\n" +
        "  float cone = pow(max(0.0, dot(normalize(toP + vec3(0.0001)), normalize(uHeadDir))), 28.0);\n" +
        "  float spot = cone * smoothstep(22.0, 3.0, dist);\n" +
        "  vec3 head = vec3(1.0, 0.93, 0.7) * spot * 0.85;\n" +
        "  gl_FragColor = vec4(base + head, 1.0);\n" +
        "  #include <fog_fragment>\n" +
        "}"
    });
  }

  function roadMap(mat) {
    if (!mat) return null;
    if (mat.map) return mat.map;
    if (mat.uniforms && mat.uniforms.uMap) return mat.uniforms.uMap.value;
    return null;
  }

  function rememberRoadMat(host, mat) {
    if (!host || !mat) return mat;
    host.asphaltMats = host.asphaltMats || [];
    host.asphaltMats.push(mat);
    return mat;
  }

  function stepRoadTextures(mats, dt) {
    if (!mats || !mats.length || !api.THREE) return;
    var currentSpeed = Number(pose.speed) || 0;
    var kmh = currentSpeed * 3.6;
    var dy = kmh >= DEADBAND_KMH ? currentSpeed * dt * ROAD_TEX_GAIN : 0;
    var i;
    var mat;
    var tex;
    for (i = 0; i < mats.length; i++) {
      mat = mats[i];
      tex = roadMap(mat);
      if (!tex || !tex.offset) continue;
      tex.wrapS = api.THREE.RepeatWrapping;
      tex.wrapT = api.THREE.RepeatWrapping;
      if (dy) {
        tex.offset.y -= dy;
        if (tex.offset.y < -10000) tex.offset.y += 10000;
      }
      if (mat.uniforms && mat.uniforms.uOffset && mat.uniforms.uOffset.value) {
        mat.uniforms.uOffset.value.set(tex.offset.x, tex.offset.y);
      }
    }
  }

  function smoothCarPose(root, worldRoot, origin, vis, headingRad, dt) {
    if (!root) return;
    var k = expK(dt || 0.016, TURN_TAU);
    if (!root.userData.poseLive) {
      root.rotation.y = headingRad;
      root.position.x = 0;
      root.position.z = 0;
      root.userData.poseLive = true;
    } else {
      root.rotation.y = lerpRad(root.rotation.y, headingRad, k);
      root.position.x = lerpNum(root.position.x, 0, k);
      root.position.z = lerpNum(root.position.z, 0, k);
    }
    if (worldRoot && origin) {
      var w = enuOffset({ lng: vis.lng, lat: vis.lat }, origin.lng, origin.lat);
      if (!worldRoot.userData.poseLive) {
        worldRoot.position.set(w.x, 0, w.z);
        worldRoot.userData.poseLive = true;
      } else {
        var wk = expK(dt || 0.016, TURN_TAU);
        worldRoot.position.x = lerpNum(worldRoot.position.x, w.x, wk);
        worldRoot.position.z = lerpNum(worldRoot.position.z, w.z, wk);
      }
    }
  }

  function asphaltTexture(THREE) {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 512;
    var g = c.getContext("2d");
    g.fillStyle = "#14161c";
    g.fillRect(0, 0, 256, 512);
    var i;
    for (i = 0; i < 3200; i++) {
      var n = 18 + Math.floor(Math.random() * 46);
      g.fillStyle = "rgba(" + n + "," + (n + 2) + "," + (n + 6) + "," + (0.12 + Math.random() * 0.28) + ")";
      g.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    g.setLineDash([30, 24]);
    g.strokeStyle = "rgba(248,250,252,0.88)";
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 512);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = "#f5c518";
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(16, 0);
    g.lineTo(16, 512);
    g.stroke();
    g.strokeStyle = "#f8fafc";
    g.beginPath();
    g.moveTo(240, 0);
    g.lineTo(240, 512);
    g.stroke();
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 10);
    tex.needsUpdate = true;
    return tex;
  }

  function makeSky(THREE, kind) {
    var c = document.createElement("canvas");
    c.width = 8;
    c.height = 256;
    var g = c.getContext("2d");
    var grd = g.createLinearGradient(0, 0, 0, 256);
    kind = kind || weather.kind || "sun";
    if (kind === "rain") {
      grd.addColorStop(0, "#6d7f93");
      grd.addColorStop(0.45, "#8ea0b3");
      grd.addColorStop(1, "#b7c4b0");
    } else if (kind === "storm") {
      grd.addColorStop(0, "#3d4452");
      grd.addColorStop(0.4, "#5b6474");
      grd.addColorStop(1, "#7a7f70");
    } else if (kind === "fog") {
      grd.addColorStop(0, "#c8c2bc");
      grd.addColorStop(0.5, "#ddd4cc");
      grd.addColorStop(1, "#c8d8b8");
    } else if (kind === "snow") {
      grd.addColorStop(0, "#9bb6d8");
      grd.addColorStop(0.5, "#dce7f4");
      grd.addColorStop(1, "#eef4ea");
    } else if (kind === "partly") {
      grd.addColorStop(0, "#7ea4dc");
      grd.addColorStop(0.35, "#f0b6c8");
      grd.addColorStop(0.7, "#ffd08a");
      grd.addColorStop(1, "#c5e6a8");
    } else {
      grd.addColorStop(0, "#6b8fd4");
      grd.addColorStop(0.28, "#f4a3c4");
      grd.addColorStop(0.55, "#ffb06a");
      grd.addColorStop(0.78, "#ffe2b0");
      grd.addColorStop(1, "#b8e4a8");
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 256);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    var mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    });
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(CAM_FAR - 10, 24, 14), mat);
    mesh.renderOrder = -8;
    return mesh;
  }

  var _cullDx = 0;
  var _cullDz = 0;
  function setRangeVisible(root, ox, oz, range) {
    if (!root) return;
    var r2 = range * range;
    var kids = root.children;
    var i;
    var obj;
    var x;
    var z;
    for (i = 0; i < kids.length; i++) {
      obj = kids[i];
      x = obj.userData && Number.isFinite(obj.userData.cullX) ? obj.userData.cullX : obj.position.x;
      z = obj.userData && Number.isFinite(obj.userData.cullZ) ? obj.userData.cullZ : obj.position.z;
      _cullDx = x - ox;
      _cullDz = z - oz;
      obj.visible = (_cullDx * _cullDx + _cullDz * _cullDz) <= r2;
    }
  }

  function envClose() {
    if (api.arcade) return true;
    return !!(mapRef && typeof mapRef.getZoom === "function" && mapRef.getZoom() >= BUILD_ZOOM_MIN);
  }

  function applyWorldLod(scene, worldRoot, buildRoot, markRoot, sky, extraHeavy) {
    var close = envClose();
    if (scene && api.THREE) {
      if (close) {
        if (!scene.fog) scene.fog = new api.THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
      } else {
        scene.fog = null;
      }
    }
    if (buildRoot) buildRoot.visible = close;
    if (markRoot) markRoot.visible = close;
    if (sky) sky.visible = close;
    if (extraHeavy) extraHeavy.visible = close;
    if (close && worldRoot) {
      var ox = -worldRoot.position.x;
      var oz = -worldRoot.position.z;
      setRangeVisible(buildRoot, ox, oz, BUILD_RANGE);
      setRangeVisible(markRoot, ox, oz, BUILD_RANGE);
      setRangeVisible(extraHeavy, ox, oz, BUILD_RANGE);
    }
  }

  function enuOffset(origin, lng, lat) {
    if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return { x: 0, z: 0 };
    var x = (lng - origin.lng) * 111320 * Math.cos((origin.lat * Math.PI) / 180);
    var z = -(lat - origin.lat) * 111320;
    return { x: x, z: z };
  }

  function clearGroup(group) {
    if (!group) return;
    while (group.children.length) {
      var ch = group.children[0];
      group.remove(ch);
      clearGroup(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) {
        var mats = Array.isArray(ch.material) ? ch.material : [ch.material];
        mats.forEach(function (m) {
          if (!m) return;
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    }
  }

  function densifyEnu(pts, step) {
    if (!pts || pts.length < 2) return pts || [];
    var out = [{ x: pts[0].x, z: pts[0].z }];
    var i;
    var k;
    var n;
    var t;
    var dx;
    var dz;
    var d;
    for (i = 1; i < pts.length; i++) {
      dx = pts[i].x - pts[i - 1].x;
      dz = pts[i].z - pts[i - 1].z;
      d = Math.hypot(dx, dz);
      n = Math.max(1, Math.round(d / Math.max(2.4, step || 5)));
      for (k = 1; k <= n; k++) {
        t = k / n;
        out.push({ x: pts[i - 1].x + dx * t, z: pts[i - 1].z + dz * t });
      }
    }
    return out;
  }

  function chaikinOnce(pts) {
    if (!pts || pts.length < 3) return pts || [];
    var out = [{ x: pts[0].x, z: pts[0].z }];
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i];
      var b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push({ x: pts[pts.length - 1].x, z: pts[pts.length - 1].z });
    return out;
  }

  function pathPoints(coords, origin) {
    var pts = [];
    var i;
    for (i = 0; i < (coords || []).length; i++) {
      var p = enuOffset(origin, coords[i][0], coords[i][1]);
      if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.z - pts[pts.length - 1].z) > 0.8) {
        pts.push(p);
      }
    }
    if (pts.length < 2) return pts;
    var THREE = api.THREE;
    if (THREE && THREE.CatmullRomCurve3 && pts.length >= 2) {
      var vecs = [];
      for (i = 0; i < pts.length; i++) vecs.push(new THREE.Vector3(pts[i].x, 0, pts[i].z));
      var curve = new THREE.CatmullRomCurve3(vecs, false, "catmullrom", 0.08);
      var total = 0;
      for (i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      }
      var sampled = curve.getPoints(Math.min(800, Math.max(180, Math.round(total / 3.5))));
      var out = [];
      for (i = 0; i < sampled.length; i++) out.push({ x: sampled[i].x, z: sampled[i].z });
      return out;
    }
    return chaikinOnce(chaikinOnce(densifyEnu(pts, 3.2)));
  }

  function ribbonFromPts(THREE, pts, width, y) {
    var i;
    var elev = y == null ? 0.08 : y;
    if (!pts || pts.length < 2) return null;
    var pos = [];
    var uvs = [];
    var acc = 0;
    var hw = width / 2;
    for (i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)];
      var b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b.x - a.x;
      var dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      var nx = (-dz / len) * hw;
      var nz = (dx / len) * hw;
      pos.push(pts[i].x + nx, elev, pts[i].z + nz);
      pos.push(pts[i].x - nx, elev, pts[i].z - nz);
      uvs.push(0, acc / 14, 1, acc / 14);
    }
    var idx = [];
    for (i = 0; i < pts.length - 1; i++) {
      var i0 = i * 2;
      idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function ribbonGeometry(THREE, coords, origin, width, y) {
    return ribbonFromPts(THREE, pathPoints(coords, origin), width, y);
  }

  function trafficTone(level) {
    if (level >= 0.65) return 0xe23b4a;
    if (level >= 0.38) return 0xf2b84b;
    return 0x3dce6a;
  }

  function trafficAt(traveled) {
    var list = lastWorld.traffic || [];
    if (!list.length) return 0.22;
    var i;
    var best = list[0];
    var d = Math.abs((best.traveled || 0) - traveled);
    for (i = 1; i < list.length; i++) {
      var n = Math.abs((list[i].traveled || 0) - traveled);
      if (n < d) {
        d = n;
        best = list[i];
      }
    }
    return Number(best.level) || 0;
  }

  function slicePtsByDist(pts, t0, t1) {
    var out = [];
    var acc = 0;
    var i;
    for (i = 0; i < pts.length; i++) {
      if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      if (acc >= t0 - 0.8 && acc <= t1 + 0.8) out.push(pts[i]);
    }
    return out;
  }

  function poseOnPts(pts, traveled) {
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x;
      var dz = pts[i].z - pts[i - 1].z;
      var len = Math.hypot(dx, dz) || 1;
      if (acc + len >= traveled) {
        var t = (traveled - acc) / len;
        return {
          x: pts[i - 1].x + dx * t,
          z: pts[i - 1].z + dz * t,
          hx: dx / len,
          hz: dz / len,
          nx: -dz / len,
          nz: dx / len
        };
      }
      acc += len;
    }
    var last = pts[pts.length - 1];
    var prev = pts[Math.max(0, pts.length - 2)];
    var ldx = last.x - prev.x;
    var ldz = last.z - prev.z;
    var llen = Math.hypot(ldx, ldz) || 1;
    return { x: last.x, z: last.z, hx: ldx / llen, hz: ldz / llen, nx: -ldz / llen, nz: ldx / llen };
  }

  function hash01(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  var weather = { code: 0, temp: null, kind: "sun" };

  function weatherKind(code) {
    var n = Number(code);
    if (!Number.isFinite(n)) n = 0;
    if (n === 0) return "sun";
    if (n <= 3) return "partly";
    if (n <= 48) return "fog";
    if (n <= 67 || (n >= 80 && n <= 82)) return "rain";
    if (n <= 77 || (n >= 85 && n <= 86)) return "snow";
    return "storm";
  }

  function weatherCloudMul() {
    if (weather.kind === "sun") return 0.35;
    if (weather.kind === "partly") return 0.7;
    if (weather.kind === "fog") return 0.85;
    if (weather.kind === "snow") return 0.8;
    if (weather.kind === "rain") return 1;
    return 1.15;
  }

  function addStoryLights(THREE, scene) {
    if (!THREE || !scene) return;
    var ambient = new THREE.AmbientLight(0xffe4c8, 0.72);
    var hemi = new THREE.HemisphereLight(0xffc8d8, 0x6aaa62, 0.55);
    var sun = new THREE.DirectionalLight(0xffd08a, 0.95);
    sun.position.set(18, 22, -14);
    var fill = new THREE.DirectionalLight(0xff9ec4, 0.28);
    fill.position.set(-16, 12, 10);
    scene.add(ambient);
    scene.add(hemi);
    scene.add(sun);
    scene.add(fill);
    scene.userData.storyLights = { ambient: ambient, hemi: hemi, sun: sun, fill: fill };
    applyWeatherToScene(scene, null);
  }

  function applyWeatherToScene(scene, renderer) {
    if (!scene || !api.THREE) return;
    var kind = weather.kind || "sun";
    var fogHex = FOG_COLOR;
    var fogDen = FOG_DENSITY;
    var amb = 0xffe4c8;
    var sunCol = 0xffd08a;
    var sunInt = 0.95;
    var ambInt = 0.72;
    if (kind === "partly") {
      fogHex = 0xe8c8b8;
      fogDen = 0.0032;
      sunInt = 0.78;
    } else if (kind === "fog") {
      fogHex = 0xd8d0c8;
      fogDen = 0.011;
      sunInt = 0.35;
      ambInt = 0.9;
      amb = 0xe8e0d8;
    } else if (kind === "rain") {
      fogHex = 0x9bb4c8;
      fogDen = 0.0048;
      sunCol = 0xc8d4e0;
      sunInt = 0.42;
      amb = 0xc5d2de;
      ambInt = 0.62;
    } else if (kind === "snow") {
      fogHex = 0xe8eef4;
      fogDen = 0.0038;
      sunCol = 0xf4f7ff;
      sunInt = 0.7;
      amb = 0xeef3ff;
    } else if (kind === "storm") {
      fogHex = 0x6b7380;
      fogDen = 0.006;
      sunCol = 0x8a94a8;
      sunInt = 0.28;
      amb = 0x8b93a3;
      ambInt = 0.5;
    }
    if (scene.fog) {
      scene.fog.density = fogDen;
      if (scene.fog.color) scene.fog.color.setHex(fogHex);
    } else {
      scene.fog = new api.THREE.FogExp2(fogHex, fogDen);
    }
    if (scene.background && scene.background.isColor) scene.background.setHex(fogHex);
    if (renderer && renderer.setClearColor) renderer.setClearColor(fogHex, 1);
    var lights = scene.userData && scene.userData.storyLights;
    if (lights) {
      if (lights.ambient) {
        lights.ambient.color.setHex(amb);
        lights.ambient.intensity = ambInt;
      }
      if (lights.sun) {
        lights.sun.color.setHex(sunCol);
        lights.sun.intensity = sunInt;
      }
    }
  }

  function clayRoadTexture(THREE) {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 512;
    var g = c.getContext("2d");
    g.fillStyle = "#4f545c";
    g.fillRect(0, 0, 256, 512);
    var i;
    for (i = 0; i < 900; i++) {
      var n = 120 + Math.floor(Math.random() * 40);
      g.fillStyle = "rgba(" + n + "," + (n - 4) + "," + (n - 8) + ",0.18)";
      g.fillRect(Math.random() * 256, Math.random() * 512, 3 + Math.random() * 8, 2);
    }
    g.setLineDash([28, 22]);
    g.strokeStyle = "rgba(255,248,230,0.92)";
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 512);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = "#f3efe4";
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(18, 0);
    g.lineTo(18, 512);
    g.stroke();
    g.beginPath();
    g.moveTo(238, 0);
    g.lineTo(238, 512);
    g.stroke();
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    tex.needsUpdate = true;
    return tex;
  }

  function clayRoadMat(THREE) {
    var mat = toonMaterial(THREE, {
      color: CLAY_ROAD,
      map: clayRoadTexture(THREE),
      fog: true,
      side: THREE.DoubleSide
    });
    return mat;
  }

  function clayRouteMat(THREE) {
    return toonMaterial(THREE, {
      color: CLAY_ROUTE,
      fog: true,
      side: THREE.DoubleSide
    });
  }

  function pickCanopy(seed) {
    return CANOPY_COLORS[Math.floor(hash01(seed) * CANOPY_COLORS.length) % CANOPY_COLORS.length];
  }

  function canopyGeo(THREE, radius, seed) {
    if (hash01(seed) > 0.5 && THREE.DodecahedronGeometry) {
      return new THREE.DodecahedronGeometry(radius, 0);
    }
    return new THREE.IcosahedronGeometry(radius, 0);
  }

  function makeClayTree(THREE, seed) {
    var g = new THREE.Group();
    var trunkH = 1.55 + hash01(seed) * 1.15;
    var trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.4, trunkH, 6),
      toonMaterial(THREE, { color: 0xc48a5a, fog: true })
    );
    trunk.position.y = trunkH * 0.5;
    g.add(trunk);
    var puffs = 2 + Math.floor(hash01(seed + 11) * 3);
    var i;
    for (i = 0; i < puffs; i++) {
      var r = 1.05 + hash01(seed + i * 3) * 1.05;
      var puff = new THREE.Mesh(
        canopyGeo(THREE, r, seed + i * 4),
        toonMaterial(THREE, { color: pickCanopy(seed + i * 19 + 7), fog: true })
      );
      puff.position.set(
        (hash01(seed + i * 5) - 0.5) * 1.45,
        trunkH + 0.55 + hash01(seed + i * 2) * 1.05,
        (hash01(seed + i * 8) - 0.5) * 1.45
      );
      puff.scale.y = 0.74 + hash01(seed + i) * 0.24;
      g.add(puff);
    }
    return g;
  }

  function makeFlower(THREE, seed) {
    var g = new THREE.Group();
    var stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.036, 0.26, 5),
      toonMaterial(THREE, { color: 0x5aaa4a, fog: true })
    );
    stem.position.y = 0.13;
    g.add(stem);
    var petalColor = hash01(seed) > 0.5 ? 0xfff8ee : 0xffe566;
    var i;
    for (i = 0; i < 5; i++) {
      var petal = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 6, 5),
        toonMaterial(THREE, { color: petalColor, fog: true })
      );
      var a = (i / 5) * Math.PI * 2;
      petal.position.set(Math.cos(a) * 0.11, 0.28, Math.sin(a) * 0.11);
      petal.scale.set(1, 0.42, 0.78);
      g.add(petal);
    }
    var center = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 6, 5),
      toonMaterial(THREE, { color: hash01(seed + 2) > 0.5 ? 0xffd84a : 0xfff6d8, fog: true })
    );
    center.position.y = 0.28;
    g.add(center);
    return g;
  }

  function makeFlowerClump(THREE, seed) {
    var g = new THREE.Group();
    var n = 3 + Math.floor(hash01(seed) * 4);
    var i;
    for (i = 0; i < n; i++) {
      var flower = makeFlower(THREE, seed + i * 13);
      flower.position.set((hash01(seed + i) - 0.5) * 1.55, 0, (hash01(seed + i + 4) - 0.5) * 1.55);
      flower.rotation.y = hash01(seed + i + 2) * Math.PI * 2;
      g.add(flower);
    }
    return g;
  }

  function makeBush(THREE, seed) {
    var g = new THREE.Group();
    var color = hash01(seed) > 0.5 ? 0x5cb86a : 0x8fd46a;
    var i;
    for (i = 0; i < 3; i++) {
      var puff = new THREE.Mesh(
        canopyGeo(THREE, 0.52 + hash01(seed + i) * 0.38, seed + i),
        toonMaterial(THREE, { color: color, fog: true })
      );
      puff.position.set((i - 1) * 0.4, 0.36, (hash01(seed + i * 3) - 0.5) * 0.38);
      puff.scale.y = 0.6;
      g.add(puff);
    }
    return g;
  }

  function makeStream(THREE, seed, startX, startZ, dirX, dirZ) {
    var vecs = [];
    var i;
    var x = startX;
    var z = startZ;
    var len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;
    var px = -dirZ;
    var pz = dirX;
    for (i = 0; i < 9; i++) {
      var wobble = Math.sin(i * 0.9 + seed) * 6 + (hash01(seed + i * 7) - 0.5) * 5;
      x += dirX * (9 + hash01(seed + i) * 4);
      z += dirZ * (9 + hash01(seed + i + 3) * 4);
      vecs.push(new THREE.Vector3(x + px * wobble, 0.035, z + pz * wobble));
    }
    var sampled = vecs;
    if (THREE.CatmullRomCurve3) {
      sampled = new THREE.CatmullRomCurve3(vecs, false, "catmullrom", 0.35).getPoints(48);
    }
    var pos = [];
    var hw = 1.15;
    for (i = 0; i < sampled.length; i++) {
      var a = sampled[Math.max(0, i - 1)];
      var b = sampled[Math.min(sampled.length - 1, i + 1)];
      var dx = b.x - a.x;
      var dz = b.z - a.z;
      var sl = Math.hypot(dx, dz) || 1;
      pos.push(sampled[i].x + (-dz / sl) * hw, sampled[i].y, sampled[i].z + (dx / sl) * hw);
      pos.push(sampled[i].x - (-dz / sl) * hw, sampled[i].y, sampled[i].z - (dx / sl) * hw);
    }
    var idx = [];
    for (i = 0; i < sampled.length - 1; i++) {
      var o = i * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(
      geo,
      toonMaterial(THREE, {
        color: 0x7ad8f5,
        fog: true,
        side: THREE.DoubleSide,
        roughness: 0.35,
        metalness: 0.08
      })
    );
  }

  function makeClayHill(THREE, seed) {
    var r = 14 + hash01(seed) * 18;
    var hill = new THREE.Mesh(
      new THREE.SphereGeometry(r, 10, 8),
      toonMaterial(THREE, { color: hash01(seed + 1) > 0.45 ? 0x8fe08c : 0xb4ebb4, fog: true })
    );
    hill.scale.y = 0.32 + hash01(seed + 3) * 0.18;
    hill.position.y = -r * hill.scale.y * 0.28;
    return hill;
  }

  function makeClayCloud(THREE, seed) {
    var g = new THREE.Group();
    var mat = toonMaterial(THREE, { color: hash01(seed) > 0.55 ? 0xfff6ee : 0xffe4ef, fog: true });
    var i;
    for (i = 0; i < 5; i++) {
      var puff = new THREE.Mesh(new THREE.SphereGeometry(2.05 + hash01(seed + i) * 1.55, 8, 6), mat);
      puff.position.set((i - 2) * 1.85, hash01(seed + i * 3) * 0.7, (hash01(seed + 9 + i) - 0.5) * 1.7);
      puff.scale.y = 0.52;
      g.add(puff);
    }
    return g;
  }

  function makeClayLamp(THREE) {
    var g = new THREE.Group();
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.11, 3.4, 6),
      toonMaterial(THREE, { color: 0xd4c4a8, fog: true })
    );
    pole.position.y = 1.7;
    var bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 6),
      toonMaterial(THREE, { color: 0xfff4c2, fog: true, emissive: 0xffe08a, emissiveIntensity: 0.8 })
    );
    bulb.position.y = 3.45;
    var hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.48, 0.28, 8),
      toonMaterial(THREE, { color: 0xe8d7b0, fog: true })
    );
    hat.position.y = 3.7;
    g.add(pole);
    g.add(bulb);
    g.add(hat);
    return g;
  }

  function makeNpcMesh(THREE, kind) {
    var g = new THREE.Group();
    var bodyCol = kind === "bus" ? 0xf2b84b : kind === "van" ? 0x6ec8ff : 0xff6eb4;
    var w = kind === "bus" ? 2.2 : kind === "van" ? 1.85 : 1.55;
    var h = kind === "bus" ? 1.45 : kind === "van" ? 1.2 : 0.85;
    var d = kind === "bus" ? 6.2 : kind === "van" ? 4.4 : 3.4;
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      toonMaterial(THREE, { color: bodyCol, fog: true })
    );
    body.position.y = 0.42 + h * 0.5;
    var cabin = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.86, h * 0.55, d * 0.38),
      toonMaterial(THREE, { color: 0xfff6e8, fog: true })
    );
    cabin.position.set(0, 0.42 + h + 0.12, kind === "bus" ? d * 0.18 : d * 0.16);
    var i;
    for (i = 0; i < 4; i++) {
      var wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.22, 8),
        toonMaterial(THREE, { color: 0x2a2a2a, fog: true })
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set((i < 2 ? -1 : 1) * w * 0.52, 0.28, (i % 2 ? 1 : -1) * d * 0.32);
      g.add(wheel);
    }
    g.add(body);
    g.add(cabin);
    g.userData.npcKind = kind;
    return g;
  }

  function defaultOrigin() {
    if (lastWorld.origin && Number.isFinite(lastWorld.origin.lat) && Number.isFinite(lastWorld.origin.lng)) {
      return lastWorld.origin;
    }
    if (Number.isFinite(pose.lat) && Number.isFinite(pose.lng)) {
      return { lng: pose.lng, lat: pose.lat };
    }
    return { lng: 19.0402, lat: 47.4979 };
  }

  function addDefaultClayPad(THREE, scene, host) {
    if (!THREE || !scene) return null;
    if (host && host.clayPad) return host.clayPad;
    var pad = new THREE.Group();
    pad.name = "clayPad";
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560, 1, 1),
      toonMaterial(THREE, { color: CLAY_GROUND, fog: true, side: THREE.DoubleSide })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.frustumCulled = false;
    pad.add(ground);
    var road = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 120, 1, 1),
      clayRoadMat(THREE)
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, ROAD_Y, 32);
    road.frustumCulled = false;
    pad.add(road);
    var paint = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 120, 1, 1),
      clayRouteMat(THREE)
    );
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(0, PAINT_Y, 32);
    paint.frustumCulled = false;
    pad.add(paint);
    pad.userData.fallbackRoad = road;
    pad.userData.fallbackPaint = paint;
    var decor = new THREE.Group();
    decor.name = "clayPadDecor";
    pad.add(decor);
    pad.userData.decor = decor;
    var i;
    for (i = 0; i < 10; i++) {
      var ang = (i / 10) * Math.PI * 2;
      var dist = 38 + hash01(i * 4) * 30;
      var hill = makeClayHill(THREE, i * 17 + 3);
      hill.position.set(Math.sin(ang) * dist, hill.position.y, Math.cos(ang) * dist);
      decor.add(hill);
    }
    for (i = 0; i < 26; i++) {
      var ang2 = (i / 26) * Math.PI * 2 + 0.35;
      var d2 = 12 + hash01(i * 9) * 26;
      var tree = makeClayTree(THREE, i * 23 + 5);
      tree.position.set(Math.sin(ang2) * d2, 0, Math.cos(ang2) * d2);
      decor.add(tree);
    }
    for (i = 0; i < 16; i++) {
      var clump = makeFlowerClump(THREE, i * 41 + 2);
      var fa = (i / 16) * Math.PI * 2 + 0.7;
      var fd = 9 + hash01(i * 6) * 22;
      clump.position.set(Math.sin(fa) * fd, 0, Math.cos(fa) * fd);
      decor.add(clump);
    }
    for (i = 0; i < 12; i++) {
      var bush = makeBush(THREE, i * 15);
      var ba = (i / 12) * Math.PI * 2 + 0.2;
      var bd = 8 + hash01(i * 5) * 16;
      bush.position.set(Math.sin(ba) * bd, 0, Math.cos(ba) * bd);
      decor.add(bush);
    }
    decor.add(makeStream(THREE, 4, -18, 8, 0.12, 1));
    for (i = 0; i < 5; i++) {
      var lamp = makeClayLamp(THREE);
      lamp.position.set((i % 2 ? 7.2 : -7.2), 0, 8 + i * 18);
      decor.add(lamp);
    }
    for (i = 0; i < 8; i++) {
      var cloud = makeClayCloud(THREE, i * 11);
      cloud.position.set((hash01(i) - 0.5) * 90, 30 + hash01(i + 3) * 14, 18 + hash01(i + 5) * 46);
      decor.add(cloud);
    }
    scene.add(pad);
    if (host) host.clayPad = pad;
    return pad;
  }

  function syncClayPadRoad(host, hasRoute) {
    if (!host || !host.clayPad || !host.clayPad.userData) return;
    var show = !hasRoute;
    if (host.clayPad.userData.fallbackRoad) host.clayPad.userData.fallbackRoad.visible = show;
    if (host.clayPad.userData.fallbackPaint) host.clayPad.userData.fallbackPaint.visible = show;
    if (host.clayPad.userData.decor) host.clayPad.userData.decor.visible = show;
  }

  function carLocal(origin) {
    origin = origin || defaultOrigin();
    if (Number.isFinite(pose.lng) && Number.isFinite(pose.lat)) {
      return enuOffset(origin, pose.lng, pose.lat);
    }
    return { x: 0, z: 0 };
  }

  function envRawPoints(coords, origin) {
    var pts = [];
    var i;
    for (i = 0; i < (coords || []).length; i++) {
      var p = enuOffset(origin, coords[i][0], coords[i][1]);
      if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.z - pts[pts.length - 1].z) > 2) {
        pts.push(p);
      }
    }
    if (pts.length < 2) return [{ x: 0, z: 20 }, { x: 0, z: -80 }];
    return densifyEnu(pts, 10);
  }

  function putEnv(root, live, key, obj, x, y, z, kind) {
    obj.position.set(x, y, z);
    obj.userData.cullX = x;
    obj.userData.cullZ = z;
    obj.userData.envKey = key;
    obj.userData.envKind = kind || "";
    obj.visible = true;
    live[key] = obj;
    root.add(obj);
  }

  function dropEnv(root, live, key) {
    var obj = live[key];
    if (!obj) return;
    root.remove(obj);
    try {
      obj.traverse(function (n) {
        if (n.geometry) n.geometry.dispose();
      });
    } catch (_e) {}
    delete live[key];
  }

  function buildClayEnvironment(THREE, root, coords, origin, carX, carZ) {
    if (!root || !THREE) return;
    if (!root.userData) root.userData = {};
    var live = root.userData.live;
    if (!live) live = root.userData.live = {};
    var here;
    if (!Number.isFinite(carX) || !Number.isFinite(carZ)) {
      here = carLocal(origin);
      carX = here.x;
      carZ = here.z;
    }
    var spawn2 = ENV_RANGE * ENV_RANGE;
    var keep2 = ENV_KEEP * ENV_KEEP;
    Object.keys(live).forEach(function (key) {
      var obj = live[key];
      if (!obj) {
        delete live[key];
        return;
      }
      var dx = (Number.isFinite(obj.userData.cullX) ? obj.userData.cullX : obj.position.x) - carX;
      var dz = (Number.isFinite(obj.userData.cullZ) ? obj.userData.cullZ : obj.position.z) - carZ;
      if (dx * dx + dz * dz > keep2) dropEnv(root, live, key);
    });
    var pts = envRawPoints(coords, origin);
    var acc = 0;
    var trees = 0;
    var lamps = 0;
    var flowers = 0;
    var bushes = 0;
    var streams = 0;
    var i;
    var key;
    var near;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x;
      var dz = pts[i].z - pts[i - 1].z;
      var len = Math.hypot(dx, dz) || 1;
      acc += len;
      var nx = -dz / len;
      var nz = dx / len;
      var midX = (pts[i].x + pts[i - 1].x) * 0.5;
      var midZ = (pts[i].z + pts[i - 1].z) * 0.5;
      near = (midX - carX) * (midX - carX) + (midZ - carZ) * (midZ - carZ) <= spawn2;
      if (acc > lamps * 16 + 6) {
        key = "l:" + lamps;
        if (near && !live[key]) {
          var lamp = makeClayLamp(THREE);
          var side = lamps % 2 ? 1 : -1;
          putEnv(root, live, key, lamp, midX + nx * 6.4 * side, 0, midZ + nz * 6.4 * side, "lamp");
        }
        lamps += 1;
      }
      if (acc > trees * 8 + 3) {
        var tOff = 10 + hash01(trees * 3) * 8;
        key = "tl:" + trees;
        if (near && !live[key]) {
          putEnv(root, live, key, makeClayTree(THREE, trees * 13 + Math.round(acc)), midX - nx * tOff, 0, midZ - nz * tOff, "tree");
        }
        key = "tr:" + trees;
        if (near && !live[key]) {
          putEnv(
            root,
            live,
            key,
            makeClayTree(THREE, trees * 29 + Math.round(acc) + 5),
            midX + nx * (tOff + 1.4),
            0,
            midZ + nz * (tOff + 1.4),
            "tree"
          );
        }
        trees += 1;
      }
      if (acc > flowers * 12 + 7) {
        key = "f:" + flowers;
        if (near && !live[key]) {
          var fSide = flowers % 2 ? 1 : -1;
          var fOff = 8 + hash01(flowers) * 6;
          putEnv(root, live, key, makeFlowerClump(THREE, flowers * 31), midX + nx * fOff * fSide, 0, midZ + nz * fOff * fSide, "flower");
        }
        flowers += 1;
      }
      if (acc > bushes * 14 + 5) {
        key = "b:" + bushes;
        if (near && !live[key]) {
          var bSide = bushes % 2 ? -1 : 1;
          var bOff = 7.2 + hash01(bushes * 2) * 4;
          putEnv(root, live, key, makeBush(THREE, bushes * 11), midX + nx * bOff * bSide, 0, midZ + nz * bOff * bSide, "bush");
        }
        bushes += 1;
      }
      if (acc > streams * 70 + 30) {
        key = "s:" + streams;
        if (near && !live[key]) {
          var sSide = streams % 2 ? 1 : -1;
          var stream = makeStream(
            THREE,
            streams * 17,
            midX + nx * 18 * sSide,
            midZ + nz * 18 * sSide,
            dz / len,
            -dx / len
          );
          stream.userData.cullX = midX;
          stream.userData.cullZ = midZ;
          stream.userData.envKey = key;
          stream.userData.envKind = "stream";
          live[key] = stream;
          root.add(stream);
        }
        streams += 1;
      }
    }
    var gx = Math.round(carX / 90);
    var gz = Math.round(carZ / 90);
    var di;
    var dj;
    var cloudMul = weatherCloudMul();
    for (di = -4; di <= 4; di++) {
      for (dj = -4; dj <= 4; dj++) {
        var cx = (gx + di) * 90 + (hash01(gx + di + 3) - 0.5) * 24;
        var cz = (gz + dj) * 90 + (hash01(gz + dj + 8) - 0.5) * 24;
        if ((cx - carX) * (cx - carX) + (cz - carZ) * (cz - carZ) > spawn2) continue;
        if (((gx + di + gz + dj) & 1) === 0) {
          key = "h:" + (gx + di) + ":" + (gz + dj);
          if (!live[key]) {
            var hill = makeClayHill(THREE, (gx + di) * 21 + (gz + dj) * 9);
            putEnv(root, live, key, hill, cx, hill.position.y, cz, "hill");
          }
        }
        key = "c:" + (gx + di) + ":" + (gz + dj);
        if (hash01((gx + di) * 17 + (gz + dj) * 5) < cloudMul && !live[key]) {
          var cloud = makeClayCloud(THREE, (gx + di) * 19 + (gz + dj) * 7);
          putEnv(root, live, key, cloud, cx, 36 + hash01(gx + di + gz + dj) * 16, cz, "cloud");
        }
      }
    }
    Object.keys(live).forEach(function (k) {
      if (k.indexOf("c:") !== 0 || !live[k]) return;
      live[k].visible = hash01(k.length + k.charCodeAt(2)) < cloudMul + 0.15;
    });
  }

  function npcKindFor(i) {
    var n = hash01(i * 19 + 4);
    if (n > 0.82) return "bus";
    if (n > 0.58) return "van";
    return "car";
  }

  function rebuildNpcs(host) {
    if (!host || !host.npcRoot || !api.THREE) return;
    clearGroup(host.npcRoot);
    host.npcs = [];
    var origin = lastWorld.origin || host.worldOrigin || defaultOrigin();
    var pts = pathPoints(lastWorld.coords, origin);
    if (pts.length < 2) return;
    var car = carLocal(origin);
    var total = 0;
    var i;
    for (i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    host.npcPath = pts;
    host.npcPathLen = total;
    var t = 18;
    var n = 0;
    while (t < total - 12 && n < 36) {
      var pose = poseOnPts(pts, t);
      var dx = pose.x - car.x;
      var dz = pose.z - car.z;
      if (dx * dx + dz * dz <= ENV_RANGE * ENV_RANGE) {
        var level = trafficAt(t);
        var jam = level >= 0.38;
        if (jam || hash01(t + 3) > 0.72) {
          var mesh = makeNpcMesh(api.THREE, npcKindFor(n));
          var lane = 1.7;
          mesh.position.set(pose.x + pose.nx * lane, 0, pose.z + pose.nz * lane);
          mesh.rotation.y = Math.atan2(pose.hx, pose.hz);
          host.npcRoot.add(mesh);
          host.npcs.push({
            mesh: mesh,
            traveled: t,
            lane: lane,
            dir: 1,
            speed: jam ? (level >= 0.65 ? 0.6 : 4.5) : 12
          });
          n += 1;
        }
        if (hash01(t + 11) > 0.55) {
          var on = makeNpcMesh(api.THREE, npcKindFor(n + 20));
          on.position.set(pose.x - pose.nx * 1.7, 0, pose.z - pose.nz * 1.7);
          on.rotation.y = Math.atan2(-pose.hx, -pose.hz);
          host.npcRoot.add(on);
          host.npcs.push({
            mesh: on,
            traveled: t,
            lane: -1.7,
            dir: -1,
            speed: 14
          });
          n += 1;
        }
      }
      t += levelGap(t);
    }
  }

  function levelGap(traveled) {
    var level = trafficAt(traveled);
    if (level >= 0.65) return 14;
    if (level >= 0.38) return 22;
    return 46;
  }

  function tickNpcs(host, dt) {
    if (!host || !host.npcs || !host.npcPath) {
      rebuildNpcs(host);
      return;
    }
    if (!host.npcs.length) return;
    var origin = lastWorld.origin || host.worldOrigin || defaultOrigin();
    var car = carLocal(origin);
    var i;
    for (i = 0; i < host.npcs.length; i++) {
      var npc = host.npcs[i];
      npc.traveled += npc.dir * npc.speed * Math.max(0.001, dt);
      if (npc.traveled < 2 || npc.traveled > (host.npcPathLen || 0) - 2) {
        npc.traveled = npc.dir > 0 ? 8 : Math.max(8, (host.npcPathLen || 20) - 8);
      }
      var pose = poseOnPts(host.npcPath, npc.traveled);
      npc.mesh.position.set(pose.x + pose.nx * npc.lane, 0, pose.z + pose.nz * npc.lane);
      npc.mesh.rotation.y = Math.atan2(pose.hx * npc.dir, pose.hz * npc.dir);
      var dx = pose.x - car.x;
      var dz = pose.z - car.z;
      npc.mesh.visible = dx * dx + dz * dz <= ENV_RANGE * ENV_RANGE;
    }
    if (host.npcAnchorX == null || Math.hypot(car.x - host.npcAnchorX, car.z - host.npcAnchorZ) > 70) {
      host.npcAnchorX = car.x;
      host.npcAnchorZ = car.z;
      rebuildNpcs(host);
    }
  }

  function nearestNpcAhead() {
    var host = overlay.npcRoot ? overlay : layer;
    if (!host || !host.npcs || !host.npcPath) return null;
    var origin = lastWorld.origin || defaultOrigin();
    var car = carLocal(origin);
    var here = 0;
    var pts = host.npcPath;
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x;
      var dz = pts[i].z - pts[i - 1].z;
      var len = Math.hypot(dx, dz);
      var t = ((car.x - pts[i - 1].x) * dx + (car.z - pts[i - 1].z) * dz) / ((len * len) || 1);
      if (t >= 0 && t <= 1) {
        here = acc + t * len;
        break;
      }
      acc += len;
    }
    var best = null;
    var bestD = 40;
    for (i = 0; i < host.npcs.length; i++) {
      var npc = host.npcs[i];
      if (npc.dir < 0) continue;
      var d = npc.traveled - here;
      if (d > 0.8 && d < bestD) {
        bestD = d;
        best = npc;
      }
    }
    return best ? { npc: best, gap: bestD, level: trafficAt(here) } : { npc: null, gap: 99, level: trafficAt(here) };
  }

  function maybeStreamEnv(host) {
    if (!host || !host.envRoot || !api.THREE) return;
    var origin = lastWorld.origin || host.worldOrigin || defaultOrigin();
    var p = carLocal(origin);
    if (
      host.envAnchorX != null &&
      Math.hypot(p.x - host.envAnchorX, p.z - host.envAnchorZ) < ENV_STEP &&
      host.envRoot.children.length
    ) {
      return;
    }
    host.envAnchorX = p.x;
    host.envAnchorZ = p.z;
    buildClayEnvironment(api.THREE, host.envRoot, lastWorld.coords, origin, p.x, p.z);
  }

  function refreshSky(host) {
    if (!host || !host.scene || !api.THREE) return;
    if (host.sky && host.sky.parent) host.sky.parent.remove(host.sky);
    host.sky = makeSky(api.THREE, weather.kind);
    host.scene.add(host.sky);
  }

  function addClayRouteMeshes(THREE, root, coords, origin, host) {
    if (!root || !coords || coords.length < 2 || !origin) return;
    var road = ribbonGeometry(THREE, coords, origin, 13.6, ROAD_Y);
    if (road) {
      var mat = clayRoadMat(THREE);
      rememberRoadMat(host, mat);
      root.add(new THREE.Mesh(road, mat));
    }
    var pts = pathPoints(coords, origin);
    var traffic = lastWorld.traffic || [];
    if (!traffic.length) {
      var paint = ribbonFromPts(THREE, pts, 3.4, PAINT_Y);
      if (paint) root.add(new THREE.Mesh(paint, clayRouteMat(THREE)));
    } else {
      var acc = 0;
      var i;
      var start = 0;
      var tone = trafficTone(trafficAt(0));
      for (i = 1; i <= pts.length; i++) {
        if (i < pts.length) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        var nextTone = i < pts.length ? trafficTone(trafficAt(acc)) : -1;
        if (nextTone !== tone || i === pts.length) {
          var slice = pts.slice(Math.max(0, start - 1), i);
          var geo = ribbonFromPts(THREE, slice, 3.4, PAINT_Y);
          if (geo) {
            root.add(
              new THREE.Mesh(
                geo,
                toonMaterial(THREE, { color: tone, fog: true, side: THREE.DoubleSide })
              )
            );
          }
          start = i - 1;
          tone = nextTone;
        }
      }
    }
    var yel = edgeLine(THREE, coords, origin, -1, 0xf3efe4);
    var wht = edgeLine(THREE, coords, origin, 1, 0xf3efe4);
    if (yel) root.add(yel);
    if (wht) root.add(wht);
  }

  function nearestOnRoute(px, pz, origin) {
    var coords = lastWorld.coords;
    if (!coords || coords.length < 2 || !origin) {
      var len = Math.hypot(px, pz) || 1;
      return { x: 0, z: 0, nx: px / len, nz: pz / len, dist: len };
    }
    var best = 1e9;
    var cx = 0;
    var cz = 0;
    var nx = 0;
    var nz = 1;
    var i;
    for (i = 1; i < coords.length; i++) {
      var a = enuOffset(origin, coords[i - 1][0], coords[i - 1][1]);
      var b = enuOffset(origin, coords[i][0], coords[i][1]);
      var abx = b.x - a.x;
      var abz = b.z - a.z;
      var ab2 = abx * abx + abz * abz || 1;
      var t = ((px - a.x) * abx + (pz - a.z) * abz) / ab2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      var qx = a.x + abx * t;
      var qz = a.z + abz * t;
      var d = Math.hypot(px - qx, pz - qz);
      if (d < best) {
        best = d;
        cx = qx;
        cz = qz;
        var alen = Math.hypot(abx, abz) || 1;
        nx = -abz / alen;
        nz = abx / alen;
        if (nx * (px - qx) + nz * (pz - qz) < 0) {
          nx = -nx;
          nz = -nz;
        }
      }
    }
    if (best < 0.4) {
      return { x: cx, z: cz, nx: nx, nz: nz, dist: best };
    }
    var lx = px - cx;
    var lz = pz - cz;
    var ll = Math.hypot(lx, lz) || 1;
    return { x: cx, z: cz, nx: lx / ll, nz: lz / ll, dist: best };
  }

  function buildingGroup(THREE, building, origin) {
    var ring = building.ring || [];
    if (ring.length < 3) return null;
    var shape = new THREE.Shape();
    var i;
    for (i = 0; i < ring.length; i++) {
      var p = enuOffset(origin, ring[i][0], ring[i][1]);
      if (i === 0) shape.moveTo(p.x, -p.z);
      else shape.lineTo(p.x, -p.z);
    }
    var h = Math.max(7, Number(building.h) || 14);
    var geo;
    try {
      geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
    } catch (_e) {
      return null;
    }
    geo.rotateX(-Math.PI / 2);
    if (building.minH) geo.translate(0, Number(building.minH) || 0, 0);
    var wall = toonMaterial(THREE, { color: 0xc4b49a, fog: true });
    var mesh = new THREE.Mesh(geo, wall);
    mesh.renderOrder = 1;
    addBlackOutline(THREE, mesh);
    var edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 18),
      new THREE.LineBasicMaterial({
        color: 0x111111,
        fog: true
      })
    );
    edges.renderOrder = 3;
    edges.raycast = function () {};
    var g = new THREE.Group();
    g.add(mesh);
    g.add(edges);
    var want = 30;
    var nearest = 1e9;
    var nx = 0;
    var nz = 1;
    var push = 0;
    var guard;
    for (i = 0; i < ring.length; i++) {
      var rp = enuOffset(origin, ring[i][0], ring[i][1]);
      var off = nearestOnRoute(rp.x, rp.z, origin);
      if (off.dist < nearest) {
        nearest = off.dist;
        nx = off.nx;
        nz = off.nz;
      }
    }
    for (guard = 0; guard < 10; guard++) {
      nearest = 1e9;
      for (i = 0; i < ring.length; i++) {
        var rp2 = enuOffset(origin, ring[i][0], ring[i][1]);
        var off2 = nearestOnRoute(rp2.x + nx * push, rp2.z + nz * push, origin);
        if (off2.dist < nearest) nearest = off2.dist;
      }
      if (nearest >= want) break;
      push += want - nearest + 1.5;
    }
    if (nearest < 14) return null;
    g.position.x += nx * push;
    g.position.z += nz * push;
    var cx = 0;
    var cz = 0;
    for (i = 0; i < ring.length; i++) {
      var cp = enuOffset(origin, ring[i][0], ring[i][1]);
      cx += cp.x;
      cz += cp.z;
    }
    g.userData.cullX = cx / ring.length + g.position.x;
    g.userData.cullZ = cz / ring.length + g.position.z;
    g.userData.glass = wall;
    g.userData.edgeMat = edges.material;
    g.userData.wireMat = edges.material;
    g.userData.baseOpacity = 1;
    g.userData.baseEdge = 1;
    mesh.userData.building = g;
    return g;
  }

  function edgeLine(THREE, coords, origin, side, color) {
    var pts = [];
    var i;
    for (i = 0; i < coords.length; i++) {
      var p = enuOffset(origin, coords[i][0], coords[i][1]);
      if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.z - pts[pts.length - 1].z) > 1.4) {
        pts.push(p);
      }
    }
    if (pts.length < 2) return null;
    var pos = [];
    var off = 1.72 * side;
    for (i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)];
      var b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b.x - a.x;
      var dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      pos.push(pts[i].x + (-dz / len) * off, 0.1, pts[i].z + (dx / len) * off);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: color, linewidth: 2 })
    );
  }

  function signTexture(kind, label) {
    var c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    var g = c.getContext("2d");
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    g.lineWidth = kind === "cam" ? 10 : 14;
    g.strokeStyle = kind === "cam" ? "#111" : "#e11d2e";
    g.stroke();
    g.fillStyle = "#111";
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (kind === "cam") {
      g.beginPath();
      g.arc(64, 64, 16, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.font = "700 42px sans-serif";
      g.fillText(String(label || ""), 64, 66);
    }
    var tex = new api.THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function makeMarker(THREE, mark) {
    var g = new THREE.Group();
    var stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 4.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2a3c })
    );
    stem.position.y = 2.1;
    var disc = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({
        map: signTexture(mark.kind, mark.label),
        transparent: true,
        depthWrite: false
      })
    );
    disc.position.y = 4.4;
    g.add(stem);
    g.add(disc);
    g.userData.billboard = disc;
    return g;
  }

  function faceMarkers(root) {
    if (!root) return;
    root.children.forEach(function (g) {
      if (g.userData && g.userData.billboard) {
        g.userData.billboard.lookAt(0, g.userData.billboard.position.y, 0);
      }
    });
  }

  var routeCache = "";
  var markCache = "";
  var buildCache = "";

  function makeLayer() {
    var THREE = api.THREE;
    return {
      id: LAYER_ID,
      type: "custom",
      renderingMode: "3d",
      camera: null,
      scene: null,
      renderer: null,
      carRoot: null,
      carSlot: null,
      worldRoot: null,
      routeRoot: null,
      markRoot: null,
      buildRoot: null,
      sky: null,
      worldOrigin: null,
      onAdd: function (map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
        this.sky = makeSky(THREE);
        this.sky.scale.set(1, 0.42, 1);
        this.sky.position.y = 40;
        this.scene.add(this.sky);
        addStoryLights(THREE, this.scene);
        this.carRoot = new THREE.Group();
        this.carSlot = new THREE.Group();
        this.worldRoot = new THREE.Group();
        this.routeRoot = new THREE.Group();
        this.markRoot = new THREE.Group();
        this.buildRoot = new THREE.Group();
        this.envRoot = new THREE.Group();
        this.npcRoot = new THREE.Group();
        this.carRoot.add(this.carSlot);
        this.worldRoot.add(this.envRoot);
        this.worldRoot.add(this.npcRoot);
        this.worldRoot.add(this.routeRoot);
        this.worldRoot.add(this.markRoot);
        this.worldRoot.add(this.buildRoot);
        this.scene.add(this.carRoot);
        this.scene.add(this.worldRoot);
        this.stripMat = clayRoadMat(THREE);
        this.asphaltMats = [this.stripMat];
        this.map = map;
        try {
          this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
          });
        } catch (err) {
          console.warn("[NavCar3D] WebGL", err);
          this.renderer = null;
          return;
        }
        this.renderer.autoClear = false;
        if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = false;
        if (this.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
          this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        if (THREE.NoToneMapping !== undefined) this.renderer.toneMapping = THREE.NoToneMapping;
        this.envMap = null;
        this.scene.environment = null;
        this._matProj = new THREE.Matrix4();
        this._matLocal = new THREE.Matrix4();
        this._matRotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        this._scaleVec = new THREE.Vector3();
        this._matArr = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        putMesh(api.currentId || savedId());
      },
      onRemove: function () {
        showFallback();
        this.renderer = null;
      },
      render: function (gl, args) {
        if (api.arcade) return;
        if (!this.renderer || !this.camera || !this.scene || !this.map) return;
        var nowT = typeof performance !== "undefined" ? performance.now() : Date.now();
        var vis = lerpPose(nowT);
        var dt = this._lastT ? Math.min(0.08, Math.max(0.001, (nowT - this._lastT) / 1000)) : 0.016;
        this._lastT = nowT;
        var mc = maplibregl.MercatorCoordinate.fromLngLat([vis.lng, vis.lat], pose.alt);
        var scale = mc.meterInMercatorCoordinateUnits();
        var headingRad = ((180 - (Number(vis.heading) || 0)) * Math.PI) / 180;
        var leanRad = ((Number(vis.lean) || 0) * Math.PI) / 180;
        smoothCarPose(this.carRoot, this.worldRoot, this.worldOrigin, vis, headingRad, dt);
        if (this.carSlot) this.carSlot.rotation.z = lerpNum(this.carSlot.rotation.z, leanRad, expK(dt, TURN_TAU));
        stepRoadTextures(this.asphaltMats, dt);
        faceMarkers(this.markRoot);
        var raw =
          args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix
            ? args.defaultProjectionData.mainMatrix
            : args;
        if (!raw) return;
        var src = raw.length ? raw : raw.elements;
        if (!src) return;
        var i;
        var arr = this._matArr;
        for (i = 0; i < 16; i++) arr[i] = src[i];
        if (arr.some(function (n) { return !Number.isFinite(n); })) return;
        var m = this._matProj.fromArray(arr);
        var l = this._matLocal
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(this._scaleVec.set(scale, -scale, scale))
          .multiply(this._matRotX);
        this.camera.projectionMatrix = m.multiply(l);
        maybeStreamEnv(this);
        tickNpcs(this, dt);
        applyWorldLod(this.scene, this.worldRoot, this.buildRoot, this.markRoot, this.sky, this.envRoot);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.renderer.resetState();
        this.map.triggerRepaint();
      }
    };
  }

  api.ensure = function (map) {
    mapRef = map;
    if (!map) return Promise.resolve(false);
    return loadThree()
      .then(function () {
        if (!layer) layer = makeLayer();
        if (!map.getLayer(LAYER_ID)) {
          try {
            map.addLayer(layer);
          } catch (_e) {
            layer = makeLayer();
            map.addLayer(layer);
          }
        }
        try {
          map.resize();
        } catch (_r) {}
        if (!api.currentId) api.setModel(savedId(), true);
        return true;
      })
      .catch(function (err) {
        console.warn("[NavCar3D]", err);
        showFallback();
        return false;
      });
  };

  api.setPose = function (lng, lat, heading, lean, speed) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    pose.lng = lng;
    pose.lat = lat;
    if (Number.isFinite(speed) && speed >= 0) pose.speed = speed;
    var kmh = (Number(pose.speed) || 0) * 3.6;
    if (Number.isFinite(heading)) {
      pose.heading = heading;
      pose.headingSeeded = true;
    }
    if (Number.isFinite(lean)) {
      pose.lean = lean;
    }
    if (mapRef) mapRef.triggerRepaint();
  };

  api.setSpeed = function (speed) {
    if (Number.isFinite(speed) && speed >= 0) pose.speed = speed;
  };

  function adoptOrigin(origin) {
    if (!layer || !origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return;
    layer.worldOrigin = { lng: origin.lng, lat: origin.lat };
    if (layer.worldRoot) layer.worldRoot.userData.poseLive = false;
    if (overlay.worldRoot) overlay.worldRoot.userData.poseLive = false;
  }

  api.setRoute = function (coords, origin) {
    var list = coords || [];
    lastWorld.coords = list;
    if (origin) lastWorld.origin = origin;
    if (api.arcade) syncOverlayWorld();
    if (!layer || !layer.routeRoot || !api.THREE) return;
    var key =
      list.length +
      ":" +
      (list[0] ? list[0][0].toFixed(5) + list[0][1].toFixed(5) : "x") +
      ":" +
      (list[list.length - 1] ? list[list.length - 1][0].toFixed(5) : "y");
    if (key === routeCache) return;
    routeCache = key;
    layer.asphaltMats = layer.stripMat ? [layer.stripMat] : [];
    clearGroup(layer.routeRoot);
    var here = origin || defaultOrigin();
    lastWorld.origin = here;
    adoptOrigin(here);
    if (list.length >= 2) {
      addClayRouteMeshes(api.THREE, layer.routeRoot, list, here, layer);
    }
    if (layer.envRoot) {
      clearGroup(layer.envRoot);
      layer.envRoot.userData.live = {};
      layer.envAnchorX = null;
      layer.envAnchorZ = null;
      maybeStreamEnv(layer);
    }
    if (layer.npcRoot) {
      layer.npcAnchorX = null;
      rebuildNpcs(layer);
    }
    syncClayPadRoad(layer, list.length >= 2);
    if (mapRef) mapRef.triggerRepaint();
  };

  api.setMarkers = function (marks, origin) {
    var list = marks || [];
    lastWorld.marks = list;
    if (origin) lastWorld.origin = origin;
    if (api.arcade) syncOverlayWorld();
    if (!layer || !layer.markRoot || !api.THREE) return;
    var key = list
      .map(function (m) {
        return m.kind + m.label + Math.round(m.lat * 1e4);
      })
      .join("|");
    if (key === markCache) return;
    markCache = key;
    clearGroup(layer.markRoot);
    if (!origin) return;
    adoptOrigin(origin);
    var THREE = api.THREE;
    list.forEach(function (mark) {
      var g = makeMarker(THREE, mark);
      var p = enuOffset(origin, mark.lng, mark.lat);
      g.position.set(p.x, 0, p.z);
      layer.markRoot.add(g);
    });
    if (mapRef) mapRef.triggerRepaint();
  };

  api.setBuildings = function (buildings, origin) {
    var list = buildings || [];
    lastWorld.buildings = list;
    if (origin) lastWorld.origin = origin;
    if (api.arcade) syncOverlayWorld();
    if (!layer || !layer.buildRoot || !api.THREE) return;
    var key =
      list.length +
      ":" +
      (origin ? origin.lat.toFixed(4) + origin.lng.toFixed(4) : "0") +
      ":" +
      (list[0] && list[0].ring && list[0].ring[0] ? list[0].ring[0][0].toFixed(4) : "x");
    if (key === buildCache) return;
    buildCache = key;
    clearGroup(layer.buildRoot);
    if (!origin) return;
    adoptOrigin(origin);
    var THREE = api.THREE;
    list.forEach(function (b) {
      var g = buildingGroup(THREE, b, origin);
      if (g) layer.buildRoot.add(g);
    });
    if (mapRef) mapRef.triggerRepaint();
  };

  var lastWorld = { coords: [], origin: null, marks: [], buildings: [], roads: [] };
  var overlayWorldKey = "";
  var overlay = {
    canvas: null,
    renderer: null,
    scene: null,
    camera: null,
    carRoot: null,
    carSlot: null,
    worldRoot: null,
    routeRoot: null,
    markRoot: null,
    buildRoot: null,
    roadRoot: null,
    envRoot: null,
    sky: null,
    asphaltMats: [],
    raycaster: null,
    hitBox: null,
    raf: 0,
    rt: null,
    postScene: null,
    postCam: null,
    postMat: null,
    blur: 0,
    lookBound: false,
    camBound: false,
    cabin: false,
    camBlend: 0,
    look: {
      enabled: false,
      yaw: 0,
      pitch: 0.38,
      dist: 15,
      down: false,
      px: 0,
      py: 0
    },
    lastT: 0,
    headingLive: false,
    tmp: null
  };

  function overlayTmp() {
    if (overlay.tmp && overlay.tmp.dashPos) return overlay.tmp;
    var THREE = api.THREE;
    overlay.tmp = {
      camLocal: new THREE.Vector3(),
      camPos: new THREE.Vector3(),
      camLook: new THREE.Vector3(),
      chasePos: new THREE.Vector3(),
      chaseLook: new THREE.Vector3(),
      dashPos: new THREE.Vector3(),
      dashLook: new THREE.Vector3(),
      carPos: new THREE.Vector3(),
      lookFar: new THREE.Vector3(),
      rayDelta: new THREE.Vector3(),
      ndc: new THREE.Vector3()
    };
    return overlay.tmp;
  }

  function kmhNow() {
    return (Number(pose.speed) || 0) * 3.6;
  }

  function bootSpeedBlur(THREE, renderer, w, h) {
    if (!renderer || !THREE.WebGLRenderTarget) return;
    try {
      var pr = Math.min(1.5, renderer.getPixelRatio ? renderer.getPixelRatio() : 1);
      overlay.rt = new THREE.WebGLRenderTarget(Math.max(2, Math.floor(w * pr)), Math.max(2, Math.floor(h * pr)));
      if (overlay.rt.texture && THREE.LinearFilter) {
        overlay.rt.texture.minFilter = THREE.LinearFilter;
        overlay.rt.texture.magFilter = THREE.LinearFilter;
      }
      overlay.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      overlay.postMat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uStrength: { value: 0 },
          uCenter: { value: new THREE.Vector2(0.5, 0.42) }
        },
        vertexShader:
          "varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "uniform sampler2D tDiffuse; uniform float uStrength; uniform vec2 uCenter;\n" +
          "varying vec2 vUv;\n" +
          "void main(){\n" +
          "  vec2 d = vUv - uCenter;\n" +
          "  float radial = length(d * vec2(1.62, 0.68));\n" +
          "  float mask = smoothstep(0.08, 0.46, radial);\n" +
          "  float str = uStrength * mask;\n" +
          "  vec4 col = texture2D(tDiffuse, vUv);\n" +
          "  if (str < 0.003) { gl_FragColor = col; return; }\n" +
          "  float acc = 1.0;\n" +
          "  for (int i = 1; i <= 8; i++) {\n" +
          "    float t = float(i) / 8.0;\n" +
          "    col += texture2D(tDiffuse, vUv - d * str * t * 0.24);\n" +
          "    acc += 1.0;\n" +
          "  }\n" +
          "  gl_FragColor = col / acc;\n" +
          "}"
      });
      overlay.postMat.depthTest = false;
      overlay.postMat.depthWrite = false;
      overlay.postScene = new THREE.Scene();
      overlay.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlay.postMat));
    } catch (_e) {
      overlay.rt = null;
      overlay.postMat = null;
    }
  }

  function resizeSpeedBlur(w, h) {
    if (!overlay.rt || !overlay.renderer) return;
    var pr = Math.min(1.5, overlay.renderer.getPixelRatio ? overlay.renderer.getPixelRatio() : 1);
    overlay.rt.setSize(Math.max(2, Math.floor(w * pr)), Math.max(2, Math.floor(h * pr)));
  }

  function renderOverlay(camLook) {
    var r = overlay.renderer;
    var THREE = api.THREE;
    var kmh = kmhNow();
    var t = Math.max(0, Math.min(1, (kmh - 0.5) / 88));
    var want = t * t * 0.7;
    overlay.blur = overlay.blur * 0.8 + want * 0.2;
    var useBlur = overlay.rt && overlay.postMat && overlay.postScene && overlay.blur > 0.012 && kmh >= 1;
    if (useBlur) {
      if (overlay.postMat.uniforms.uCenter && camLook) {
        var ndc = overlayTmp().ndc.copy(camLook).project(overlay.camera);
        overlay.postMat.uniforms.uCenter.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
      }
      overlay.postMat.uniforms.uStrength.value = overlay.blur;
      overlay.postMat.uniforms.tDiffuse.value = overlay.rt.texture;
      var tm = r.toneMapping;
      var enc = r.outputEncoding;
      r.setRenderTarget(overlay.rt);
      if (THREE.LinearEncoding) r.outputEncoding = THREE.LinearEncoding;
      r.render(overlay.scene, overlay.camera);
      r.setRenderTarget(null);
      r.toneMapping = THREE.NoToneMapping || 0;
      if (THREE.sRGBEncoding) r.outputEncoding = THREE.sRGBEncoding;
      r.render(overlay.postScene, overlay.postCam);
      r.toneMapping = tm;
      if (enc !== undefined) r.outputEncoding = enc;
      return;
    }
    r.render(overlay.scene, overlay.camera);
  }

  function syncLookUi() {
    var btn = document.getElementById("lookAroundBtn");
    var canvas = overlay.canvas || document.getElementById("arcade3d");
    var stopped = !!(api.arcade && kmhNow() < 1);
    var app = document.getElementById("app");
    if (app) app.classList.toggle("is-arcade-stopped", stopped);
    if (!stopped && overlay.look.enabled) {
      overlay.look.enabled = false;
      overlay.look.yaw = 0;
      overlay.look.pitch = 0.38;
      overlay.look.down = false;
    }
    if (btn) {
      btn.hidden = !stopped || !!overlay.cabin;
      btn.classList.toggle("is-on", stopped && overlay.look.enabled && !overlay.cabin);
      btn.setAttribute("aria-pressed", stopped && overlay.look.enabled && !overlay.cabin ? "true" : "false");
    }
    if (canvas) {
      canvas.style.pointerEvents = stopped && overlay.look.enabled ? "auto" : "none";
      canvas.style.touchAction = stopped && overlay.look.enabled ? "none" : "";
    }
  }

  function onLookDown(ev) {
    if (!overlay.look.enabled || kmhNow() >= 1) return;
    overlay.look.down = true;
    overlay.look.px = ev.clientX;
    overlay.look.py = ev.clientY;
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch (_e) {}
    ev.preventDefault();
  }

  function onLookMove(ev) {
    if (!overlay.look.down || !overlay.look.enabled) return;
    var dx = ev.clientX - overlay.look.px;
    var dy = ev.clientY - overlay.look.py;
    overlay.look.px = ev.clientX;
    overlay.look.py = ev.clientY;
    overlay.look.yaw -= dx * 0.005;
    overlay.look.pitch = Math.max(0.12, Math.min(1.22, overlay.look.pitch + dy * 0.004));
    ev.preventDefault();
  }

  function onLookUp(ev) {
    overlay.look.down = false;
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    } catch (_e) {}
  }

  function bindLookUi() {
    if (overlay.lookBound) return;
    overlay.lookBound = true;
    var btn = document.getElementById("lookAroundBtn");
    on(btn, "click", function () {
      if (kmhNow() >= 1) return;
      overlay.look.enabled = !overlay.look.enabled;
      if (!overlay.look.enabled) {
        overlay.look.yaw = 0;
        overlay.look.pitch = 0.38;
      }
      syncLookUi();
    });
    var canvas = document.getElementById("arcade3d");
    if (!canvas) return;
    on(canvas, "pointerdown", onLookDown);
    on(canvas, "pointermove", onLookMove);
    on(canvas, "pointerup", onLookUp);
    on(canvas, "pointercancel", onLookUp);
  }

  function setExteriorVisible(host, show) {
    if (!host) return;
    if (host.carSlot) host.carSlot.visible = !!show;
    if (host.carRoot) {
      host.carRoot.children.forEach(function (child) {
        if (child.userData && child.userData.contactShadow) child.visible = !!show;
      });
    }
  }

  function syncCamUi() {
    var btn = document.getElementById("camViewBtn");
    if (!btn) return;
    var onCabin = !!overlay.cabin;
    btn.classList.toggle("is-on", onCabin);
    btn.setAttribute("aria-pressed", onCabin ? "true" : "false");
    btn.title = onCabin ? "Belső nézet — koppints a külsőhöz" : "Külső nézet — koppints a belsőhöz";
  }

  function bindCamUi() {
    if (overlay.camBound) return;
    overlay.camBound = true;
    on(document.getElementById("camViewBtn"), "click", function () {
      overlay.cabin = !overlay.cabin;
      if (overlay.cabin) overlay.look.enabled = false;
      syncCamUi();
      syncLookUi();
    });
  }

  function syncOverlayWorld() {
    if (!overlay.scene || !api.THREE) return;
    var origin = lastWorld.origin || defaultOrigin();
    lastWorld.origin = origin;
    var list = lastWorld.coords || [];
    var key =
      list.length +
      ":" +
      (list[0] ? list[0][0].toFixed(5) : "x") +
      ":" +
      (lastWorld.marks || []).length +
      ":" +
      (lastWorld.buildings || []).length +
      ":" +
      (lastWorld.roads || []).length +
      ":" +
      origin.lat.toFixed(4) +
      origin.lng.toFixed(4);
    if (key === overlayWorldKey && overlay.routeRoot && overlay.routeRoot.children.length) {
      maybeStreamEnv(overlay);
      return;
    }
    overlayWorldKey = key;
    var THREE = api.THREE;
    overlay.worldOrigin = origin;
    overlay.asphaltMats = overlay.stripMat ? [overlay.stripMat] : [];
    clearGroup(overlay.routeRoot);
    clearGroup(overlay.markRoot);
    clearGroup(overlay.buildRoot);
    clearGroup(overlay.roadRoot);
    clearGroup(overlay.envRoot);
    overlay.envRoot.userData.live = {};
    overlay.envAnchorX = null;
    overlay.envAnchorZ = null;
    if (list.length >= 2) {
      addClayRouteMeshes(THREE, overlay.routeRoot, list, origin, overlay);
    }
    maybeStreamEnv(overlay);
    if (overlay.npcRoot) {
      overlay.npcAnchorX = null;
      rebuildNpcs(overlay);
    }
    syncClayPadRoad(overlay, list.length >= 2);
    (lastWorld.marks || []).forEach(function (mark) {
      var g = makeMarker(THREE, mark);
      var p = enuOffset(origin, mark.lng, mark.lat);
      g.position.set(p.x, 0, p.z);
      overlay.markRoot.add(g);
    });
  }

  function overlayPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, 1.5);
  }

  function bootOverlay() {
    var canvas = document.getElementById("arcade3d");
    if (!canvas || !api.THREE) return false;
    var THREE = api.THREE;
    overlay.canvas = canvas;
    var host = canvas.parentNode;
    var w = Math.max(320, canvas.clientWidth || (host && host.clientWidth) || window.innerWidth || 800);
    var h = Math.max(480, canvas.clientHeight || (host && host.clientHeight) || window.innerHeight || 1280);
    canvas.width = w;
    canvas.height = h;
    try {
      overlay.renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: false,
        failIfMajorPerformanceCaveat: false
      });
    } catch (err) {
      console.warn("[NavCar3D] overlay WebGL", err);
      overlay.renderer = null;
      return false;
    }
    overlay.renderer.setPixelRatio(overlayPixelRatio());
    overlay.renderer.setSize(w, h, false);
    overlay.renderer.setClearColor(FOG_COLOR, 1);
    if (overlay.renderer.shadowMap) overlay.renderer.shadowMap.enabled = false;
    if (overlay.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
      overlay.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    if (THREE.NoToneMapping !== undefined) overlay.renderer.toneMapping = THREE.NoToneMapping;
    overlay.envMap = null;
    overlay.scene = new THREE.Scene();
    overlay.scene.background = new THREE.Color(FOG_COLOR);
    overlay.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    overlay.sky = makeSky(THREE);
    overlay.scene.add(overlay.sky);
    addStoryLights(THREE, overlay.scene);
    overlay.carRoot = new THREE.Group();
    overlay.carSlot = new THREE.Group();
    overlay.worldRoot = new THREE.Group();
    overlay.routeRoot = new THREE.Group();
    overlay.markRoot = new THREE.Group();
    overlay.buildRoot = new THREE.Group();
    overlay.roadRoot = new THREE.Group();
    overlay.envRoot = new THREE.Group();
    overlay.npcRoot = new THREE.Group();
    overlay.carRoot.add(overlay.carSlot);
    overlay.worldRoot.add(overlay.envRoot);
    overlay.worldRoot.add(overlay.npcRoot);
    overlay.worldRoot.add(overlay.roadRoot);
    overlay.worldRoot.add(overlay.routeRoot);
    overlay.worldRoot.add(overlay.markRoot);
    overlay.worldRoot.add(overlay.buildRoot);
    overlay.scene.add(overlay.carRoot);
    overlay.scene.add(overlay.worldRoot);
    addDefaultClayPad(THREE, overlay.scene, overlay);
    overlay.stripMat = clayRoadMat(THREE);
    overlay.asphaltMats = [overlay.stripMat];
    applyWeatherToScene(overlay.scene, overlay.renderer);
    overlay.camera = new THREE.PerspectiveCamera(CAM_FOV_CHASE, w / Math.max(1, h), 0.2, CAM_FAR);
    overlay.camera.far = CAM_FAR;
    overlay.camera.updateProjectionMatrix();
    overlay.camBlend = overlay.cabin ? 1 : 0;
    bootSpeedBlur(THREE, overlay.renderer, w, h);
    bindLookUi();
    bindCamUi();
    syncCamUi();
    putOverlayCar(api.currentId || savedId());
    syncOverlayWorld();
    return true;
  }

  function putOverlayCar(id) {
    if (!overlay.carSlot || !api.THREE) return;
    fetchModel(id)
      .then(function (src) {
        if (!overlay.carSlot) return;
        while (overlay.carSlot.children.length) overlay.carSlot.remove(overlay.carSlot.children[0]);
        var mesh = cloneGltf(src);
        mesh.traverse(function (node) {
          if (node.isMesh && node.geometry) node.geometry = node.geometry.clone();
        });
        applyCarMaterials(mesh);
        alignAndFit(mesh);
        decorateCar(api.THREE, mesh);
        recenterOnFloor(mesh);
        overlay.carSlot.add(mesh);
        attachHeadlights(api.THREE, overlay.carSlot, mesh);
        installContactShadow(api.THREE, overlay.carRoot, mesh);
      })
      .catch(function () {});
  }

  function buildingFromHit(obj) {
    if (obj && obj.userData && obj.userData.building) return obj.userData.building;
    var p = obj && obj.parent;
    while (p) {
      if (p.userData && p.userData.glass) return p;
      p = p.parent;
    }
    return null;
  }

  function ghostBuilding(g) {
    if (!g || !g.userData || !g.userData.glass) return;
    g.userData.glass.transparent = true;
    g.userData.glass.opacity = 0.18;
    g.userData.glass.depthWrite = false;
    if (g.userData.edgeMat) g.userData.edgeMat.opacity = 1;
    if (g.userData.wireMat) g.userData.wireMat.opacity = 0.9;
  }

  function rayHits(from, to) {
    var tmp = overlayTmp();
    var delta = tmp.rayDelta.copy(to).sub(from);
    var len = delta.length();
    if (len < 0.3) return [];
    overlay.raycaster.set(from, delta.normalize());
    overlay.raycaster.near = 0.15;
    overlay.raycaster.far = len + 0.4;
    var hits = overlay.raycaster.intersectObjects(overlay.buildRoot.children, true);
    var kept = overlay._lodHits;
    if (!kept) kept = overlay._lodHits = [];
    kept.length = 0;
    var i;
    var hit;
    var bldg;
    for (i = 0; i < hits.length; i++) {
      hit = hits[i];
      if (!hit.object || hit.object.visible === false) continue;
      bldg = buildingFromHit(hit.object);
      if (bldg && bldg.visible === false) continue;
      kept.push(hit);
    }
    return kept;
  }

  function tickOverlay(now) {
    if (!api.arcade || !overlay.renderer || !overlay.camera) {
      overlay.raf = 0;
      return;
    }
    overlay.raf = requestAnimationFrame(tickOverlay);
    var nowT = now || performance.now();
    var dt = overlay.lastT ? Math.min(0.08, Math.max(0.001, (nowT - overlay.lastT) / 1000)) : 0.016;
    overlay.lastT = nowT;
    var vis = lerpPose(nowT);
    var headingRad = ((180 - (Number(vis.heading) || 0)) * Math.PI) / 180;
    var leanRad = ((Number(vis.lean) || 0) * Math.PI) / 180;
    smoothCarPose(overlay.carRoot, overlay.worldRoot, overlay.worldOrigin, vis, headingRad, dt);
    if (overlay.carSlot) overlay.carSlot.rotation.z = lerpNum(overlay.carSlot.rotation.z, leanRad, expK(dt, TURN_TAU));
    maybeStreamEnv(overlay);
    tickNpcs(overlay, dt);
    applyWorldLod(overlay.scene, overlay.worldRoot, overlay.buildRoot, overlay.markRoot, overlay.sky, overlay.envRoot);
    if (overlay.sky) overlay.sky.position.copy(overlay.camera.position);
    faceMarkers(overlay.markRoot);
    overlay.asphaltMats.forEach(function (m) {
      if (!m.uniforms || !m.uniforms.uHead) return;
      m.uniforms.uHead.value.set(-Math.sin(headingRad) * 0.2, 0.65, Math.cos(headingRad) * 1.6);
      m.uniforms.uHeadDir.value.set(-Math.sin(headingRad), -0.12, Math.cos(headingRad));
    });
    stepRoadTextures(overlay.asphaltMats, dt);
    var canvas = overlay.canvas;
    var cw = canvas.clientWidth || window.innerWidth;
    var ch = canvas.clientHeight || window.innerHeight;
    if (overlay.camBlend == null || !Number.isFinite(overlay.camBlend)) {
      overlay.camBlend = overlay.cabin ? 1 : 0;
    } else {
      overlay.camBlend = lerpNum(overlay.camBlend, overlay.cabin ? 1 : 0, expK(dt, CAM_BLEND_TAU));
    }
    var fov = lerpNum(CAM_FOV_CHASE, CAM_FOV_DASH, overlay.camBlend);
    var aspect = cw / Math.max(1, ch);
    if (
      overlay.camera.aspect !== aspect ||
      overlay.camera.fov !== fov ||
      overlay.camera.far !== CAM_FAR ||
      overlay.camera.near !== 0.2
    ) {
      overlay.camera.aspect = aspect;
      overlay.camera.fov = fov;
      overlay.camera.near = 0.2;
      overlay.camera.far = CAM_FAR;
      overlay.camera.updateProjectionMatrix();
    }
    if (canvas.width !== cw || canvas.height !== ch) {
      overlay.renderer.setSize(cw, ch, false);
      resizeSpeedBlur(cw, ch);
    }
    overlay.carRoot.updateMatrixWorld(true);
    var kmh = kmhNow();
    syncLookUi();
    var tmp = overlayTmp();
    var camPos = tmp.camPos;
    var camLook = tmp.camLook;
    var ck = expK(dt, CAM_TAU);
    if (overlay.camYaw == null || !Number.isFinite(overlay.camYaw)) {
      overlay.camYaw = overlay.carRoot.rotation.y;
    } else {
      overlay.camYaw = lerpRad(overlay.camYaw, overlay.carRoot.rotation.y, ck);
    }
    if (overlay.look.enabled && kmh < 1 && overlay.camBlend < 0.35) {
      var yaw = overlay.look.yaw;
      var pitch = overlay.look.pitch;
      var dist = overlay.look.dist;
      overlay.carRoot.localToWorld(
        tmp.camLocal.set(
          Math.sin(yaw) * Math.cos(pitch) * dist,
          Math.sin(pitch) * dist + 1.2,
          -Math.cos(yaw) * Math.cos(pitch) * dist
        )
      );
      camPos.copy(tmp.camLocal);
      overlay.carRoot.localToWorld(camLook.set(0, 1.05, 0));
    } else {
      var cy = overlay.camYaw;
      var ox = overlay.carRoot.position.x;
      var oy = overlay.carRoot.position.y;
      var oz = overlay.carRoot.position.z;
      tmp.chasePos.set(ox - Math.sin(cy) * CAM_BACK, oy + CAM_HEIGHT, oz - Math.cos(cy) * CAM_BACK);
      tmp.chaseLook.set(ox + Math.sin(cy) * CAM_LOOK, oy + 0.35, oz + Math.cos(cy) * CAM_LOOK);
      tmp.dashPos.set(ox + Math.sin(cy) * CAM_DASH_FWD, oy + CAM_DASH_HEIGHT, oz + Math.cos(cy) * CAM_DASH_FWD);
      tmp.dashLook.set(ox + Math.sin(cy) * CAM_DASH_LOOK, oy + 0.62, oz + Math.cos(cy) * CAM_DASH_LOOK);
      camPos.lerpVectors(tmp.chasePos, tmp.dashPos, overlay.camBlend);
      camLook.lerpVectors(tmp.chaseLook, tmp.dashLook, overlay.camBlend);
    }
    setExteriorVisible(overlay, overlay.camBlend < 0.55);
    overlay.camera.position.copy(camPos);
    overlay.camera.lookAt(camLook);
    try {
      renderOverlay(camLook);
    } catch (_draw) {
      failArcadeOverlay();
    }
  }

  function dropOverlay() {
    if (overlay.raf) cancelAnimationFrame(overlay.raf);
    overlay.raf = 0;
    if (overlay.renderer) {
      try { overlay.renderer.dispose(); } catch (_e) {}
    }
    if (overlay.rt) {
      try { overlay.rt.dispose(); } catch (_rt) {}
    }
    overlay.rt = null;
    overlay.postScene = null;
    overlay.postCam = null;
    overlay.postMat = null;
    overlay.blur = 0;
    overlay.look.enabled = false;
    overlay.look.down = false;
    overlay.renderer = null;
    overlay.scene = null;
    overlay.camera = null;
    overlay.carRoot = null;
    overlay.carSlot = null;
    overlay.worldRoot = null;
    overlay.routeRoot = null;
    overlay.markRoot = null;
    overlay.buildRoot = null;
    overlay.roadRoot = null;
    overlay.envRoot = null;
    overlay.npcRoot = null;
    overlay.npcs = [];
    overlay.clayPad = null;
    overlay.smoothCam = null;
    overlay.camYaw = null;
    overlay.camBlend = overlay.cabin ? 1 : 0;
    overlay.sky = null;
    overlay.stripMat = null;
    overlay.asphaltMats = [];
    overlay.lastT = 0;
    overlayWorldKey = "";
  }

  function setArcadeLive(on) {
    api.arcade = !!on;
    document.documentElement.classList.toggle("is-arcade3d", !!on);
    if (typeof api.onArcadeLive === "function") {
      try {
        api.onArcadeLive(!!on);
      } catch (_cb) {}
    }
    if (mapRef) mapRef.triggerRepaint();
  }

  function failArcadeOverlay() {
    var canvas = document.getElementById("arcade3d");
    if (canvas) {
      canvas.hidden = true;
      canvas.style.pointerEvents = "none";
    }
    dropOverlay();
    setArcadeLive(false);
    syncLookUi();
  }

  api.setRoads = function (roads, origin) {
    lastWorld.roads = roads || [];
    if (origin) lastWorld.origin = origin;
    if (api.arcade) syncOverlayWorld();
  };

  api.setArcade = function (on) {
    var canvas = document.getElementById("arcade3d");
    if (!on) {
      failArcadeOverlay();
      return;
    }
    stopGarage();
    if (canvas) {
      canvas.hidden = false;
      canvas.removeAttribute("hidden");
    }
    bindLookUi();
    bindCamUi();
    syncCamUi();
    if (overlay.renderer && overlay.raf) {
      setArcadeLive(true);
      return;
    }
    function startOverlay() {
      loadThree()
        .then(function () {
          if (!canvas || canvas.hidden) return;
          if (overlay.renderer && overlay.raf) {
            setArcadeLive(true);
            return;
          }
          var ok = false;
          try {
            ok = !!bootOverlay();
          } catch (_boot) {
            ok = false;
          }
          if (!ok) {
            failArcadeOverlay();
            return;
          }
          try {
            on(
              canvas,
              "webglcontextlost",
              function (ev) {
                try {
                  ev.preventDefault();
                } catch (_p) {}
                failArcadeOverlay();
              },
              { once: true }
            );
          } catch (_l) {}
          setArcadeLive(true);
          if (!overlay.raf) overlay.raf = requestAnimationFrame(tickOverlay);
        })
        .catch(function () {
          failArcadeOverlay();
        });
    }
    if (!canvas || canvas.clientWidth < 2 || canvas.clientHeight < 2) {
      requestAnimationFrame(startOverlay);
    } else {
      startOverlay();
    }
  };

  api.setTraffic = function (samples, apply) {
    lastWorld.traffic = samples || [];
    if (apply === false) return lastWorld.traffic.length;
    overlayWorldKey = "";
    routeCache = "";
    if (api.arcade) syncOverlayWorld();
    if (layer && layer.routeRoot && lastWorld.coords && lastWorld.coords.length >= 2) {
      api.setRoute(lastWorld.coords, lastWorld.origin);
    }
    if (overlay.npcRoot) rebuildNpcs(overlay);
    if (layer && layer.npcRoot) rebuildNpcs(layer);
    return lastWorld.traffic.length;
  };

  api.trafficPace = function () {
    var hit = nearestNpcAhead();
    var pace = 1;
    if (hit && hit.level >= 0.38) pace = hit.level >= 0.65 ? 0.22 : 0.55;
    if (hit && hit.npc && hit.gap < 28) {
      if (hit.gap < 8) pace = Math.min(pace, 0.08);
      else if (hit.gap < 16) pace = Math.min(pace, 0.32);
      else pace = Math.min(pace, 0.62);
    }
    return pace;
  };

  api.setWeather = function (code, temp) {
    weather.code = Number(code) || 0;
    weather.temp = Number.isFinite(temp) ? temp : weather.temp;
    weather.kind = weatherKind(weather.code);
    if (overlay.scene) {
      applyWeatherToScene(overlay.scene, overlay.renderer);
      refreshSky(overlay);
    }
    if (layer && layer.scene) {
      applyWeatherToScene(layer.scene, layer.renderer);
      refreshSky(layer);
    }
    return weather.kind;
  };

  api.toggleCabin = function (on) {
    if (on == null) overlay.cabin = !overlay.cabin;
    else overlay.cabin = !!on;
    if (overlay.cabin) overlay.look.enabled = false;
    syncCamUi();
    syncLookUi();
    return overlay.cabin;
  };

  api.setModel = function (id, skipStore) {
    if (!carModels[id]) id = "verso";
    api.currentId = id;
    if (!skipStore) persist(id);
    showFallback();
    if (layer && layer.carRoot) putMesh(id);
    else if (mapRef) api.ensure(mapRef);
    if (api.arcade) putOverlayCar(id);
    return id;
  };

  api.id = function () {
    return api.currentId || savedId();
  };

  api.iconSvg = iconSvg;
  api.garageKey = GARAGE_KEY;
  api.chibiScale = CHIBI_SCALE;

  var garage = {
    raf: 0,
    renderer: null,
    scene: null,
    camera: null,
    light: null,
    yaw: 0.85,
    last: 0,
    items: [],
    root: null,
    carSlot: null
  };

  function stopGarage() {
    try {
      if (garage.raf) {
        cancelAnimationFrame(garage.raf);
        garage.raf = 0;
      }
      garage.items = [];
      if (garage.root && garage.root.parentNode) garage.root.removeChild(garage.root);
      if (garage.renderer) {
        try {
          garage.renderer.dispose();
        } catch (_e) {}
      }
    } catch (_stop) {}
    garage.renderer = null;
    garage.scene = null;
    garage.camera = null;
    garage.root = null;
    garage.carSlot = null;
  }

  function fitPreview(model) {
    var THREE = api.THREE;
    model.rotation.set(0, 0, 0);
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    model.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    var longest = Math.max(size.x, size.z, 0.001);
    model.scale.setScalar(1.85 / longest);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    var c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z);
  }

  function tickGarage(now) {
    if (!garage.renderer || !garage.items.length) return;
    if (now - garage.last < 40) {
      garage.raf = requestAnimationFrame(tickGarage);
      return;
    }
    garage.last = now;
    garage.yaw += 0.01;
    garage.items.forEach(function (item) {
      if (!item.mesh || !item.ctx || !item.canvas) return;
      while (garage.carSlot.children.length) garage.carSlot.remove(garage.carSlot.children[0]);
      item.mesh.rotation.y = garage.yaw;
      garage.carSlot.add(item.mesh);
      var w = item.canvas.width;
      var h = item.canvas.height;
      garage.camera.aspect = w / Math.max(1, h);
      garage.camera.updateProjectionMatrix();
      garage.renderer.setSize(w, h, false);
      garage.renderer.render(garage.scene, garage.camera);
      item.ctx.clearRect(0, 0, w, h);
      item.ctx.drawImage(garage.renderer.domElement, 0, 0, w, h);
    });
    garage.raf = requestAnimationFrame(tickGarage);
  }

  api.stopGarage = stopGarage;

  api.mountGarage = function (grid) {
    stopGarage();
    if (!grid) return;
    loadThree()
      .then(function () {
        var THREE = api.THREE;
        var canvases = grid.querySelectorAll("canvas[data-car-preview]");
        if (!canvases.length) return;
        var host = document.createElement("div");
        host.style.cssText = "position:absolute;left:-999px;top:-999px;width:4px;height:4px;overflow:hidden;";
        document.body.appendChild(host);
        garage.root = host;
        garage.renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true
        });
        garage.renderer.setClearColor(0x000000, 0);
        garage.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        if (garage.renderer.shadowMap) garage.renderer.shadowMap.enabled = false;
        if (garage.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
          garage.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        if (THREE.NoToneMapping !== undefined) garage.renderer.toneMapping = THREE.NoToneMapping;
        garage.envMap = null;
        host.appendChild(garage.renderer.domElement);
        garage.scene = new THREE.Scene();
        garage.scene.add(new THREE.AmbientLight(0xf2f6ff, 0.95));
        garage.scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x1a1c22, 0.75));
        var key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(2.4, 3.2, 2.8);
        garage.scene.add(key);
        var rim = new THREE.DirectionalLight(0xffe4c8, 0.6);
        rim.position.set(-2.2, 1.4, -1.6);
        garage.scene.add(rim);
        garage.carSlot = new THREE.Group();
        garage.scene.add(garage.carSlot);
        var disc = new THREE.Mesh(
          new THREE.CircleGeometry(0.95, 28),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38 })
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.01;
        garage.scene.add(disc);
        garage.camera = new THREE.PerspectiveCamera(28, 1.6, 0.1, 20);
        garage.camera.position.set(1.85, 1.2, 2.35);
        garage.camera.lookAt(0, 0.32, 0);
        garage.yaw = 0.85;
        var ids = [];
        for (var i = 0; i < canvases.length; i++) ids.push(canvases[i].getAttribute("data-car-preview"));
        return Promise.all(
          ids.map(function (id, idx) {
            return fetchModel(id).then(function (src) {
              var mesh = cloneGltf(src);
              fitPreview(mesh);
              applyCarMaterials(mesh);
              var canvas = canvases[idx];
              var dpr = Math.min(2, window.devicePixelRatio || 1);
              var w = Math.max(160, Math.round((canvas.clientWidth || 160) * dpr));
              var h = Math.max(100, Math.round((canvas.clientHeight || 100) * dpr));
              canvas.width = w;
              canvas.height = h;
              garage.camera.aspect = w / h;
              garage.camera.updateProjectionMatrix();
              var wrap = canvas.parentNode;
              if (wrap) wrap.classList.add("is-3d");
              garage.items.push({
                id: id,
                mesh: mesh,
                canvas: canvas,
                ctx: canvas.getContext("2d")
              });
            });
          })
        );
      })
      .then(function () {
        if (!garage.items.length || !garage.renderer) return;
        garage.last = 0;
        garage.raf = requestAnimationFrame(tickGarage);
      })
      .catch(function (err) {
        console.warn("[NavCar3D] garage", err);
        stopGarage();
      });
  };

  global.NavCar3D = api;
  api.currentId = savedId();
  on(global, "carModelChanged", function (ev) {
    var id = ev && ev.detail;
    if (!id || !carModels[id]) id = "verso";
    if (id === api.currentId && api.ready && layer && layer.carSlot && layer.carSlot.children.length) {
      return;
    }
    api.setModel(id, true);
  });
  loadThree().catch(function (err) {
    console.warn("[NavCar3D] three", err);
    showFallback();
  });
})(window);
