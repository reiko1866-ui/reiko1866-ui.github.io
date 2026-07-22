(function () {
  "use strict";

  const APP_VERSION = "20260718btn";
  const LS_DELIVERY_ID = "divian_szallitas_delivery_id";
  const LS_COURIER = "divian_szallitas_courier";

  const CATEGORY_ORDER = [
    { code: "butortest_lap", label: "Bútortestek" },
    { code: "vasalat_kiegeszito", label: "Vasalatok és kiegészítők" },
    { code: "gyari_tartozek", label: "Gyári tartozékok" },
    { code: "beepitheto_gep", label: "Beépíthető gépek" }
  ];

  // Csak helyszíni átadás (raklapos felvétel nincs — tételes ellenőrzés lerakodáskor)
  const ACTIONS = {
    ok: { scope: "helyszin", status: "atadva", label: "Átadva" },
    hianyzik: { scope: "helyszin", status: "hianyzik", label: "Hiányzik" },
    serult: { scope: "helyszin", status: "serult", label: "Sérült" }
  };

  let state = {
    deliveryId: "",
    courierName: "",
    order: null,
    items: [],
    loading: false,
    pendingItemId: null,
    socket: null,
    signaturePad: null
  };

  const $ = (id) => document.getElementById(id);

  function normalizeDeliveryIdInput(raw) {
    let s = String(raw || "").trim();
    s = s.replace(/\s*[\(\[\{].*$/, "");
    s = s.replace(/\s*[—–]\s+.+$/u, "");
    s = (s.split(/\s+/)[0] || s).trim();
    return s.toUpperCase();
  }

  function friendlyLoadError(err) {
    const msg = String(err?.message || err || "");
    if (msg === "not-found" || /not-found/i.test(msg)) {
      return (
        "A szállítási API nem elérhető. Indítsd újra a kalkulátort (INDITAS.bat), " +
        "majd írd be csak az ajánlatszámot — pl. MRDH-VACI-26-0555 (ügyfélnév nélkül)."
      );
    }
    return msg;
  }

  function apiBase() {
    return window.location.origin.replace(/\/$/, "");
  }

  function showToast(message, type) {
    const host = $("toastHost");
    if (!host) {
      try {
        window.alert(message);
      } catch (_e) {}
      return;
    }
    const el = document.createElement("div");
    const kind = type === "error" ? "toast-error" : type === "ok" ? "toast-ok" : "toast-info";
    el.className = "toast-card " + kind;
    el.setAttribute("role", "status");
    el.textContent = message;
    host.prepend(el);
    window.setTimeout(() => el.remove(), 4500);
  }

  function flashCard(card, kind) {
    if (!card) return;
    card.classList.remove("is-flash-ok", "is-flash-err");
    void card.offsetWidth;
    card.classList.add(kind === "error" ? "is-flash-err" : "is-flash-ok");
    window.setTimeout(() => {
      card.classList.remove("is-flash-ok", "is-flash-err");
    }, 900);
  }

  function hapticLight() {
    try {
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (_e) {}
  }

  function showScreen(name) {
    $("screenLoad").classList.toggle("hidden", name !== "load");
    $("screenMain").classList.toggle("hidden", name !== "main");
  }

  function setLoadError(msg) {
    const el = $("loadError");
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  async function apiFetch(path, options) {
    const res = await fetch(apiBase() + path, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...options
    });
    let body = {};
    try {
      body = await res.json();
    } catch (_e) {
      body = {};
    }
    if (!res.ok || body.ok === false) {
      const err = new Error(body.error || "HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async function loadDelivery(deliveryId, opts) {
    const soft = !!(opts && opts.soft);
    const id = String(deliveryId || state.deliveryId || "").trim();
    if (!id) return;
    state.loading = true;
    if (!soft) {
      $("itemsLoading")?.classList.remove("hidden");
      $("itemsContainer")?.classList.add("hidden");
    }
    try {
      const data = await apiFetch(
        "/api/asztalos-delivery/" + encodeURIComponent(id) + "/items"
      );
      state.deliveryId = data.deliveryId || id;
      state.order = data.order;
      state.items = Array.isArray(data.items) ? data.items : [];
      localStorage.setItem(LS_DELIVERY_ID, state.deliveryId);
      connectSocket();
      renderAll();
      if (!soft) setSignPanelOpen(false);
      showScreen("main");
    } finally {
      state.loading = false;
      if (!soft) {
        $("itemsLoading")?.classList.add("hidden");
      }
    }
  }

  async function patchItemStatus(itemId, scope, status, note) {
    const payload = {
      scope,
      statusCode: status,
      changedBy: state.courierName || "szállító",
      note: note || ""
    };
    const result = await apiFetch("/api/asztalos-delivery/items/" + itemId + "/status", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    if (result.item) {
      const idx = state.items.findIndex((i) => i.id === itemId);
      if (idx >= 0) state.items[idx] = result.item;
    }
    return result;
  }

  function itemStatus(item) {
    const h = item.statusHelyszin?.code || "nincs";
    if (h === "atadva" || h === "kiszallitva") return "ok";
    if (h === "hianyzik" || h === "serult") return "missing";
    if (h === "utvon") return "in-transit";
    return "pending";
  }

  function deliveryProgress() {
    let done = 0;
    state.items.forEach((item) => {
      if (itemStatus(item) === "ok") done++;
    });
    return { done, total: state.items.length };
  }

  function groupItemsByCategory(items) {
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

  function statusLabel(item) {
    return item.statusHelyszin?.label || "—";
  }

  function renderHeader() {
    $("hdrDeliveryId").textContent = state.deliveryId;
    $("hdrCustomerName").textContent = state.order?.customerName || "—";
    $("hdrCustomerAddress").textContent = state.order?.customerAddress || "—";

    const prog = deliveryProgress();
    $("hdrProgress").textContent = prog.done + " / " + prog.total + " átadva";
    $("hdrStatusText").textContent = "Helyszíni átadás";
  }

  function renderItemCard(item) {
    const ui = itemStatus(item);
    const card = document.createElement("article");
    card.className =
      "item-card rounded-xl border-2 border-slate-700 bg-slate-800/70 p-3 flex gap-3 items-stretch";
    card.dataset.itemId = String(item.id);
    card.dataset.ui = ui;

    const info = document.createElement("div");
    info.className = "flex-1 min-w-0 flex flex-col justify-center";
    info.innerHTML =
      '<p class="text-base font-semibold text-white leading-snug truncate">' +
      escapeHtml(item.name) +
      "</p>" +
      '<p class="text-xs font-mono text-slate-500 mt-0.5">' +
      (item.code ? escapeHtml(item.code) + " · " : "") +
      escapeHtml(String(item.qty)) +
      " " +
      escapeHtml(item.qtyUnit || "db") +
      "</p>" +
      '<p class="text-[11px] font-mono uppercase tracking-wide mt-1.5 ' +
      (ui === "ok"
        ? "text-emerald-400"
        : ui === "missing"
          ? "text-red-400"
          : "text-slate-500") +
      '" data-status-label>' +
      escapeHtml(statusLabel(item)) +
      "</p>";

    const actions = document.createElement("div");
    actions.className = "flex flex-col gap-2 shrink-0";

    const btnOk = document.createElement("button");
    btnOk.type = "button";
    btnOk.className =
      "btn-action flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-xl border-2 border-emerald-500/50 bg-emerald-500/15 text-3xl text-emerald-400 active:bg-emerald-500/30 disabled:opacity-40";
    btnOk.setAttribute("aria-label", "Átadva");
    btnOk.setAttribute("data-action", "ok");
    btnOk.setAttribute("data-item-id", String(item.id));
    btnOk.textContent = "✓";
    btnOk.disabled = state.loading;

    const btnBad = document.createElement("button");
    btnBad.type = "button";
    btnBad.className =
      "btn-action flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-xl border-2 border-red-500/50 bg-red-500/10 text-3xl font-bold text-red-400 active:bg-red-500/25 disabled:opacity-40";
    btnBad.setAttribute("aria-label", "Hiányzik vagy sérült");
    btnBad.setAttribute("data-action", "issue");
    btnBad.setAttribute("data-item-id", String(item.id));
    btnBad.textContent = "✕";
    btnBad.disabled = state.loading;

    actions.appendChild(btnOk);
    actions.appendChild(btnBad);
    card.appendChild(info);
    card.appendChild(actions);
    return card;
  }

  function renderItems() {
    const container = $("itemsContainer");
    container.innerHTML = "";
    const groups = groupItemsByCategory(state.items);

    if (!groups.length) {
      container.innerHTML =
        '<p class="text-center text-slate-500 font-mono py-12">Nincs tétel ebben a szállításban.</p>';
    } else {
      groups.forEach((group) => {
        const section = document.createElement("section");
        section.innerHTML =
          '<h3 class="text-xs font-mono uppercase tracking-[0.15em] text-amber-500/90 mb-3 sticky top-28 bg-slate-900/95 py-1">' +
          escapeHtml(group.label) +
          ' <span class="text-slate-600">(' +
          group.items.length +
          ")</span></h3>";
        const list = document.createElement("div");
        list.className = "space-y-3";
        group.items.forEach((item) => list.appendChild(renderItemCard(item)));
        section.appendChild(list);
        container.appendChild(section);
      });
    }

    $("itemsLoading").classList.add("hidden");
    container.classList.remove("hidden");
  }

  function renderAll() {
    renderHeader();
    renderItems();
  }

  function updateItemCardDom(item) {
    const card = document.querySelector('[data-item-id="' + item.id + '"]');
    if (!card) return;
    const ui = itemStatus(item);
    card.dataset.ui = ui;
    const labelEl = card.querySelector("[data-status-label]");
    if (labelEl) {
      labelEl.textContent = statusLabel(item);
      labelEl.className =
        "text-[11px] font-mono uppercase tracking-wide mt-1.5 " +
        (ui === "ok" ? "text-emerald-400" : ui === "missing" ? "text-red-400" : "text-slate-500");
    }
  }

  let statusBusy = false;

  async function onOkClick(itemId) {
    if (statusBusy) return;
    statusBusy = true;
    const action = ACTIONS.ok;
    const card = document.querySelector('[data-item-id="' + itemId + '"]');
    const btn = card?.querySelector('button[data-action="ok"]');
    hapticLight();
    flashCard(card, "ok");
    if (btn) btn.disabled = true;
    if (card) {
      card.dataset.ui = "ok";
      const labelEl = card.querySelector("[data-status-label]");
      if (labelEl) {
        labelEl.textContent = "Feltöltés…";
        labelEl.className = "text-[11px] font-mono uppercase tracking-wide mt-1.5 text-amber-400";
      }
    }
    showToast("Átadás küldése…", "info");
    try {
      const result = await patchItemStatus(itemId, action.scope, action.status);
      const item = result.item || state.items.find((i) => i.id === itemId);
      if (item) updateItemCardDom(item);
      renderHeader();
      showToast("Átadva — feltöltve az irodába ✓", "ok");
    } catch (err) {
      flashCard(card, "error");
      if (card) {
        card.dataset.ui = "pending";
        const labelEl = card.querySelector("[data-status-label]");
        if (labelEl) {
          labelEl.textContent = "Hiba — próbáld újra";
          labelEl.className = "text-[11px] font-mono uppercase tracking-wide mt-1.5 text-red-400";
        }
      }
      showToast(err.message || "Feltöltés sikertelen", "error");
    } finally {
      if (btn) btn.disabled = false;
      statusBusy = false;
    }
  }

  function onIssueClick(item) {
    hapticLight();
    state.pendingItemId = item.id;
    $("modalIssueItemName").textContent = item.name;
    $("modalIssue").classList.remove("hidden");
  }

  async function applyIssue(statusCode) {
    const itemId = state.pendingItemId;
    if (!itemId) return;
    $("modalIssue").classList.add("hidden");
    const cfg = statusCode === "serult" ? ACTIONS.serult : ACTIONS.hianyzik;
    const card = document.querySelector('[data-item-id="' + itemId + '"]');
    hapticLight();
    flashCard(card, "error");
    if (card) {
      const labelEl = card.querySelector("[data-status-label]");
      if (labelEl) {
        labelEl.textContent = "Feltöltés…";
        labelEl.className = "text-[11px] font-mono uppercase tracking-wide mt-1.5 text-amber-400";
      }
    }
    showToast(cfg.label + " küldése…", "info");
    try {
      const result = await patchItemStatus(itemId, cfg.scope, cfg.status);
      const item = result.item || state.items.find((i) => i.id === itemId);
      if (item) updateItemCardDom(item);
      renderHeader();
      showToast(cfg.label + " — feltöltve az irodába", "error");
    } catch (err) {
      showToast(err.message || "Feltöltés sikertelen", "error");
    }
    state.pendingItemId = null;
  }

  let searchTimer = null;

  function renderSearchResults(orders) {
    const box = $("searchResults");
    const empty = $("searchEmpty");
    box.innerHTML = "";
    if (!orders.length) {
      box.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    box.classList.remove("hidden");
    orders.forEach((order) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "btn-action w-full text-left rounded-xl border-2 border-slate-700 bg-slate-800/70 px-4 py-3 active:border-amber-500/60";
      btn.innerHTML =
        '<p class="font-semibold text-white truncate">' +
        escapeHtml(order.customerName || "Ismeretlen") +
        "</p>" +
        '<p class="text-xs font-mono text-slate-500 mt-0.5 truncate">' +
        escapeHtml(order.deliveryId || "") +
        (order.customerAddress ? " · " + escapeHtml(order.customerAddress) : "") +
        "</p>";
      btn.addEventListener("click", async () => {
        $("inputDeliveryId").value = order.deliveryId || "";
        $("inputCustomerSearch").value = order.customerName || "";
        setLoadError("");
        $("btnLoadDelivery").disabled = true;
        try {
          await loadDelivery(order.deliveryId);
        } catch (err) {
          setLoadError(friendlyLoadError(err));
        } finally {
          $("btnLoadDelivery").disabled = false;
        }
      });
      box.appendChild(btn);
    });
  }

  async function runCustomerSearch(q) {
    if (q.length < 2) {
      $("searchResults").classList.add("hidden");
      $("searchResults").innerHTML = "";
      $("searchEmpty").classList.add("hidden");
      return;
    }
    try {
      const data = await apiFetch(
        "/api/asztalos-delivery/orders/search?q=" + encodeURIComponent(q)
      );
      renderSearchResults(data.orders || []);
    } catch (err) {
      $("searchResults").classList.add("hidden");
      setLoadError(friendlyLoadError(err));
    }
  }

  function connectSocket() {
    if (typeof io !== "function") {
      $("hdrLiveDot").classList.add("hidden");
      return;
    }
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    state.socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      query: { role: "courier" }
    });
    state.socket.on("connect", () => {
      $("hdrLiveDot").classList.remove("hidden");
      state.socket.emit("joinOrder", { deliveryId: state.deliveryId });
    });
    state.socket.on("disconnect", () => {
      $("hdrLiveDot").classList.add("hidden");
    });
    state.socket.on("item:statusUpdated", (payload) => {
      if (!payload?.item) return;
      const idx = state.items.findIndex((i) => i.id === payload.itemId);
      if (idx >= 0) {
        state.items[idx] = payload.item;
        updateItemCardDom(payload.item);
        renderHeader();
      }
    });
    state.socket.on("order:saved", (payload) => {
      const pid = String(payload?.deliveryId || payload?.quoteNumber || "").trim().toUpperCase();
      const current = String(state.deliveryId || "").trim().toUpperCase();
      if (!current || !pid || pid !== current) return;
      if (payload?.delivery?.items) {
        state.items = payload.delivery.items;
        if (payload.delivery.order) state.order = payload.delivery.order;
        renderItems();
        renderHeader();
      } else {
        loadDelivery(state.deliveryId, { soft: true }).catch(() => {});
      }
    });
    state.socket.on("app:change", (envelope) => {
      const event = String(envelope?.event || "").toLowerCase();
      const p = envelope?.payload || {};
      const pid = String(p.deliveryId || p.quoteNumber || "").trim().toUpperCase();
      const current = String(state.deliveryId || "").trim().toUpperCase();
      if (!current) return;
      if (event === "order:saved" || event.indexOf("megrendelo") >= 0 || event.indexOf("order") >= 0) {
        if (!pid || pid === current) {
          loadDelivery(state.deliveryId, { soft: true }).catch(() => {});
        }
      }
    });
  }

  function setSignPanelOpen(open) {
    const panel = $("signPanel");
    const compact = $("footerCompact");
    const main = $("screenMain");
    if (!panel || !compact) return;
    panel.classList.toggle("hidden", !open);
    compact.classList.toggle("hidden", open);
    if (main) main.classList.toggle("sign-open", !!open);
    if (open) {
      state.signaturePad = null;
      window.requestAnimationFrame(() => initSignaturePad());
    }
  }

  function initSignaturePad() {
    const canvas = $("signatureCanvas");
    if (!canvas) return;
    // Újrainit, ha a panel újra kinyílik
    if (state.signaturePad) return;

    const ctx = canvas.getContext("2d");
    let drawing = false;
    let hasStroke = false;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }

    function start(e) {
      e.preventDefault();
      drawing = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      hasStroke = true;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    function end() {
      drawing = false;
    }

    resize();
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);

    state.signaturePad = {
      clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasStroke = false;
      },
      isEmpty() {
        return !hasStroke;
      },
      toDataURL() {
        return canvas.toDataURL("image/png");
      },
      resize
    };

    window.addEventListener("resize", () => {
      if (state.signaturePad) state.signaturePad.resize();
    });
  }

  function completeDelivery() {
    if (!state.signaturePad || state.signaturePad.isEmpty()) {
      showToast("Kérjük az ügyfél aláírását!", "error");
      return;
    }
    const prog = deliveryProgress();
    if (prog.total > 0 && prog.done < prog.total) {
      const ok = window.confirm(
        "Nem minden tétel van átadva (" +
          prog.done +
          "/" +
          prog.total +
          "). Lezárod így is?"
      );
      if (!ok) return;
    }

    const signatureData = state.signaturePad.toDataURL();
    const record = {
      deliveryId: state.deliveryId,
      customerName: state.order?.customerName,
      courierName: state.courierName,
      completedAt: new Date().toISOString(),
      signaturePng: signatureData
    };
    try {
      localStorage.setItem(
        "divian_szallitas_sign_" + state.deliveryId,
        JSON.stringify(record)
      );
    } catch (_e) {}

    $("successMessage").textContent =
      state.deliveryId +
      " · " +
      (state.order?.customerName || "") +
      " · aláírás elmentve.";
    $("modalSuccess").classList.remove("hidden");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindEvents() {
    $("appVersion").textContent = APP_VERSION;

    // Mobil: delegated kattintás (ha a gomb a lista alján van)
    $("itemsRoot")?.addEventListener(
      "click",
      (ev) => {
        const btn = ev.target.closest("button[data-action]");
        if (!btn || btn.disabled) return;
        const itemId = Number(btn.getAttribute("data-item-id"));
        if (!itemId) return;
        const action = btn.getAttribute("data-action");
        if (action === "ok") {
          ev.preventDefault();
          onOkClick(itemId);
        } else if (action === "issue") {
          ev.preventDefault();
          const item = state.items.find((i) => Number(i.id) === itemId);
          if (item) onIssueClick(item);
        }
      },
      true
    );

    $("loadForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      setLoadError("");
      const id = normalizeDeliveryIdInput($("inputDeliveryId").value);
      $("inputDeliveryId").value = id;
      const courier = $("inputCourierName").value.trim();
      if (!id) {
        setLoadError("Válassz megrendelőt a keresésből, vagy add meg az ajánlatszámot.");
        return;
      }
      state.courierName = courier;
      if (courier) localStorage.setItem(LS_COURIER, courier);
      $("btnLoadDelivery").disabled = true;
      try {
        await loadDelivery(id);
      } catch (err) {
        setLoadError(friendlyLoadError(err));
      } finally {
        $("btnLoadDelivery").disabled = false;
      }
    });

    $("inputCustomerSearch").addEventListener("input", () => {
      const q = $("inputCustomerSearch").value.trim();
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => runCustomerSearch(q), 280);
    });

    $("btnChangeDelivery").addEventListener("click", () => {
      if (state.socket) state.socket.disconnect();
      state.socket = null;
      state.signaturePad = null;
      setSignPanelOpen(false);
      showScreen("load");
    });

    $("btnClearSignature").addEventListener("click", () => {
      if (state.signaturePad) state.signaturePad.clear();
    });

    $("btnShowSign")?.addEventListener("click", () => setSignPanelOpen(true));
    $("btnHideSign")?.addEventListener("click", () => setSignPanelOpen(false));

    $("btnCompleteDelivery").addEventListener("click", completeDelivery);

    $("btnModalIssueCancel").addEventListener("click", () => {
      state.pendingItemId = null;
      $("modalIssue").classList.add("hidden");
    });

    $("modalIssue").addEventListener("click", (e) => {
      if (e.target === $("modalIssue")) {
        state.pendingItemId = null;
        $("modalIssue").classList.add("hidden");
      }
    });

    document.querySelectorAll("#modalIssue [data-issue]").forEach((btn) => {
      btn.addEventListener("click", () => applyIssue(btn.getAttribute("data-issue")));
    });

    $("btnSuccessOk").addEventListener("click", () => {
      $("modalSuccess").classList.add("hidden");
      if (state.socket) state.socket.disconnect();
      state = {
        deliveryId: "",
        courierName: state.courierName,
        order: null,
        items: [],
        loading: false,
        pendingItemId: null,
        socket: null,
        signaturePad: null
      };
      $("inputDeliveryId").value = "";
      showScreen("load");
    });
  }

  function init() {
    bindEvents();
    if (typeof DivianRealtimeNotify !== "undefined") {
      DivianRealtimeNotify.start({
        role: "courier",
        ignoreSelfCourier: true,
        autoAskPermission: true,
        shouldIgnoreChange: (envelope) => {
          const id = Number(envelope?.payload?.itemId);
          return !!(id && state.pendingItemId && id === Number(state.pendingItemId));
        },
        onChange: (envelope) => {
          if (!state.deliveryId) return;
          const event = String(envelope?.event || "").toLowerCase();
          const p = envelope?.payload || {};
          const pid = String(p.deliveryId || p.quoteNumber || "").trim().toUpperCase();
          const current = String(state.deliveryId || "").trim().toUpperCase();
          if (
            event === "order:saved" ||
            event.indexOf("megrendelo") >= 0 ||
            (pid && pid === current)
          ) {
            loadDelivery(state.deliveryId, { soft: true }).catch(() => {});
          }
        }
      });
    }
    const savedId = localStorage.getItem(LS_DELIVERY_ID);
    const savedCourier = localStorage.getItem(LS_COURIER);
    if (savedCourier) $("inputCourierName").value = savedCourier;
    if (savedId) $("inputDeliveryId").value = savedId;

    const params = new URLSearchParams(window.location.search);
    const qId = params.get("id") || params.get("deliveryId");
    if (qId) {
      $("inputDeliveryId").value = normalizeDeliveryIdInput(qId);
      if (params.get("autoload") === "1") {
        $("loadForm").requestSubmit();
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
