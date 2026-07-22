(function () {
  "use strict";

  const APP_VERSION = "20260716dash";
  const CATEGORY_ORDER = [
    { code: "butortest_lap", label: "Bútortestek" },
    { code: "vasalat_kiegeszito", label: "Vasalatok és kiegészítők" },
    { code: "gyari_tartozek", label: "Gyári tartozékok" },
    { code: "beepitheto_gep", label: "Beépíthető gépek" }
  ];

  const state = {
    orders: [],
    selectedId: null,
    selectedDelivery: null,
    items: [],
    socket: null
  };

  const $ = (id) => document.getElementById(id);

  function apiBase() {
    return window.location.origin.replace(/\/$/, "");
  }

  async function apiFetch(path) {
    const res = await fetch(apiBase() + path, {
      headers: { Accept: "application/json" }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || "HTTP " + res.status);
    }
    return body;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function customerShortName(name) {
    const n = String(name || "Ismeretlen ügyfél").trim();
    const parts = n.split(/\s+/);
    if (parts.length >= 2) return parts[0] + " " + parts[1];
    return n;
  }

  function progressLabel(order) {
    const pct = order.deliveredPercent || 0;
    return customerShortName(order.customerName) + " szállítás: " + pct + "% átadva";
  }

  function findOrder(deliveryId) {
    return state.orders.find((o) => o.deliveryId === deliveryId);
  }

  function updateOrderFromItems(deliveryId, items) {
    const order = findOrder(deliveryId);
    if (!order || !items.length) return;
    const total = items.length;
    let loaded = 0;
    let delivered = 0;
    let issues = 0;
    items.forEach((item) => {
      const m = item.statusMuhely?.code;
      const h = item.statusHelyszin?.code;
      if (m === "felrakva_kocsira") loaded++;
      if (h === "atadva" || h === "kiszallitva") delivered++;
      if (h === "hianyzik" || h === "serult") issues++;
    });
    order.itemCount = total;
    order.loadedCount = loaded;
    order.loadedPercent = total ? Math.round((loaded / total) * 100) : 0;
    order.deliveredCount = delivered;
    order.deliveredPercent = total ? Math.round((delivered / total) * 100) : 0;
    order.issueCount = issues;
  }

  function renderProjectCard(order) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "project-card w-full text-left rounded-xl border-2 border-slate-800 bg-slate-800/40 p-4 transition hover:border-slate-600";
    btn.dataset.deliveryId = order.deliveryId;
    if (state.selectedId === order.deliveryId) btn.classList.add("is-active");

    const issueBadge =
      order.issueCount > 0
        ? '<span class="inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-mono uppercase text-red-300">' +
          order.issueCount +
          " hiba</span>"
        : "";

    btn.innerHTML =
      '<div class="flex items-start justify-between gap-2 mb-2">' +
      '<p class="font-semibold text-white leading-snug">' +
      escapeHtml(progressLabel(order)) +
      "</p>" +
      issueBadge +
      "</div>" +
      '<p class="text-xs text-slate-500 font-mono mb-3 truncate">' +
      escapeHtml(order.deliveryId) +
      (order.customerAddress ? " · " + escapeHtml(order.customerAddress) : "") +
      "</p>" +
      '<div class="h-2 rounded-full bg-slate-700/80 overflow-hidden" role="progressbar" aria-valuenow="' +
      (order.deliveredPercent || 0) +
      '" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="progress-fill h-full rounded-full bg-emerald-500" style="width:' +
      (order.deliveredPercent || 0) +
      '%"></div>' +
      "</div>" +
      '<p class="text-[10px] font-mono text-slate-500 mt-1.5">' +
      (order.deliveredCount || 0) +
      " / " +
      (order.itemCount || 0) +
      " tétel átadva</p>";

    btn.addEventListener("click", () => selectDelivery(order.deliveryId));
    return btn;
  }

  function renderProjectList() {
    const list = $("projectList");
    list.innerHTML = "";
    $("projectCount").textContent = state.orders.length + " aktív szállítás";

    if (!state.orders.length) {
      list.innerHTML =
        '<p class="text-sm text-slate-500 font-mono py-8 text-center leading-relaxed">Nincs aktív szállítás.<br/>Ments megrendelést a kalkulátorból.</p>';
      return;
    }

    state.orders.forEach((order) => list.appendChild(renderProjectCard(order)));
  }

  function refreshProjectCard(deliveryId) {
    const order = findOrder(deliveryId);
    if (!order) return;
    const existing = document.querySelector('.project-card[data-delivery-id="' + deliveryId + '"]');
    if (existing) {
      const next = renderProjectCard(order);
      existing.replaceWith(next);
    }
  }

  function groupItems(items) {
    const map = new Map();
    CATEGORY_ORDER.forEach((c) => map.set(c.code, []));
    items.forEach((item) => {
      const code = item.categoryCode || "butortest_lap";
      if (!map.has(code)) map.set(code, []);
      map.get(code).push(item);
    });
    return CATEGORY_ORDER.map((cat) => ({
      ...cat,
      items: map.get(cat.code) || []
    })).filter((g) => g.items.length > 0);
  }

  function itemStatusText(item) {
    const parts = [];
    if (item.statusMuhely?.code && item.statusMuhely.code !== "nincs") {
      parts.push("Műhely: " + item.statusMuhely.label);
    }
    if (item.statusHelyszin?.code && item.statusHelyszin.code !== "nincs") {
      parts.push("Helyszín: " + item.statusHelyszin.label);
    }
    return parts.length ? parts.join(" · ") : "Nincs státusz";
  }

  function renderItemRow(item) {
    const row = document.createElement("div");
    row.className =
      "item-row rounded-lg border border-slate-800 px-4 py-3 flex items-center justify-between gap-4";
    row.dataset.itemId = String(item.id);
    row.dataset.ui = item.uiClass || "pending";

    const isIssue = item.uiClass === "missing";
    row.innerHTML =
      '<div class="min-w-0 flex-1">' +
      '<p class="font-medium text-white truncate">' +
      escapeHtml(item.name) +
      "</p>" +
      '<p class="text-xs font-mono text-slate-500 mt-0.5">' +
      (item.code ? escapeHtml(item.code) + " · " : "") +
      escapeHtml(String(item.qty)) +
      " " +
      escapeHtml(item.qtyUnit || "db") +
      "</p>" +
      '<p class="text-[11px] font-mono uppercase tracking-wide mt-1 ' +
      (isIssue ? "text-red-400 font-semibold" : "text-slate-500") +
      '" data-delivery-status>' +
      escapeHtml(itemStatusText(item)) +
      "</p>" +
      "</div>" +
      '<div class="shrink-0 text-2xl" data-ui-icon aria-hidden="true">' +
      (isIssue ? "✕" : item.uiClass === "ok" ? "✓" : "○") +
      "</div>";

    return row;
  }

  function renderDetailHeader(order) {
    $("detailDeliveryId").textContent = order.deliveryId;
    $("detailCustomerName").textContent = order.customerName || "—";
    $("detailCustomerAddress").textContent = order.customerAddress || "—";
    $("detailDeliveredPct").textContent = (order.deliveredPercent || 0) + "%";
    $("detailIssueCount").textContent = String(order.issueCount || 0);
  }

  function renderDetailItems() {
    const root = $("detailItems");
    root.innerHTML = "";
    const groups = groupItems(state.items);

    if (!groups.length) {
      root.innerHTML = '<p class="text-slate-500 font-mono text-sm">Nincs tétel.</p>';
      return;
    }

    groups.forEach((group) => {
      const section = document.createElement("section");
      section.innerHTML =
        '<h3 class="text-xs font-mono uppercase tracking-[0.15em] text-amber-500/90 mb-3">' +
        escapeHtml(group.label) +
        " (" +
        group.items.length +
        ")</h3>";
      const list = document.createElement("div");
      list.className = "space-y-2";
      group.items.forEach((item) => list.appendChild(renderItemRow(item)));
      section.appendChild(list);
      root.appendChild(section);
    });
  }

  function showDetail(show) {
    $("detailEmpty").classList.toggle("hidden", show);
    $("detailPanel").classList.toggle("hidden", !show);
  }

  async function selectDelivery(deliveryId) {
    state.selectedId = deliveryId;
    document.querySelectorAll(".project-card").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.deliveryId === deliveryId);
    });

    try {
      const data = await apiFetch("/api/asztalos-delivery/" + encodeURIComponent(deliveryId) + "/items");
      state.selectedDelivery = data.order;
      state.items = data.items || [];
      updateOrderFromItems(deliveryId, state.items);
      refreshProjectCard(deliveryId);

      const order = findOrder(deliveryId) || {
        deliveryId,
        customerName: data.order?.customerName,
        customerAddress: data.order?.customerAddress,
        loadedPercent: 0,
        deliveredPercent: 0,
        issueCount: 0
      };
      renderDetailHeader(order);
      renderDetailItems();
      showDetail(true);

      if (state.socket) {
        state.socket.emit("joinOrder", { deliveryId });
      }
    } catch (err) {
      showAlert("Betöltési hiba: " + err.message, "error");
    }
  }

  function showIssueAlert(payload) {
    const itemName = payload.item?.name || "Tétel";
    const statusLabel = String(payload.statusLabel || "HIÁNYZIK").toUpperCase();
    const customer = findOrder(payload.deliveryId)?.customerName || payload.deliveryId || "";
    showAlert(itemName + " — " + statusLabel, "issue", { customer });
  }

  function handleRealtimeUpdate(payload) {
    if (!payload?.itemId || !payload.deliveryId) return;

    if (state.selectedId === payload.deliveryId && payload.item) {
      const idx = state.items.findIndex((i) => i.id === payload.itemId);
      if (idx >= 0) state.items[idx] = payload.item;
      updateOrderFromItems(payload.deliveryId, state.items);
      const order = findOrder(payload.deliveryId);
      if (order) renderDetailHeader(order);
      updateItemRowDom(payload);
      refreshProjectCard(payload.deliveryId);
    } else {
      loadActiveOrdersQuiet().then(() => {
        if (payload.deliveryId) refreshProjectCard(payload.deliveryId);
      });
    }

    const uiClass = payload.uiClass || payload.item?.uiClass;
    if (uiClass === "missing") showIssueAlert(payload);
  }

  function updateItemRowDom(payload) {
    const row = document.querySelector('.item-row[data-item-id="' + payload.itemId + '"]');
    if (!row || !payload.item) return;

    const item = payload.item;
    const uiClass = item.uiClass || "pending";
    row.dataset.ui = uiClass;

    const statusEl = row.querySelector("[data-delivery-status]");
    if (statusEl) {
      statusEl.textContent = itemStatusText(item);
      statusEl.className =
        "text-[11px] font-mono uppercase tracking-wide mt-1 " +
        (uiClass === "missing" ? "text-red-400 font-semibold" : "text-slate-500");
    }

    const iconEl = row.querySelector("[data-ui-icon]");
    if (iconEl) {
      iconEl.textContent = uiClass === "missing" ? "✕" : uiClass === "ok" ? "✓" : "○";
    }

    if (uiClass === "missing") {
      row.classList.remove("flash-issue");
      void row.offsetWidth;
      row.classList.add("flash-issue");
    }
  }

  function showAlert(message, type, meta) {
    const host = $("alertHost");
    const el = document.createElement("div");
    el.className =
      "alert-banner pointer-events-auto rounded-xl border px-4 py-3 shadow-xl " +
      (type === "issue"
        ? "border-red-500/60 bg-red-950/95 text-red-100"
        : type === "error"
          ? "border-red-500/40 bg-red-950/80 text-red-200"
          : "border-slate-600 bg-slate-800/95 text-slate-200");

    const title =
      type === "issue"
        ? '<strong class="block text-red-300 font-mono text-xs uppercase tracking-wider mb-1">⚠ Terepi figyelmeztetés</strong>'
        : "";

    el.innerHTML =
      title +
      '<p class="text-sm font-semibold">' +
      escapeHtml(message) +
      "</p>" +
      (meta?.customer
        ? '<p class="text-xs text-red-300/80 mt-1 font-mono">' + escapeHtml(meta.customer) + "</p>"
        : "");

    host.prepend(el);
    window.setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.4s";
      window.setTimeout(() => el.remove(), 400);
    }, type === "issue" ? 12000 : 5000);
  }

  async function loadActiveOrders() {
    const data = await apiFetch("/api/asztalos-delivery/orders/active");
    state.orders = data.orders || [];
    renderProjectList();

    if (state.selectedId && findOrder(state.selectedId)) {
      await selectDelivery(state.selectedId);
    } else if (state.orders.length === 1) {
      await selectDelivery(state.orders[0].deliveryId);
    }
  }

  function connectSocket() {
    if (typeof DivianRealtimeNotify === "undefined") {
      showAlert("Értesítő modul nem elérhető — nincs valós idejű frissítés", "error");
      return;
    }

    state.socket = DivianRealtimeNotify.start({
      role: "office",
      autoAskPermission: true,
      onConnect: (socket) => {
        $("liveBadge").classList.remove("hidden");
        $("liveBadge").classList.add("inline-flex");
        if (state.selectedId) {
          socket.emit("joinOrder", { deliveryId: state.selectedId });
        }
      },
      onItemStatusUpdated: (payload) => handleRealtimeUpdate(payload),
      onOrderSaved: () => loadActiveOrders().catch(() => {})
    });

    if (state.socket) {
      state.socket.on("disconnect", () => {
        $("liveBadge").classList.add("hidden");
        $("liveBadge").classList.remove("inline-flex");
      });
    }
  }

  async function loadActiveOrdersQuiet() {
    try {
      const data = await apiFetch("/api/asztalos-delivery/orders/active");
      state.orders = data.orders || [];
      renderProjectList();
      if (state.selectedId) {
        document.querySelectorAll(".project-card").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.deliveryId === state.selectedId);
        });
      }
    } catch (_e) {}
  }

  function bindEvents() {
    $("btnRefresh").addEventListener("click", () => {
      loadActiveOrders().catch((err) => showAlert(err.message, "error"));
    });
  }

  async function init() {
    bindEvents();
    try {
      await loadActiveOrders();
      connectSocket();
    } catch (err) {
      $("projectList").innerHTML =
        '<p class="text-red-400 text-sm font-mono py-8 text-center">' +
        escapeHtml(err.message) +
        "</p>";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
