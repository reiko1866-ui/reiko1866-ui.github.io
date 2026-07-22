/**
 * Számlázási sor kerekítés — Számlázz.hu kompatibilis:
 *   nettó = egységár × db
 *   ÁFA = kerekítés(nettó × 27%)
 *   bruttó = nettó + ÁFA
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.DivianInvoiceVat = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this, function () {
  const DEFAULT_VAT_PCT = 27;

  function roundNearestFive(value) {
    return Math.round(Number(value) / 5) * 5;
  }

  function splitHalfAmount(fullAmount) {
    const full = Math.max(0, Math.floor(Number(fullAmount) || 0));
    const first = roundNearestFive(Math.round(full * 0.5));
    const second = Math.max(0, full - first);
    return { full, first, second };
  }

  function computeRowAmountsFromGross(grossTarget, qty, vatPct) {
    const pct = Number(vatPct) || DEFAULT_VAT_PCT;
    const q = Math.max(1, Math.floor(Number(qty) || 0) || 1);
    const target = Math.max(0, Math.round(Number(grossTarget) || 0));
    if (!target) {
      return { qty: q, unitNet: 0, net: 0, vat: 0, gross: 0, vatPct: pct };
    }

    const baseUnit = Math.round(target / (1 + pct / 100) / q);
    let best = null;
    for (let delta = -20; delta <= 20; delta += 5) {
      const unitNet = Math.max(0, roundNearestFive(baseUnit + delta));
      const net = unitNet * q;
      const vat = Math.round((net * pct) / 100);
      const gross = net + vat;
      const diff = Math.abs(gross - target);
      if (
        !best ||
        diff < best.diff ||
        (diff === best.diff && gross <= target && gross > best.gross)
      ) {
        best = { unitNet, net, vat, gross, diff };
      }
    }

    return {
      qty: q,
      unitNet: best.unitNet,
      net: best.net,
      vat: best.vat,
      gross: best.gross,
      vatPct: pct
    };
  }

  function stripPartialPartSuffix(label) {
    return String(label || "")
      .replace(/\s+(I+\.\s*r[eé]szlet|II\.\s*r[eé]szlet)\s*$/i, "")
      .trim();
  }

  return {
    DEFAULT_VAT_PCT,
    roundNearestFive,
    splitHalfAmount,
    computeRowAmountsFromGross,
    stripPartialPartSuffix
  };
});
