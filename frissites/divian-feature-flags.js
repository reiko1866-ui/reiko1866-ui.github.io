"use strict";

/**
 * Globális funkciókapcsolók — böngésző + Node.js
 *
 * Alap: szállítólevél zárolva.
 * Feloldás csak a Váci úti hub gépen (DIVIAN_SITE / config/divian-site.txt / remote API).
 */

const DELIVERY_NOTE_DISABLED = true;
const DELIVERY_NOTE_DISABLED_MESSAGE =
  "A szállítólevél generálás ideiglenesen ki van kapcsolva (hibás adatok miatt).";

const VACI_HUB_SITE_VALUES = new Set(["vaci-server", "vaci-hub", "vaci"]);

let remoteSiteOverride = "";

function normalizeSiteRole(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "");
}

function readSiteRoleFromDisk() {
  if (typeof require !== "function" || typeof process === "undefined" || !process.versions?.node) {
    return "";
  }
  try {
    const fs = require("fs");
    const path = require("path");
    const candidates = [
      path.join(__dirname, "divian-site.txt"),
      path.join(__dirname, "..", "config", "divian-site.txt")
    ];
    for (const fp of candidates) {
      try {
        const text = fs.readFileSync(fp, "utf8");
        const line =
          String(text || "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith("#")) || "";
        const role = normalizeSiteRole(line);
        if (role) return role;
      } catch (_err) {
        /* next */
      }
    }
  } catch (_err) {
    /* ignore */
  }
  return "";
}

function readSiteRole() {
  if (remoteSiteOverride) return remoteSiteOverride;

  if (typeof process !== "undefined" && process.env && process.env.DIVIAN_SITE) {
    const fromEnv = normalizeSiteRole(process.env.DIVIAN_SITE);
    if (fromEnv) return fromEnv;
  }

  if (typeof window !== "undefined" && window.__DIVIAN_SITE__) {
    const fromWindow = normalizeSiteRole(window.__DIVIAN_SITE__);
    if (fromWindow) return fromWindow;
  }

  const fromDisk = readSiteRoleFromDisk();
  if (fromDisk) return fromDisk;

  return "";
}

function isVaciHubUnlocked() {
  return VACI_HUB_SITE_VALUES.has(readSiteRole());
}

function isDeliveryNoteDisabled() {
  if (isVaciHubUnlocked()) return false;
  return DELIVERY_NOTE_DISABLED === true;
}

function isWorkflowFullyUnlocked() {
  return isVaciHubUnlocked();
}

function deliveryNoteDisabledError() {
  return {
    ok: false,
    disabled: true,
    error: "delivery-note-disabled",
    message: DELIVERY_NOTE_DISABLED_MESSAGE
  };
}

/** Böngésző: a hub `/api/feature-flags` válaszából. */
function applyRemoteFlags(data) {
  if (!data || typeof data !== "object") return false;
  const site = normalizeSiteRole(data.site || data.DIVIAN_SITE || "");
  if (site) {
    remoteSiteOverride = site;
    if (typeof window !== "undefined") window.__DIVIAN_SITE__ = site;
  } else if (data.vaciHubUnlocked === true || data.fullyUnlocked === true) {
    remoteSiteOverride = "vaci-server";
    if (typeof window !== "undefined") window.__DIVIAN_SITE__ = "vaci-server";
  }
  return isVaciHubUnlocked();
}

function getFeatureFlagsSnapshot() {
  const site = readSiteRole();
  const vaciHubUnlocked = isVaciHubUnlocked();
  return {
    ok: true,
    site: site || "default",
    vaciHubUnlocked,
    fullyUnlocked: vaciHubUnlocked,
    deliveryNoteDisabled: isDeliveryNoteDisabled(),
    workflowFullyUnlocked: isWorkflowFullyUnlocked(),
    DELIVERY_NOTE_DISABLED,
    DELIVERY_NOTE_DISABLED_MESSAGE
  };
}

const api = {
  DELIVERY_NOTE_DISABLED,
  DELIVERY_NOTE_DISABLED_MESSAGE,
  isDeliveryNoteDisabled,
  deliveryNoteDisabledError,
  isVaciHubUnlocked,
  isWorkflowFullyUnlocked,
  applyRemoteFlags,
  getFeatureFlagsSnapshot,
  readSiteRole
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.DivianFeatureFlags = api;
}
