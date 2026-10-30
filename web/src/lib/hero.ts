// The hero chart data (spec §15.5), normalized from the bench JSON.
//
// Three shapes are read:
//   recorded  what bench/charts.py writes and bench/results/<set>/hero-*.json holds:
//             {task, title, x, x_label, panels: [{metric, label, note}],
//              series: {<workflow>: {color, points: [{x, profile, seeds, runs, stall_s, stall_s_min, stall_s_max,
//              extra_cost_pct, ..., completion_rate, validity_rate (percent), coordination_tokens, cost_usd}]}}}
//   v1        "fractalswarm.hero/v1", the fixture of the UI's development: {x, workflows: [{id, label?, points:
//             [{coordinators_killed, profile?, stall_s, extra_cost_pct, completion_rate?, ...}]}]}, rates as fractions
//   rows      flat rows: {rows: [{workflow, coordinators_killed, stall_s, ...}]}
// Every rate leaves here as a fraction (0..1), whatever it came in as.

import { systemName } from "../arena/assumptions";

/** The numbers a point carries, by the name this module gives them. */
export type MetricKey = "stallS" | "extraCostPct" | "completionRate" | "validityRate" | "coordinationTokens" | "costUsd";

export interface HeroPoint {
  coordinatorsKilled: number;
  profile: string | null;
  stallS: number | null;
  extraCostPct: number | null;
  /** 0..1 */
  completionRate: number | null;
  /** 0..1 */
  validityRate: number | null;
  coordinationTokens: number | null;
  costUsd: number | null;
  /** The lowest and highest value over the seeds, for the metrics the file records them for. */
  range: Partial<Record<MetricKey, [number, number]>>;
  /** The seeds this point is the mean of; empty where the file does not say. */
  seeds: string[];
  runs: string[];
}

export interface HeroSeries {
  id: string;
  label: string;
  points: HeroPoint[];
}

/** What the file says about one of its charts (the recorded shape's `panels`), by metric key. */
export interface HeroPanel {
  label: string;
  note: string;
}

export type HeroShape = "recorded" | "v1" | "rows" | "unknown";

export interface HeroData {
  shape: HeroShape;
  /** The matrix the file was drawn from ("rivals-real", "headline"), if it says. */
  title: string | null;
  task: string;
  /** The x values that have a point in some series, ascending. */
  x: number[];
  xLabel: string;
  series: HeroSeries[];
  panels: Partial<Record<MetricKey, HeroPanel>>;
  note: string | null;
}

export const WORKFLOW_ORDER = ["swarm", "durable-max", "durable", "central", "pipeline", "single", "langgraph"];

/** How a workflow is named on a chart: the arena's words for the bench's systems (arena/assumptions.ts),
 * so the in-process supervisor is never called just "central" or a plain supervisor. */
export function workflowLabel(id: string): string {
  const name = id === "langgraph" ? "LangGraph teams" : systemName(id);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const PROFILE_BY_KILLS: Record<number, string> = { 0: "C0", 1: "C1", 3: "C2", 5: "C3" };

/** The file's metric names, as this module calls them. */
const FIELDS: Record<MetricKey, { file: string; percent: boolean }> = {
  stallS: { file: "stall_s", percent: false },
  extraCostPct: { file: "extra_cost_pct", percent: false },
  completionRate: { file: "completion_rate", percent: true },
  validityRate: { file: "validity_rate", percent: true },
  coordinationTokens: { file: "coordination_tokens", percent: false },
  costUsd: { file: "cost_usd", percent: false },
};
const METRICS = Object.keys(FIELDS) as MetricKey[];

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A point of any of the three shapes. ``rateScale`` is what a rate must be divided by to be a fraction. */
function point(raw: Raw, rateScale: number): HeroPoint {
  const kills = num(raw.coordinators_killed) ?? num(raw.x) ?? 0;
  const out: HeroPoint = {
    coordinatorsKilled: kills,
    profile: typeof raw.profile === "string" ? raw.profile : (PROFILE_BY_KILLS[kills] ?? null),
    stallS: null,
    extraCostPct: null,
    completionRate: null,
    validityRate: null,
    coordinationTokens: null,
    costUsd: null,
    range: {},
    seeds: Array.isArray(raw.seeds) ? raw.seeds.map(String) : [],
    runs: Array.isArray(raw.runs) ? raw.runs.map(String) : [],
  };
  for (const key of METRICS) {
    const { file, percent } = FIELDS[key];
    const scale = percent ? rateScale : 1;
    const mean = num(raw[file]);
    out[key] = mean === null ? null : mean / scale;
    const lo = num(raw[`${file}_min`]);
    const hi = num(raw[`${file}_max`]);
    if (lo !== null && hi !== null) out.range[key] = [lo / scale, hi / scale];
  }
  return out;
}

const panelsOf = (raw: Raw): HeroData["panels"] => {
  const out: HeroData["panels"] = {};
  if (!Array.isArray(raw.panels)) return out;
  for (const panel of raw.panels) {
    if (!isRecord(panel)) continue;
    const key = METRICS.find((m) => FIELDS[m].file === panel.metric);
    if (key) out[key] = { label: String(panel.label ?? ""), note: String(panel.note ?? "") };
  }
  return out;
};

export function normalizeHero(data: unknown): HeroData {
  const raw = isRecord(data) ? data : {};
  let series: HeroSeries[] = [];
  let shape: HeroShape = "unknown";
  if (isRecord(raw.series)) {
    shape = "recorded";
    series = Object.entries(raw.series).map(([id, entry]) => {
      const points = isRecord(entry) && Array.isArray(entry.points) ? entry.points : [];
      return { id, label: workflowLabel(id), points: points.filter(isRecord).map((p) => point(p, 100)) };
    });
  } else if (Array.isArray(raw.workflows)) {
    shape = "v1";
    series = (raw.workflows as Raw[]).map((w) => {
      const id = String(w.id ?? w.name ?? "?");
      return {
        id,
        label: typeof w.label === "string" ? w.label : workflowLabel(id),
        points: (Array.isArray(w.points) ? (w.points as Raw[]) : []).map((p) => point(p, 1)),
      };
    });
  } else if (Array.isArray(raw.rows)) {
    shape = "rows";
    const byId = new Map<string, HeroPoint[]>();
    for (const row of raw.rows as Raw[]) {
      const id = String(row.workflow ?? "?");
      byId.set(id, [...(byId.get(id) ?? []), point(row, 1)]);
    }
    series = [...byId.entries()].map(([id, points]) => ({ id, label: workflowLabel(id), points }));
  }
  for (const s of series) s.points.sort((a, b) => a.coordinatorsKilled - b.coordinatorsKilled);
  const rank = (id: string) => {
    const index = WORKFLOW_ORDER.indexOf(id);
    return index < 0 ? WORKFLOW_ORDER.length : index;
  };
  series.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  // Only the x values somebody has a point at: a file that lists C1 and C2 for a matrix that never ran them
  // would otherwise draw two empty columns.
  const drawn = [...new Set(series.flatMap((s) => s.points.map((p) => p.coordinatorsKilled)))].sort((a, b) => a - b);
  const listed = Array.isArray(raw.x) ? (raw.x as unknown[]).map(Number).filter(Number.isFinite) : [];
  return {
    shape,
    title: typeof raw.title === "string" ? raw.title : null,
    task: typeof raw.task === "string" ? raw.task : "T2",
    x: drawn.length > 0 ? drawn : listed,
    xLabel: typeof raw.x_label === "string" ? raw.x_label : "Coordinators killed",
    series,
    panels: panelsOf(raw),
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

/** The key of a series' [lowest, highest] band in a chart row. */
export const bandKey = (seriesId: string): string => `${seriesId}:band`;

/** Recharts rows: one per x value, one column per workflow for the chosen metric, and
 * ``<workflow>:band`` with the [lowest, highest] over the seeds where the file records them. */
export function chartRows(hero: HeroData, metric: MetricKey): Record<string, number | string | [number, number] | null>[] {
  return hero.x.map((x) => {
    const row: Record<string, number | string | [number, number] | null> = {
      x,
      label: `${x} (${PROFILE_BY_KILLS[x] ?? "?"})`,
    };
    for (const s of hero.series) {
      const found = s.points.find((p) => p.coordinatorsKilled === x);
      const value = found ? found[metric] : null;
      row[s.id] = typeof value === "number" ? value : null;
      row[bandKey(s.id)] = found?.range[metric] ?? null;
    }
    return row;
  });
}

/** How many seeds the points of a set were taken over: the smallest and largest count, so a set whose
 * points differ says so. Null where the file does not name its seeds. */
export function seedCounts(hero: HeroData): { min: number; max: number } | null {
  const counts = hero.series.flatMap((s) => s.points.map((p) => p.seeds.length)).filter((n) => n > 0);
  return counts.length > 0 ? { min: Math.min(...counts), max: Math.max(...counts) } : null;
}

/** The runs behind a set: every distinct run a point names. */
export function runCount(hero: HeroData): number {
  return new Set(hero.series.flatMap((s) => s.points.flatMap((p) => p.runs))).size;
}

// ---- the recorded sets (`GET api/bench/results`) ----

export type Backend = "real" | "fake";

/** What each recorded set was run with. The files do not say, so this does, from docs/claims.md: the
 * real-model rows are `bench/results/v1` (2 seeds) and `bench/results/headline` (3 seeds, after the handler
 * freeze); `bench/results/rivals-gate` is the $0 gate (fake LLM, simulated clock). A set that is not here
 * is shown with its setting "not recorded", never guessed. */
const SET_FACTS: Record<string, { backend: Backend; heading: string }> = {
  v1: { backend: "real", heading: "Rivals matrix" },
  headline: { backend: "real", heading: "Headline" },
  "rivals-gate": { backend: "fake", heading: "The $0 gate" },
};

export interface HeroSet {
  /** The directory under bench/results it was read from ("v1", "headline"). */
  name: string;
  /** Where the file is, for the caption. */
  source: string;
  heading: string;
  /** Null where the setting is not recorded. */
  backend: Backend | null;
  hero: HeroData;
}

interface BenchBody {
  source?: string;
  fixture?: boolean;
  data?: unknown;
  sets?: unknown;
}

/** The measured sets a `bench/results` answer carries, in the order the server lists them. Empty when the
 * server has only its placeholder (``fixture``) or nothing the chart can read: a page must say so and must
 * not draw the placeholder as if it were measured. An older server sends one file in ``data``; that is
 * one set. */
export function heroSets(body: BenchBody): HeroSet[] {
  if (body.fixture) return [];
  const listed = Array.isArray(body.sets) ? body.sets.filter(isRecord) : [];
  const files: Raw[] = listed.length > 0 ? listed : body.data === undefined ? [] : [{ data: body.data, source: body.source }];
  return files
    .map((file): HeroSet => {
      const hero = normalizeHero(file.data);
      const name = typeof file.name === "string" ? file.name : (hero.title ?? "recorded");
      const facts = SET_FACTS[name];
      return {
        name,
        source: typeof file.source === "string" ? file.source : name,
        heading: facts?.heading ?? hero.title ?? name,
        backend: facts?.backend ?? null,
        hero,
      };
    })
    .filter((set) => set.hero.series.length > 0);
}
