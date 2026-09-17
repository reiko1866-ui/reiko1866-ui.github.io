(function (global) {
  "use strict";
  global.NavVoice = {
    instance: null,
    init: function () {
      return Promise.resolve(null);
    },
    playCat: function () {
      return false;
    }
  };
})(typeof window !== "undefined" ? window : this);
