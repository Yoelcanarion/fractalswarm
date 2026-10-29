// bench/results/honesty.json as the "where it helps" panel reads it (bench/verdicts.py writes it).
//
// The file is the evidence: nothing here re-derives a verdict, the panel only lays out what the bench
// decided. The parser is strict about the words that carry a verdict (win / tie / loss, holds / ties /
// fails): a panel that guessed at an unknown word could hide a loss, so it stops with a message instead.

import { asNumber, asString } from "../../lib/generic";

export type Verdict = "win" | "tie" | "loss" | "n/a" | "incomplete";
export type Locality = "holds" | "ties" | "fails" | "n/a";
export type Reading = "swarm lower" | "comparable" | "rival lower" | "n/a";

const SCHEMA = 1;
const VERDICTS: readonly Verdict[] = ["win", "tie", "loss", "n/a", "incomplete"];
const LOCALITIES: readonly Locality[] = ["holds", "ties", "fails", "n/a"];
const READINGS: readonly Reading[] = ["swarm lower", "comparable", "rival lower", "n/a"];

/** The four impacts of one coordinator failure that the per-process view weighs (bench/PREREG.md §6). */
export const IMPACT_KEYS = ["cdt_s", "idle_agent_s", "ttr_own_mean_s", "blast_agents_mean_pct"] as const;
export type ImpactKey = (typeof IMPACT_KEYS)[number];
export type Impact = Record<ImpactKey, number | null>;

/** Swarm wins, ties and losses against one rival; `na` counts results with no verdict (a run that did not complete). */
export interface Tally {
  win: number;
  tie: number;
  loss: number;
  na: number;
}

export interface Hypothesis {
  id: string;
  name: string;
  metric: string;
  /** What the design predicted, written before any result (bench/PREREG.md §2). */
  expected: string;
  /** By rival id. */
  tally: Record<string, Tally>;
}

/** The swarm's value over the rival's, as the ratio of the seed means (descriptive: the verdict is not read off it). */
export interface Ratios {
  cdt: number | null;
  blast: number | null;
  idle: number | null;
}

export interface RegimePoint {
  /** The sweep, or null at the gate. */
  axis: string | null;
  value: number | null;
  /** In the part of the rival's assumptions a real deployment could have; fixed before any result (PREREG §5). */
  plausible: boolean;
  task: string;
  profile: string;
  rival: string;
  locality: Locality;
  ratios: Ratios;
}

export interface GatePoint {
  task: string;
  profile: string;
  locality: Locality;
  ratios: Ratios;
}

export interface Outcome {
  /** "A" or "B": which headline the decision rule allows (bench/PREREG.md §7). */
  label: string;
  /** The rival the outcome is read against. */
  against: string;
  /** The points of the gate that decide it. */
  gate: GatePoint[];
  conditions: string[];
}

/** One comparison of one metric, swarm against one rival, at one regime point. */
export interface Comparison {
  hypothesis: string;
  metric: string;
  rival: string;
  task: string;
  profile: string;
  axis: string | null;
  value: number | null;
  seeds: number;
  swarm: number | null;
  rivalValue: number | null;
  ratio: number | null;
  verdict: Verdict;
  /** The seeds disagree: a tie, whatever the means say. */
  mixed: boolean;
}

export interface PerProcess {
  task: string;
  /** Expected impact of one failure per unit of failure rate, summed over the swarm's coordinators. */
  swarm: Impact;
  rivals: Record<string, Impact>;
  /** Swarm over rival. */
  ratio: Record<string, Impact>;
  reading: Record<string, Record<ImpactKey, Reading>>;
  /** How many coordinators the swarm has at each level of its tree. */
  levels: { level: number; count: number }[];
}

export interface FalseDeath {
  axis: string | null;
  value: number | null;
  task: string;
  profile: string;
  workflow: string;
  runs: number;
  remapsMean: number;
  remapsMax: number;
}

export interface Rules {
  /** Minimum effect, per metric: a difference below it is a tie. */
  difference: Record<string, number>;
  /** A win is at most `ratio` times the rival's value, when the rival's value is at least `floor`. */
  ratio: Record<string, { ratio: number; floor: number }>;
}

export interface Honesty {
  prereg: { path: string; sha: string };
  code: { commit: string; dirty: boolean };
  rules: Rules;
  outcome: Outcome;
  hypotheses: Hypothesis[];
  comparisons: Comparison[];
  regimes: RegimePoint[];
  perProcess: PerProcess[];
  falseDeaths: FalseDeath[];
  /** Over hypotheses H1 to H6; stall time is reported next to them and not counted. */
  tally: Tally;
}

export type Parsed = { ok: true; honesty: Honesty } | { ok: false; reason: string };

class HonestyError extends Error {}

const fail = (where: string, what: string): never => {
  throw new HonestyError(`${where}: ${what}`);
};

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(where, "expected an object");
  return value as Record<string, unknown>;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) return fail(where, "expected a list");
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") return fail(where, "expected text");
  return value;
}

const optionalText = (value: unknown, where: string): string | null => (value === null || value === undefined ? null : text(value, where));

function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  return allowed.includes(value as T) ? (value as T) : fail(where, `unexpected "${String(value)}"`);
}

const count = (value: unknown): number => {
  const n = asNumber(value);
  return n === null || n < 0 ? 0 : Math.trunc(n);
};

function tally(value: unknown, where: string): Tally {
  const r = record(value, where);
  return { win: count(r.win), tie: count(r.tie), loss: count(r.loss), na: count(r.na) };
}

const ratios = (r: Record<string, unknown>): Ratios => ({ cdt: asNumber(r.cdt_ratio), blast: asNumber(r.blast_ratio), idle: asNumber(r.idle_ratio) });

function impact(value: unknown, where: string): Impact {
  const r = record(value, where);
  return Object.fromEntries(IMPACT_KEYS.map((key) => [key, asNumber(r[key])])) as Impact;
}

function perProcess(value: unknown, where: string): PerProcess {
  const r = record(value, where);
  const rivals = record(r.rivals, `${where}.rivals`);
  const ratio = record(r.ratio, `${where}.ratio`);
  const reading = record(r.reading, `${where}.reading`);
  return {
    task: text(r.task, `${where}.task`),
    swarm: impact(r.swarm_expected, `${where}.swarm_expected`),
    rivals: Object.fromEntries(Object.entries(rivals).map(([id, v]) => [id, impact(v, `${where}.rivals.${id}`)])),
    ratio: Object.fromEntries(Object.entries(ratio).map(([id, v]) => [id, impact(v, `${where}.ratio.${id}`)])),
    reading: Object.fromEntries(
      Object.entries(reading).map(([id, v]) => {
        const words = record(v, `${where}.reading.${id}`);
        return [id, Object.fromEntries(IMPACT_KEYS.map((key) => [key, oneOf(words[key], READINGS, `${where}.reading.${id}.${key}`)]))];
      }),
    ) as PerProcess["reading"],
    levels: list(r.swarm_levels ?? [], `${where}.swarm_levels`).map((level, i) => {
      const l = record(level, `${where}.swarm_levels[${i}]`);
      return { level: count(l.level), count: count(l.count) };
    }),
  };
}

function rules(value: unknown): Rules {
  const r = value === undefined ? {} : record(value, "rules");
  const difference = r.difference === undefined ? {} : record(r.difference, "rules.difference");
  const ratio = r.ratio === undefined ? {} : record(r.ratio, "rules.ratio");
  return {
    difference: Object.fromEntries(Object.entries(difference).flatMap(([metric, v]) => (asNumber(v) === null ? [] : [[metric, asNumber(v) as number]]))),
    ratio: Object.fromEntries(
      Object.entries(ratio).map(([metric, v]) => {
        const rule = record(v, `rules.ratio.${metric}`);
        return [metric, { ratio: asNumber(rule.ratio) ?? 0.5, floor: asNumber(rule.floor) ?? 0 }];
      }),
    ),
  };
}

function read(raw: unknown): Honesty {
  const root = record(raw, "honesty.json");
  if (asNumber(root.schema_version) !== SCHEMA) fail("schema_version", `this panel reads version ${SCHEMA}, the file says ${asString(root.schema_version, "nothing")}`);

  const outcome = record(root.outcome, "outcome");
  const prereg = record(root.prereg, "prereg");
  const code = record(root.code, "code");
  return {
    prereg: { path: text(prereg.path, "prereg.path"), sha: text(prereg.sha, "prereg.sha") },
    code: { commit: text(code.commit, "code.commit"), dirty: code.dirty === true },
    rules: rules(root.rules),
    outcome: {
      label: text(outcome.label, "outcome.label"),
      against: text(outcome.against, "outcome.against"),
      gate: list(outcome.gate ?? [], "outcome.gate").map((point, i) => {
        const p = record(point, `outcome.gate[${i}]`);
        return {
          task: text(p.task, `outcome.gate[${i}].task`),
          profile: text(p.profile, `outcome.gate[${i}].profile`),
          locality: oneOf(p.locality, LOCALITIES, `outcome.gate[${i}].locality`),
          ratios: ratios(p),
        };
      }),
      conditions: list(outcome.conditions ?? [], "outcome.conditions").map(String),
    },
    hypotheses: list(root.hypotheses, "hypotheses").map((value, i) => {
      const h = record(value, `hypotheses[${i}]`);
      const tallies = record(h.tally, `hypotheses[${i}].tally`);
      return {
        id: text(h.id, `hypotheses[${i}].id`),
        name: text(h.name, `hypotheses[${i}].name`),
        metric: text(h.metric, `hypotheses[${i}].metric`),
        expected: asString(h.expected),
        tally: Object.fromEntries(Object.entries(tallies).map(([rival, t]) => [rival, tally(t, `hypotheses[${i}].tally.${rival}`)])),
      };
    }),
    comparisons: list(root.comparisons ?? [], "comparisons").map((value, i) => {
      const where = `comparisons[${i}]`;
      const c = record(value, where);
      return {
        hypothesis: text(c.hypothesis, `${where}.hypothesis`),
        metric: text(c.metric, `${where}.metric`),
        rival: text(c.rival, `${where}.rival`),
        task: text(c.task, `${where}.task`),
        profile: text(c.profile, `${where}.profile`),
        axis: optionalText(c.axis, `${where}.axis`),
        value: asNumber(c.value),
        seeds: Array.isArray(c.seeds) ? c.seeds.length : 0,
        swarm: asNumber(c.swarm),
        rivalValue: asNumber(c.rival_value),
        ratio: asNumber(c.ratio),
        verdict: oneOf(c.verdict, VERDICTS, `${where}.verdict`),
        mixed: c.mixed === true,
      };
    }),
    regimes: list(root.regimes, "regimes").map((value, i) => {
      const where = `regimes[${i}]`;
      const r = record(value, where);
      return {
        axis: optionalText(r.axis, `${where}.axis`),
        value: asNumber(r.value),
        plausible: r.plausible === true,
        task: text(r.task, `${where}.task`),
        profile: text(r.profile, `${where}.profile`),
        rival: text(r.rival, `${where}.rival`),
        locality: oneOf(r.locality, LOCALITIES, `${where}.locality`),
        ratios: ratios(r),
      };
    }),
    perProcess: list(root.per_process ?? [], "per_process").map((value, i) => perProcess(value, `per_process[${i}]`)),
    falseDeaths: list(root.false_deaths ?? [], "false_deaths").map((value, i) => {
      const where = `false_deaths[${i}]`;
      const f = record(value, where);
      return {
        axis: optionalText(f.axis, `${where}.axis`),
        value: asNumber(f.value),
        task: text(f.task, `${where}.task`),
        profile: text(f.profile, `${where}.profile`),
        workflow: text(f.workflow, `${where}.workflow`),
        runs: count(f.runs),
        remapsMean: asNumber(f.remaps_mean) ?? 0,
        remapsMax: count(f.remaps_max),
      };
    }),
    tally: tally(root.tally, "tally"),
  };
}

/** Reads the file's JSON. A file this panel cannot read gives a reason, never a partial panel. */
export function parseHonesty(raw: unknown): Parsed {
  try {
    return { ok: true, honesty: read(raw) };
  } catch (error) {
    if (error instanceof HonestyError) return { ok: false, reason: error.message };
    throw error;
  }
}

/** Does this look like honesty.json (so a response that wraps it as `{data}` can be told from one that is it)? */
export const looksLikeHonesty = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && "schema_version" in raw && "hypotheses" in raw && "regimes" in raw;

/** The rivals in the order the panel shows them: the one the outcome is read against, then the strongest first. */
export function rivalOrder(honesty: Honesty): string[] {
  const seen = new Set<string>(honesty.regimes.map((r) => r.rival));
  for (const h of honesty.hypotheses) for (const rival of Object.keys(h.tally)) seen.add(rival);
  const preferred = [honesty.outcome.against, "durable-max", "durable", "central"];
  const first = preferred.filter((rival, i) => seen.has(rival) && preferred.indexOf(rival) === i);
  return [...first, ...[...seen].filter((rival) => !first.includes(rival)).sort()];
}
