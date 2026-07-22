"use strict";

const express = require("express");
const {
  saveOrderFromPayload,
  fetchDeliveryItems,
  updateItemStatus,
  fetchStatusLookups,
  fetchActiveDeliveries,
  searchDeliveries,
  buildSocketPayload
} = require("./asztalos-delivery-service");
const {
  broadcastAppChange,
  describeItemStatusUpdate,
  describeOrderSaved
} = require("./asztalos-delivery-broadcast");

function createAsztalosDeliveryRouter(getIo) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, module: "asztalos-delivery", realtime: !!getIo() });
  });

  router.get("/statuses", (_req, res) => {
    try {
      res.json({ ok: true, ...fetchStatusLookups() });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  router.get("/orders/active", (_req, res) => {
    try {
      const orders = fetchActiveDeliveries();
      res.json({ ok: true, orders, count: orders.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  router.get("/orders/search", async (req, res) => {
    try {
      const q = String(req.query?.q || req.query?.name || "").trim();
      const orders = await searchDeliveries(q);
      res.json({ ok: true, q, orders, count: orders.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  router.post("/orders", (req, res) => {
    try {
      const payload = req.body?.payload || req.body;
      if (!payload || typeof payload !== "object") {
        res.status(400).json({ ok: false, error: "missing-payload" });
        return;
      }
      const meta = {
        sourceKind: req.body?.sourceKind || "arajanlat_sync",
        sourcePayloadPath: req.body?.sourcePayloadPath || null,
        sourcePayloadHash: req.body?.sourcePayloadHash || null
      };
      const result = saveOrderFromPayload(payload, meta);
      const savedPayload = {
        deliveryId: result.quoteNumber,
        orderId: result.orderId,
        itemCount: result.itemCount,
        delivery: result.delivery,
        savedAt: new Date().toISOString()
      };
      const desc = describeOrderSaved(savedPayload);
      broadcastAppChange(getIo(), "order:saved", savedPayload, {
        source: "asztalos-delivery",
        title: desc.title,
        body: desc.body,
        level: desc.level
      });
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });

  router.get("/:deliveryId/items", async (req, res) => {
    try {
      const data = await fetchDeliveryItems(req.params.deliveryId);
      if (data?.changed) {
        const savedPayload = {
          deliveryId: data.deliveryId,
          orderId: data.order?.id,
          itemCount: Array.isArray(data.items) ? data.items.length : 0,
          delivery: data,
          savedAt: new Date().toISOString(),
          source: "megrendelo-refresh"
        };
        const desc = describeOrderSaved(savedPayload);
        let io = null;
        try {
          io = typeof getIo === "function" ? getIo() : null;
        } catch (_e) {}
        if (!io) {
          try {
            io = require("./divian-realtime-hub").getRealtimeIo();
          } catch (_e2) {}
        }
        broadcastAppChange(io, "order:saved", savedPayload, {
          source: "asztalos-delivery",
          title: desc.title,
          body: desc.body || "Megrendelő frissült",
          level: desc.level
        });
      }
      res.json({ ok: true, ...data });
    } catch (err) {
      const status = err.code === "delivery-not-found" ? 404 : 500;
      res.status(status).json({ ok: false, error: String(err?.message || err) });
    }
  });

  router.patch("/items/:itemId/status", (req, res) => {
    try {
      const itemId = Number(req.params.itemId);
      if (!itemId) {
        res.status(400).json({ ok: false, error: "invalid-item-id" });
        return;
      }
      const updateResult = updateItemStatus(itemId, req.body || {});
      const socketPayload = buildSocketPayload(updateResult);
      const desc = describeItemStatusUpdate(socketPayload);
      broadcastAppChange(getIo(), "item:statusUpdated", socketPayload, {
        source: "asztalos-delivery",
        title: desc.title,
        body: desc.body,
        level: desc.level
      });
      res.json({ ok: true, ...socketPayload });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });

  return router;
}

function createAsztalosDeliveryApp(getIo) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });
  app.options(/.*/, (_req, res) => res.sendStatus(204));
  app.use("/api/asztalos-delivery", createAsztalosDeliveryRouter(getIo));
  return app;
}

module.exports = {
  createAsztalosDeliveryApp,
  createAsztalosDeliveryRouter
};
