import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiplayerClient } from "./index.js";

class FakeBrowserWebSocket {
  static instance: FakeBrowserWebSocket | undefined;
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeBrowserWebSocket.instance = this;
  }

  addEventListener(event: string, listener: (event: { data?: unknown }) => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  close() { this.closed = true; }
  emit(event: string, data?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener({ data });
  }
}

describe("browser realtime client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the browser WebSocket without importing a Node implementation", async () => {
    vi.stubGlobal("WebSocket", FakeBrowserWebSocket);
    const client = new MultiplayerClient({ baseUrl: "https://relay.example.test", accessToken: "browser-token" });
    const onEvent = vi.fn();
    const connection = client.realtime(onEvent);
    const socket = FakeBrowserWebSocket.instance!;

    expect(socket.url).toBe("wss://relay.example.test/realtime?token=browser-token");
    socket.emit("message", JSON.stringify({ type: "ready", userId: "user-1" }));
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith({ type: "ready", userId: "user-1" }));

    const onError = vi.fn();
    connection.on("error", onError);
    socket.emit("error");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    connection.close();
    expect(socket.closed).toBe(true);
  });
});
