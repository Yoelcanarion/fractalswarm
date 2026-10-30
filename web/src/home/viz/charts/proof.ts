// What the Proof section's chart draws, read from the home data and typed nowhere: the swarm against each rival on the same task, with
// the setting printed beside it. Against the in-process supervisor it is two bars and two numbers for each measure. Against the ideal
// durable supervisor the data's verdict is a tie ("every seed must agree" is its rule), and two bars of the means would read as a
// win, so each seed is a dot on one shared axis and the verdict is printed as the data gives it. A new reading (ten seeds) changes
// the dots, the bars and the words with it.

import type { HeadlineCell, Story } from "../../data/types";

/** How a value is written: seconds, or a signed percentage. */
export type Unit = "s" | "pct";

export interface BarRow {
  id: "stall" | "cost";
  label: string;
  unit: Unit;
  swarm: number;
  rival: number;
}

export interface SeedValue {
  seed: string;
  value: number;
}

export interface SeedRow {
  id: "stall" | "cost";
  label: string;
  unit: Unit;
  swarm: SeedValue[];
  rival: SeedValue[];
  /** The gate's verdict on this comparison ("tie", "win", "loss"), printed as it is; null when the data has none. */
  verdict: string | null;
}

interface PanelBase {
  /** "In-process supervisor": the name the data gives the rival. */
  rival: string;
  /** "Real model · T2 conference · C3 · 2 seeds": the setting of the numbers. */
  setting: string;
}

export interface BarsPanel extends PanelBase {
  kind: "bars";
  id: "central";
  rows: BarRow[];
}

export interface SeedsPanel extends PanelBase {
  kind: "seeds";
  id: "durable-max";
  rows: SeedRow[];
}

export type ProofPanel = BarsPanel | SeedsPanel;

export type ProofStory = Pick<Story, "numbers" | "verdicts" | "workflows" | "headline" | "hero">;

/** t2_conference becomes "T2 conference". */
const taskName = (task: string): string => task.replace(/^t(\d+)_/, "T$1 ").replace(/_/g, " ");
const seedsName = (n: number): string => `${n} seed${n === 1 ? "" : "s"}`;

/** Written the way the page writes them: one decimal, a real minus. */
export function proofText(value: number, unit: Unit): string {
  const abs = Math.abs(value).toFixed(1);
  if (unit === "s") return `${abs} s`;
  return `${value < 0 ? "−" : "+"}${abs}%`;
}

/** How long a bar is, as a share of the longest in its row (0 for a value below nothing: those are written, not drawn). */
export function barShare(value: number, other: number): number {
  const longest = Math.max(value, other, 0);
  return longest <= 0 ? 0 : Math.max(0, value) / longest;
}

const setting = (real: boolean, task: string, profile: string | null, seeds: number): string =>
  [real ? "Real model" : "Fake model", taskName(task), profile, seedsName(seeds)].filter(Boolean).join(" · ");

/** The seeds of one workflow at one failure profile, in the order of the seeds, for the measure `pick` reads. */
function perSeed(story: ProofStory, workflow: string, profile: string, pick: (cell: HeadlineCell) => number | null): SeedValue[] {
  return (story.headline?.cells ?? [])
    .filter((cell) => cell.workflow === workflow && cell.profile === profile)
    .sort((a, b) => Number(a.seed) - Number(b.seed))
    .flatMap((cell) => {
      const value = pick(cell);
      return value === null ? [] : [{ seed: cell.seed, value }];
    });
}

export function proofPanels(story: ProofStory): ProofPanel[] {
  const t2 = story.numbers.r5.t2;
  const comparisons = story.verdicts?.comparisons ?? [];
  const against = (metric: string) => comparisons.find((c) => c.rival === "durable-max" && c.metric === metric);
  const profile = against("stall_s")?.profile ?? "C3";
  const central = story.hero.series["central"]?.points.find((p) => p.x === 5);
  return [
    {
      kind: "bars",
      id: "central",
      rival: story.workflows["central"] ?? "central",
      setting: setting(story.hero.model === "real", t2.task, central?.profile ?? null, t2.seeds),
      rows: [
        { id: "stall", label: "Stalled after a crash", unit: "s", swarm: t2.swarmStallS, rival: t2.centralStallS },
        { id: "cost", label: "Extra cost", unit: "pct", swarm: t2.swarmExtraPct, rival: t2.centralExtraPct },
      ],
    },
    {
      kind: "seeds",
      id: "durable-max",
      rival: story.workflows["durable-max"] ?? "durable-max",
      setting: setting(story.headline?.real ?? story.hero.model === "real", story.numbers.r2.task, profile, story.numbers.r2.seeds),
      rows: [
        {
          id: "stall",
          label: "Stalled after a crash · a dot for each seed",
          unit: "s",
          swarm: perSeed(story, "swarm", profile, (c) => c.stallS),
          rival: perSeed(story, "durable-max", profile, (c) => c.stallS),
          verdict: against("stall_s")?.verdict ?? null,
        },
        {
          id: "cost",
          label: "Extra cost",
          unit: "pct",
          swarm: perSeed(story, "swarm", profile, (c) => c.extraCostPct),
          rival: perSeed(story, "durable-max", profile, (c) => c.extraCostPct),
          verdict: against("extra_cost_pct")?.verdict ?? null,
        },
      ],
    },
  ];
}

/** The chart in words, for a screen reader and for the title of the drawing: every number in it, and the verdict as the data gives it. */
export function proofReading(panels: ProofPanel[], swarm: string): string {
  return panels
    .map((panel) => {
      if (panel.kind === "bars") {
        const parts = panel.rows.map((row) => `${row.label.toLowerCase()}: ${swarm} ${proofText(row.swarm, row.unit)}, ${panel.rival} ${proofText(row.rival, row.unit)}`);
        return `Against the ${panel.rival.toLowerCase()} (${panel.setting}), ${parts.join("; ")}.`;
      }
      const parts = panel.rows.map((row) => {
        const seeds = (list: SeedValue[]): string => list.map((s) => proofText(s.value, row.unit)).join(", ");
        const verdict = row.verdict ? `the data's verdict is a ${row.verdict}` : "no verdict";
        return `${row.id === "stall" ? "stall" : "extra cost"} by seed: ${swarm} ${seeds(row.swarm)}; ${panel.rival} ${seeds(row.rival)}; ${verdict}`;
      });
      return `Against the ${panel.rival.toLowerCase()} (${panel.setting}), ${parts.join(". ")}.`;
    })
    .join(" ");
}
