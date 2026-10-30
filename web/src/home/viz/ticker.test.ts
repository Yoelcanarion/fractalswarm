import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The ticker keeps its state in the module, so each test loads a fresh copy of it, with a requestAnimationFrame it can step by hand.
type Ticker = typeof import("./ticker");

let queue: Map<number, FrameRequestCallback>;
let next: number;
let cancelled: number;
let listeners: Map<string, () => void>;
let page: { hidden: boolean };

const load = async (): Promise<Ticker> => {
  vi.resetModules();
  return import("./ticker");
};

/** Runs the frame that is waiting, at ``ms`` on the page's clock. */
const frame = (ms: number): void => {
  const [[id, callback]] = [...queue];
  queue.delete(id);
  callback(ms);
};

beforeEach(() => {
  queue = new Map();
  next = 1;
  cancelled = 0;
  listeners = new Map();
  page = { hidden: false };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queue.set(next, callback);
    return next++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancelled += 1;
    queue.delete(id);
  });
  vi.stubGlobal("document", {
    get hidden() {
      return page.hidden;
    },
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.spyOn(performance, "now").mockReturnValue(1000);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the ticker", () => {
  it("asks for no frame until something subscribes, and for none once the last subscriber has left", async () => {
    const { onFrame, subscribers } = await load();
    expect(queue.size).toBe(0);
    const stop = onFrame(() => undefined);
    expect(queue.size).toBe(1);
    expect(subscribers()).toBe(1);
    stop();
    expect(subscribers()).toBe(0);
    expect(queue.size).toBe(0);
    expect(cancelled).toBe(1);
  });

  it("tells each subscriber the seconds since the last frame, and never more than MAX_DT", async () => {
    const { onFrame, MAX_DT } = await load();
    const seen: number[] = [];
    onFrame((dt) => seen.push(dt));
    frame(1016);
    frame(1033);
    frame(5000); // a tab that was away
    expect(seen[0]).toBeCloseTo(0.016, 6);
    expect(seen[1]).toBeCloseTo(0.017, 6);
    expect(seen[2]).toBe(MAX_DT);
  });

  it("runs the subscribers of a frame in order, whichever came first", async () => {
    const { onFrame } = await load();
    const seen: string[] = [];
    onFrame(() => seen.push("ambient"), 10);
    onFrame(() => seen.push("loop"), 0);
    onFrame(() => seen.push("also ambient"), 10);
    frame(1016);
    expect(seen).toEqual(["loop", "ambient", "also ambient"]);
  });

  it("lets a subscriber leave in the middle of a frame without skipping the others", async () => {
    const { onFrame } = await load();
    const seen: string[] = [];
    const stop = onFrame(() => {
      seen.push("first");
      stop();
    }, 0);
    onFrame(() => seen.push("second"), 1);
    frame(1016);
    frame(1033);
    expect(seen).toEqual(["first", "second", "second"]);
  });

  it("stops asking for frames while the tab is hidden and starts again when it comes back", async () => {
    const { onFrame } = await load();
    const seen: number[] = [];
    onFrame((dt) => seen.push(dt));
    expect(listeners.has("visibilitychange")).toBe(true);
    page.hidden = true;
    listeners.get("visibilitychange")?.();
    expect(queue.size).toBe(0);
    page.hidden = false;
    listeners.get("visibilitychange")?.();
    expect(queue.size).toBe(1);
    frame(1016);
    expect(seen).toHaveLength(1);
  });

  it("does not start in a hidden tab, and watches the tab only while something is subscribed", async () => {
    const { onFrame } = await load();
    page.hidden = true;
    const stop = onFrame(() => undefined);
    expect(queue.size).toBe(0);
    expect(listeners.has("visibilitychange")).toBe(true);
    stop();
    expect(listeners.has("visibilitychange")).toBe(false);
  });
});
