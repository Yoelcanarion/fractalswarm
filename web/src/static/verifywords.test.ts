// W4's Runs page words its verify cell with verifyWords (lib/catalogue.ts). In the static build the report is the one the
// build made, so the cell says so, and never that a replay ran in the browser just now. Same words as the badge's tooltip
// (BuildVerified.tsx). Everything else (a mismatch, an error, a replay in progress) is W4's wording as it is.

import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyWords } from "../lib/catalogue";
import { VERIFY } from "./testing";

afterEach(() => vi.unstubAllEnvs());

describe("the Runs page's verify cell", () => {
  const verified = { state: "done", report: VERIFY } as never;

  it("is the local server's wording in every build but the static one", () => {
    const words = verifyWords(verified);
    expect(words.label).toBe("Replay verified");
    expect(words.detail).toContain("re-run from run.started");
  });

  it("says in the static build that the replay was checked when the site was built, not in the browser", () => {
    vi.stubEnv("MODE", "static");
    const words = verifyWords(verified);
    expect(words).toMatchObject({ label: "Replay verified at build", tone: "good" });
    expect(words.detail).toContain("not in your browser");
    expect(words.detail).toContain("commit ccccccc on 2026-10-30");
    expect(`${words.label} ${words.detail}`).not.toMatch(/re-run|replaying|just now/i);
  });

  it("leaves a mismatch, an error and a replay in progress as W4 words them", () => {
    vi.stubEnv("MODE", "static");
    expect(verifyWords({ state: "done", report: { ...VERIFY, ok: false, first_divergence: 7 } } as never).label).toBe("Replay mismatch at seq 7");
    expect(verifyWords({ state: "error", error: "x" }).label).toBe("Could not check");
    expect(verifyWords({ state: "pending" }).label).toBe("Replaying…");
  });
});
