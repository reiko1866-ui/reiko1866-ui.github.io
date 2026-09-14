(function (global) {
  "use strict";

  var GARAGE_KEY = "nav2_car_model";
  var LAYER_ID = "ego-car-3d";
  var TARGET_METERS = 7.2;
  var CHIBI_SCALE = 1;
  var THREE_LOCAL = "./vendor/three.min.js";
  var GLTF_LOCAL = "./vendor/GLTFLoader.js";
  var THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
  var GLTF_CDN = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js";

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

  var pose = { lng: 19.0402, lat: 47.4979, heading: 0, lean: 0, alt: 0 };
  var shown = { lng: 19.0402, lat: 47.4979, heading: 0, lean: 0, seeded: false };
  var lastPoseT = 0;

  function angDeltaDeg(from, to) {
    return ((to - from + 540) % 360) - 180;
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
    var dt = lastPoseT ? Math.min(0.05, Math.max(0.008, (now - lastPoseT) / 1000)) : 0.016;
    lastPoseT = now;
    var k = 1 - Math.exp(-dt / 0.1);
    shown.lng += (pose.lng - shown.lng) * k;
    shown.lat += (pose.lat - shown.lat) * k;
    shown.heading = (shown.heading + angDeltaDeg(shown.heading, pose.heading) * k + 360) % 360;
    shown.lean += (pose.lean - shown.lean) * k;
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
    copy.traverse(function (node) {
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
    copy.rotation.set(0, 0, 0);
    copy.position.set(0, 0, 0);
    copy.scale.set(1, 1, 1);
    return copy;
  }

  function alignAndFit(model) {
    var THREE = api.THREE;
    /* GLB marad Y-up: a kerekek az y=0 aszfalton. A Z-up váltás a MapLibre mátrixban van. */
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
    var room = new THREE.Scene();
    function glow(hex, intensity) {
      return new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: intensity,
        roughness: 1,
        metalness: 0
      });
    }
    var shell = new THREE.Mesh(
      new THREE.BoxGeometry(14, 10, 14),
      new THREE.MeshStandardMaterial({
        color: 0x1a2230,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.BackSide
      })
    );
    room.add(shell);
    var ceil = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), glow(0xf4f7ff, 5.5));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 4.6;
    room.add(ceil);
    var window = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.6), glow(0xffe4c2, 8));
    window.position.set(0, 0.9, -6.8);
    room.add(window);
    var warm = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5), glow(0xff7a3a, 4.2));
    warm.position.set(-6.8, 0.3, 0.8);
    warm.rotation.y = Math.PI / 2;
    room.add(warm);
    var cool = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5), glow(0x6ea8ff, 3.6));
    cool.position.set(6.8, 0.3, 0.8);
    cool.rotation.y = -Math.PI / 2;
    room.add(cool);
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.35, metalness: 0.4 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -4.8;
    room.add(floor);
    room.add(new THREE.AmbientLight(0xffffff, 0.35));
    var pmrem = new THREE.PMREMGenerator(renderer);
    var rt = pmrem.fromScene(room, 0.04, 0.1, 24);
    pmrem.dispose();
    return rt && rt.texture ? rt.texture : null;
    } catch (_e) {
      return null;
    }
  }

  function applyCarMaterials(mesh, envMap) {
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
        next = new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : color,
          map: map,
          metalness: 0.28,
          roughness: 0.48,
          envMap: envMap || null,
          envMapIntensity: 0.55
        });
      } else if (kind === "glass") {
        next = new THREE.MeshPhysicalMaterial({
          color: 0x152033,
          metalness: 0,
          roughness: 0.1,
          transmission: 0.8,
          thickness: 0.32,
          ior: 1.45,
          transparent: true,
          opacity: 1,
          envMap: envMap || null,
          envMapIntensity: 1.5,
          side: THREE.DoubleSide,
          depthWrite: false
        });
      } else if (kind === "lamp") {
        next = new THREE.MeshPhysicalMaterial({
          color: color,
          map: map,
          emissive: color.clone().multiplyScalar(0.8),
          emissiveIntensity: 2.4,
          roughness: 0.22,
          metalness: 0.1,
          envMap: envMap || null
        });
      } else {
        next = new THREE.MeshPhysicalMaterial({
          color: map ? 0xffffff : color,
          map: map,
          metalness: 0.8,
          roughness: 0.2,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          envMap: envMap || null,
          envMapIntensity: 1.35,
          reflectivity: 0.85
        });
      }
      if (src.normalMap) next.normalMap = src.normalMap;
      node.material = next;
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

  function decorateCar(THREE, mesh, envMap) {
    if (!mesh) return;
    var box = boxInLocal(THREE, mesh);
    var size = box.getSize(new THREE.Vector3());
    var c = box.getCenter(new THREE.Vector3());
    var glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x121c28,
      metalness: 0,
      roughness: 0.1,
      transmission: 0.8,
      thickness: 0.28,
      ior: 1.45,
      transparent: true,
      opacity: 1,
      envMap: envMap || null,
      envMapIntensity: 1.55,
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
    rear.position.set(c.x, box.min.y + size.y * 0.72, box.min.z + size.z * 0.16);
    rear.rotation.x = 0.48;
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
    var headMat = new THREE.MeshPhysicalMaterial({
      color: 0xfff3d0,
      emissive: 0xffe7a8,
      emissiveIntensity: 4.2,
      roughness: 0.12,
      metalness: 0.05,
      transmission: 0.35,
      transparent: true,
      envMap: envMap || null
    });
    var tailMat = new THREE.MeshPhysicalMaterial({
      color: 0xff1a3c,
      emissive: 0xff1028,
      emissiveIntensity: 3.6,
      roughness: 0.22,
      metalness: 0.08,
      envMap: envMap || null
    });
    var yLamp = box.min.y + size.y * 0.36;
    var xLamp = size.x * 0.3;
    var headGeo = new THREE.BoxGeometry(size.x * 0.16, size.y * 0.09, 0.1);
    var headL = new THREE.Mesh(headGeo, headMat);
    headL.position.set(-xLamp, yLamp, box.max.z - 0.04);
    var headR = new THREE.Mesh(headGeo, headMat);
    headR.position.set(xLamp, yLamp, box.max.z - 0.04);
    var tailGeo = new THREE.BoxGeometry(size.x * 0.18, size.y * 0.08, 0.08);
    var tailL = new THREE.Mesh(tailGeo, tailMat);
    tailL.position.set(-xLamp * 0.92, yLamp, box.min.z + 0.04);
    var tailR = new THREE.Mesh(tailGeo, tailMat);
    tailR.position.set(xLamp * 0.92, yLamp, box.min.z + 0.04);
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
    var zb = box.min.z + 0.02;
    var fx = new THREE.Group();
    fx.userData.carLights = true;
    var spotL = new THREE.SpotLight(0xfff1c8, 12, 46, 0.38, 0.35, 0.5);
    spotL.position.set(-xLamp, yLamp + 0.06, zf + 0.08);
    spotL.target.position.set(-xLamp * 0.3, 0.03, zf + 18);
    var spotR = new THREE.SpotLight(0xfff1c8, 12, 46, 0.38, 0.35, 0.5);
    spotR.position.set(xLamp, yLamp + 0.06, zf + 0.08);
    spotR.target.position.set(xLamp * 0.3, 0.03, zf + 18);
    fx.add(spotL);
    fx.add(spotL.target);
    fx.add(spotR);
    fx.add(spotR.target);
    var beamL = lightCone(THREE, 0xffe7b0, 16, 1.85, 0.12);
    beamL.position.set(-xLamp, yLamp, zf);
    var beamR = lightCone(THREE, 0xffe7b0, 16, 1.85, 0.12);
    beamR.position.set(xLamp, yLamp, zf);
    fx.add(beamL);
    fx.add(beamR);
    var tailGlow = new THREE.PointLight(0xff2244, 1.7, 9);
    tailGlow.position.set(0, yLamp, zb - 0.12);
    fx.add(tailGlow);
    var beamT = lightCone(THREE, 0xff2244, 5.2, 0.8, 0.15);
    beamT.rotation.y = Math.PI;
    beamT.position.set(0, yLamp, zb);
    fx.add(beamT);
    host.add(fx);
  }

  function installContactShadow(THREE, carRoot, mesh) {
    clearTagged(carRoot, "contactShadow");
    if (!carRoot || !mesh) return;
    mesh.updateMatrixWorld(true);
    var box = boxInParent(THREE, mesh, carRoot);
    var size = box.getSize(new THREE.Vector3());
    var shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(2.4, size.x * 1.18), Math.max(4.2, size.z * 1.14)),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(THREE),
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        fog: true
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.035, 0);
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
        applyCarMaterials(mesh, layer.envMap || (layer.scene && layer.scene.environment));
        alignAndFit(mesh);
        decorateCar(THREE, mesh, layer.envMap || (layer.scene && layer.scene.environment));
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
    var geo = new THREE.ConeGeometry(radius, len, 18, 1, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, len / 2);
    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
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
    var uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: tex },
        uHead: { value: new THREE.Vector3(0, 0.7, 1.8) },
        uHeadDir: { value: new THREE.Vector3(0, -0.08, 1) },
        uTail: { value: new THREE.Vector3(0, 0.5, -1.8) },
        uTime: { value: 0 }
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
        "uniform sampler2D uMap; uniform vec3 uHead; uniform vec3 uHeadDir; uniform vec3 uTail; uniform float uTime;\n" +
        "varying vec2 vUv; varying vec3 vWorld;\n" +
        "#include <fog_pars_fragment>\n" +
        "void main(){\n" +
        "  vec3 base = texture2D(uMap, vUv).rgb * 0.78;\n" +
        "  vec3 toP = vWorld - uHead;\n" +
        "  float dist = length(toP);\n" +
        "  float cone = pow(max(0.0, dot(normalize(toP + vec3(0.0001)), normalize(uHeadDir))), 16.0);\n" +
        "  float spot = cone * smoothstep(28.0, 4.0, dist);\n" +
        "  vec3 head = vec3(1.0, 0.93, 0.7) * spot * 0.85;\n" +
        "  float td = length(vWorld - uTail);\n" +
        "  vec3 tail = vec3(1.0, 0.1, 0.22) * smoothstep(10.0, 0.6, td) * 0.7;\n" +
        "  float pulse = 0.85 + 0.15 * sin(uTime * 6.0);\n" +
        "  gl_FragColor = vec4(base + head + tail * pulse, 1.0);\n" +
        "  #include <fog_fragment>\n" +
        "}"
    });
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

  function makeSky(THREE) {
    var c = document.createElement("canvas");
    c.width = 8;
    c.height = 256;
    var g = c.getContext("2d");
    var grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#01030a");
    grd.addColorStop(0.42, "#071428");
    grd.addColorStop(0.68, "#163c72");
    grd.addColorStop(0.84, "#c06a3e");
    grd.addColorStop(1, "#1a1a2e");
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
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(260, 28, 18), mat);
    mesh.renderOrder = -8;
    return mesh;
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

  function ribbonGeometry(THREE, coords, origin, width, y) {
    var pts = [];
    var i;
    var elev = y == null ? 0.08 : y;
    for (i = 0; i < coords.length; i++) {
      var p = enuOffset(origin, coords[i][0], coords[i][1]);
      if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.z - pts[pts.length - 1].z) > 1.4) {
        pts.push(p);
      }
    }
    if (pts.length < 2) return null;
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
    var glass = new THREE.MeshBasicMaterial({
      color: 0x3ec6f0,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: true
    });
    var mesh = new THREE.Mesh(geo, glass);
    mesh.renderOrder = 1;
    var wire = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0xb8ffff,
        wireframe: true,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        fog: true,
        blending: THREE.AdditiveBlending
      })
    );
    wire.renderOrder = 2;
    var edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 18),
      new THREE.LineBasicMaterial({
        color: 0xeaffff,
        transparent: true,
        opacity: 1,
        fog: true,
        blending: THREE.AdditiveBlending
      })
    );
    edges.renderOrder = 3;
    wire.raycast = function () {};
    edges.raycast = function () {};
    var g = new THREE.Group();
    g.add(mesh);
    g.add(wire);
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
    g.userData.glass = glass;
    g.userData.edgeMat = edges.material;
    g.userData.wireMat = wire.material;
    g.userData.baseOpacity = 0.2;
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
        this.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.015);
        this.sky = makeSky(THREE);
        this.sky.scale.set(1, 0.42, 1);
        this.sky.position.y = 40;
        this.scene.add(this.sky);
        this.scene.add(new THREE.AmbientLight(0x8aa0c0, 0.38));
        this.scene.add(new THREE.HemisphereLight(0x4a7ab0, 0x12141a, 0.42));
        var sun = new THREE.DirectionalLight(0xffd2b0, 0.55);
        sun.position.set(8, 22, -10);
        this.scene.add(sun);
        var fill = new THREE.DirectionalLight(0x6ea8ff, 0.22);
        fill.position.set(-10, 8, 12);
        this.scene.add(fill);
        this.carRoot = new THREE.Group();
        this.carSlot = new THREE.Group();
        this.worldRoot = new THREE.Group();
        this.routeRoot = new THREE.Group();
        this.markRoot = new THREE.Group();
        this.buildRoot = new THREE.Group();
        this.carRoot.add(this.carSlot);
        this.worldRoot.add(this.routeRoot);
        this.worldRoot.add(this.markRoot);
        this.worldRoot.add(this.buildRoot);
        this.scene.add(this.carRoot);
        this.scene.add(this.worldRoot);
        var asphalt = new THREE.Mesh(
          new THREE.PlaneGeometry(14, 90),
          new THREE.MeshStandardMaterial({
            map: asphaltTexture(THREE),
            color: 0xffffff,
            roughness: 0.92,
            metalness: 0.04
          })
        );
        asphalt.rotation.x = -Math.PI / 2;
        asphalt.position.set(0, 0.02, 18);
        asphalt.receiveShadow = true;
        this.carRoot.add(asphalt);
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
        if (this.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
          this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        if (THREE.ACESFilmicToneMapping) {
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 1.05;
        }
        this.envMap = makeStudioEnv(THREE, this.renderer);
        if (this.envMap) this.scene.environment = this.envMap;
        putMesh(api.currentId || savedId());
      },
      onRemove: function () {
        showFallback();
        this.renderer = null;
      },
      render: function (gl, args) {
        if (api.arcade) return;
        if (!this.renderer || !this.camera || !this.scene || !this.map) return;
        var vis = lerpPose(typeof performance !== "undefined" ? performance.now() : Date.now());
        var mc = maplibregl.MercatorCoordinate.fromLngLat([vis.lng, vis.lat], pose.alt);
        var scale = mc.meterInMercatorCoordinateUnits();
        var headingRad = ((180 - (Number(vis.heading) || 0)) * Math.PI) / 180;
        var leanRad = ((Number(vis.lean) || 0) * Math.PI) / 180;
        if (this.carRoot) this.carRoot.rotation.y = headingRad;
        if (this.carSlot) this.carSlot.rotation.z = leanRad;
        if (this.worldRoot && this.worldOrigin) {
          var w = enuOffset({ lng: vis.lng, lat: vis.lat }, this.worldOrigin.lng, this.worldOrigin.lat);
          this.worldRoot.position.set(w.x, 0, w.z);
        }
        faceMarkers(this.markRoot);
        var raw =
          args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix
            ? args.defaultProjectionData.mainMatrix
            : args;
        if (!raw) return;
        var arr = raw.length ? Array.prototype.slice.call(raw, 0, 16) : (raw.elements ? Array.prototype.slice.call(raw.elements, 0, 16) : []);
        if (!arr.length || arr.some(function (n) { return !Number.isFinite(n); })) return;
        var m = new THREE.Matrix4().fromArray(arr);
        var rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        var l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(rotationX);
        this.camera.projectionMatrix = m.multiply(l);
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

  api.setPose = function (lng, lat, heading, lean) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    pose.lng = lng;
    pose.lat = lat;
    if (Number.isFinite(heading)) pose.heading = heading;
    if (Number.isFinite(lean)) pose.lean = lean;
    if (mapRef) mapRef.triggerRepaint();
  };

  function adoptOrigin(origin) {
    if (!layer || !origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return;
    layer.worldOrigin = { lng: origin.lng, lat: origin.lat };
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
    layer.asphaltMats = [];
    clearGroup(layer.routeRoot);
    if (list.length < 2 || !origin) return;
    adoptOrigin(origin);
    var THREE = api.THREE;
    var road = ribbonGeometry(THREE, list, origin, 11.5, 0.04);
    if (road) {
      var roadMat = asphaltShader(THREE, asphaltTexture(THREE));
      layer.asphaltMats = layer.asphaltMats || [];
      layer.asphaltMats.push(roadMat);
      layer.routeRoot.add(new THREE.Mesh(road, roadMat));
    }
    var bloom = ribbonGeometry(THREE, list, origin, 5.6, 0.07);
    if (bloom) {
      layer.routeRoot.add(
        new THREE.Mesh(
          bloom,
          new THREE.MeshBasicMaterial({
            color: 0x00ff66,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
        )
      );
    }
    var body = ribbonGeometry(THREE, list, origin, 3.05, 0.11);
    if (body) {
      layer.routeRoot.add(
        new THREE.Mesh(
          body,
          new THREE.MeshBasicMaterial({
            color: 0x22ff77,
            transparent: true,
            opacity: 0.82,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
        )
      );
    }
    var yel = edgeLine(THREE, list, origin, -1, 0xf5c518);
    var wht = edgeLine(THREE, list, origin, 1, 0xf8fafc);
    if (yel) layer.routeRoot.add(yel);
    if (wht) layer.routeRoot.add(wht);
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
    sky: null,
    asphaltMats: [],
    raycaster: null,
    hitBox: null,
    raf: 0
  };

  function syncOverlayWorld() {
    if (!overlay.scene || !api.THREE || !lastWorld.origin) return;
    var origin = lastWorld.origin;
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
    if (key === overlayWorldKey && overlay.routeRoot && overlay.routeRoot.children.length) return;
    overlayWorldKey = key;
    var THREE = api.THREE;
    overlay.worldOrigin = origin;
    overlay.asphaltMats = [];
    clearGroup(overlay.routeRoot);
    clearGroup(overlay.markRoot);
    clearGroup(overlay.buildRoot);
    clearGroup(overlay.roadRoot);
    if (list.length >= 2) {
      var road = ribbonGeometry(THREE, list, origin, 12.2, 0.03);
      if (road) {
        var mat = asphaltShader(THREE, asphaltTexture(THREE));
        overlay.asphaltMats.push(mat);
        overlay.routeRoot.add(new THREE.Mesh(road, mat));
      }
      var bloom = ribbonGeometry(THREE, list, origin, 6.2, 0.08);
      if (bloom) {
        overlay.routeRoot.add(
          new THREE.Mesh(
            bloom,
            new THREE.MeshBasicMaterial({
              color: 0x00ff66,
              transparent: true,
              opacity: 0.28,
              side: THREE.DoubleSide,
              depthWrite: false,
              blending: THREE.AdditiveBlending
            })
          )
        );
      }
      var neon = ribbonGeometry(THREE, list, origin, 2.8, 0.13);
      if (neon) {
        overlay.routeRoot.add(
          new THREE.Mesh(
            neon,
            new THREE.MeshBasicMaterial({
              color: 0x66ffbb,
              transparent: true,
              opacity: 0.9,
              side: THREE.DoubleSide,
              depthWrite: false,
              blending: THREE.AdditiveBlending
            })
          )
        );
      }
      var yel = edgeLine(THREE, list, origin, -1, 0xf5c518);
      var wht = edgeLine(THREE, list, origin, 1, 0xf8fafc);
      if (yel) overlay.routeRoot.add(yel);
      if (wht) overlay.routeRoot.add(wht);
    }
    (lastWorld.roads || []).forEach(function (line) {
      if (!line || line.length < 2) return;
      var geo = ribbonGeometry(THREE, line, origin, 8.4, 0.01);
      if (!geo) return;
      var mat = asphaltShader(THREE, asphaltTexture(THREE));
      overlay.asphaltMats.push(mat);
      overlay.roadRoot.add(new THREE.Mesh(geo, mat));
    });
    (lastWorld.marks || []).forEach(function (mark) {
      var g = makeMarker(THREE, mark);
      var p = enuOffset(origin, mark.lng, mark.lat);
      g.position.set(p.x, 0, p.z);
      overlay.markRoot.add(g);
    });
    (lastWorld.buildings || []).forEach(function (b) {
      var g = buildingGroup(THREE, b, origin);
      if (g) overlay.buildRoot.add(g);
    });
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
    overlay.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false
    });
    overlay.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    overlay.renderer.setSize(w, h, false);
    overlay.renderer.setClearColor(0x1a1a2e, 1);
    if (overlay.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
      overlay.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    if (THREE.ACESFilmicToneMapping) {
      overlay.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      overlay.renderer.toneMappingExposure = 1.08;
    }
    overlay.scene = new THREE.Scene();
    overlay.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.015);
    overlay.sky = makeSky(THREE);
    overlay.scene.add(overlay.sky);
    overlay.scene.add(new THREE.AmbientLight(0x6f88aa, 0.32));
    overlay.scene.add(new THREE.HemisphereLight(0x3d6ca8, 0x0a0c10, 0.4));
    var sun = new THREE.DirectionalLight(0xffc8a0, 0.45);
    sun.position.set(10, 24, -8);
    overlay.scene.add(sun);
    overlay.envMap = makeStudioEnv(THREE, overlay.renderer);
    if (overlay.envMap) overlay.scene.environment = overlay.envMap;
    overlay.carRoot = new THREE.Group();
    overlay.carSlot = new THREE.Group();
    overlay.worldRoot = new THREE.Group();
    overlay.routeRoot = new THREE.Group();
    overlay.markRoot = new THREE.Group();
    overlay.buildRoot = new THREE.Group();
    overlay.roadRoot = new THREE.Group();
    overlay.carRoot.add(overlay.carSlot);
    overlay.worldRoot.add(overlay.roadRoot);
    overlay.worldRoot.add(overlay.routeRoot);
    overlay.worldRoot.add(overlay.markRoot);
    overlay.worldRoot.add(overlay.buildRoot);
    overlay.scene.add(overlay.carRoot);
    overlay.scene.add(overlay.worldRoot);
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(180, 48),
      new THREE.MeshStandardMaterial({ color: 0x07090e, roughness: 1, metalness: 0, envMapIntensity: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    overlay.scene.add(ground);
    var local = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 70),
      new THREE.MeshStandardMaterial({
        map: asphaltTexture(THREE),
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0.06,
        envMapIntensity: 0.15
      })
    );
    overlay.asphaltMats.push(local.material);
    local.rotation.x = -Math.PI / 2;
    local.position.set(0, 0.02, 16);
    overlay.carRoot.add(local);
    overlay.camera = new THREE.PerspectiveCamera(50, w / Math.max(1, h), 0.2, 320);
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
        applyCarMaterials(mesh, overlay.envMap);
        alignAndFit(mesh);
        decorateCar(api.THREE, mesh, overlay.envMap);
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
    g.userData.glass.opacity = 0.07;
    g.userData.glass.depthWrite = false;
    if (g.userData.edgeMat) g.userData.edgeMat.opacity = 1;
    if (g.userData.wireMat) g.userData.wireMat.opacity = 0.9;
  }

  function rayHits(from, to) {
    var delta = to.clone().sub(from);
    var len = delta.length();
    if (len < 0.3) return [];
    overlay.raycaster.set(from, delta.normalize());
    overlay.raycaster.near = 0.15;
    overlay.raycaster.far = len + 0.4;
    return overlay.raycaster.intersectObjects(overlay.buildRoot.children, true);
  }

  function tickOverlay(now) {
    if (!api.arcade || !overlay.renderer || !overlay.camera) {
      overlay.raf = 0;
      return;
    }
    overlay.raf = requestAnimationFrame(tickOverlay);
    var vis = lerpPose(now || performance.now());
    var headingRad = ((180 - (Number(vis.heading) || 0)) * Math.PI) / 180;
    var leanRad = ((Number(vis.lean) || 0) * Math.PI) / 180;
    overlay.carRoot.rotation.y = headingRad;
    overlay.carSlot.rotation.z = leanRad;
    if (overlay.worldOrigin) {
      var w = enuOffset({ lng: vis.lng, lat: vis.lat }, overlay.worldOrigin.lng, overlay.worldOrigin.lat);
      overlay.worldRoot.position.set(w.x, 0, w.z);
    }
    if (overlay.sky) overlay.sky.position.copy(overlay.camera.position);
    faceMarkers(overlay.markRoot);
    var t = (now || 0) / 1000;
    overlay.asphaltMats.forEach(function (m) {
      if (!m.uniforms) return;
      m.uniforms.uTime.value = t;
      var hx = Math.sin(headingRad) * 1.8;
      var hz = Math.cos(headingRad) * 1.8;
      m.uniforms.uHead.value.set(-Math.sin(headingRad) * 0.2, 0.7, hz);
      m.uniforms.uHeadDir.value.set(-Math.sin(headingRad), -0.08, Math.cos(headingRad));
      m.uniforms.uTail.value.set(Math.sin(headingRad) * 1.8, 0.5, -Math.cos(headingRad) * 1.8);
    });
    var canvas = overlay.canvas;
    var cw = canvas.clientWidth || window.innerWidth;
    var ch = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== cw || canvas.height !== ch) {
      overlay.renderer.setSize(cw, ch, false);
      overlay.camera.aspect = cw / Math.max(1, ch);
      overlay.camera.updateProjectionMatrix();
    }
    var up = new api.THREE.Vector3(0, 1, 0);
    var camPos = new api.THREE.Vector3(0, 2.35, -11.2).applyAxisAngle(up, headingRad);
    var camLook = new api.THREE.Vector3(0, 0.4, 14).applyAxisAngle(up, headingRad);
    var carPos = new api.THREE.Vector3(0, 1.15, 0);
    if (overlay.worldRoot) overlay.worldRoot.updateMatrixWorld(true);
    if (overlay.buildRoot) {
      overlay.buildRoot.children.forEach(function (g) {
        if (!g.userData.glass) return;
        g.userData.glass.opacity = g.userData.baseOpacity;
        g.userData.glass.depthWrite = false;
        if (g.userData.edgeMat) g.userData.edgeMat.opacity = g.userData.baseEdge;
        if (g.userData.wireMat) g.userData.wireMat.opacity = 0.88;
      });
      if (!overlay.raycaster) overlay.raycaster = new api.THREE.Raycaster();
      if (!overlay.hitBox) overlay.hitBox = new api.THREE.Box3();
      var i;
      var hits = rayHits(carPos, camPos);
      for (i = 0; i < hits.length; i++) ghostBuilding(buildingFromHit(hits[i].object));
      var step;
      for (step = 0; step < 8; step++) {
        hits = rayHits(carPos, camPos);
        if (!hits.length) break;
        camPos.y += 1.25;
      }
      if (hits.length) {
        var dir = camPos.clone().sub(carPos).normalize();
        var safe = Math.max(6.8, hits[0].distance - 1.1);
        camPos.copy(carPos).add(dir.multiplyScalar(safe));
        camPos.y = Math.max(camPos.y, 3.1);
      }
      overlay.buildRoot.children.forEach(function (g) {
        overlay.hitBox.setFromObject(g);
        if (overlay.hitBox.containsPoint(camPos)) {
          ghostBuilding(g);
          camPos.y = Math.max(camPos.y, overlay.hitBox.max.y + 1.15);
          if (camPos.distanceTo(carPos) > 8.2) camPos.lerp(carPos, 0.12);
        }
      });
      var lookFar = new api.THREE.Vector3(0, 0.4, 80).applyAxisAngle(up, headingRad);
      var block = rayHits(camPos, lookFar);
      for (i = 0; i < block.length; i++) ghostBuilding(buildingFromHit(block[i].object));
      if (block.length) camPos.y = Math.max(camPos.y, 3.4);
    }
    overlay.camera.position.copy(camPos);
    overlay.camera.lookAt(camLook);
    overlay.renderer.render(overlay.scene, overlay.camera);
  }

  function dropOverlay() {
    if (overlay.raf) cancelAnimationFrame(overlay.raf);
    overlay.raf = 0;
    if (overlay.renderer) {
      try { overlay.renderer.dispose(); } catch (_e) {}
    }
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
    overlay.sky = null;
    overlay.asphaltMats = [];
    overlayWorldKey = "";
  }

  api.setRoads = function (roads, origin) {
    lastWorld.roads = roads || [];
    if (origin) lastWorld.origin = origin;
    if (api.arcade) syncOverlayWorld();
  };

  api.setArcade = function (on) {
    api.arcade = !!on;
    var canvas = document.getElementById("arcade3d");
    document.documentElement.classList.toggle("is-arcade3d", !!on);
    if (!on) {
      if (canvas) canvas.hidden = true;
      dropOverlay();
      if (mapRef) mapRef.triggerRepaint();
      return;
    }
    if (canvas) canvas.hidden = false;
    if (overlay.renderer && overlay.raf) return;
    loadThree().then(function () {
      if (!api.arcade) return;
      if (overlay.renderer && overlay.raf) return;
      if (!overlay.renderer && !bootOverlay()) return;
      if (!overlay.raf) overlay.raf = requestAnimationFrame(tickOverlay);
    });
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
        garage.renderer.setPixelRatio(1);
        if (garage.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
          garage.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        if (THREE.ACESFilmicToneMapping) {
          garage.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          garage.renderer.toneMappingExposure = 1.1;
        }
        host.appendChild(garage.renderer.domElement);
        garage.scene = new THREE.Scene();
        garage.envMap = makeStudioEnv(THREE, garage.renderer);
        if (garage.envMap) garage.scene.environment = garage.envMap;
        garage.scene.add(new THREE.AmbientLight(0xf2f6ff, 0.9));
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
              applyCarMaterials(mesh, garage.envMap);
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
  global.addEventListener("carModelChanged", function (ev) {
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
