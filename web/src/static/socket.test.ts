import { describe, expect, it, vi } from "vitest";

import { silenceEventStreams } from "./socket";

const BASE = "https://example.github.io/fractalswarm/index.html";

/** A WebSocket that only remembers where it was asked to connect: the browser's own, standing in. */
class RealSocket {
  static opened: string[] = [];
  constructor(readonly url: string | URL) {
    RealSocket.opened.push(String(url));
  }
}

function target() {
  RealSocket.opened = [];
  const window = { WebSocket: RealSocket as unknown as typeof WebSocket };
  silenceEventStreams(BASE, window);
  return window;
}

describe("the tail of a run, on a site with no server", () => {
  it("closes at once, so the store takes the stream for ended instead of the browser logging a failed connection", async () => {
    const { WebSocket } = target();
    const url = new URL("wss://example.github.io/fractalswarm/api/runs/r1/events?from_seq=9&pace=none");
    const socket = new WebSocket(url);
    const closed = new Promise<void>((resolve) => {
      socket.onclose = () => resolve();
    });
    await closed;
    expect(socket.readyState).toBe(3);
    expect(RealSocket.opened).toEqual([]);
  });

  it("does not close before the caller has set its handler", () => {
    vi.useFakeTimers();
    try {
      const { WebSocket } = target();
      const socket = new WebSocket("wss://example.github.io/fractalswarm/api/runs/r1/events");
      const onclose = vi.fn();
      socket.onclose = onclose;
      expect(onclose).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(onclose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can be closed by the caller, as a socket can", () => {
    const { WebSocket } = target();
    const socket = new WebSocket("wss://example.github.io/fractalswarm/api/runs/r1/events");
    expect(() => socket.close()).not.toThrow();
  });

  it("leaves any other socket to the browser", () => {
    const { WebSocket } = target();
    new WebSocket("wss://chat.example/live");
    new WebSocket("wss://example.github.io/elsewhere/api/runs/r1/events");
    expect(RealSocket.opened).toEqual(["wss://chat.example/live", "wss://example.github.io/elsewhere/api/runs/r1/events"]);
  });
});
