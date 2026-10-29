import { describe, expect, it } from "vitest";

import { describeTakeover, logHasTakeover, readTakeover, type TakeoverSummary } from "./takeover";
import { loadJsonl, Stream } from "./testing";

const report = (over: Partial<TakeoverSummary> = {}): TakeoverSummary => ({ ok: true, violations: [], heirs: null, reclaims: null, adoptions: null, kills: null, ...over });

describe("reading a takeover report", () => {
  it("needs a boolean ok, and nothing else", () => {
    expect(readTakeover({ ok: true, violations: [] })).toEqual(report());
    expect(readTakeover({ ok: true })).toMatchObject({ violations: [] });
    for (const body of [null, undefined, 3, "ok", [], {}, { ok: "yes" }, { ok: 1 }, { violations: [] }]) expect(readTakeover(body)).toBeNull();
  });

  it("reads violations and counts what the check found", () => {
    const read = readTakeover({
      ok: false,
      violations: [{ check: "succession", kind: "split-brain", seq: 812, detail: "two heirs for goal track-ai" }, { detail: "no check named" }],
      successions: [{}, {}, {}],
      adoptions: [{}],
      kills: [{}, {}, {}, {}, {}],
    });
    expect(read).toEqual({
      ok: false,
      violations: [
        { check: "succession", kind: "split-brain", seq: 812, detail: "two heirs for goal track-ai" },
        { check: "", kind: "", seq: null, detail: "no check named" },
      ],
      heirs: 3,
      reclaims: 0,
      adoptions: 1,
      kills: 5,
    });
  });

  it("counts each list on its own, and nothing for one that is not a list", () => {
    expect(readTakeover({ ok: true, successions: [{}] })).toMatchObject({ heirs: 1, adoptions: null });
    expect(readTakeover({ ok: true, adoptions: [{}, {}] })).toMatchObject({ heirs: null, adoptions: 2 });
    expect(readTakeover({ ok: true, successions: "many", adoptions: 4 })).toMatchObject({ heirs: null, reclaims: null, adoptions: null });
  });

  it("keeps a reclaim out of the heirs: the check compares no heir for a member that took its own goal back", () => {
    // The shape of the report of t2-real-c3-swarm-seed1b: 11 takeovers and 1 reclaim (verify/takeover.py `kind`).
    const successions = [...Array.from({ length: 11 }, () => ({ kind: "takeover" })), { kind: "reclaim" }];
    expect(readTakeover({ ok: true, successions, adoptions: new Array(12).fill({}), kills: new Array(11).fill({}) })).toMatchObject({
      heirs: 11,
      reclaims: 1,
      adoptions: 12,
      kills: 11,
    });
    expect(readTakeover({ ok: true, successions: [{ kind: "reclaim" }] })).toMatchObject({ heirs: 0, reclaims: 1 });
    expect(readTakeover({ ok: true, successions: [{ kind: "takeover" }, {}] })).toMatchObject({ heirs: 2, reclaims: 0 });
    expect(readTakeover({ ok: true })).toMatchObject({ heirs: null, reclaims: null });
  });
});

describe("what the chip says", () => {
  it("says Takeover OK with the hand-overs it recomputed an heir for", () => {
    const chip = describeTakeover(report({ heirs: 6, adoptions: 5, kills: 5 }), true);
    expect(chip.tone).toBe("good");
    expect(chip.text).toBe("Takeover OK ✓ 6 hand-overs");
    expect(chip.detail).toBe("6 hand-overs: the heir of each, recomputed from the log, is the one the run used. 5 tree adoptions checked against the log.");
    const one = describeTakeover(report({ heirs: 1 }), true);
    expect(one.text).toBe("Takeover OK ✓ 1 hand-over");
    expect(one.detail).toBe("1 hand-over: its heir, recomputed from the log, is the one the run used.");
  });

  it("counts goals handed over, so 5 kills can read as 7 hand-overs", () => {
    // The kill-half demo bundle: 5 coordinator kills, 7 successions (all takeovers), 7 adoptions.
    expect(describeTakeover(report({ heirs: 7, reclaims: 0, adoptions: 7, kills: 5 }), true).text).toBe("Takeover OK ✓ 7 hand-overs");
  });

  it("counts a reclaim apart from the heirs, and says what it is", () => {
    const chip = describeTakeover(report({ heirs: 11, reclaims: 1, adoptions: 12, kills: 11 }), true);
    expect(chip.tone).toBe("good");
    expect(chip.text).toBe("Takeover OK ✓ 11 hand-overs");
    expect(chip.detail).toBe(
      "11 hand-overs: the heir of each, recomputed from the log, is the one the run used. " +
        "1 reclaim: a member back from a false death took its own goal back (no heir is compared). " +
        "12 tree adoptions checked against the log.",
    );
  });

  it("says Takeover OK without a count when only adoptions were checked", () => {
    expect(describeTakeover(report({ heirs: 0, adoptions: 2 }), true)).toEqual({
      tone: "good",
      text: "Takeover OK ✓",
      detail: "2 tree adoptions checked against the log.",
    });
  });

  it("does not claim a takeover when the report counted none", () => {
    for (const body of [report({ heirs: 0, adoptions: 0, kills: 0 }), report({ heirs: 0 }), report({ adoptions: 0 })]) {
      const chip = describeTakeover(body, true); // the log is not asked when the report counts
      expect(chip.tone).toBe("muted");
      expect(chip.text).toBe("No takeover to check");
    }
  });

  it("says how many kills it was when none of them moved a goal", () => {
    expect(describeTakeover(report({ heirs: 0, adoptions: 0, kills: 3 }), false).detail).toBe(
      "No goal changed hands in this run (3 kills), so there was no heir to recompute from the log.",
    );
    expect(describeTakeover(report({ heirs: 0, adoptions: 0, kills: 1 }), false).detail).toContain("(1 kill)");
  });

  it("does not call a run with only a reclaim a takeover, and does not say no goal changed hands", () => {
    const chip = describeTakeover(report({ heirs: 0, reclaims: 1, adoptions: 0, kills: 2 }), true);
    expect(chip.tone).toBe("muted");
    expect(chip.text).toBe("No takeover to check");
    expect(chip.detail).toBe("No goal was taken over in this run (2 kills, 1 reclaim), so there was no heir to recompute from the log.");
  });

  it("asks the log when the report counts nothing", () => {
    expect(describeTakeover(report(), true)).toEqual({
      tone: "good",
      text: "Takeover OK ✓",
      detail: "Every heir recomputed from the log is the one the run used.",
    });
    expect(describeTakeover(report(), false)).toMatchObject({ tone: "muted", text: "No takeover to check" });
  });

  it("fails loudly, with the first violations in the hover text", () => {
    const violations = Array.from({ length: 5 }, (_, i) => ({ check: "succession", kind: "wrong-heir", seq: 100 + i, detail: `goal g${i}` }));
    const chip = describeTakeover(report({ ok: false, violations, heirs: 5, kills: 5 }), true);
    expect(chip.tone).toBe("bad");
    expect(chip.text).toBe("Takeover check failed: 5 violations");
    expect(chip.detail.split("\n")).toEqual([
      "succession/wrong-heir at seq 100: goal g0",
      "succession/wrong-heir at seq 101: goal g1",
      "succession/wrong-heir at seq 102: goal g2",
      "and 2 more",
    ]);
  });

  it("fails even when ok is false and no violation is listed, or ok is true with violations", () => {
    expect(describeTakeover(report({ ok: false }), false)).toMatchObject({ tone: "bad", text: "Takeover check failed" });
    expect(describeTakeover(report({ violations: [{ check: "x", kind: "", seq: null, detail: "d" }], heirs: 2 }), true)).toMatchObject({
      tone: "bad",
      text: "Takeover check failed: 1 violation",
    });
  });
});

describe("a takeover in the log", () => {
  it("is an ownership change or a tree adoption, and nothing else", () => {
    const quiet = new Stream().emit("run.started", "@kernel").emit("actor.killed", "@chaos").emit("member.dead", "@kernel").emit("msg.sent", "a");
    expect(logHasTakeover(quiet.events)).toBe(false);
    expect(logHasTakeover([])).toBe(false);
    expect(logHasTakeover(new Stream().emit("ownership.remapped", "@kernel", { key: "g", owner: "b", previous: "a" }).events)).toBe(true);
    expect(logHasTakeover(new Stream().emit("tree.adopted", "@kernel", { dead: "a", adopter: "b" }).events)).toBe(true);
  });

  it("is absent from the golden bundles, which kill nothing", () => {
    expect(logHasTakeover(loadJsonl("tests/golden/toy/events.jsonl"))).toBe(false);
    expect(logHasTakeover(loadJsonl("tests/golden/one-call/events.jsonl"))).toBe(false);
  });
});
