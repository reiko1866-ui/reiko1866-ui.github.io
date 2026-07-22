/**
 * Asztalos értesítések — felmérés / szerelés kérés, hozzárendelés, határidő.
 * App polling + opcionális Thunderbird e-mail (17321).
 */
"use strict";

const fsPromises = require("fs/promises");
const path = require("path");
const { DATA_DIR } = require("./divian-felmeres-queue");
const { readAdminSettings } = require("./divian-admin-settings");
const DivianAsztalosMunkalap = require("./divian-asztalos-munkalap");

const NOTIFY_FILE = path.join(DATA_DIR, "asztalos_ertesitesek.json");
const FORWARDER_COMPOSE_URL =
  String(process.env.DIVIAN_FORWARDER_URL || "http://127.0.0.1:17321").replace(/\/+$/, "") +
  "/thunderbird-compose";

function bool(v) {
  return v === true || v === "true" || v === 1;
}

function str(v) {
  return String(v || "").trim();
}

function entryLabel(entry) {
  const name = str(entry?.customerName) || "Ügyfél";
  const quote = str(entry?.quoteNumber);
  return quote ? name + " · " + quote : name;
}

function deadlineText(entry) {
  if (typeof DivianAsztalosMunkalap.kitchenDeliveryLabel === "function") {
    const label = DivianAsztalosMunkalap.kitchenDeliveryLabel(entry);
    if (label && label !== "—") return label;
  }
  if (typeof DivianAsztalosMunkalap.deadlineLabel === "function") {
    return DivianAsztalosMunkalap.deadlineLabel(entry) || "—";
  }
  return str(entry?.deadlineDate) || str(entry?.deadline) || "—";
}

function addressText(entry) {
  return str(entry?.customerAddress || entry?.address);
}

function phoneText(entry) {
  return str(entry?.customerPhone || entry?.phone);
}

async function readNotificationStore() {
  try {
    const raw = await fsPromises.readFile(NOTIFY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.notifications) ? parsed.notifications : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeNotificationStore(rows) {
  await fsPromises.mkdir(DATA_DIR, { recursive: true });
  const list = Array.isArray(rows) ? rows.slice(-500) : [];
  await fsPromises.writeFile(
    NOTIFY_FILE,
    JSON.stringify({ notifications: list, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

async function appendNotification(row) {
  const rows = await readNotificationStore();
  rows.push(row);
  await writeNotificationStore(rows);
  return row;
}

function detectEvents(before, after) {
  if (!after || typeof after !== "object") return [];
  const prev = before && typeof before === "object" ? before : {};
  const events = [];
  const crew = str(after.installationCrew) || null;
  const prevCrew = str(prev.installationCrew) || null;

  const felmeresNew = !!after.felmeresRequested && !prev.felmeresRequested;
  const installNew = !!after.installationRequested && !prev.installationRequested;
  const crewNew = !!crew && crew !== prevCrew;
  const deadlineChanged =
    str(after.deadline) !== str(prev.deadline) ||
    str(after.deadlineDate) !== str(prev.deadlineDate);

  if (felmeresNew) {
    events.push({
      type: "felmeres_requested",
      crewId: crew,
      title: "Új felmérés kérés",
      body:
        entryLabel(after) +
        (addressText(after) ? "\n" + addressText(after) : "") +
        "\nHatáridő: " +
        deadlineText(after)
    });
  }

  if (installNew) {
    events.push({
      type: "install_requested",
      crewId: crew,
      title: "Új szerelés kérés",
      body:
        entryLabel(after) +
        (addressText(after) ? "\n" + addressText(after) : "") +
        "\nHatáridő: " +
        deadlineText(after)
    });
  }

  if (crewNew && !installNew && !felmeresNew) {
    events.push({
      type: "crew_assigned",
      crewId: crew,
      title: "Hozzárendelt munka",
      body:
        entryLabel(after) +
        (addressText(after) ? "\n" + addressText(after) : "") +
        "\nHatáridő: " +
        deadlineText(after)
    });
  }

  if (
    deadlineChanged &&
    !felmeresNew &&
    !installNew &&
    !crewNew &&
    (after.felmeresRequested || after.installationRequested)
  ) {
    events.push({
      type: "deadline_changed",
      crewId: crew,
      title: "Határidő módosult",
      body: entryLabel(after) + "\nÚj határidő: " + deadlineText(after)
    });
  }

  return events;
}

function resolveCrewRecipients(settings, crewId) {
  const crews = Array.isArray(settings?.carpenterCrews) ? settings.carpenterCrews : [];
  if (crewId) {
    const row = crews.find((c) => str(c.id) === str(crewId));
    return row ? [row] : [];
  }
  return crews.filter((c) => str(c.id));
}

function resolveAppCrewTargets(crewId) {
  if (crewId) return [str(crewId)];
  return ["1", "2", "3"];
}

async function sendThunderbirdEmail(to, subject, body) {
  const email = str(to);
  if (!email || !/@/.test(email)) return { ok: false, reason: "no-email" };
  try {
    const res = await fetch(FORWARDER_COMPOSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: email, subject, body })
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

async function dispatchCrewAlerts(entry, event) {
  const settings = await readAdminSettings();
  const notify = settings.notifications?.crewAlerts || {};
  if (notify.enabled === false) return { skipped: true };

  const appOn = notify.app !== false;
  const emailOn = notify.email !== false;
  const appTargets = resolveAppCrewTargets(event.crewId);
  const created = [];

  if (appOn) {
    for (let i = 0; i < appTargets.length; i++) {
      const crewId = appTargets[i];
      const row = {
        id: "cn-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        createdAt: new Date().toISOString(),
        type: event.type,
        crewId,
        jobId: str(entry?.id),
        quoteNumber: str(entry?.quoteNumber),
        customerName: str(entry?.customerName),
        title: event.title,
        body: event.body,
        deadlineLabel: deadlineText(entry),
        customerAddress: addressText(entry),
        customerPhone: phoneText(entry)
      };
      await appendNotification(row);
      created.push(row);
    }
  }

  if (emailOn) {
    const crews = resolveCrewRecipients(settings, event.crewId);
    const subject = "Divian — " + event.title + " (" + str(entry?.quoteNumber) + ")";
    const body =
      event.body +
      (phoneText(entry) ? "\nTel: " + phoneText(entry) : "") +
      "\n\nNyisd meg az asztalos appot a részletekért.";
    for (let j = 0; j < crews.length; j++) {
      const email = str(crews[j]?.email);
      if (email) await sendThunderbirdEmail(email, subject, body);
    }
  }

  return { created: created.length };
}

async function handleQueueEntryChange(before, after) {
  const events = detectEvents(before, after);
  if (!events.length) return { events: 0 };
  let dispatched = 0;
  for (let i = 0; i < events.length; i++) {
    const result = await dispatchCrewAlerts(after, events[i]);
    if (!result.skipped) dispatched++;
  }
  return { events: events.length, dispatched };
}

async function listCrewNotifications(opts) {
  const crewId = str(opts?.crewId);
  const isAdmin = !!opts?.isAdmin;
  const sinceMs = Date.parse(String(opts?.since || ""));
  const rows = await readNotificationStore();
  return rows
    .filter((row) => {
      const t = Date.parse(String(row?.createdAt || ""));
      if (Number.isFinite(sinceMs) && t && t <= sinceMs) return false;
      if (isAdmin) return true;
      return str(row?.crewId) === crewId;
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 40);
}

module.exports = {
  NOTIFY_FILE,
  handleQueueEntryChange,
  listCrewNotifications,
  detectEvents,
  dispatchCrewAlerts
};
