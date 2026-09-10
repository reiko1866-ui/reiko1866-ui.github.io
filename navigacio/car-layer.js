(function (global) {
  "use strict";

  var GARAGE_KEY = "nav2_car_model";
  var LAYER_ID = "ego-car-3d";
  var THREE_ESM = "https://esm.sh/three@0.170.0";
  var GLTF_ESM = "https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";
  var THREE_UMD = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
  var GLTF_UMD = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js";

  var carModels = {
    verso: {
      url: "./models/verso.glb",
      name: "Toyota Corolla Verso",
      hint: "Saját modell",
      scale: 1.18,
      yaw: 0,
      color: "#c8ccd1"
    },
    scross: {
      url: "./models/scross.glb",
      name: "Suzuki SX4 S-Cross",
      hint: "Króm hűtőmaszk és lámpák",
      scale: 1.16,
      yaw: 0,
      color: "#f3f1ea"
    },
    bmw3: {
      url: "./models/bmw3.glb",
      name: "BMW 3-as sorozat",
      hint: "Dupla vese-rács és hátsó lámpák",
      scale: 1.2,
      yaw: 0,
      color: "#bec5ce"
    },
    merc_e: {
      url: "./models/merc_e.glb",
      name: "Mercedes-Benz E-Class",
      hint: "Csillag-rács, LED-sáv",
      scale: 1.22,
      yaw: 0,
      color: "#16181c"
    },
    korando: {
      url: "./models/korando.glb",
      name: "SsangYong Korando",
      hint: "Magas SUV karosszéria",
      scale: 1.18,
      yaw: 0,
      color: "#6a7180"
    },
    golf: {
      url: "./models/golf.glb",
      name: "Volkswagen Golf VII",
      hint: "Kompakt ferdehátú",
      scale: 1.14,
      yaw: 0,
      color: "#8f1d22"
    }
  };

  var api = {
    carModels: carModels,
    ready: false,
    currentId: "",
    THREE: null,
    GLTFLoader: null
  };

  var pose = { lng: 19.0402, lat: 47.4979, heading: 0, lean: 0, alt: 0.04 };
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

  function ns(mod) {
    if (!mod) return null;
    if (mod.Scene) return mod;
    if (mod.default && mod.default.Scene) return mod.default;
    return mod;
  }

  function loadThree() {
    if (api.THREE && api.GLTFLoader) return Promise.resolve();
    if (loadP) return loadP;
    loadP = Promise.resolve()
      .then(function () {
        return import(THREE_ESM).then(function (mod) {
          api.THREE = ns(mod);
          return import(GLTF_ESM);
        }).then(function (g) {
          api.GLTFLoader = g.GLTFLoader || (g.default && g.default.GLTFLoader) || g.default;
        });
      })
      .catch(function () {
        return loadScript(THREE_UMD).then(function () {
          return loadScript(GLTF_UMD);
        }).then(function () {
          api.THREE = global.THREE;
          api.GLTFLoader = global.THREE && global.THREE.GLTFLoader;
        });
      })
      .then(function () {
        if (!api.THREE || !api.GLTFLoader) throw new Error("Three.js nem töltődött be");
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

  function cloneGltf(root) {
    var THREE = api.THREE;
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
    return copy;
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
    if (!layer || !layer.carRoot || !api.THREE) return;
    var spec = carModels[id] || carModels.verso;
    loadingId = id;
    fetchModel(id)
      .then(function (src) {
        if (loadingId !== id || !layer.carRoot) return;
        while (layer.carRoot.children.length) layer.carRoot.remove(layer.carRoot.children[0]);
        var mesh = cloneGltf(src);
        mesh.rotation.y = spec.yaw || 0;
        layer.carRoot.add(mesh);
        api.currentId = id;
        api.ready = true;
        document.documentElement.classList.add("has-car3d");
        var app = document.getElementById("app");
        if (app) app.classList.add("is-car3d");
        if (mapRef) mapRef.triggerRepaint();
      })
      .catch(function (err) {
        console.warn("[NavCar3D] modell", id, err);
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
        this.scene.add(new THREE.AmbientLight(0xf2f5ff, 0.78));
        var sun = new THREE.DirectionalLight(0xffffff, 1.55);
        sun.position.set(8, 22, 12);
        this.scene.add(sun);
        var fill = new THREE.DirectionalLight(0xb8d4ff, 0.45);
        fill.position.set(-10, 8, -6);
        this.scene.add(fill);
        this.carRoot = new THREE.Group();
        this.scene.add(this.carRoot);
        this.map = map;
        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true
        });
        this.renderer.autoClear = false;
        if (this.renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
          this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        }
        putMesh(api.currentId || savedId());
      },
      onRemove: function () {
        api.ready = false;
        this.renderer = null;
      },
      render: function (gl, args) {
        if (!this.renderer || !this.camera || !this.scene) return;
        var spec = carModels[api.currentId] || carModels.verso;
        var mc = maplibregl.MercatorCoordinate.fromLngLat([pose.lng, pose.lat], pose.alt);
        var scale = mc.meterInMercatorCoordinateUnits() * (spec.scale || 1);
        var headingRad = (-(Number(pose.heading) || 0) * Math.PI) / 180;
        var leanRad = ((Number(pose.lean) || 0) * Math.PI) / 180;
        var rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        var rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), headingRad);
        var rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), -leanRad);
        var raw =
          args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix
            ? args.defaultProjectionData.mainMatrix
            : args;
        var m = new THREE.Matrix4().fromArray(raw);
        var l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(rotationX)
          .multiply(rotationZ)
          .multiply(rotationY);
        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
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
        if (!api.currentId) api.setModel(savedId(), true);
        return true;
      })
      .catch(function (err) {
        console.warn("[NavCar3D]", err);
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
    if (layer && layer.carRoot) putMesh(id);
    else if (mapRef) api.ensure(mapRef);
    return id;
  };

  api.id = function () {
    return api.currentId || savedId();
  };

  global.NavCar3D = api;
})(window);
