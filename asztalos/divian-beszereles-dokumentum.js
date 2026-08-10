/**
 * Beszerelési átvételi nyilatkozat — nyomtatás + digitális aláírás (szállítás-szerű canvas).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DivianBeszerelesDokumentum = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function todayHu() {
    const d = new Date();
    const m = [
      "január",
      "február",
      "március",
      "április",
      "május",
      "június",
      "július",
      "augusztus",
      "szeptember",
      "október",
      "november",
      "december"
    ];
    return d.getFullYear() + ". " + m[d.getMonth()] + " " + d.getDate() + ".";
  }

  function jobFields(job) {
    const j = job && typeof job === "object" ? job : {};
    return {
      quoteNumber: String(j.quoteNumber || "").trim() || "—",
      customerName: String(j.customerName || "").trim() || "—",
      customerAddress: String(j.customerAddress || j.address || "").trim() || "—",
      customerPhone: String(j.customerPhone || "").trim() || "—",
      customerEmail: String(j.customerEmail || "").trim() || "—",
      carpenterName: String(j.installationClosedBy || j.carpenterName || "").trim() || ""
    };
  }

  const CHECK_LABELS = [
    "A beszerelés a megbeszélt / jóváhagyott terv szerint készült el.",
    "A látható felületeket, ajtókat, fiókokat és működést átnéztem.",
    "A hiányosságokat / sérüléseket (ha vannak) jeleztem, vagy „nincs” észrevételt rögzítettem."
  ];

  function liabilityPoints(designerName, companyName) {
    return [
      "A Megrendelő nem támaszt igényt " +
        designerName +
        " felé olyan esztétikai / elrendezési / méretezési kifogás miatt, amely a jóváhagyott tervből következik.",
      companyName +
        " / a tervező nem felel épületi, villamos, víz-gáz hibákért, egyenetlen falakért, páratartalomért, utólagos átalakításért vagy helytelen használatért.",
      "A szerelés minőségére vonatkozó észrevételeket az átvételkor kell jelezni.",
      "A jótállás / szavatosság a szerződés és a jogszabály szerint érvényes; ez a nyilatkozat az átvételt és a tervezői felelősség korlátait rögzíti."
    ];
  }

  function buildHtml(job, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const f = jobFields(job);
    const dateLine = String(o.dateLabel || todayHu());
    const designerName = String(o.designerName || "Divian Konyhastúdió / a konyhatervező").trim();
    const companyName = String(o.companyName || "Divian").trim();
    const signaturePng = String(o.signaturePng || "").trim();
    const notes = String(o.notes || "").trim() || "nincs";
    const checks = Array.isArray(o.checks) ? o.checks : [];

    const checkHtml = CHECK_LABELS.map(function (label, i) {
      const on = checks[i] === true || checks[i] === "1" || checks[i] === 1;
      return (
        "<label><input type='checkbox'" +
        (on ? " checked" : "") +
        " disabled/> " +
        escapeHtml(label) +
        "</label>"
      );
    }).join("");

    const signBlock = signaturePng
      ? "<div class='sign-box'><strong>Megrendelő digitális aláírása</strong>" +
        "Név: " +
        escapeHtml(f.customerName) +
        "<div style='margin-top:.5rem'><img src='" +
        signaturePng.replace(/'/g, "%27") +
        "' alt='Aláírás' style='max-width:100%;height:90px;object-fit:contain;background:#f7f7f7;border:1px solid #ccc'/></div>" +
        "<div style='margin-top:.35rem;font-size:.8rem;color:#444'>Digitálisan aláírva: " +
        escapeHtml(dateLine) +
        "</div></div>"
      : "<div class='sign-box'><strong>Megrendelő aláírása</strong>Név: " +
        escapeHtml(f.customerName) +
        "<div class='line'>aláírás</div></div>";

    return (
      "<!DOCTYPE html><html lang='hu'><head><meta charset='utf-8'/>" +
      "<meta name='viewport' content='width=device-width, initial-scale=1'/>" +
      "<title>Beszerelési átvételi nyilatkozat — " +
      escapeHtml(f.quoteNumber) +
      "</title><style>" +
      "*{box-sizing:border-box}" +
      "body{font-family:Georgia,'Times New Roman',serif;margin:0;padding:18px;color:#1a1a1a;background:#fff;line-height:1.45;font-size:14px}" +
      "h1{font-size:1.35rem;margin:0 0 .35rem;letter-spacing:.02em}" +
      ".sub{color:#555;margin:0 0 1.1rem;font-size:.92rem}" +
      ".meta{border:1px solid #222;padding:.7rem .85rem;margin:0 0 1rem}" +
      ".meta p{margin:.2rem 0}" +
      "h2{font-size:1.02rem;margin:1.1rem 0 .45rem;border-bottom:1px solid #ccc;padding-bottom:.2rem}" +
      "ol{margin:.35rem 0 .8rem;padding-left:1.25rem}" +
      "li{margin:.35rem 0}" +
      ".note{font-size:.86rem;color:#444;margin:.6rem 0 1rem}" +
      ".checks{margin:0 0 1rem}" +
      ".checks label{display:flex;gap:.55rem;align-items:flex-start;margin:.4rem 0}" +
      ".checks input{margin-top:.2rem;flex:0 0 auto}" +
      ".signs{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-top:1.4rem}" +
      ".sign-box{border:1px solid #222;min-height:7.5rem;padding:.65rem .75rem}" +
      ".sign-box strong{display:block;margin-bottom:.35rem;font-size:.9rem}" +
      ".line{margin-top:3.2rem;border-top:1px solid #222;padding-top:.25rem;font-size:.85rem;color:#333}" +
      ".foot{margin-top:1.2rem;font-size:.78rem;color:#666}" +
      "@media print{body{padding:10mm} .no-print{display:none!important} .sign-box{break-inside:avoid}}" +
      "@media (max-width:640px){.signs{grid-template-columns:1fr}}" +
      "</style></head><body>" +
      (signaturePng
        ? ""
        : "<p class='no-print' style='margin:0 0 12px'><button type='button' onclick='window.print()' style='font-size:16px;padding:10px 16px'>Nyomtatás / PDF mentés</button></p>") +
      "<h1>Beszerelési átvételi és felelősségkorlátozó nyilatkozat</h1>" +
      "<p class='sub'>Konyhabútor beszerelésének átvétele — a tervező védelmére és a munka lezárásához</p>" +
      "<div class='meta'>" +
      "<p><strong>Ajánlatszám / munkaszám:</strong> " +
      escapeHtml(f.quoteNumber) +
      "</p>" +
      "<p><strong>Megrendelő / átvevő:</strong> " +
      escapeHtml(f.customerName) +
      "</p>" +
      "<p><strong>Helyszín:</strong> " +
      escapeHtml(f.customerAddress) +
      "</p>" +
      "<p><strong>Telefon:</strong> " +
      escapeHtml(f.customerPhone) +
      " &nbsp;·&nbsp; <strong>E-mail:</strong> " +
      escapeHtml(f.customerEmail) +
      "</p>" +
      "<p><strong>Átvétel dátuma:</strong> " +
      escapeHtml(dateLine) +
      "</p>" +
      (signaturePng ? "<p><strong>Aláírás módja:</strong> digitális (telefon)</p>" : "") +
      "</div>" +
      "<h2>1. Átvételi nyilatkozat</h2>" +
      "<p>Alulírott Megrendelő kijelentem, hogy a fenti munkaszámú konyhabútor <strong>beszerelése a helyszínen megtörtént</strong>, a kész munkát megtekintettem, és azt – az alábbiak figyelembevételével – <strong>átveszem</strong>.</p>" +
      "<div class='checks'>" +
      checkHtml +
      "</div>" +
      "<p><strong>Észrevételek / hiányosságok a mai átvételkor:</strong></p>" +
      "<div style='border:1px solid #222;min-height:2.4rem;margin:.35rem 0 1rem;padding:.5rem'>" +
      escapeHtml(notes) +
      "</div>" +
      "<h2>2. Tervezői felelősségkorlátozás</h2>" +
      "<p>A Megrendelő tudomásul veszi és elfogadja, hogy a konyha <strong>terve, méretezése és vizuális kialakítása</strong> a megrendelés / gyártás előtt egyeztetésre és jóváhagyásra került. Ennek megfelelően:</p>" +
      "<ol>" +
      liabilityPoints(designerName, companyName)
        .map(function (p) {
          return "<li>" + escapeHtml(p) + "</li>";
        })
        .join("") +
      "</ol>" +
      "<p class='note'>A Megrendelő aláírásával megerősíti, hogy a fentieket elolvasta, megértette, és a beszerelt konyhát a mai napon átveszi.</p>" +
      "<div class='signs'>" +
      signBlock +
      "<div class='sign-box'><strong>Szerelést végző asztalos</strong>Név: " +
      escapeHtml(f.carpenterName || "________________") +
      "<div class='line'>rögzítve az appban</div></div>" +
      "</div>" +
      "<p class='foot'>" +
      escapeHtml(companyName) +
      " · Beszerelési átvételi nyilatkozat · " +
      escapeHtml(f.quoteNumber) +
      " · " +
      escapeHtml(dateLine) +
      "</p>" +
      "</body></html>"
    );
  }

  function openPrintWindow(job, opts) {
    const html = buildHtml(job, opts);
    const w = window.open("", "_blank");
    if (!w) {
      return { ok: false, error: "popup-blocked", message: "A böngésző blokkolta az ablakot — engedélyezd a felugró ablakokat." };
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    try {
      w.focus();
    } catch (_e) {}
    return { ok: true };
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || "").split(/\s+/);
    let line = "";
    let yy = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = words[i];
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, yy);
      yy += lineHeight;
    }
    return yy;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("signature-image-failed"));
      };
      img.src = src;
    });
  }

  /**
   * Digitálisan aláírt nyilatkozat → PNG (szerverre feltölthető).
   */
  async function renderSignedPng(job, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const f = jobFields(job);
    const dateLine = String(o.dateLabel || todayHu());
    const designerName = String(o.designerName || "a Divian konyhatervező / tervező").trim();
    const companyName = String(o.companyName || "Divian").trim();
    const notes = String(o.notes || "").trim() || "nincs";
    const checks = Array.isArray(o.checks) ? o.checks : [];
    const signaturePng = String(o.signaturePng || "").trim();
    if (!signaturePng) throw new Error("Nincs aláírás");

    const width = 900;
    const margin = 36;
    const maxW = width - margin * 2;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111111";
    ctx.textBaseline = "top";

    let y = margin;
    ctx.font = "bold 28px Georgia, serif";
    y = wrapText(ctx, "Beszerelési átvételi és felelősségkorlátozó nyilatkozat", margin, y, maxW, 34);
    y += 8;
    ctx.font = "16px Georgia, serif";
    ctx.fillStyle = "#444444";
    y = wrapText(ctx, "Digitális aláírás · " + companyName, margin, y, maxW, 22);
    y += 14;
    ctx.fillStyle = "#111111";
    ctx.font = "bold 17px Georgia, serif";
    y = wrapText(ctx, "Munkaszám: " + f.quoteNumber, margin, y, maxW, 24);
    ctx.font = "16px Georgia, serif";
    y = wrapText(ctx, "Megrendelő: " + f.customerName, margin, y, maxW, 22);
    y = wrapText(ctx, "Helyszín: " + f.customerAddress, margin, y, maxW, 22);
    y = wrapText(ctx, "Dátum: " + dateLine, margin, y, maxW, 22);
    y = wrapText(ctx, "Asztalos: " + (f.carpenterName || "—"), margin, y, maxW, 22);
    y += 16;

    ctx.font = "bold 18px Georgia, serif";
    y = wrapText(ctx, "1. Átvételi nyilatkozat", margin, y, maxW, 24);
    ctx.font = "15px Georgia, serif";
    y = wrapText(
      ctx,
      "A Megrendelő kijelenti, hogy a konyhabútor beszerelése megtörtént, a munkát megtekintette és átveszi.",
      margin,
      y,
      maxW,
      21
    );
    y += 8;
    for (let i = 0; i < CHECK_LABELS.length; i++) {
      const mark = checks[i] ? "[X] " : "[ ] ";
      y = wrapText(ctx, mark + CHECK_LABELS[i], margin, y, maxW, 20);
      y += 4;
    }
    y += 6;
    y = wrapText(ctx, "Észrevételek: " + notes, margin, y, maxW, 20);
    y += 14;

    ctx.font = "bold 18px Georgia, serif";
    y = wrapText(ctx, "2. Tervezői felelősségkorlátozás", margin, y, maxW, 24);
    ctx.font = "15px Georgia, serif";
    const points = liabilityPoints(designerName, companyName);
    for (let i = 0; i < points.length; i++) {
      y = wrapText(ctx, i + 1 + ". " + points[i], margin, y, maxW, 20);
      y += 6;
    }
    y += 10;
    ctx.font = "bold 16px Georgia, serif";
    y = wrapText(ctx, "Megrendelő digitális aláírása", margin, y, maxW, 22);
    y += 6;

    const img = await loadImage(signaturePng);
    const sigH = 120;
    const sigW = Math.min(maxW, Math.round((img.width / Math.max(img.height, 1)) * sigH));
    ctx.strokeStyle = "#cccccc";
    ctx.strokeRect(margin, y, maxW, sigH + 16);
    ctx.drawImage(img, margin + 8, y + 8, sigW, sigH);
    y += sigH + 28;

    ctx.font = "13px Georgia, serif";
    ctx.fillStyle = "#555555";
    y = wrapText(
      ctx,
      companyName + " · Digitális beszerelési nyilatkozat · " + f.quoteNumber + " · " + dateLine,
      margin,
      y,
      maxW,
      18
    );
    y += margin;

    const out = document.createElement("canvas");
    out.width = width;
    out.height = Math.min(Math.max(Math.ceil(y), 900), 2400);
    const octx = out.getContext("2d");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL("image/png");
  }

  function createSignaturePad(canvas, options) {
    const o = options && typeof options === "object" ? options : {};
    const strokeStyle = o.strokeStyle || "#111111";
    const lineWidth = o.lineWidth || 2.4;
    const ctx = canvas.getContext("2d");
    let drawing = false;
    let hasStroke = false;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const ratio = window.devicePixelRatio || 1;
      const prev = hasStroke ? canvas.toDataURL("image/png") : null;
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (prev) {
        const img = new Image();
        img.onload = function () {
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
        };
        img.src = prev;
      }
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

    return {
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
  }

  return {
    CHECK_LABELS,
    liabilityPoints,
    buildHtml,
    openPrintWindow,
    renderSignedPng,
    createSignaturePad,
    jobFields,
    todayHu
  };
});
