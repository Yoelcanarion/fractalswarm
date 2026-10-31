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

  it("leaves a broken chain, a recording this code does not reproduce, an error and a replay in progress as W4 words them", () => {
    vi.stubEnv("MODE", "static");
    const broken = { ...VERIFY, ok: false, chain_ok: false, first_divergence: 7 };
    expect(verifyWords({ state: "done", report: broken } as never)).toMatchObject({ label: "Replay mismatch at seq 7", tone: "bad" });
    const notReproduced = { ...VERIFY, ok: false, chain_ok: true, first_divergence: 7 };
    expect(verifyWords({ state: "done", report: notReproduced } as never)).toMatchObject({
      label: "Log intact. This code does not reproduce this recording: first difference at seq 7.",
      tone: "warn",
    });
    expect(verifyWords({ state: "error", error: "x" }).label).toBe("Could not check");
  });

  it("says what the browser is doing while it does it, and it is not a replay", () => {
    expect(verifyWords({ state: "pending" }).label).toBe("Replaying…");
    vi.stubEnv("MODE", "static");
    expect(verifyWords({ state: "pending" })).toMatchObject({ label: "Recomputing…", detail: "Your browser is recomputing every hash of the log." });
  });

  it("adds what this browser found, beside what the build found, and how long it took", () => {
    vi.stubEnv("MODE", "static");
    const here = { ok: true, events: 12345, head: "a".repeat(32), brokenAt: null, ms: 2340 };
    const words = verifyWords({ state: "done", report: { ...VERIFY, here } } as never);
    expect(words).toMatchObject({ label: "Replay verified at build", tone: "good" });
    expect(words.detail).toContain("Check it yourself: uv run fractalswarm demo --verify");
    expect(words.also?.label).toBe("12,345 hashes recomputed here in 2.3 s ✓");
    expect(words.also?.detail).toContain("Your browser recomputed the hash of each of the 12,345 events from the log this site shows");
    expect(words.also?.detail).toContain("it is not a replay, which needs the code");
  });

  it("says that a digit was changed on purpose when it was, and that the log itself was not touched", () => {
    vi.stubEnv("MODE", "static");
    const here = { ok: false, events: 4320, head: "a".repeat(32), brokenAt: 4321, ms: 1, changed: true };
    const words = verifyWords({ state: "done", report: { ...VERIFY, here } } as never);
    expect(words).toMatchObject({ label: "One digit changed: hash chain broken at event 4,321", tone: "bad" });
    expect(words.detail).toContain("The log itself was not touched.");
    expect(words.also).toBeUndefined();
  });

  it("says where a chain breaks, and that a log that holds but stops short is not the one stored", () => {
    vi.stubEnv("MODE", "static");
    const here = { ok: false, events: 6, head: "a".repeat(32), brokenAt: 7, ms: 1 };
    expect(verifyWords({ state: "done", report: { ...VERIFY, here } } as never)).toMatchObject({ label: "Hash chain broken at event 7", tone: "bad" });
    const short = verifyWords({ state: "done", report: { ...VERIFY, here: { ...here, brokenAt: null } } } as never);
    expect(short).toMatchObject({ label: "Log does not reach its stored head", tone: "bad" });
    expect(short.also).toBeUndefined();
  });
});
