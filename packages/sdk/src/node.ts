import WebSocket from "ws";
import type { RelaySocket, RelaySocketFactory } from "./index.js";

export const nodeSocketFactory: RelaySocketFactory = (url) => {
  const socket = new WebSocket(url);
  return {
    close: (code, reason) => socket.close(code, reason),
    onMessage: (listener) => socket.on("message", (data) => listener(data.toString())),
    onError: (listener) => socket.on("error", listener),
  } satisfies RelaySocket;
};
