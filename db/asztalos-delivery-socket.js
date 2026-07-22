"use strict";

const { Server } = require("socket.io");

function initAsztalosDeliverySocket(httpServer) {
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"]
  });

  io.on("connection", (socket) => {
    const clientRole = String(socket.handshake.query?.role || "unknown");
    console.log("[Socket.io] csatlakozás:", socket.id, "role=" + clientRole);
    socket.join("all");

    socket.on("joinAll", () => {
      socket.join("all");
      socket.emit("joined", { room: "all", role: clientRole });
    });

    socket.on("joinOffice", () => {
      socket.join("office");
      socket.emit("joined", { room: "office", role: "office" });
    });

    socket.on("joinOrder", (payload) => {
      const deliveryId = String(payload?.deliveryId || payload || "")
        .trim()
        .toUpperCase();
      if (!deliveryId) {
        socket.emit("error", { message: "Hiányzó deliveryId" });
        return;
      }
      const room = "order:" + deliveryId;
      socket.join(room);
      socket.emit("joined", { room, deliveryId, role: clientRole });
    });

    socket.on("leaveOrder", (payload) => {
      const deliveryId = String(payload?.deliveryId || payload || "")
        .trim()
        .toUpperCase();
      if (!deliveryId) return;
      socket.leave("order:" + deliveryId);
    });

    socket.on("ping", () => {
      socket.emit("pong", { at: new Date().toISOString() });
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket.io] bontás:", socket.id, reason);
    });
  });

  return io;
}

module.exports = {
  initAsztalosDeliverySocket
};
