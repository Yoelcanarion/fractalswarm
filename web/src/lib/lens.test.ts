import { describe, expect, it } from "vitest";

import {
  citedSources,
  describeCall,
  foldMeter,
  formatDuration,
  formatPercent,
  formatTokens,
  formatUsd,
  highlight,
  phaseAt,
  pickCall,
  readCallDetail,
  readCalls,
  readMeter,
  readOutput,
  sentenceLabel,
  startedBy,
  type CallRow,
} from "./lens";
import { loadFixture } from "./testing";

// Responses captured from recorded runs (lib/fixtures): `demo-backup`, a real Muse run with facts and
// their source emails, and `t2-real-c3-central-seed1`, a baseline that lost 27 calls to coordinator
// crashes and agent kills, so it has cancelled calls billed at their estimate.
interface Fixture {
  run: string;
  calls: unknown;
  meter: unknown;
  details: Record<string, unknown>;
}

const demo = loadFixture<Fixture>("lens-demo-backup.json");
const central = loadFixture<Fixture>("lens-central-c3.json");

const demoCalls = readCalls(demo.calls).calls;
const centralCalls = readCalls(central.calls).calls;
const detail = (fixture: Fixture, id: string) => {
  const found = readCallDetail(fixture.details[id]);
  if (!found) throw new Error(`no detail ${id}`);
  return found;
};

describe("reading the API", () => {
  it("reads every row of a real calls list", () => {
    const parsed = readCalls(demo.calls);
    expect(parsed.run_id).toBe("demo-backup");
    expect(parsed.calls).toHaveLength(79);
    expect(parsed.refused).toEqual([]);
    for (const call of parsed.calls) {
      expect(call.effect_id).toMatch(/^eff-/);
      expect(call.started_ts).toBeGreaterThanOrEqual(0);
      expect(call.ended_ts).not.toBeNull();
      expect(call.usage.input_tokens).toBeGreaterThan(0);
    }
  });

  it("keeps the order the calls started in", () => {
    const seqs = demoCalls.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("survives a server that sends less", () => {
    expect(readCalls(undefined).calls).toEqual([]);
    expect(readCalls({ calls: "no" }).calls).toEqual([]);
    expect(readCalls({ calls: [null, 3, { actor: "x" }, { effect_id: "e1" }] }).calls.map((c) => c.effect_id)).toEqual(["e1"]);
    const bare = readCalls({ calls: [{ effect_id: "e1" }] }).calls[0];
    expect(bare.usage).toEqual({ input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, searches: 0 });
    expect(bare.status).toBe("ok");
    expect(bare.badge).toBe("other");
    expect(bare.ended_ts).toBeNull();
    expect(readMeter({})).toBeNull();
    expect(readCallDetail({})).toBeNull();
  });

  it("reads a call in full: prompt, output, facts and sources", () => {
    const d = detail(demo, "eff-3895.0");
    expect(d.badge).toBe("spark");
    expect(d.effort).toBe("low");
    expect(d.usage).toMatchObject({ input_tokens: 3300, cached_tokens: 3057, output_tokens: 1902, reasoning_tokens: 660 });
    expect(d.cost_breakdown?.reasoning_usd).toBeCloseTo(0.002805, 9);
    expect(d.attempt_log).toEqual([{ status: 200, latency_ms: 6880, error: null, retry_after_ms: null }]);
    expect(d.prompt.tools).toEqual(["memory.search", "memory.publish_fact"]);
    expect(Object.keys(d.prompt.untrusted)).toEqual(["abstracts", "emails"]);
    expect(d.output.tool_calls.filter((c) => c.name === "memory.publish_fact")).toHaveLength(8);
    expect(d.facts).toHaveLength(8);
    expect(Object.keys(d.sources ?? {})).toHaveLength(8);
  });

  it("gives the evidence offsets of every fact exactly as the server cut them", () => {
    // The contract of api/lens.py: source.text.slice(start, end) === evidence.text, in UTF-16 units.
    let checked = 0;
    for (const id of ["eff-3895.0"]) {
      const d = detail(demo, id);
      for (const fact of d.facts ?? []) {
        for (const ev of fact.evidence) {
          const source = d.sources?.[ev.source_id];
          expect(source, `${fact.key} cites ${ev.source_id}`).toBeDefined();
          expect(source?.text.slice(ev.start, ev.end)).toBe(ev.text);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
});

describe("the Muse meter folded from the calls", () => {
  const closeTotals = (a: ReturnType<typeof foldMeter>["totals"], b: ReturnType<typeof foldMeter>["totals"]) => {
    for (const key of ["calls", "completed", "cancelled", "errors", "input_tokens", "cached_tokens", "output_tokens", "reasoning_tokens", "coordination_tokens", "recovery_tokens"] as const) {
      expect(a[key], key).toBe(b[key]);
    }
    for (const key of ["cost_usd", "settled_cost_usd", "estimated_cost_usd"] as const) expect(a[key], key).toBeCloseTo(b[key], 9);
    if (a.cache_hit_share === null || b.cache_hit_share === null) expect(a.cache_hit_share).toBe(b.cache_hit_share);
    else expect(a.cache_hit_share).toBeCloseTo(b.cache_hit_share, 12);
    expect(a.lost_to_cancellation.calls).toBe(b.lost_to_cancellation.calls);
    expect(a.lost_to_cancellation.tokens).toBe(b.lost_to_cancellation.tokens);
    expect(a.lost_to_cancellation.cost_usd).toBeCloseTo(b.lost_to_cancellation.cost_usd, 9);
  };

  for (const [name, fixture, calls] of [
    ["demo-backup", demo, demoCalls],
    ["a baseline that lost calls to crashes", central, centralCalls],
  ] as const) {
    it(`agrees with the server's /models at the end of ${name}`, () => {
      const server = readMeter(fixture.meter);
      expect(server).not.toBeNull();
      const folded = foldMeter(calls);
      closeTotals(folded.totals, server!.totals);
      expect(folded.models.map((m) => m.model)).toEqual(server!.models.map((m) => m.model));
      for (const [i, row] of folded.models.entries()) {
        const expected = server!.models[i];
        expect(row.badge).toBe(expected.badge);
        expect(row.calls).toBe(expected.calls);
        expect(row.completed).toBe(expected.completed);
        expect(row.cost_usd).toBeCloseTo(expected.cost_usd, 9);
        expect(row.input_tokens).toBe(expected.input_tokens);
        expect(row.cached_tokens).toBe(expected.cached_tokens);
        expect(row.output_tokens).toBe(expected.output_tokens);
        expect(row.reasoning_tokens).toBe(expected.reasoning_tokens);
        expect(row.cache_hit_share ?? 0).toBeCloseTo(expected.cache_hit_share ?? 0, 12);
        expect(row.share_of_cost ?? 0).toBeCloseTo(expected.share_of_cost ?? 0, 12);
        expect(row.share_of_tokens ?? 0).toBeCloseTo(expected.share_of_tokens ?? 0, 12);
      }
    });
  }

  it("reports the numbers the demo is built on", () => {
    const { totals, models } = foldMeter(demoCalls);
    expect(totals.calls).toBe(79);
    expect(totals.cost_usd).toBeCloseTo(0.494767, 5);
    expect(totals.input_tokens).toBe(198719);
    expect(totals.cached_tokens).toBe(120350);
    expect(totals.cache_hit_share).toBeCloseTo(0.6056, 4);
    expect(totals.coordination_tokens).toBe(0);
    expect(totals.recovery_tokens).toBe(0);
    expect(models.map((m) => [m.badge, m.calls])).toEqual([
      ["spark", 78],
      ["wonder", 1],
    ]);
  });

  it("counts a cancelled call at its estimate and as lost", () => {
    const { totals } = foldMeter(centralCalls);
    expect(totals.cancelled).toBe(27);
    expect(totals.lost_to_cancellation.calls).toBe(27);
    expect(totals.estimated_cost_usd).toBeCloseTo(0.14576, 4);
    expect(totals.cost_usd).toBeCloseTo(totals.settled_cost_usd + totals.estimated_cost_usd, 9);
  });

  it("counts a call only once it has ended", () => {
    const call = demoCalls[10];
    const ended = call.ended_ts as number;
    const during = (call.started_ts + ended) / 2;
    // Calls overlap, so count what had ended by each moment from the rows themselves.
    const endedBy = (t: number) => demoCalls.filter((c) => (c.ended_ts as number) <= t);
    expect(foldMeter(demoCalls, during).totals.calls).toBe(endedBy(during).length);
    const before = foldMeter(demoCalls, ended - 1).totals;
    const after = foldMeter(demoCalls, ended).totals;
    const landing = demoCalls.filter((c) => c.ended_ts === ended);
    expect(landing).toContain(call);
    expect(after.calls).toBe(before.calls + landing.length);
    expect(after.cost_usd).toBeCloseTo(before.cost_usd + landing.reduce((sum, c) => sum + c.cost_usd, 0), 9);
    expect(after.input_tokens).toBe(before.input_tokens + landing.reduce((sum, c) => sum + c.usage.input_tokens, 0));
  });

  it("grows with the playhead and never decreases", () => {
    const end = Math.max(...demoCalls.map((c) => c.ended_ts ?? 0));
    let previous = foldMeter(demoCalls, -1).totals;
    expect(previous.calls).toBe(0);
    expect(previous.cache_hit_share).toBeNull();
    for (let i = 1; i <= 40; i++) {
      const now = foldMeter(demoCalls, (end * i) / 40).totals;
      expect(now.calls).toBeGreaterThanOrEqual(previous.calls);
      expect(now.cost_usd).toBeGreaterThanOrEqual(previous.cost_usd - 1e-12);
      expect(now.input_tokens).toBeGreaterThanOrEqual(previous.input_tokens);
      previous = now;
    }
    closeTotals(previous, foldMeter(demoCalls).totals);
  });

  it("counts coordination and recovery tokens from roles and tags", () => {
    const base = demoCalls[0];
    const call = (over: Partial<CallRow>): CallRow => ({ ...base, ...over, usage: { ...base.usage, input_tokens: 100, output_tokens: 20 } });
    const calls = [
      call({ effect_id: "a", role: "supervisor", tag: null }),
      call({ effect_id: "b", role: "agent", tag: "coord:route" }),
      call({ effect_id: "c", role: "agent", tag: "recovery:redo" }),
      call({ effect_id: "d", role: "recovery", tag: null }),
      call({ effect_id: "e", role: "agent", tag: "c-1:1" }),
    ];
    const { totals } = foldMeter(calls);
    // The server's definitions: coordination is the supervisor, coordinator, router and recovery
    // roles and the coord: tag; recovery is the recovery role and the recovery: tag. A recovery:
    // tag on an agent's call is recovery but not coordination.
    expect(totals.coordination_tokens).toBe(360); // a, b, d
    expect(totals.recovery_tokens).toBe(240); // c, d
  });
});

describe("where a call sits on the playhead", () => {
  const call = demoCalls[5];
  it("is future, in flight, then done", () => {
    expect(phaseAt(call, call.started_ts - 1)).toBe("future");
    expect(phaseAt(call, call.started_ts)).toBe("inflight");
    expect(phaseAt(call, (call.ended_ts as number) - 1)).toBe("inflight");
    expect(phaseAt(call, call.ended_ts as number)).toBe("done");
  });

  it("never ends a call that has no end", () => {
    expect(phaseAt({ ...call, ended_ts: null }, Number.MAX_SAFE_INTEGER)).toBe("inflight");
  });

  it("lists the calls started by a moment", () => {
    const t = demoCalls[20].started_ts;
    const started = startedBy(demoCalls, t);
    expect(started.length).toBeGreaterThanOrEqual(21);
    expect(started.every((c) => c.started_ts <= t)).toBe(true);
  });

  it("picks the newest call an actor had started, or its first", () => {
    const actor = demoCalls.find((c) => c.actor === "o1.2.a2")?.actor as string;
    const own = demoCalls.filter((c) => c.actor === actor);
    expect(own.length).toBeGreaterThan(1);
    expect(pickCall(demoCalls, actor, own[1].started_ts)?.effect_id).toBe(own[1].effect_id);
    expect(pickCall(demoCalls, actor, -5)?.effect_id).toBe(own[0].effect_id);
    expect(pickCall(demoCalls, actor, Number.MAX_SAFE_INTEGER)?.effect_id).toBe(own.at(-1)?.effect_id);
    expect(pickCall(demoCalls, "nobody", 10)).toBeNull();
  });
});

describe("words for a call", () => {
  const find = (pred: (c: CallRow) => boolean) => demoCalls.find(pred) as CallRow;
  it("names what a call did and where", () => {
    expect(describeCall(find((c) => c.model === "muse-wonder-1.0"))).toEqual({ title: "Root plan", where: "o0" });
    expect(describeCall(find((c) => c.ref.contract_kind === "extract" && c.ref.step === 2))).toMatchObject({ title: "Extract" });
    expect(describeCall(find((c) => c.ref.contract_kind === "extract" && c.ref.step === 2)).where).toMatch(/ · step 2$/);
    expect(describeCall(find((c) => c.ref.kind === "judge")).title).toBe("Judge");
    expect(describeCall(find((c) => c.ref.kind === "plan" && c.ref.goal_id !== "root")).where).toMatch(/^track-/);
    expect(describeCall({ ...demoCalls[0], ref: { kind: null }, purpose: "arbitration" }).title).toBe("Arbitration");
    expect(describeCall({ ...demoCalls[0], ref: { kind: "ablate", note_id: "N3" } })).toEqual({ title: "Ablation", where: "note N3" });
  });

  it("formats figures to read on a screen", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(3300)).toBe("3.3k");
    expect(formatTokens(198719)).toBe("199k");
    expect(formatTokens(2_345_678)).toBe("2.35M");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.0088458)).toBe("$0.0088");
    expect(formatUsd(0.494767)).toBe("$0.4948");
    expect(formatUsd(12.3)).toBe("$12.30");
    expect(formatPercent(0.6056)).toBe("61%");
    expect(formatPercent(null)).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(6880)).toBe("6.9 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
  });

  it("labels the model's own sentences", () => {
    expect(sentenceLabel("limitations[1]")).toBe("limitation 2");
    expect(sentenceLabel("reasons[0]")).toBe("reason 1");
    expect(sentenceLabel("entries[2]")).toBe("entry 3");
    expect(sentenceLabel("feasibility")).toBe("feasibility");
    expect(sentenceLabel("message")).toBe("message");
  });
});

describe("a fact next to its source sentence", () => {
  it("cuts a source into plain and marked stretches that add back up", () => {
    const d = detail(demo, "eff-3895.0");
    const fact = (d.facts ?? [])[0];
    const source = (d.sources ?? {})[fact.sources[0]];
    const segments = highlight(source.text, fact.evidence);
    expect(segments.map((s) => s.text).join("")).toBe(source.text);
    const marked = segments.filter((s) => s.marks.length > 0).map((s) => s.text);
    expect(marked).toEqual(fact.evidence.map((e) => e.text));
    expect(segments.some((s) => s.marks.length === 0)).toBe(true);
  });

  it("highlights the right words when an emoji comes first (UTF-16 offsets)", () => {
    const text = "Hi 😀 team.\nI can only join after lunch on day 2.\nBest, Sam";
    const sentence = "I can only join after lunch on day 2.";
    const start = text.indexOf(sentence);
    const segments = highlight(text, [{ start, end: start + sentence.length, text: sentence }]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.filter((s) => s.marks.length).map((s) => s.text)).toEqual([sentence]);
  });

  it("finds the sentence when the offsets are off, and drops it when it is not there", () => {
    const text = "One. Two is here. Three.";
    const segments = highlight(text, [
      { start: 0, end: 3, text: "Two is here." },
      { start: 5, end: 9, text: "not in the text" },
      { start: 99, end: 120, text: "beyond" },
    ]);
    expect(segments.filter((s) => s.marks.length).map((s) => [s.text, s.marks])).toEqual([["Two is here.", [0]]]);
  });

  it("marks an overlap with both sentences", () => {
    const text = "abcdefghij";
    const segments = highlight(text, [
      { start: 1, end: 6, text: "bcdef" },
      { start: 4, end: 9, text: "efghi" },
    ]);
    expect(segments).toEqual([
      { text: "a", marks: [] },
      { text: "bcd", marks: [0] },
      { text: "ef", marks: [0, 1] },
      { text: "ghi", marks: [1] },
      { text: "j", marks: [] },
    ]);
  });

  it("returns the whole text when there is nothing to mark", () => {
    expect(highlight("plain", [])).toEqual([{ text: "plain", marks: [] }]);
    expect(highlight("", [])).toEqual([]);
  });

  it("lists each cited source once, in the order it is cited", () => {
    const d = detail(demo, "eff-3895.0");
    const sources = citedSources(d);
    expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length);
    expect(sources[0].id).toBe((d.facts ?? [])[0].sources[0]);
  });
});

describe("the readable output of each kind of call", () => {
  const kinds = (id: string, fixture = demo) => readOutput(detail(fixture, id)).map((piece) => piece.kind);

  it("shows the facts an extraction published, and not the tool calls that published them", () => {
    expect(kinds("eff-3895.0")).toEqual(["facts"]);
  });

  it("shows a search an extraction step made", () => {
    const pieces = readOutput(detail(demo, "eff-3707.0"));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ kind: "search" });
    expect((pieces[0] as { query: string }).query).toMatch(/^S04 OR/);
  });

  it("reads Wonder's plan as tracks", () => {
    const d = detail(demo, "eff-408.1");
    expect(d.badge).toBe("wonder");
    const [plan] = readOutput(d);
    expect(plan.kind).toBe("tracks");
    const tracks = (plan as { tracks: { id: string; room: string; talks: number; priority: number | null }[] }).tracks;
    expect(tracks.map((t) => t.id)).toEqual(["track-ai", "track-data", "track-hci"]);
    expect(tracks.every((t) => t.talks === 16 && t.room !== "")).toBe(true);
    // The feasibility sentence and the limitations come from the model's own words.
    const fields = d.decision.sentences.map((s) => s.field);
    expect(fields[0]).toBe("feasibility");
    expect(fields.length).toBeGreaterThan(1);
    expect(fields.slice(1).every((field) => /^limitations\[\d+\]$/.test(field))).toBe(true);
  });

  it("reads a session plan as contracts", () => {
    const [plan] = readOutput(detail(demo, "eff-3330.0"));
    expect(plan.kind).toBe("contracts");
    const contracts = (plan as { contracts: { id: string; kind: string; dependsOn: string[] }[] }).contracts;
    expect(contracts.map((c) => c.id)).toEqual(["extract", "place", "blurb"]);
    expect(contracts[1].dependsOn).toEqual(["extract"]);
  });

  it("reads the placements of a placing step, in day and slot order", () => {
    const d = detail(demo, "eff-7433.0");
    const [pieces] = [readOutput(d)];
    expect(pieces.map((p) => p.kind)).toEqual(["placements"]);
    const placements = (pieces[0] as { placements: { talk: string; day: number; room: string; slot: number }[] }).placements;
    expect(placements).toHaveLength(8);
    expect(placements[0]).toEqual({ talk: "T11", day: 2, room: "room-d", slot: 0 });
    const order = placements.map((p) => (p.day ?? 0) * 100 + (p.slot ?? 0));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(d.decision.sentences[0].field).toBe("notes");
  });

  it("reads a judge's verdict, with the reasons as sentences", () => {
    const d = detail(demo, "eff-6463.1");
    expect(readOutput(d)).toEqual([{ kind: "verdict", verdict: "pass", score: 1 }]);
    expect(d.decision.sentences.map((s) => s.field).slice(0, 2)).toEqual(["reasons[0]", "reasons[1]"]);
  });

  it("reads a blurb the agent wrote", () => {
    const pieces = readOutput(detail(demo, "eff-6190.0"));
    const write = pieces.find((p) => p.kind === "write");
    expect(write).toMatchObject({ kind: "write", path: "sessions/track-data/d1/blurb.md" });
    expect((write as { content: string }).content).toMatch(/^Join us in Room C/);
  });

  it("does not choke on a call that was cut off before it answered", () => {
    const killed = detail(central, "eff-463.0");
    expect(killed.status).toBe("cancelled");
    expect(killed.estimated).toBe(true);
    expect(killed.cancel).toMatchObject({ kind: "actor_stopped", reason: "chaos", fault: "kill_agent" });
    expect(killed.cancel?.detail).toBe("o0.a4 was killed by chaos (kill_agent)");
    expect(readOutput(killed)).toEqual([]);
    const crashed = detail(central, "eff-542.3");
    expect(crashed.cancel?.kind).toBe("coordinator_crash");
    expect(crashed.cost_breakdown).toBeNull();
  });

  it("falls back to the JSON of an answer it has no reader for, and to plain text", () => {
    const base = detail(demo, "eff-6463.1");
    const unknown = { ...base, facts: null, output: { ...base.output, parsed: { colour: "green" }, text: "{}" }, decision: { ...base.decision, sentences: [] } };
    expect(readOutput(unknown)).toEqual([{ kind: "json", label: "answer", value: { colour: "green" } }]);
    const said = { ...unknown, output: { ...unknown.output, parsed: null, text: "Looks fine to me." } };
    expect(readOutput(said)).toEqual([{ kind: "message", text: "Looks fine to me." }]);
    const ruling = { ...unknown, purpose: "arbitration" as const, output: { ...unknown.output, parsed: { winner: "S12:day2", reason: "the later email", confidence: 0.8, evidence: ["E12"] } } };
    expect(readOutput(ruling)).toEqual([{ kind: "ruling", winner: "S12:day2", reason: "the later email", confidence: 0.8, evidence: ["E12"] }]);
  });
});
