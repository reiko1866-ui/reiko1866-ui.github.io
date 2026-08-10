/**
 * Egységes ügyfél-fejléc — asztalos / szállító: név, cím, hívás, Waze.
 */
(function (root) {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function customerFields(entry) {
    const e = entry && typeof entry === "object" ? entry : {};
    return {
      name: String(e.customerName || e.customer?.name || "").trim(),
      quoteNumber: String(e.quoteNumber || e.deliveryId || "").trim(),
      address: String(e.customerAddress || e.address || e.customer?.address || "").trim(),
      phone: String(e.customerPhone || e.customer?.phone || "").trim(),
      email: String(e.customerEmail || e.customer?.email || "").trim()
    };
  }

  function phoneHref(phone) {
    const digits = String(phone || "").replace(/[^\d+]/g, "");
    return digits ? "tel:" + digits : "";
  }

  function wazeHref(address) {
    const q = String(address || "").trim();
    if (!q) return "";
    return "https://waze.com/ul?q=" + encodeURIComponent(q) + "&navigate=yes";
  }

  function mapsHref(address) {
    const q = String(address || "").trim();
    if (!q) return "";
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q);
  }

  /** Nagy érintőgombok: Hívás + Waze (+ Maps). */
  function renderContactActions(entry, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const c = customerFields(entry);
    const tel = phoneHref(c.phone);
    const waze = wazeHref(c.address);
    const maps = mapsHref(c.address);
    if (!tel && !waze && !maps) return "";

    const parts = ['<div class="customer-actions">'];
    if (tel) {
      parts.push(
        '<a class="customer-action-btn customer-action-call" href="' +
          escapeHtml(tel) +
          '"><span class="customer-action-ico" aria-hidden="true">📞</span><span>Hívás</span>' +
          (c.phone ? '<span class="customer-action-sub">' + escapeHtml(c.phone) + "</span>" : "") +
          "</a>"
      );
    }
    if (waze) {
      parts.push(
        '<a class="customer-action-btn customer-action-waze" href="' +
          escapeHtml(waze) +
          '" target="_blank" rel="noopener"><span class="customer-action-ico" aria-hidden="true">🗺️</span><span>Waze</span>' +
          '<span class="customer-action-sub">Navigáció</span></a>'
      );
    }
    if (maps && o.showMaps !== false) {
      parts.push(
        '<a class="customer-action-btn customer-action-maps" href="' +
          escapeHtml(maps) +
          '" target="_blank" rel="noopener"><span class="customer-action-ico" aria-hidden="true">📍</span><span>Maps</span>' +
          '<span class="customer-action-sub">Google</span></a>'
      );
    }
    parts.push("</div>");
    return parts.join("");
  }

  /** Egyszerű fejléc: név, sorszám, cím + opcionális hívás/navigáció gombok. */
  function renderCustomerHead(entry, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const c = customerFields(entry);
    const name = c.name || o.fallbackName || "Ügyfél";
    const headingTag = o.headingTag === "h4" ? "h4" : "h3";
    const showContact = o.showContact !== false && !o.compact;
    const showActions = o.showActions === true || (showContact && o.showActions !== false);
    const parts = [
      '<div class="customer-head">',
      "<" + headingTag + ' class="customer-head-name">' + escapeHtml(name) + "</" + headingTag + ">"
    ];

    parts.push('<p class="customer-head-line">' + escapeHtml(c.quoteNumber || "—") + "</p>");
    if (c.address) {
      const nav = wazeHref(c.address);
      if (nav && o.linkAddress !== false && !o.compact) {
        parts.push(
          '<p class="customer-head-line"><a href="' +
            escapeHtml(nav) +
            '" target="_blank" rel="noopener">' +
            escapeHtml(c.address) +
            "</a></p>"
        );
      } else {
        parts.push('<p class="customer-head-line">' + escapeHtml(c.address) + "</p>");
      }
    }
    if (showContact && c.phone) {
      const phoneHtml =
        o.linkPhone !== false && phoneHref(c.phone)
          ? '<a href="' + escapeHtml(phoneHref(c.phone)) + '">' + escapeHtml(c.phone) + "</a>"
          : escapeHtml(c.phone);
      parts.push('<p class="customer-head-line">' + phoneHtml + "</p>");
    }
    if (showContact && c.email) {
      const emailHtml =
        o.linkEmail !== false
          ? '<a href="mailto:' + escapeHtml(c.email) + '">' + escapeHtml(c.email) + "</a>"
          : escapeHtml(c.email);
      parts.push('<p class="customer-head-line">' + emailHtml + "</p>");
    }
    if (showActions) {
      parts.push(renderContactActions(entry, o));
    }

    parts.push("</div>");
    return parts.join("");
  }

  root.DivianCustomerBanner = {
    customerFields,
    phoneHref,
    wazeHref,
    mapsHref,
    renderContactActions,
    renderCustomerHead,
    renderCustomerBanner: renderCustomerHead,
    escapeHtml
  };
})(typeof window !== "undefined" ? window : global);
