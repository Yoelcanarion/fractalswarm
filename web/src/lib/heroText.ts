// The words and the number formats of the Charts page. Pure, so they are tested without a browser.
//
// The numbers come from the recorded files; the words that describe a setting come from docs/claims.md and
// bench/REPORT.md §1, and none of them compares one workflow with another (that is for claims.md alone).

import type { TermId } from "./glossary";
import type { Backend, HeroData, HeroPoint, HeroSet, MetricKey } from "./hero";
import { runCount, seedCounts } from "./hero";

export interface MetricSpec {
  title: string;
  /** Appended to a value on an axis and in a tooltip. */
  unit: string;
  decimals: number;
  /** A rate: 0..1 in the data, shown as a percentage. */
  rate?: boolean;
  /** A change against C0: shown with its sign. */
  signed?: boolean;
  /** Put before the number. */
  prefix?: string;
  /** The glossary entry that defines it. */
  term?: TermId;
}

export const METRICS: Record<MetricKey, MetricSpec> = {
  stallS: { title: "Stall time", unit: " s", decimals: 1, term: "stall" },
  extraCostPct: { title: "Extra cost vs C0", unit: "%", decimals: 1, signed: true, term: "extraCost" },
  completionRate: { title: "Completion", unit: "%", decimals: 0, rate: true },
  validityRate: { title: "Validity", unit: "%", decimals: 0, rate: true },
  coordinationTokens: { title: "Coordination tokens per run", unit: "", decimals: 0, term: "coordinationTokens" },
  costUsd: { title: "Cost per run", unit: "", decimals: 3, prefix: "$" },
};

const MINUS = "−";

/** "14.6 s", "+6.6%", "−6.0%", "100%", "$0.299". */
export function formatMetric(metric: MetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const spec = METRICS[metric];
  const shown = spec.rate ? value * 100 : value;
  const digits = Math.abs(shown) >= 1000 ? 0 : spec.decimals;
  const body = Math.abs(shown).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = Number(body.replace(/,/g, "")) === 0 ? "" : shown < 0 ? MINUS : spec.signed ? "+" : "";
  return `${sign}${spec.prefix ?? ""}${body}${spec.unit}`;
}

/** "5.6 to 23.5 s": the lowest and highest seed, in the unit of the metric. */
export function formatRange(metric: MetricKey, range: readonly [number, number]): string {
  const [low, high] = range.map((v) => formatMetric(metric, v));
  return `${low} to ${high}`;
}

/** The mean of a point and, when the file records the seeds' spread, the lowest and highest: "14.6 s (5.6 to 23.5 s)". */
export function formatPoint(metric: MetricKey, point: HeroPoint): string {
  const mean = formatMetric(metric, point[metric]);
  const range = point.range[metric];
  return range ? `${mean} (${formatRange(metric, range)})` : mean;
}

/** True when the metric has values and they are all `value`: a chart of them would be a flat line or empty bars. */
export function isFlat(hero: HeroData, metric: MetricKey, value: number): boolean {
  const values = hero.series.flatMap((s) => s.points.map((p) => p[metric])).filter((v): v is number => typeof v === "number");
  return values.length > 0 && values.every((v) => v === value);
}

// ---- what a workflow is (bench/REPORT.md §1) ----

/** What each workflow does when a coordinator dies, in the report's own words. A description, not a verdict. */
export const WORKFLOW_HELP: Record<string, string> = {
  swarm:
    "Ten orchestrators in a depth-2 tree lead 12 agents. When one dies, the survivors re-own its work by deterministic hashing from the log: no supervisor, no election and no LLM call.",
  "durable-max":
    "One coordinator with the same 12 agents and the same log. When it crashes its agents keep working, and what they send meanwhile is logged and adopted when it restarts 5 s later, as are its own plan and judge calls.",
  durable:
    "The same, except that the coordinator's own in-flight plan and judge calls are lost and redone after the restart, as in LangGraph or CrewAI supervisors.",
  central:
    "The Phase 1 baseline, kept as a reference row. Its workers run inside its process, so a crash cancels their calls.",
  pipeline: "A secondary baseline row: one coordinator and one agent, passing the work through stages and keeping each stage's output.",
  single: "A secondary baseline row: one coordinator and one agent, with its transcript kept.",
  langgraph: "Hierarchical teams on LangGraph: a supervisor per track and per session, with LangGraph's checkpointer keeping the state.",
};

/** The one sentence that must stay next to the in-process supervisor wherever it is drawn: docs/claims.md R5. */
export const IN_PROCESS_REASON =
  "The in-process supervisor's workers run inside its process, so each crash cancels their calls. Most of the gap between it and the swarm comes from that design, so it is no evidence against a well-built supervisor.";

// ---- the setting of a set ----

const TASKS: Record<string, { term: TermId | null; name: string }> = {
  t1_extraction: { term: "t1", name: "extraction" },
  t2_conference: { term: "t2", name: "conference schedule" },
  t3_web_report: { term: "t3", name: "web report" },
};

/** The task of a set: the short name that has a glossary entry ("T2") and its words. */
export function taskOf(task: string): { term: TermId | null; short: string; name: string } {
  const known = TASKS[task];
  if (known) return { term: known.term, short: task.slice(0, 2).toUpperCase(), name: known.name };
  return { term: null, short: task, name: "" };
}

export interface SetCaption {
  backend: { label: string; tone: "plain" | "warn" };
  /** "2 seeds per point", "2 to 3 seeds per point" or "seeds not recorded". */
  seeds: string;
  /** "48 runs", or null where the file names none. */
  runs: string | null;
}

const BACKENDS: Record<Backend, { label: string; tone: "plain" | "warn" }> = {
  real: { label: "Real model", tone: "plain" },
  fake: { label: "Fake model, simulated clock", tone: "warn" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function captionOf(set: HeroSet): SetCaption {
  const counts = seedCounts(set.hero);
  const runs = runCount(set.hero);
  return {
    backend: set.backend ? BACKENDS[set.backend] : { label: "Setting not recorded", tone: "warn" },
    seeds: !counts ? "seeds not recorded" : `${counts.min === counts.max ? counts.min : `${counts.min} to ${counts.max}`} seeds per point`,
    runs: runs > 0 ? plural(runs, "run") : null,
  };
}

/** What a set's runs were done with, beyond the badge. Only the fake set has something to add (bench/REPORT.md §3). */
export function settingNote(set: HeroSet): string | null {
  return set.backend === "fake"
    ? "The fake LLM with calibrated latencies on a simulated clock: no network and no spend. It checks the design; it does not measure the real model."
    : null;
}

/** Whether a set draws the in-process supervisor, which then carries its reason. */
export const drawsInProcess = (hero: HeroData): boolean => hero.series.some((s) => s.id === "central");
