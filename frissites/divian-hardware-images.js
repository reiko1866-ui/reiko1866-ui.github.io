/**
 * Divian vasalat / kiegészítő termék képek (partner.divian.hu katalógusból).
 * Kulcs = HARDWARE_ITEMS code.
 */
(function (global) {
  "use strict";
  const MAP = {
  "DRAWER_ORG_ADJ_400": "../assets/hardware/DRAWER_ORG_ADJ_400.jpg",
  "DRAWER_ORG_ADJ_450": "../assets/hardware/DRAWER_ORG_ADJ_450.jpg",
  "DRAWER_ORG_ADJ_600": "../assets/hardware/DRAWER_ORG_ADJ_600.jpg",
  "DRAWER_ORG_ADJ_800": "../assets/hardware/DRAWER_ORG_ADJ_800.jpg",
  "DRAWER_ORG_ADJ_900": "../assets/hardware/DRAWER_ORG_ADJ_900.jpg",
  "DRAWER_ORG_CUT_401_450": "../assets/hardware/DRAWER_ORG_CUT_401_450.jpg",
  "DRAWER_ORG_CUT_501_600": "../assets/hardware/DRAWER_ORG_CUT_501_600.jpg",
  "DRAWER_ORG_CUT_701_800": "../assets/hardware/DRAWER_ORG_CUT_701_800.jpg",
  "FLEXON_45_2": "../assets/hardware/FLEXON_45_2.jpg",
  "FLEXON_60_2": "../assets/hardware/FLEXON_60_2.jpg",
  "FOLDING_STEP": "../assets/hardware/FOLDING_STEP.jpg",
  "K40H400_CHROME": "../assets/hardware/K40H400_CHROME.jpg",
  "K40H400_GREY_SOLID": "../assets/hardware/K40H400_GREY_SOLID.jpg",
  "K40H400_GREY_WIRE": "../assets/hardware/K40H400_GREY_WIRE.jpg",
  "K60N_600_1700_CHROME": "../assets/hardware/K60N_600_1700_CHROME.jpg",
  "K60N_600_1700_GREY": "../assets/hardware/K60N_600_1700_GREY.jpg",
  "K60N_SOLO_600_CHROME": "../assets/hardware/K60N_SOLO_600_CHROME.jpg",
  "K60N_SOLO_600_GREY": "../assets/hardware/K60N_SOLO_600_GREY.jpg",
  "KL300": "../assets/hardware/KL300.jpg",
  "KL400": "../assets/hardware/KL400.jpg",
  "LED_SET_ALU": "../assets/hardware/LED_SET_ALU.jpg",
  "LED_SET_BLACK": "../assets/hardware/LED_SET_BLACK.jpg",
  "LED_SET_WHITE": "../assets/hardware/LED_SET_WHITE.jpg",
  "LM450": "../assets/hardware/LM450.jpg",
  "MAGIC": "../assets/hardware/MAGIC.jpg",
  "MAGIC_GLASS": "../assets/hardware/MAGIC_GLASS.jpg",
  "MOVE": "../assets/hardware/MOVE.jpg",
  "MOVEX_PEDAL": "../assets/hardware/MOVEX_PEDAL.jpg",
  "SEPARATO45": "../assets/hardware/SEPARATO45.jpg",
  "SEPARATO60": "../assets/hardware/SEPARATO60.jpg",
  "SET_PAPER_HOOK": "../assets/hardware/SET_PAPER_HOOK.jpg",
  "SET_RAIL_HOOK": "../assets/hardware/SET_RAIL_HOOK.jpg",
  "SET_RAIL_PAPER": "../assets/hardware/SET_RAIL_PAPER.jpg",
  "SOLO20": "../assets/hardware/SOLO20.jpg",
  "TANDEM1515": "../assets/hardware/TANDEM1515.jpg"
};
  function hardwareImageUrl(code) {
    const key = String(code || "").trim();
    return MAP[key] || "";
  }
  global.DIVIAN_HARDWARE_IMAGES = MAP;
  global.divianHardwareImageUrl = hardwareImageUrl;
})(typeof window !== "undefined" ? window : globalThis);
