import { describe, expect, it, vi } from "vitest";

import { loadHonesty, type Fetched } from "./load";
import { honestySample } from "./testing";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const file = (): Raw => structuredClone(honestySample() as Raw);
const serving = (body: unknown): (() => Promise<Fetched>) => async () => ({ kind: "file", body });

describe("loading honesty.json", () => {
  it("takes the server's file", async () => {
    const state = await loadHonesty(serving(file()));
    expect(state.status).toBe("ready");
    expect(state.status === "ready" && state.honesty.tally).toEqual({ win: 163, tie: 249, loss: 68, na: 0 });
  });

  it("asks the endpoint this panel documents, and only that", async () => {
    const get = vi.fn(async (): Promise<Fetched> => ({ kind: "missing" }));
    await loadHonesty(get);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("api/bench/honesty");
  });

  it("says the file is missing when the server has none, and shows no stand-in for it", async () => {
    expect(await loadHonesty(async () => ({ kind: "missing" }))).toEqual({ status: "missing" });
  });

  it("says when it could not ask at all", async () => {
    expect(await loadHonesty(async () => ({ kind: "failed", reason: "connection refused" }))).toEqual({ status: "unreachable", reason: "connection refused" });
  });

  it("stops at a file it cannot read, with the reason", async () => {
    const broken = file();
    broken.comparisons[0].verdict = "maybe";
    const state = await loadHonesty(serving(broken));
    expect(state.status).toBe("invalid");
    expect(state.status === "invalid" && state.reason).toContain("comparisons[0].verdict");
    expect(await loadHonesty(serving({ hero: [] }))).toMatchObject({ status: "invalid" });
    expect(await loadHonesty(serving(null))).toMatchObject({ status: "invalid" });
  });
});

describe("asking the server", () => {
  const answer = (init: { status: number; body?: unknown; reject?: Error }) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (init.reject) throw init.reject;
        return { status: init.status, ok: init.status >= 200 && init.status < 300, json: async () => init.body };
      }),
    );

  it("reads a 200 as the file, a 404 as missing, any other status or a lost connection as a failure", async () => {
    try {
      answer({ status: 200, body: file() });
      expect((await loadHonesty()).status).toBe("ready");
      answer({ status: 404 });
      expect(await loadHonesty()).toEqual({ status: "missing" });
      answer({ status: 500 });
      expect(await loadHonesty()).toEqual({ status: "unreachable", reason: "the server answered 500" });
      answer({ status: 0, reject: new TypeError("Failed to fetch") });
      expect(await loadHonesty()).toEqual({ status: "unreachable", reason: "Failed to fetch" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
