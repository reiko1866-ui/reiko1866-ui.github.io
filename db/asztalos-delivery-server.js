"use strict";

const http = require("http");
const { createAsztalosDeliveryApp } = require("./asztalos-delivery-express");
const { initAsztalosDeliverySocket } = require("./asztalos-delivery-socket");

const DEFAULT_PORT = Number(process.env.DIVIAN_ASZTALOS_DELIVERY_PORT || 17323);

function attachAsztalosDeliveryToHttpServer(httpServer) {
  const ioRef = { current: null };
  const getIo = () => ioRef.current;
  const app = createAsztalosDeliveryApp(getIo);
  ioRef.current = initAsztalosDeliverySocket(httpServer);
  try {
    const { setRealtimeIo } = require("./divian-realtime-hub");
    setRealtimeIo(ioRef.current);
  } catch (_e) {
    /* optional */
  }
  return { app, io: ioRef.current, getIo };
}

function isAsztalosDeliveryApiPath(pathname) {
  return String(pathname || "").startsWith("/api/asztalos-delivery");
}

function startStandaloneAsztalosDeliveryServer(port) {
  const listenPort = port || DEFAULT_PORT;
  const server = http.createServer();
  const stack = attachAsztalosDeliveryToHttpServer(server);
  server.on("request", (req, res) => {
    stack.app(req, res);
  });
  server.listen(listenPort, "0.0.0.0", () => {
    console.log(
      "[Asztalos delivery] API + Socket.io: http://0.0.0.0:" +
        listenPort +
        "/api/asztalos-delivery/health"
    );
  });
  return { server, ...stack };
}

if (require.main === module) {
  startStandaloneAsztalosDeliveryServer(DEFAULT_PORT);
}

module.exports = {
  attachAsztalosDeliveryToHttpServer,
  isAsztalosDeliveryApiPath,
  startStandaloneAsztalosDeliveryServer
};
