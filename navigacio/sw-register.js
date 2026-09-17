(function (global) {
  var pending = false;
  var reloading = false;

  function navigating() {
    var app = document.getElementById("app");
    return !!(app && app.classList.contains("is-nav"));
  }

  function apply() {
    if (reloading) return;
    if (navigating()) {
      pending = true;
      return;
    }
    reloading = true;
    location.reload();
  }

  function checkBuild() {
    fetch("./version.json", { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (v) {
        if (!v || !v.build) return;
        var last = "";
        try { last = localStorage.getItem("nav_build") || ""; } catch (_e) {}
        try { localStorage.setItem("nav_build", v.build); } catch (_e2) {}
        if (last && last !== v.build) apply();
      })
      .catch(function () {});
  }

  function watch(reg) {
    function poke() {
      try { reg.update(); } catch (_u) {}
      checkBuild();
    }
    poke();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      poke();
      if (pending) apply();
    });
    setInterval(poke, 5 * 60 * 1000);
    if (reg.waiting && navigator.serviceWorker.controller) apply();
  }

  function boot() {
    if (!("serviceWorker" in navigator)) return;
    if (location.hostname && location.hostname !== "reiko1866-ui.github.io") return;
    navigator.serviceWorker.addEventListener("controllerchange", apply);
    navigator.serviceWorker.addEventListener("message", function (ev) {
      if (ev.data && ev.data.type === "NAV_SW_UPDATED") apply();
    });
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then(watch)
      .catch(function () {});
  }

  global.NavSw = {
    applyPending: function () {
      if (pending) apply();
    }
  };
  boot();
})(window);
