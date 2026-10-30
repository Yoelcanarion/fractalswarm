// The numbers the page's own sentences and figures use, read from the story. Every function takes the story
// and returns null (or an empty list) for what it does not hold: the page shows a dash, never a guess.

import type { Facts } from "./copy";
import { slice, type Story } from "./story";
import type {
  HeroPoint,
  Keyframes,
  StoryAblation,
  StoryAssumption,
  StoryExtraction,
  StoryFacts,
  StoryFailures,
  StoryFinish,
  StoryHero,
  StoryProof,
  StoryTakeover,
  StoryTokens,
} from "./storyTypes";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function facts(story: Story | null): Facts {
  const f = slice<StoryFacts>(story, "facts") ?? {};
  return {
    talks: num(f.talks),
    tracks: num(f.tracks),
    days: num(f.days),
    sessions: num(f.sessions),
    orchestrators: num(f.orchestrators),
    agents: num(f.agents),
  };
}

export interface HeroReading {
  stallS: number | null;
  extraCostPct: number | null;
  /** Coordinators killed at this point. */
  crashes: number | null;
  seeds: number | null;
  profile: string | null;
}

const NO_READING: HeroReading = { stallS: null, extraCostPct: null, crashes: null, seeds: null, profile: null };

/** The reading of one workflow at the last (heaviest) failure profile of the hero chart: C3, five crashes. */
export function heroReading(story: Story | null, workflow: string): HeroReading {
  const points = slice<StoryHero>(story, "hero")?.series?.[workflow]?.points;
  const last: HeroPoint | undefined = points?.at(-1);
  if (!last) return NO_READING;
  return {
    stallS: num(last.stall_s),
    extraCostPct: num(last.extra_cost_pct),
    crashes: num(last.x),
    seeds: Array.isArray(last.seeds) ? last.seeds.length : null,
    profile: typeof last.profile === "string" ? last.profile : null,
  };
}

/** The setting of the hero chart's readings, for the caption under a result. */
export function heroSetting(story: Story | null): { task: string | null; real: boolean } {
  const hero = slice<StoryHero>(story, "hero");
  return { task: typeof hero?.task === "string" ? hero.task : null, real: /real/i.test(hero?.title ?? "") };
}

/** How many different seeds a slice holds: its `seeds` (a list or a count), or the `seed` of each of its cells. */
export function seedCount(story: Story | null, path: string): number | null {
  const at = slice<unknown>(story, path);
  const fromCells = (cells: unknown): number | null =>
    Array.isArray(cells) ? new Set(cells.map((cell) => (cell as { seed?: unknown })?.seed).filter((seed) => seed !== undefined)).size || null : null;
  if (Array.isArray(at)) return fromCells(at);
  if (at && typeof at === "object") {
    const record = at as { seeds?: unknown; cells?: unknown };
    if (Array.isArray(record.seeds)) return record.seeds.length;
    if (num(record.seeds) !== null) return num(record.seeds);
    return fromCells(record.cells);
  }
  return null;
}

export const finish = (story: Story | null): StoryFinish => slice<StoryFinish>(story, "finish") ?? {};
export const failures = (story: Story | null): StoryFailures => slice<StoryFailures>(story, "failures") ?? {};
export const takeover = (story: Story | null): StoryTakeover => slice<StoryTakeover>(story, "takeover") ?? {};
export const tokens = (story: Story | null): StoryTokens => slice<StoryTokens>(story, "tokens") ?? {};
export const extraction = (story: Story | null): StoryExtraction | null => slice<StoryExtraction>(story, "extraction") ?? null;
export const ablation = (story: Story | null): StoryAblation | null => slice<StoryAblation>(story, "ablation") ?? null;
export const proofLines = (story: Story | null): string[] => slice<StoryProof>(story, "proof")?.lines ?? [];

export function assumptions(story: Story | null): StoryAssumption[] {
  const rows = slice<StoryAssumption[]>(story, "assumptions");
  return Array.isArray(rows) ? rows : [];
}

/** The positions of a visual's events, from its slice's `keyframes`, over defaults for what it does not name. */
export function keyframes(story: Story | null, path: string, defaults: Keyframes): Keyframes {
  const given = slice<Keyframes>(story, `${path}.keyframes`) ?? {};
  const merged: Keyframes = { ...defaults };
  for (const [name, at] of Object.entries(given)) {
    const value = num(at);
    if (value !== null) merged[name] = value;
  }
  return merged;
}

/** The setting of a result drawn from `hero` (the v1 matrix) or from `headline` (the 3-seed rows after the freeze): both are the
 * T2 conference at the heaviest failure profile, so the task and the profile come from the hero chart, and the seeds from the slice itself. */
export function captionFor(story: Story | null, source: "hero" | "headline"): string {
  const swarm = heroReading(story, "swarm");
  const own = slice<{ real?: unknown }>(story, source);
  const real = typeof own?.real === "boolean" ? own.real : heroSetting(story).real;
  const seeds = source === "hero" ? swarm.seeds : seedCount(story, "headline");
  return settingText({ task: heroSetting(story).task, crashes: swarm.crashes, profile: swarm.profile, real, seeds });
}

/** `t2_conference` -> `T2 conference`. */
export function taskName(id: string | null): string {
  if (!id) return "—";
  const [head, ...rest] = id.split("_");
  return [head.toUpperCase(), ...rest].join(" ");
}

/** The caption under a result: the task, the failure profile, real model or fake, and the seeds. */
export function settingText(parts: { task: string | null; crashes: number | null; profile: string | null; real: boolean | null; seeds: number | null }): string {
  const crashes =
    parts.crashes === null
      ? "—"
      : `${parts.crashes} ${parts.crashes === 1 ? "coordinator" : "coordinators"} crashed${parts.profile ? ` (${parts.profile})` : ""}`;
  const seeds = parts.seeds === null ? "—" : `${parts.seeds} ${parts.seeds === 1 ? "seed" : "seeds"}`;
  const model = parts.real === null ? "—" : parts.real ? "real model" : "fake model";
  return [taskName(parts.task), crashes, model, seeds].join(" · ");
}
