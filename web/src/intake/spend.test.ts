// Real spend from the page: what a preflight says, and when the launch may go. The preflight bodies are written from
// api/spend.py (`Spend.preflight`): they cannot be captured, because a real preflight needs the server flag and a key.

import { describe, expect, it } from "vitest";

import { canonicalBody, dollars, gateFor, readPreflight, worstCaseLines, type Checked, type Preflight } from "./spend";

const standing = { settled_usd: 12.5, reserved_usd: 0, committed_usd: 12.5, project_cap_usd: 150, project_remaining_usd: 137.5, phase_start_usd: 11.82, phase_cap_usd: 50, phase_spent_usd: 0.68, phase_remaining_usd: 49.32 };

const allowed = () => ({
  ok: true,
  token: "tok-1",
  expires_in_s: 600,
  confirm_word: "SPEND",
  kind: "arena",
  runs: 2,
  calls_per_run: 560,
  estimate_usd_per_run: 11.4,
  run_cap_usd: 0.75,
  worst_case_usd: 1.5,
  standing,
  refusals: [] as string[],
});

const refused = () => ({ ...allowed(), ok: false, token: null, expires_in_s: null, refusals: ["real runs from the UI are off: start the server with FRACTALSWARM_ALLOW_UI_REAL=1"] });

const read = (raw: unknown): Preflight => {
  const result = readPreflight(raw);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};

describe("reading a preflight", () => {
  it("reads the price, the caps and the word to type", () => {
    expect(read(allowed())).toMatchObject({ ok: true, token: "tok-1", confirm_word: "SPEND", kind: "arena", runs: 2, worst_case_usd: 1.5, standing: { phase_remaining_usd: 49.32 } });
  });

  it("reads a refusal, with no token", () => {
    expect(read(refused())).toMatchObject({ ok: false, token: null, refusals: [expect.stringContaining("FRACTALSWARM_ALLOW_UI_REAL")] });
  });

  it("refuses an answer that contradicts itself: a token that comes with a refusal, an ok with none", () => {
    expect(readPreflight({ ...allowed(), refusals: ["no"] }).ok).toBe(false);
    expect(readPreflight({ ...allowed(), token: null }).ok).toBe(false);
    expect(readPreflight({ ...refused(), token: "tok" }).ok).toBe(false);
  });

  it("refuses a number that is not one, and names it", () => {
    const wrong = readPreflight({ ...allowed(), worst_case_usd: "1.5" });
    expect(wrong).toEqual({ ok: false, reason: expect.stringContaining("preflight.worst_case_usd: expected a number") });
    const noStanding = readPreflight({ ...allowed(), standing: { ...standing, phase_remaining_usd: undefined } });
    expect(noStanding.ok).toBe(false);
  });
});

describe("showing the worst case", () => {
  it("writes dollars at the precision they have", () => {
    expect([0.156, 0.75, 8.24, 11.82, 1.5, 0, 0.25, 49.32].map(dollars)).toEqual(["$0.156", "$0.75", "$8.24", "$11.82", "$1.50", "$0.00", "$0.25", "$49.32"]);
  });

  it("gives the total first, then how it is made, then what is left under each cap", () => {
    expect(worstCaseLines(read(allowed()))).toEqual([
      "Worst case $1.50",
      "2 runs × the lower of $11.40 and the $0.75 cap each, 560 requests a run at their worst.",
      "Settled so far $12.50.",
      "Left under the project cap ($150.00): $137.50. Left under the phase cap ($50.00): $49.32.",
    ]);
  });

  it("says one run, one request and what is reserved", () => {
    const one = read({ ...allowed(), kind: "intake", runs: 1, calls_per_run: 1, estimate_usd_per_run: 0.156, worst_case_usd: 0.156, standing: { ...standing, reserved_usd: 0.4 } });
    expect(worstCaseLines(one)[0]).toBe("Worst case $0.156");
    expect(worstCaseLines(one)[1]).toBe("1 run × $0.156 each, 1 request a run at their worst.");
    expect(worstCaseLines(one)[2]).toBe("Settled so far $12.50, $0.40 reserved.");
  });
});

describe("tying the token to the settings it priced", () => {
  const body = { spec: { goal: "G", seed: "1", inputs: { intake: "i1" } }, rival: "durable-max", chaos: "half-the-brains", clock: "sim", backend: "real" };

  it("does not depend on the order of fields, and leaves out what the server does not bind a token to", () => {
    const reordered = { backend: "real", clock: "sim", chaos: "half-the-brains", rival: "durable-max", spec: { inputs: { intake: "i1" }, seed: "1", goal: "G" } };
    expect(canonicalBody(reordered)).toBe(canonicalBody(body));
    expect(canonicalBody({ ...body, preflight_token: "t", confirm: "SPEND", run_id: "r", pair_id: "p" })).toBe(canonicalBody(body));
  });

  it("changes with any setting the server does bind it to", () => {
    for (const change of [{ rival: "durable" }, { chaos: "C3" }, { clock: "live" }, { spec: { ...body.spec, seed: "2" } }]) {
      expect(canonicalBody({ ...body, ...change })).not.toBe(canonicalBody(body));
    }
  });
});

describe("when the launch may go", () => {
  const body = { clock: "sim", backend: "real" };
  const checked = (raw: unknown = allowed(), at = 1_000): Checked => ({ preflight: read(raw), priced: canonicalBody(body), at });
  const gate = (c: Checked | null, typed: string, now = 2_000, current = canonicalBody(body)) => gateFor(c, current, typed, now);

  it("waits for the check, and then for the word, typed exactly", () => {
    expect(gate(null, "SPEND")).toEqual({ launch: false, reason: "Check the cost first." });
    expect(gate(checked(), "")).toEqual({ launch: false, reason: "Type SPEND to confirm." });
    for (const typed of ["spend", "SPEND ", " SPEND", "SPEN", "Spend"]) expect(gate(checked(), typed).launch, typed).toBe(false);
    expect(gate(checked(), "SPEND")).toEqual({ launch: true, token: "tok-1" });
  });

  it("asks for the server's own word, whatever it is", () => {
    const other = { ...allowed(), confirm_word: "PAY" };
    expect(gate(checked(other), "SPEND").launch).toBe(false);
    expect(gate(checked(other), "PAY")).toEqual({ launch: true, token: "tok-1" });
  });

  it("says why the server refused, and never lets a refused launch go", () => {
    expect(gate(checked(refused()), "SPEND")).toEqual({ launch: false, reason: expect.stringContaining("FRACTALSWARM_ALLOW_UI_REAL") });
  });

  it("does not let a token that priced other settings launch these", () => {
    const changed = canonicalBody({ ...body, clock: "live" });
    expect(gate(checked(), "SPEND", 2_000, changed)).toEqual({ launch: false, reason: "The settings changed since the check: check the cost again." });
  });

  it("does not let a token launch after it has run out", () => {
    expect(gate(checked(), "SPEND", 1_000 + 599_999).launch).toBe(true);
    expect(gate(checked(), "SPEND", 1_000 + 600_000)).toEqual({ launch: false, reason: "The check has run out: check the cost again." });
  });
});
