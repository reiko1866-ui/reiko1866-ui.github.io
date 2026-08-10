"use strict";
/**
 * Cyncly planner URL kliens — Pages módban nincs helyi forwarder.
 */
(function (global) {
  function getPlannerUrl() {
    return (
      global.__DIVIAN_PLANNER_URL__ ||
      "https://planner.cyncly-idealspaces.com/hu/design/Draft?partnership=divian"
    );
  }
  const api = { getPlannerUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivianPlannerUrlClient = api;
})(typeof window !== "undefined" ? window : globalThis);
