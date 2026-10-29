// The per-process view: what happens when every coordinator process fails at the same rate, so the swarm,
// which runs ten coordinators, sees about ten times the crashes of a supervisor, which runs one
// (bench/PREREG.md §6). It is the failure model that favours the rival, and it is shown next to the
// per-crash results whatever it says.

import type { Honesty, ImpactKey, Reading } from "./honesty";
import { fmt, metricUnit } from "./labels";

export type Tone = "ok" | "danger" | "muted";

export interface ProcessLine {
  key: ImpactKey;
  label: string;
  swarm: string;
  rival: string;
  /** Swarm over rival: 0.5 or less means the swarm's expected impact is the lower, 2 or more the rival's. */
  ratio: string;
  reading: Reading;
  tone: Tone;
}

export interface ProcessView {
  task: string;
  /** The swarm's coordinators, by level: 1 + 3 + 6. */
  coordinators: number[];
  lines: ProcessLine[];
}

const LABELS: Record<ImpactKey, string> = {
  cdt_s: "Coordinator-dependency time",
  idle_agent_s: "Idle agent-seconds",
  ttr_own_mean_s: "Time to recover",
  blast_agents_mean_pct: "Blast radius",
};

const text = (key: ImpactKey, value: number | null): string => (value === null ? "—" : `${fmt(value)}${metricUnit(key)}`);

const TONES: Record<Reading, Tone> = { "swarm lower": "ok", comparable: "muted", "rival lower": "danger", "n/a": "muted" };

/** The per-process lines against one rival, for the first task the file has them for (null when it has none for that rival). */
export function processView(honesty: Honesty, rival: string): ProcessView | null {
  const pp = honesty.perProcess.find((p) => p.rivals[rival] !== undefined);
  if (!pp) return null;
  const keys = Object.keys(LABELS) as ImpactKey[];
  return {
    task: pp.task,
    coordinators: [...pp.levels].sort((a, b) => a.level - b.level).map((l) => l.count),
    lines: keys.map((key) => {
      const reading = pp.reading[rival]?.[key] ?? "n/a";
      return {
        key,
        label: LABELS[key],
        swarm: text(key, pp.swarm[key]),
        rival: text(key, pp.rivals[rival][key]),
        ratio: pp.ratio[rival]?.[key] == null ? "—" : `${fmt(pp.ratio[rival][key] as number)}×`,
        reading,
        tone: TONES[reading],
      };
    }),
  };
}

/** "Comparable", "Swarm lower", "Supervisor lower": the file's reading in words for the rival at hand. */
export function readingText(reading: Reading, rivalNoun: string): string {
  if (reading === "swarm lower") return "Swarm lower";
  if (reading === "rival lower") return `${rivalNoun} lower`;
  if (reading === "comparable") return "Comparable";
  return "No reading";
}
