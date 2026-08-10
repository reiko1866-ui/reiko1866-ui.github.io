/**
 * Felhőbeli asztalos munkaszervezés — kiosztás a Fly-en (PC nélkül).
 */
(function () {
  "use strict";

  const LS_PIN = "divian_msz_admin_pin";
  const FLY_API = "https://divian-asztalos.fly.dev";
  function resolveApi() {
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      if (
        host.endsWith(".github.io") ||
        host.endsWith(".pages.dev") ||
        host.endsWith(".workers.dev")
      ) {
        return FLY_API;
      }
    } catch (_e) {}
    return String(window.location.origin || FLY_API).replace(/\/+$/, "");
  }
  const API = resolveApi();

  let pin = "";
  let crews = [];
  let rows = [];

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(el, msg, tone) {
    if (!el) return;
    el.textContent = String(msg || "");
    el.classList.remove("is-ok", "is-err");
    if (tone === "ok") el.classList.add("is-ok");
    if (tone === "err") el.classList.add("is-err");
  }

  const SS_OWNER_KEY = "divian_msz_owner_key";

  function ownerKey() {
    try {
      return String(sessionStorage.getItem(SS_OWNER_KEY) || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function ensureOwnerKeyForPages() {
    if (ownerKey()) return ownerKey();
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      if (
        !(
          host.endsWith(".github.io") ||
          host.endsWith(".pages.dev") ||
          host.endsWith(".workers.dev")
        )
      ) {
        return "";
      }
      const typed = window.prompt(
        "Tulajdonosi jelszó (egyszer) — a Fly API eléréséhez kell:"
      );
      const key = String(typed || "").trim();
      if (!key) return "";
      sessionStorage.setItem(SS_OWNER_KEY, key);
      return key;
    } catch (_e) {
      return "";
    }
  }

  async function apiJson(path, opts) {
    const headers = Object.assign(
      { "Content-Type": "application/json", Accept: "application/json" },
      (opts && opts.headers) || {}
    );
    const key = ownerKey() || ensureOwnerKeyForPages();
    if (key) headers["X-Divian-Owner-Key"] = key;
    const res = await fetch(
      API + path,
      Object.assign({ cache: "no-store" }, opts || {}, { headers })
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      if (String(json.error || "") === "locked") {
        try {
          sessionStorage.removeItem(SS_OWNER_KEY);
        } catch (_e) {}
      }
      throw new Error(json.message || json.error || "HTTP " + res.status);
    }
    return json;
  }

  function crewName(id) {
    const hit = crews.find((c) => String(c.id) === String(id || ""));
    return hit ? hit.name : id || "—";
  }

  function formatHuDate(iso) {
    const s = String(iso || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s || "—";
    return Number(m[1]) + ". " + Number(m[2]) + ". " + Number(m[3]) + ".";
  }

  function filteredRows() {
    const q = String($("searchInput")?.value || "")
      .trim()
      .toLowerCase();
    const open = rows.filter((r) => String(r.status || "") !== "done");
    if (!q) return open;
    return open.filter((r) => {
      const blob = [
        r.customerName,
        r.quoteNumber,
        r.customerPhone,
        r.customerAddress,
        r.installationCrew,
        crewName(r.installationCrew)
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  function renderStats() {
    const open = rows.filter((r) => String(r.status || "") !== "done");
    const need = open.filter(
      (r) =>
        (r.installationRequested || r.felmeresRequested) &&
        !r.installationClosed &&
        !String(r.installationCrew || "").trim()
    );
    const assigned = open.filter((r) => String(r.installationCrew || "").trim());
    $("statsBar").innerHTML =
      '<span class="stat">Nyitott: <strong>' +
      open.length +
      "</strong></span>" +
      '<span class="stat">Kiosztatlan: <strong>' +
      need.length +
      "</strong></span>" +
      '<span class="stat">Kiosztott: <strong>' +
      assigned.length +
      "</strong></span>";
  }

  function renderList() {
    const list = filteredRows();
    const box = $("jobList");
    if (!list.length) {
      box.innerHTML = '<div class="card"><p class="meta">Nincs megjeleníthető munka.</p></div>';
      return;
    }
    const opts =
      '<option value="">— Asztalos —</option>' +
      crews
        .map(
          (c) =>
            '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name || c.id) + "</option>"
        )
        .join("");
    box.innerHTML = list
      .map((r) => {
        const crew = String(r.installationCrew || "").trim();
        const badge = crew
          ? '<span class="badge ok">' + escapeHtml(crewName(crew)) + "</span>"
          : '<span class="badge warn">Nincs kiosztva</span>';
        const store = /BUD/i.test(String(r.quoteNumber || "")) || /buda/i.test(String(r.store || ""))
          ? "Budaörs"
          : "Váci út";
        const felmeresDate = String(r.felmeresScheduledDate || "").trim();
        const felmeresBadge = felmeresDate
          ? '<span class="badge ok">Felmérés: ' + escapeHtml(formatHuDate(felmeresDate)) + "</span>"
          : r.felmeresRequested || r.installationRequested
            ? '<span class="badge warn">Felmérés: nincs dátum</span>'
            : "";
        return (
          '<article class="card job" data-id="' +
          escapeHtml(r.id) +
          '"><div class="row" style="justify-content:space-between">' +
          "<div><h3>" +
          escapeHtml(r.customerName || "Ismeretlen ügyfél") +
          "</h3><p class=\"meta\">" +
          escapeHtml(r.quoteNumber || "—") +
          " · " +
          escapeHtml(store) +
          " · " +
          escapeHtml(r.customerPhone || "nincs tel.") +
          "</p></div>" +
          '<div class="row">' +
          badge +
          felmeresBadge +
          "</div></div>" +
          (r.customerAddress
            ? '<p class="meta">' + escapeHtml(r.customerAddress) + "</p>"
            : "") +
          "<label>Felmérés dátuma</label>" +
          '<div class="row">' +
          '<input type="date" class="felmeres-date" data-id="' +
          escapeHtml(r.id) +
          '" value="' +
          escapeHtml(felmeresDate) +
          '" />' +
          '<button type="button" class="btn ghost save-felmeres-date" data-id="' +
          escapeHtml(r.id) +
          '">Dátum mentés</button>' +
          "</div>" +
          "<label>Asztalos kiosztása</label>" +
          '<div class="row">' +
          '<select class="crew-select" data-id="' +
          escapeHtml(r.id) +
          '">' +
          opts.replace(
            'value="' + escapeHtml(crew) + '"',
            'value="' + escapeHtml(crew) + '" selected'
          ) +
          "</select>" +
          '<button type="button" class="btn ghost save-crew" data-id="' +
          escapeHtml(r.id) +
          '">Mentés</button>' +
          '<button type="button" class="btn ghost delete-job" data-id="' +
          escapeHtml(r.id) +
          '" style="border-color:#5c1f1f;color:#ffb4b4">Törlés</button>' +
          "</div></article>"
        );
      })
      .join("");

    // Fix selected options properly
    box.querySelectorAll("select.crew-select").forEach((sel) => {
      const id = sel.getAttribute("data-id");
      const entry = rows.find((r) => String(r.id) === String(id));
      sel.value = String(entry?.installationCrew || "");
    });
  }

  async function loadData() {
    setStatus($("appStatus"), "Betöltés…", "");
    const json = await apiJson(
      "/api/munkaszervezes/queue?pin=" + encodeURIComponent(pin)
    );
    rows = Array.isArray(json.rows) ? json.rows : [];
    crews = Array.isArray(json.crews) ? json.crews : [];
    renderStats();
    renderList();
    setStatus($("appStatus"), rows.length + " munka a felhőben", "ok");
  }

  async function assignCrew(id, crew) {
    const patch = {
      installationCrew: crew || null
    };
    if (crew) {
      patch.installationRequested = true;
      patch.felmeresRequested = true;
      patch.installationAssignedAt = new Date().toISOString();
    }
    await apiJson("/api/felmeres-queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, patch, pin })
    });
  }

  async function saveFelmeresDate(id, date) {
    const value = String(date || "").trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error("Érvénytelen dátum.");
    }
    await apiJson("/api/felmeres-queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        pin,
        patch: {
          felmeresScheduledDate: value || null,
          felmeresScheduledAt: value ? new Date().toISOString() : null,
          felmeresRequested: true
        }
      })
    });
  }

  async function login() {
    pin = String($("adminPin")?.value || "").trim();
    if (!pin) {
      setStatus($("loginStatus"), "Add meg az admin PIN-t.", "err");
      return;
    }
    try {
      setStatus($("loginStatus"), "Belépés…", "");
      await apiJson("/api/munkaszervezes/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      try {
        localStorage.setItem(LS_PIN, pin);
      } catch (_e) {}
      $("loginCard").hidden = true;
      $("appPanel").hidden = false;
      await loadData();
    } catch (err) {
      setStatus($("loginStatus"), String(err.message || err), "err");
    }
  }

  function logout() {
    pin = "";
    try {
      localStorage.removeItem(LS_PIN);
    } catch (_e) {}
    $("loginCard").hidden = false;
    $("appPanel").hidden = true;
    if ($("adminPin")) $("adminPin").value = "";
    setStatus($("loginStatus"), "", "");
  }

  function wire() {
    $("loginBtn")?.addEventListener("click", () => void login());
    $("adminPin")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") void login();
    });
    $("refreshBtn")?.addEventListener("click", () => void loadData().catch((e) => setStatus($("appStatus"), String(e.message || e), "err")));
    $("logoutBtn")?.addEventListener("click", logout);
    $("searchInput")?.addEventListener("input", renderList);
    $("jobList")?.addEventListener("click", async (ev) => {
      const dateBtn = ev.target.closest(".save-felmeres-date");
      if (dateBtn) {
        const id = dateBtn.getAttribute("data-id");
        const input = $("jobList").querySelector('input.felmeres-date[data-id="' + id + '"]');
        const date = String(input?.value || "").trim();
        dateBtn.disabled = true;
        try {
          await saveFelmeresDate(id, date);
          setStatus(
            $("appStatus"),
            date ? "Felmérés napja: " + formatHuDate(date) + " ✓" : "Felmérés dátum törölve",
            "ok"
          );
          await loadData();
        } catch (err) {
          setStatus($("appStatus"), String(err.message || err), "err");
        } finally {
          dateBtn.disabled = false;
        }
        return;
      }
      const delBtn = ev.target.closest(".delete-job");
      if (delBtn) {
        const id = delBtn.getAttribute("data-id");
        const entry = rows.find((r) => String(r.id) === String(id));
        const label =
          String(entry?.customerName || "").trim() ||
          String(entry?.quoteNumber || "").trim() ||
          id;
        if (!confirm("Biztosan törlöd?\n\n" + label + "\n\nNem visszavonható.")) return;
        delBtn.disabled = true;
        try {
          await apiJson(
            "/api/felmeres-queue?id=" +
              encodeURIComponent(id) +
              "&pin=" +
              encodeURIComponent(pin),
            { method: "DELETE" }
          );
          setStatus($("appStatus"), "Munka törölve ✓", "ok");
          await loadData();
        } catch (err) {
          setStatus($("appStatus"), String(err.message || err), "err");
        } finally {
          delBtn.disabled = false;
        }
        return;
      }
      const btn = ev.target.closest(".save-crew");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const sel = $("jobList").querySelector('select.crew-select[data-id="' + id + '"]');
      const crew = String(sel?.value || "").trim();
      btn.disabled = true;
      try {
        await assignCrew(id, crew);
        setStatus(
          $("appStatus"),
          crew ? "Kiosztva: " + crewName(crew) + " — azonnal látszik az asztalos appban" : "Kiosztás törölve",
          "ok"
        );
        await loadData();
      } catch (err) {
        setStatus($("appStatus"), String(err.message || err), "err");
      } finally {
        btn.disabled = false;
      }
    });
    $("jobList")?.addEventListener("change", async (ev) => {
      const sel = ev.target.closest("select.crew-select");
      if (!sel) return;
      const id = sel.getAttribute("data-id");
      const crew = String(sel.value || "").trim();
      try {
        await assignCrew(id, crew);
        setStatus(
          $("appStatus"),
          crew ? "Kiosztva: " + crewName(crew) : "Kiosztás törölve",
          "ok"
        );
        await loadData();
      } catch (err) {
        setStatus($("appStatus"), String(err.message || err), "err");
      }
    });
  }

  async function boot() {
    wire();
    try {
      pin = String(localStorage.getItem(LS_PIN) || "").trim();
    } catch (_e) {
      pin = "";
    }
    if (pin) {
      $("adminPin").value = pin;
      void login();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
