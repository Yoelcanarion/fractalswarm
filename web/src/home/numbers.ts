// The numbers the page's own sentences and figures use, read from the story. Every function takes the story and
// returns null (or an empty list) for what it does not hold: the page shows a dash, never a guess.

import type { Facts } from "./copy";
import type { AssumptionRow, FailureFigure, HeroPoint, Story } from "./data/types";
import { MISSING } from "./format";
import { slice } from "./story";

export type { FailureFigure };

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function facts(story: Story | null): Facts {
  const f = story?.facts;
  return {
    talks: num(f?.talks),
    tracks: num(f?.tracks),
    days: num(f?.days),
    sessions: num(f?.sessions),
    orchestrators: num(f?.orchestrators),
    agents: num(f?.agents),
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
  const last: HeroPoint | undefined = story?.hero?.series?.[workflow]?.points?.at(-1);
  if (!last) return NO_READING;
  return {
    stallS: num(last.stall_s),
    extraCostPct: num(last.extra_cost_pct),
    crashes: num(last.x),
    seeds: Array.isArray(last.seeds) ? last.seeds.length : null,
    profile: typeof last.profile === "string" ? last.profile : null,
  };
}

export interface Setting {
  task: string | null;
  real: boolean | null;
  seeds: number | null;
  crashes: number | null;
  profile: string | null;
}

/** The setting of the hero chart's readings: its task and model, its seeds, the failures at its last point. */
export function heroSetting(story: Story | null): Setting {
  const hero = story?.hero;
  const reading = heroReading(story, "swarm");
  return {
    task: hero?.task ?? null,
    real: hero ? hero.model === "real" : null,
    seeds: num(hero?.seedCount),
    crashes: reading.crashes,
    profile: reading.profile,
  };
}

/** The setting of the per-seed rows (`headline`): the same task and failures as the hero chart's last point, counted over their own seeds. */
export function headlineSetting(story: Story | null): Setting {
  const rows = story?.headline;
  const base = heroSetting(story);
  return { ...base, task: rows?.task ?? base.task, real: rows ? rows.real : base.real, seeds: num(rows?.seedCount) ?? (rows ? rows.seeds.length : null) };
}

const GATE_PROFILES = ["C2", "C3"] as const;

/** The crash counts of the two profiles the $0 gate tied at (C2 and C3), read from the failure profiles: three and five. */
export function gateCrashes(story: Story | null): number[] {
  const items = story?.profiles?.items ?? {};
  return GATE_PROFILES.flatMap((profile) => {
    const crashes = num(items[profile]?.coordinatorCrashes);
    return crashes === null ? [] : [crashes];
  });
}

/** `t2_conference` -> `T2 conference planning` (the short name and the name the generator gives the task). */
export function taskName(story: Story | null, id: string | null): string {
  if (!id) return MISSING;
  const task = story?.tasks?.[id];
  if (task) return `${task.short} ${task.name.toLowerCase()}`;
  const [head, ...rest] = id.split("_");
  return [head.toUpperCase(), ...rest].join(" ");
}

/** The caption under a result: the task, the failure profile, real model or fake, and the seeds. */
export function settingText(story: Story | null, setting: Setting): string {
  const crashes =
    setting.crashes === null
      ? MISSING
      : `${setting.crashes} ${setting.crashes === 1 ? "coordinator" : "coordinators"} crashed${setting.profile ? ` (${setting.profile})` : ""}`;
  const seeds = setting.seeds === null ? MISSING : `${setting.seeds} ${setting.seeds === 1 ? "seed" : "seeds"}`;
  const model = setting.real === null ? MISSING : setting.real ? "real model" : "fake model";
  return [taskName(story, setting.task), crashes, model, seeds].join(" · ");
}

/** The setting of a result drawn from `hero` or from `headline` (the per-seed rows). */
export const captionFor = (story: Story | null, source: "hero" | "headline"): string =>
  settingText(story, source === "hero" ? heroSetting(story) : headlineSetting(story));

/** The setting of the demo bundle's run, which `finish` names, with the coordinators the run killed. */
export function runSetting(story: Story | null): Setting {
  const run = story?.finish;
  return {
    task: run?.task ?? null,
    real: typeof run?.real === "boolean" ? run.real : null,
    seeds: num(run?.seeds),
    crashes: num(story?.takeover?.killed),
    profile: null,
  };
}

export const finish = (story: Story | null) => story?.finish ?? null;

export interface Takeover {
  killed: number | null;
  /** Who held the root, in order: ["o0", "o1", "o2", "o3"]. */
  rootChain: string[];
}

export function takeover(story: Story | null): Takeover {
  const run = story?.takeover;
  return { killed: num(run?.killed), rootChain: run?.rootChain ?? [] };
}

export const tokens = (story: Story | null): { coordination: number | null; recovery: number | null } => ({
  coordination: num(story?.tokens?.coordination),
  recovery: num(story?.tokens?.recovery),
});

export interface ProofStep {
  command: string;
  /** What the real run printed for it. */
  lines: string[];
}

/** What the terminal types: the replay of the demo run, then the takeover check of the same run, each with its real output. */
export function proofSteps(story: Story | null): ProofStep[] {
  const proof = story?.proof;
  if (!proof) return [];
  const steps: ProofStep[] = [{ command: proof.command, lines: proof.lines ?? [] }];
  if (proof.takeover?.line) steps.push({ command: proof.takeover.command, lines: [proof.takeover.line] });
  return steps.filter((step) => step.command && step.lines.length > 0);
}

export const assumptions = (story: Story | null): AssumptionRow[] => (Array.isArray(story?.assumptions) ? (story?.assumptions as AssumptionRow[]) : []);

const REAL_MODEL = /real model/i;

export interface Failures {
  /** An external supervisor that detects and restarts within a second or less while the swarm keeps its 5 s detection:
   * the swarm's coordinator-dependency time as a multiple of the supervisor's, as R3 writes it (13.2 and 5.7, one decimal). */
  fastRestart: FailureFigure[];
  /** Unnecessary takeovers per run at the $0 gate, fake model, C2 and C3 (1.25 and 2.25 in R3). The figure of the real runs
   * is not here: it belongs to R4's setting (`realFalseDeaths`). */
  falseDeaths: FailureFigure[];
  /** Per process, each coordinator process failing at the same rate: the swarm's exposure over the supervisor's (0.90 in R3). */
  perProcess: FailureFigure | null;
}

export function failures(story: Story | null): Failures {
  const found = story?.failures;
  return {
    fastRestart: (found?.fastRestart ?? []).map((item) => ({ decimals: 1, ...item })),
    falseDeaths: (found?.falseDeaths ?? []).filter((item) => !REAL_MODEL.test(item.label)),
    perProcess: found?.perProcess ?? null,
  };
}

/** What the swarm's failure detector did on the real runs of the headline point: unnecessary takeovers per run, over how many runs. */
export function realFalseDeaths(story: Story | null): { perRun: number; runs: number } | null {
  const row = story?.verdicts?.falseDeaths?.find((item) => item.workflow === "swarm" && item.profile === "C3");
  const perRun = num(row?.remapsPerRun);
  return row && perRun !== null ? { perRun, runs: row.runs } : null;
}

/** One real extraction: a messy email and what Muse Spark read in it. W7 adds it to the data; until then it is null. */
export interface Extraction {
  email: string;
  constraints: { text: string; source: [from: number, to: number] | string }[];
  model?: string;
}
export const extraction = (story: Story | null): Extraction | null => slice<Extraction>(story, "extraction") ?? null;

/** The hand-written parser against Muse Spark on the same notes. Absent by decision (coordinator, Oct 30): the block shows PENDING. */
export interface Ablation {
  parser: number;
  muse: number;
  total: number;
}
export const ablation = (story: Story | null): Ablation | null => slice<Ablation>(story, "ablation") ?? null;
