(function (global) {
  "use strict";

  var GARAGE_KEY = "nav2_car_model";
  var LAYER_ID = "ego-car-3d";
  var TARGET_METERS = 3.6;
  var CHIBI_SCALE = 1.38;
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
      hint: "Zömök mini MPV",
      color: "#d4d7de",
      lamp: "#e11d48"
    },
    scross: {
      url: "./models/scross.glb",
      brand: "Suzuki",
      type: "Mini SX4 S-Cross",
      name: "Mini SX4 S-Cross",
      hint: "Króm rács, nagy kerekek",
      color: "#f3efe6",
      lamp: "#fb7185"
    },
    bmw3: {
      url: "./models/bmw3.glb",
      brand: "BMW",
      type: "Mini 3er / M3",
      name: "Mini 3er / M3",
      hint: "Dupla vese, sportos far",
      color: "#b7c0cb",
      lamp: "#ef4444"
    },
    merc_e: {
      url: "./models/merc_e.glb",
      brand: "Mercedes-Benz",
      type: "Mini E-Class",
      name: "Mini E-Class",
      hint: "Csillag-rács, LED-sáv",
      color: "#1c1f26",
      lamp: "#f87171"
    },
    korando: {
      url: "./models/korando.glb",
      brand: "SsangYong",
      type: "Mini Korando",
      name: "Mini Korando",
      hint: "Magas mini SUV",
      color: "#6a7180",
      lamp: "#dc2626"
    },
    golf: {
      url: "./models/golf.glb",
      brand: "Volkswagen",
      type: "Mini Golf",
      name: "Mini Golf",
      hint: "Pufi ferdehátú",
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

  var pose = { lng: 19.0402, lat: 47.4979, heading: 0, lean: 0, alt: 0.02 };
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
    /* GLB Y-up → Z-up aszfalt, 180° Z: a farok a haladási irányba. */
    model.rotation.x = Math.PI / 2;
    model.rotation.z = Math.PI;
    model.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    var longest = Math.max(size.x, size.y, size.z, 0.001);
    var s = (TARGET_METERS / longest) * CHIBI_SCALE;
    model.scale.setScalar(s);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    var center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= center.y;
    model.position.z -= box.min.z;
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
    loadingId = id;
    fetchModel(id)
      .then(function (src) {
        if (loadingId !== id || !layer.carRoot) return;
        while (layer.carRoot.children.length) layer.carRoot.remove(layer.carRoot.children[0]);
        var mesh = cloneGltf(src);
        var THREE = api.THREE;
        mesh.traverse(function (node) {
          if (!node.isMesh) return;
          node.frustumCulled = false;
          var mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(function (m) {
            if (!m) return;
            m.side = THREE.DoubleSide;
            if (typeof m.metalness === "number" && m.metalness > 0.45) m.metalness = 0.35;
            if (typeof m.roughness === "number" && m.roughness < 0.18) m.roughness = 0.22;
            if (m.emissive && m.color && m.emissive.getHex && m.emissive.getHex() === 0) {
              m.emissive = m.color.clone().multiplyScalar(0.12);
            }
          });
        });
        alignAndFit(mesh);
        layer.carRoot.add(mesh);
        api.currentId = id;
        hideFallback();
        if (mapRef) mapRef.triggerRepaint();
      })
      .catch(function (err) {
        console.warn("[NavCar3D] modell", id, err);
        showFallback();
      });
  }

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
      onAdd: function (map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.scene.add(new THREE.AmbientLight(0xe8eef8, 0.72));
        this.scene.add(new THREE.HemisphereLight(0x9ec9ff, 0x1a1c22, 0.55));
        var sun = new THREE.DirectionalLight(0xffffff, 1.7);
        sun.position.set(5, 18, -16);
        this.scene.add(sun);
        var fill = new THREE.DirectionalLight(0xffd8c0, 0.4);
        fill.position.set(-8, 6, 8);
        this.scene.add(fill);
        var rim = new THREE.DirectionalLight(0xffffff, 0.85);
        rim.position.set(0, 10, -22);
        this.scene.add(rim);
        this.carRoot = new THREE.Group();
        this.scene.add(this.carRoot);
        this.map = map;
        try {
          this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
          });
        } catch (err) {
          console.warn("[NavCar3D] WebGL", err);
          this.renderer = null;
          return;
        }
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.autoClear = true;
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        if (this.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
          this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        var el = this.renderer.domElement;
        el.className = "car3d-canvas";
        el.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";
        map.getCanvasContainer().appendChild(el);
        putMesh(api.currentId || savedId());
      },
      onRemove: function () {
        showFallback();
        if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        if (this.renderer) this.renderer.dispose();
        this.renderer = null;
      },
      render: function (gl, args) {
        if (!this.renderer || !this.camera || !this.scene || !this.map) return;
        var mc = maplibregl.MercatorCoordinate.fromLngLat([pose.lng, pose.lat], pose.alt);
        var scale = mc.meterInMercatorCoordinateUnits();
        var headingRad = (-(Number(pose.heading) || 0) * Math.PI) / 180;
        var leanRad = ((Number(pose.lean) || 0) * Math.PI) / 180;
        var raw =
          args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix
            ? args.defaultProjectionData.mainMatrix
            : args;
        if (!raw) return;
        var arr = raw.length ? Array.prototype.slice.call(raw, 0, 16) : (raw.elements ? Array.prototype.slice.call(raw.elements, 0, 16) : []);
        if (!arr.length || arr.some(function (n) { return !Number.isFinite(n); })) return;
        var canvas = this.map.getCanvas();
        var w = canvas.clientWidth || canvas.width;
        var h = canvas.clientHeight || canvas.height;
        this.renderer.setSize(w, h, false);
        var m = new THREE.Matrix4().fromArray(arr);
        var l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), headingRad))
          .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), leanRad));
        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.render(this.scene, this.camera);
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

  api.setModel = function (id, skipStore) {
    if (!carModels[id]) id = "verso";
    api.currentId = id;
    if (!skipStore) persist(id);
    showFallback();
    if (layer && layer.carRoot) putMesh(id);
    else if (mapRef) api.ensure(mapRef);
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
    var longest = Math.max(size.x, size.y, size.z, 0.001);
    model.scale.setScalar(1.42 / longest);
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
        host.appendChild(garage.renderer.domElement);
        garage.scene = new THREE.Scene();
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
        garage.camera = new THREE.PerspectiveCamera(32, 1.6, 0.1, 20);
        garage.camera.position.set(1.55, 1.22, 2.15);
        garage.camera.lookAt(0, 0.48, 0);
        garage.yaw = 0.85;
        var ids = [];
        for (var i = 0; i < canvases.length; i++) ids.push(canvases[i].getAttribute("data-car-preview"));
        return Promise.all(
          ids.map(function (id, idx) {
            return fetchModel(id).then(function (src) {
              var mesh = cloneGltf(src);
              fitPreview(mesh);
              mesh.traverse(function (node) {
                if (!node.isMesh) return;
                var mats = Array.isArray(node.material) ? node.material : [node.material];
                mats.forEach(function (m) {
                  if (!m) return;
                  m.side = THREE.DoubleSide;
                });
              });
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
    if (id === api.currentId && api.ready && layer && layer.carRoot && layer.carRoot.children.length) {
      return;
    }
    api.setModel(id, true);
  });
  loadThree().catch(function (err) {
    console.warn("[NavCar3D] three", err);
    showFallback();
  });
})(window);
