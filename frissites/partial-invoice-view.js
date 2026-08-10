"use strict";
/**
 * Részszámla / szállítólevél segéd — Pages stub.
 * A teljes PartialInvoiceView a helyi / szerveres csomagban van.
 */
(function (global) {
  const PartialInvoiceView = {
    deliveryNotePdfOnlyBlockReason() {
      return "Pages / felhő mód: szállítólevél PDF generálás a helyi szerveren vagy a Fly asztalos hubon érhető el.";
    },
    buildPreview() {
      return { ok: false, error: "partial-invoice-unavailable-on-pages" };
    }
  };
  global.PartialInvoiceView = PartialInvoiceView;
})(typeof window !== "undefined" ? window : globalThis);
