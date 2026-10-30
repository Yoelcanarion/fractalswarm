// What the Proof section's bars draw, read from the home data and typed nowhere: the swarm against each rival on the same task, with
// the setting printed beside it and, against the ideal durable supervisor, the verdict the data gives. The data is the recorded
// runs' (`numbers`) and the gate's own verdicts (`verdicts`), so a new reading (ten seeds) changes the bars and the words with it.

import type { Story } from "../../data/types";

export interface ProofRow {
  id: string;
  label: string;
  swarm: number;
  rival: number;
  /** How a value is written: seconds, or a signed percentage. */
  unit: "s" | "pct";
  /** The gate's verdict on this comparison when the data has one ("tie", "win", "loss"): printed as it is. */
  verdict: string | null;
}

export interface ProofPanel {
  id: "central" | "durable-max";
  /** "In-process supervisor": the name the data gives the rival. */
  rival: string;
  /** "T2 conference · 2 seeds": the setting of the numbers. */
  setting: string;
  rows: ProofRow[];
}

/** t2_conference becomes "T2 conference". */
const taskName = (task: string): string => task.replace(/^t(\d+)_/, "T$1 ").replace(/_/g, " ");
const seedsName = (n: number): string => `${n} seed${n === 1 ? "" : "s"}`;

/** Written the way the page writes them: one decimal, a real minus. */
export function proofText(value: number, unit: ProofRow["unit"]): string {
  const abs = Math.abs(value).toFixed(1);
  if (unit === "s") return `${abs} s`;
  return `${value < 0 ? "−" : "+"}${abs}%`;
}

export function proofPanels(story: Pick<Story, "numbers" | "verdicts" | "workflows">): ProofPanel[] {
  const { r5, r2 } = story.numbers;
  const verdict = (rival: string, metric: string): string | null => story.verdicts?.comparisons.find((c) => c.rival === rival && c.metric === metric)?.verdict ?? null;
  const t2 = r5.t2;
  return [
    {
      id: "central",
      rival: story.workflows["central"] ?? "central",
      setting: `${taskName(t2.task)} · ${seedsName(t2.seeds)}`,
      rows: [
        { id: "stall", label: "Stall time", swarm: t2.swarmStallS, rival: t2.centralStallS, unit: "s", verdict: null },
        { id: "cost", label: "Extra cost", swarm: t2.swarmExtraPct, rival: t2.centralExtraPct, unit: "pct", verdict: null },
      ],
    },
    {
      id: "durable-max",
      rival: story.workflows["durable-max"] ?? "durable-max",
      setting: `${taskName(r2.task)} · ${seedsName(r2.seeds)}`,
      rows: [
        { id: "stall", label: "Stall time", swarm: r2.swarmStallS, rival: r2.durableMaxStallS, unit: "s", verdict: verdict("durable-max", "stall_s") },
        { id: "cost", label: "Extra cost", swarm: r2.swarmExtraPct, rival: r2.durableMaxExtraPct, unit: "pct", verdict: verdict("durable-max", "extra_cost_pct") },
      ],
    },
  ];
}

/** How long a bar is, as a share of the longest in its row (0 for a value below nothing: those are written, not drawn). */
export function barShare(value: number, other: number): number {
  const longest = Math.max(value, other, 0);
  return longest <= 0 ? 0 : Math.max(0, value) / longest;
}
