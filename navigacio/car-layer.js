(function (global) {
  "use strict";

  var GARAGE_KEY = "nav2_car_model";
  var LAYER_ID = "ego-car-3d";
  var TARGET_METERS = 4.6;
  var DASH_SCALE = 2.5;
  var THREE_LOCAL = "./vendor/three.min.js";
  var GLTF_LOCAL = "./vendor/GLTFLoader.js";
  var THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
  var GLTF_CDN = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js";

  var carModels = {
    verso: {
      url: "./models/verso.glb",
      brand: "Toyota",
      type: "Corolla Verso",
      name: "Toyota Corolla Verso",
      hint: "Saját modell",
      color: "#c8ccd1",
      lamp: "#e11d48"
    },
    scross: {
      url: "./models/scross.glb",
      brand: "Suzuki",
      type: "SX4 S-Cross",
      name: "Suzuki SX4 S-Cross",
      hint: "Króm hűtőmaszk és lámpák",
      color: "#f3f1ea",
      lamp: "#fb7185"
    },
    bmw3: {
      url: "./models/bmw3.glb",
      brand: "BMW",
      type: "3-as sorozat",
      name: "BMW 3-as sorozat",
      hint: "Dupla vese-rács és hátsó lámpák",
      color: "#bec5ce",
      lamp: "#ef4444"
    },
    merc_e: {
      url: "./models/merc_e.glb",
      brand: "Mercedes-Benz",
      type: "E-Class",
      name: "Mercedes-Benz E-Class",
      hint: "Csillag-rács, LED-sáv",
      color: "#2c3038",
      lamp: "#f87171"
    },
    korando: {
      url: "./models/korando.glb",
      brand: "SsangYong",
      type: "Korando",
      name: "SsangYong Korando",
      hint: "Magas SUV karosszéria",
      color: "#6a7180",
      lamp: "#dc2626"
    },
    golf: {
      url: "./models/golf.glb",
      brand: "Volkswagen",
      type: "Golf VII",
      name: "Volkswagen Golf VII",
      hint: "Kompakt ferdehátú",
      color: "#8f1d22",
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
      var id = String(localStorage.getItem(GARAGE_KEY) || "");
      if (carModels[id]) return id;
    } catch (_e) {}
    return "verso";
  }

  function persist(id) {
    try {
      localStorage.setItem(GARAGE_KEY, id);
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
    var tall = id === "verso" || id === "korando" || id === "scross";
    var roofY = tall ? 58 : 68;
    var bodyD =
      id === "golf"
        ? "M46 96c6-26 26-40 50-36 20 4 34 20 38 44l6 46c2 14-10 26-44 30-32 4-52-8-56-24z"
        : id === "bmw3" || id === "merc_e"
          ? "M48 98c8-24 26-36 50-32 18 3 32 16 36 40l8 46c2 14-10 26-46 30-34 4-52-8-56-22z"
          : "M46 88c8-26 26-38 52-34 18 3 32 16 36 42l8 50c2 16-10 28-46 32-34 4-54-8-58-24z";
    var lampShape =
      id === "merc_e" || id === "scross"
        ? '<rect x="54" y="132" width="72" height="8" rx="4" fill="' + lamp + '"/>'
        : id === "bmw3"
          ? '<path d="M56 128h28l4 18H54z" fill="' + lamp + '"/><path d="M96 126h28l-6 20H92z" fill="' + lamp + '"/>'
          : id === "verso" || id === "korando"
            ? '<rect x="52" y="118" width="14" height="36" rx="3" fill="' + lamp + '"/><rect x="114" y="116" width="14" height="36" rx="3" fill="' + lamp + '"/>'
            : '<rect x="54" y="130" width="28" height="12" rx="3" fill="' + lamp + '"/><rect x="98" y="128" width="28" height="12" rx="3" fill="' + lamp + '"/>';
    var chrome =
      id === "scross" || id === "merc_e"
        ? '<rect x="58" y="148" width="64" height="5" rx="2" fill="#dbe4ee"/>'
        : '<rect x="78" y="148" width="28" height="8" rx="1.5" fill="#111"/>';
    return (
      '<svg viewBox="0 0 160 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      "<defs>" +
      '<linearGradient id="p-' + uid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="' + paint + '"/>' +
      '<stop offset="1" stop-color="#64748b"/></linearGradient>' +
      '<linearGradient id="w-' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#93c5fd"/><stop offset="1" stop-color="#0f172a"/></linearGradient>' +
      "</defs>" +
      '<ellipse cx="84" cy="186" rx="46" ry="8" fill="rgba(0,0,0,.45)"/>' +
      '<path d="' + bodyD + '" fill="url(#p-' + uid + ')" stroke="#0f172a" stroke-width="1.4"/>' +
      '<path d="M60 ' + (roofY + 8) + "c8-16 24-24 40-20 12 3 22 14 26 28l4 16H56z" +
      '" fill="url(#w-' + uid + ')" opacity=".95"/>' +
      '<path d="M52 124h78l-3 12H56z" fill="#dbe3ee" opacity=".85"/>' +
      lampShape +
      chrome +
      '<ellipse cx="44" cy="118" rx="9" ry="5" fill="#f8fafc" stroke="#0f172a" stroke-width="1.2"/>' +
      '<ellipse cx="128" cy="112" rx="8" ry="4.5" fill="#f8fafc" stroke="#0f172a" stroke-width="1.2"/>' +
      '<ellipse cx="58" cy="168" rx="11" ry="6.5" fill="#111"/><ellipse cx="118" cy="162" rx="11" ry="6.5" fill="#111"/>' +
      '<path d="M70 ' + roofY + 'c10-6 24-6 34 0" fill="none" stroke="#cbd5e1" stroke-width="3"/>' +
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
    var s = (TARGET_METERS / longest) * DASH_SCALE;
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
          .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), -leanRad));
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

  global.NavCar3D = api;
  api.currentId = savedId();
  loadThree().catch(function (err) {
    console.warn("[NavCar3D] three", err);
    showFallback();
  });
})(window);
