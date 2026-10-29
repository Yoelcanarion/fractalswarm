// The bench's ids as a person reads them: names, units and settings for the "where it helps" panel.

import { systemName } from "../assumptions";

/** A rival as a column head or a name in a sentence: "Ideal durable supervisor". */
export function rivalLabel(id: string): string {
  const name = systemName(id);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "t2_conference" is "T2 conference". */
export function taskName(task: string): string {
  const match = /^t(\d+)_(.+)$/.exec(task);
  return match ? `T${match[1]} ${match[2].replace(/_/g, " ")}` : task.replace(/_/g, " ");
}

/** A number without trailing zeros, with the precision a person needs at its size: 73.2, 2.33, 0.005, 12. */
export function fmt(value: number): string {
  const size = Math.abs(value);
  const decimals = size >= 100 ? 0 : size >= 10 ? 1 : size >= 1 ? 2 : 3;
  return String(Number(value.toFixed(decimals)));
}

/** The metrics of bench/PREREG.md by their ids. */
const METRIC_NAMES: Record<string, string> = {
  preserved_pct: "Preserved work",
  extra_cost_pct: "Extra cost",
  ttr_own_mean_s: "Time to recover",
  cdt_s: "Coordinator-dependency time",
  blast_sessions_mean_pct: "Blast radius",
  blast_agents_mean_pct: "Blast radius (agents)",
  idle_agent_s: "Idle agent-seconds",
  unnecessary_reassignments: "Unnecessary reassignments",
  dup_chaos_pct: "Duplicated spend",
  stall_s: "Stall time",
};

export const metricName = (metric: string): string => METRIC_NAMES[metric] ?? metric.replace(/_/g, " ");

/** The unit a metric id carries: `_pct` is a percentage, `_s` seconds. */
export function metricUnit(metric: string): string {
  if (metric === "idle_agent_s") return " agent·s";
  if (metric.endsWith("_pct")) return "%";
  if (metric.endsWith("_s")) return " s";
  return "";
}

/** A value of a metric with its unit; "—" when the bench has no number (a ratio against a rival at 0). */
export const valueText = (metric: string, value: number | null): string => (value === null ? "—" : `${fmt(value)}${metricUnit(metric)}`);

/** C1, C2 and C3 are 1, 3 and 5 coordinator crashes (bench/PREREG.md §6). */
const CRASHES: Record<string, number> = { C1: 1, C2: 3, C3: 5 };

export function crashesText(profile: string): string | null {
  const n = CRASHES[profile];
  return n === undefined ? null : `${n} ${n === 1 ? "crash" : "crashes"}`;
}

const SECONDS_AXES = new Set(["recovery_ms", "rival_restart_ms", "rival_recovery_ms"]);

/** One setting of a sweep as it reads on a cell: "5 s", "0.25×", "12 agents"; the gate's is its profile. */
export function settingLabel(axis: string | null, value: number | null, profile: string): string {
  if (axis === null || value === null) return profile;
  if (SECONDS_AXES.has(axis)) return `${fmt(value / 1000)} s`;
  if (axis === "agent_latency_scale") return `${fmt(value)}×`;
  if (axis === "agents") return `${fmt(value)} agents`;
  return `${axis} ${fmt(value)}`;
}

export const LOCALITY_WORD = { holds: "holds", ties: "ties", fails: "fails", "n/a": "has no verdict" } as const;

export const VERDICT_WORD = { win: "win", tie: "tie", loss: "loss", "n/a": "not scored", incomplete: "not scored" } as const;

/** "1 win", "20 losses": a count with its word. */
export const countText = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
