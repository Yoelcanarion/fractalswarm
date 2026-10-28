// The hero chart data (spec §15.5), normalized from the bench JSON.
//
// Preferred shape ("fractalswarm.hero/v1"):
//   {x: [0,1,3,5], workflows: [{id, label?, points: [{coordinators_killed, profile?, stall_s,
//     extra_cost_pct, completion_rate?, validity_rate?, coordination_tokens?, runs?}]}]}
// Also accepted: flat rows, {rows: [{workflow, coordinators_killed, stall_s, ...}]}.

export interface HeroPoint {
  coordinatorsKilled: number;
  profile: string | null;
  stallS: number | null;
  extraCostPct: number | null;
  completionRate: number | null;
  validityRate: number | null;
  coordinationTokens: number | null;
  runs: string[];
}

export interface HeroSeries {
  id: string;
  label: string;
  points: HeroPoint[];
}

export interface HeroData {
  task: string;
  x: number[];
  series: HeroSeries[];
  note: string | null;
}

export const WORKFLOW_ORDER = ["swarm", "central", "pipeline", "single", "langgraph"];
const LABELS: Record<string, string> = {
  swarm: "FractalSwarm",
  central: "Central supervisor",
  pipeline: "Pipeline",
  single: "Single agent",
  langgraph: "LangGraph teams",
};
const PROFILE_BY_KILLS: Record<number, string> = { 0: "C0", 1: "C1", 3: "C2", 5: "C3" };

type Raw = Record<string, unknown>;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function point(raw: Raw): HeroPoint {
  const kills = num(raw.coordinators_killed) ?? 0;
  return {
    coordinatorsKilled: kills,
    profile: typeof raw.profile === "string" ? raw.profile : (PROFILE_BY_KILLS[kills] ?? null),
    stallS: num(raw.stall_s),
    extraCostPct: num(raw.extra_cost_pct),
    completionRate: num(raw.completion_rate),
    validityRate: num(raw.validity_rate),
    coordinationTokens: num(raw.coordination_tokens),
    runs: Array.isArray(raw.runs) ? raw.runs.map(String) : [],
  };
}

export function normalizeHero(data: unknown): HeroData {
  const raw = (data ?? {}) as Raw;
  let series: HeroSeries[] = [];
  if (Array.isArray(raw.workflows)) {
    series = (raw.workflows as Raw[]).map((w) => {
      const id = String(w.id ?? w.name ?? "?");
      return {
        id,
        label: String(w.label ?? LABELS[id] ?? id),
        points: (Array.isArray(w.points) ? (w.points as Raw[]) : []).map(point),
      };
    });
  } else if (Array.isArray(raw.rows)) {
    const byId = new Map<string, HeroPoint[]>();
    for (const row of raw.rows as Raw[]) {
      const id = String(row.workflow ?? "?");
      byId.set(id, [...(byId.get(id) ?? []), point(row)]);
    }
    series = [...byId.entries()].map(([id, points]) => ({ id, label: LABELS[id] ?? id, points }));
  }
  for (const s of series) s.points.sort((a, b) => a.coordinatorsKilled - b.coordinatorsKilled);
  const rank = (id: string) => {
    const index = WORKFLOW_ORDER.indexOf(id);
    return index < 0 ? WORKFLOW_ORDER.length : index;
  };
  series.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  const xs = Array.isArray(raw.x)
    ? (raw.x as unknown[]).map(Number)
    : [...new Set(series.flatMap((s) => s.points.map((p) => p.coordinatorsKilled)))].sort((a, b) => a - b);
  return {
    task: typeof raw.task === "string" ? raw.task : "T2",
    x: xs,
    series,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

/** Recharts rows: one per x value, one column per workflow for the chosen metric. */
export function chartRows(hero: HeroData, metric: keyof HeroPoint): Record<string, number | string | null>[] {
  return hero.x.map((x) => {
    const row: Record<string, number | string | null> = {
      x,
      label: `${x} (${PROFILE_BY_KILLS[x] ?? "?"})`,
    };
    for (const s of hero.series) {
      const found = s.points.find((p) => p.coordinatorsKilled === x);
      const value = found ? found[metric] : null;
      row[s.id] = typeof value === "number" ? value : null;
    }
    return row;
  });
}
