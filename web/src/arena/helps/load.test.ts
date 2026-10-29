import { describe, expect, it, vi } from "vitest";

import { loadHonesty } from "./load";
import { honestySample } from "./testing";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const file = (): Raw => structuredClone(honestySample() as Raw);
const bundled = async () => honestySample();

describe("loading honesty.json", () => {
  it("takes the server's file, and never opens the bundled copy", async () => {
    const sample = vi.fn(bundled);
    const state = await loadHonesty({ fetchJson: async () => file(), sample });
    expect(state).toMatchObject({ status: "ready", source: "api" });
    expect(sample).not.toHaveBeenCalled();
  });

  it("takes the file out of the wrapper /api/bench/results gives its files", async () => {
    const state = await loadHonesty({ fetchJson: async () => ({ source: "bench/results", fixture: false, data: file() }), sample: bundled });
    expect(state).toMatchObject({ status: "ready", source: "api" });
  });

  it("asks the endpoint this panel documents", async () => {
    const fetchJson = vi.fn(async () => null);
    await loadHonesty({ fetchJson, sample: bundled });
    expect(fetchJson).toHaveBeenCalledWith("api/bench/honesty");
  });

  it("falls back to the bundled sample when the server has no file, and says it is the sample", async () => {
    for (const served of [null, { error: "not found" }, { data: { hero: [] } }, "text", []]) {
      const state = await loadHonesty({ fetchJson: async () => served, sample: bundled });
      expect(state, JSON.stringify(served)).toMatchObject({ status: "ready", source: "sample" });
    }
  });

  it("falls back to the sample when there is no server to ask", async () => {
    const state = await loadHonesty({
      fetchJson: async () => {
        throw new Error("connection refused");
      },
      sample: bundled,
    });
    expect(state).toMatchObject({ status: "ready", source: "sample" });
  });

  it("stops at a server file it cannot read, instead of showing the sample's numbers in its place", async () => {
    const broken = file();
    broken.comparisons[0].verdict = "maybe";
    const sample = vi.fn(bundled);
    const state = await loadHonesty({ fetchJson: async () => broken, sample });
    expect(state).toMatchObject({ status: "invalid", source: "api" });
    expect(state.status === "invalid" && state.reason).toContain("comparisons[0].verdict");
    expect(sample).not.toHaveBeenCalled();
  });

  it("stops at a bundled sample it cannot read", async () => {
    const broken = file();
    broken.schema_version = 2;
    const state = await loadHonesty({ fetchJson: async () => null, sample: async () => broken });
    expect(state).toMatchObject({ status: "invalid", source: "sample" });
  });
});
