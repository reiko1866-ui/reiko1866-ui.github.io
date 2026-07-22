"use strict";

/** Globális funkciókapcsolók — böngésző + Node.js */
const DELIVERY_NOTE_DISABLED = true;
const DELIVERY_NOTE_DISABLED_MESSAGE =
  "A szállítólevél generálás ideiglenesen ki van kapcsolva (hibás adatok miatt).";

function isDeliveryNoteDisabled() {
  return DELIVERY_NOTE_DISABLED === true;
}

function deliveryNoteDisabledError() {
  return {
    ok: false,
    disabled: true,
    error: "delivery-note-disabled",
    message: DELIVERY_NOTE_DISABLED_MESSAGE
  };
}

const api = {
  DELIVERY_NOTE_DISABLED,
  DELIVERY_NOTE_DISABLED_MESSAGE,
  isDeliveryNoteDisabled,
  deliveryNoteDisabledError
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.DivianFeatureFlags = api;
}
