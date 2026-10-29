import { describe, expect, it } from "vitest";

import { looksLikeHonesty, parseHonesty, rivalOrder } from "./honesty";
import { honestySample, parsedSample } from "./testing";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const clone = (): Raw => structuredClone(honestySample() as Raw);

describe("reading honesty.json", () => {
  it("reads the sample the bench wrote", () => {
    const h = parsedSample();
    expect(h.hypotheses).toHaveLength(9);
    expect(h.regimes).toHaveLength(60);
    expect(h.comparisons).toHaveLength(540);
    expect(h.perProcess).toHaveLength(1);
    expect(h.falseDeaths).toHaveLength(87);
    expect(h.outcome.conditions).toHaveLength(19);
    expect(h.outcome).toMatchObject({ label: "B", against: "durable-max" });
    expect(h.outcome.gate.map((g) => [g.task, g.profile, g.locality])).toEqual([
      ["t2_conference", "C2", "ties"],
      ["t2_conference", "C3", "ties"],
    ]);
    expect(h.prereg).toEqual({ path: "bench/PREREG.md", sha: "25d4a75919b3" });
    expect(h.code.commit.startsWith("3e723a8")).toBe(true);
    expect(h.code.dirty).toBe(false);
    expect(h.tally).toEqual({ win: 163, tie: 249, loss: 68, na: 0 });
  });

  it("agrees with itself: every hypothesis tally is its comparisons, counted", () => {
    const h = parsedSample();
    for (const hypothesis of h.hypotheses) {
      for (const [rival, tally] of Object.entries(hypothesis.tally)) {
        const mine = h.comparisons.filter((c) => c.hypothesis === hypothesis.id && c.rival === rival);
        const count = (verdict: string) => mine.filter((c) => c.verdict === verdict).length;
        expect(tally, `${hypothesis.id} against ${rival}`).toEqual({ win: count("win"), tie: count("tie"), loss: count("loss"), na: count("n/a") + count("incomplete") });
      }
    }
  });

  it("keeps the figures the bench printed", () => {
    const h = parsedSample();
    const gate = h.regimes.find((r) => r.axis === null && r.rival === "durable-max" && r.task === "t2_conference" && r.profile === "C3");
    expect(gate?.locality).toBe("ties");
    expect(gate?.ratios.cdt).toBeCloseTo(0.366, 3);
    const fast = h.regimes.find((r) => r.axis === "rival_recovery_ms" && r.value === 500 && r.rival === "durable-max");
    expect(fast).toMatchObject({ locality: "fails", plausible: true });
    expect(h.rules.difference).toMatchObject({ stall_s: 3, preserved_pct: 10 });
    expect(h.rules.ratio.cdt_s).toEqual({ ratio: 0.5, floor: 1 });
  });

  it("orders the rivals: the one the outcome is read against first", () => {
    const h = parsedSample();
    expect(rivalOrder(h)).toEqual(["durable-max", "durable", "central"]);
    expect(rivalOrder({ ...h, outcome: { ...h.outcome, against: "durable" } })).toEqual(["durable", "durable-max", "central"]);
  });

  it("tells honesty.json from a response that wraps it", () => {
    expect(looksLikeHonesty(honestySample())).toBe(true);
    expect(looksLikeHonesty({ source: "x", data: honestySample() })).toBe(false);
    expect(looksLikeHonesty(null)).toBe(false);
    expect(looksLikeHonesty("honesty")).toBe(false);
  });
});

describe("a file the panel cannot read", () => {
  const reason = (raw: unknown): string => {
    const parsed = parseHonesty(raw);
    if (parsed.ok) throw new Error("expected a failure");
    return parsed.reason;
  };

  it("is refused with a reason, never half shown", () => {
    expect(reason(null)).toContain("expected an object");
    expect(reason([])).toContain("expected an object");
  });

  it("is refused when the schema is not the one this panel reads", () => {
    const raw = clone();
    raw.schema_version = 2;
    expect(reason(raw)).toContain("schema_version");
    delete raw.schema_version;
    expect(reason(raw)).toContain("schema_version");
  });

  it("is refused at a verdict word it does not know, instead of guessing at it", () => {
    const raw = clone();
    raw.comparisons[3].verdict = "maybe";
    expect(reason(raw)).toContain('comparisons[3].verdict: unexpected "maybe"');
    const other = clone();
    other.regimes[0].locality = "mostly";
    expect(reason(other)).toContain('regimes[0].locality: unexpected "mostly"');
    const reading = clone();
    reading.per_process[0].reading["durable-max"].cdt_s = "better";
    expect(reason(reading)).toContain("per_process[0].reading.durable-max.cdt_s");
  });

  it("is refused when a part it draws is missing", () => {
    for (const part of ["hypotheses", "regimes", "outcome", "tally", "prereg", "code"]) {
      const raw = clone();
      delete raw[part];
      expect(reason(raw), part).toContain(part);
    }
  });

  it("takes the verdicts that mean 'not scored' and counts nothing it does not understand", () => {
    const raw = clone();
    raw.comparisons[0].verdict = "incomplete";
    raw.comparisons[1].verdict = "n/a";
    const parsed = parseHonesty(raw);
    expect(parsed.ok).toBe(true);
    raw.regimes[0].locality = "n/a";
    expect(parseHonesty(raw).ok).toBe(true);
  });

  it("copes with a ratio the bench could not compute (the rival had none)", () => {
    const h = parsedSample();
    expect(h.comparisons.some((c) => c.ratio === null)).toBe(true);
  });
});
