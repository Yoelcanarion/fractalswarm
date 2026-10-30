// The numbers the page's own sentences and figures use, read from the story. Every function takes the story and
// returns null (or an empty list) for what it does not hold: the page shows a dash, never a guess.

import type { Facts } from "./copy";
import type { AssumptionsSlice, FalseDeathRow, HeroPoint, HeroSlice, LaneBar, LanesSlice, Story } from "./data/types";
import { figure, MISSING } from "./format";
import type { Keyframe } from "./viz/tree/timeline";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function facts(story: Story | null): Facts {
  const counts = story?.tree?.counts;
  return {
    talks: num(story?.finish?.expected),
    tracks: num(counts?.tracks),
    sessions: num(counts?.sessions),
    orchestrators: num(counts?.orchestrators),
    agents: num(counts?.agents),
  };
}

/** The two real-model hero charts: the 2-seed matrix of the first runs (`v1`) and the 3-seed rows after the handler freeze. */
export type HeroSource = "v1" | "headline";

export interface HeroReading {
  stallS: number | null;
  extraCostPct: number | null;
  /** Coordinators killed at this point. */
  crashes: number | null;
  seeds: number | null;
  profile: string | null;
}

const NO_READING: HeroReading = { stallS: null, extraCostPct: null, crashes: null, seeds: null, profile: null };

/** The reading of one workflow at the last (heaviest) failure profile of a hero chart: C3, five crashes. */
export function heroReading(story: Story | null, workflow: string, source: HeroSource = "v1"): HeroReading {
  const last: HeroPoint | undefined = story?.hero?.[source]?.series.find((series) => series.id === workflow)?.points.at(-1);
  if (!last) return NO_READING;
  return {
    stallS: num(last.stallS),
    extraCostPct: num(last.extraPct),
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

/** The setting of a result drawn from one of the hero charts: its task and model, its seeds, the failures at its last point. */
export function settingOf(story: Story | null, source: HeroSource): Setting {
  const hero: HeroSlice | null | undefined = story?.hero?.[source];
  const reading = heroReading(story, "swarm", source);
  return {
    task: hero?.task ?? null,
    real: hero ? hero.model === "real" : null,
    seeds: num(hero?.seedCount),
    crashes: reading.crashes,
    profile: reading.profile,
  };
}

/** The setting of the 3-seed rows (`headline`): the same task and failures as the second hero chart, counted from the cells. */
export function headlineSetting(story: Story | null): Setting {
  const own = story?.headline;
  const base = settingOf(story, "headline");
  return { ...base, task: own?.task ?? base.task, real: own ? own.model === "real" : base.real, seeds: own ? own.seeds.length : base.seeds };
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

export const captionFor = (story: Story | null, source: HeroSource | "headline-rows"): string =>
  settingText(story, source === "headline-rows" ? headlineSetting(story) : settingOf(story, source));

/** The setting of the demo bundle, read from the name its run has (`t2-real-killhalf-seed1`: task, model, seed). */
export function bundleSetting(story: Story | null): Setting {
  const match = /^(t\d+)-(real|fake)-.*?seed(\d+)$/.exec(story?.sources?.bundle?.runId ?? "");
  const task = match ? Object.keys(story?.tasks ?? {}).find((id) => id.startsWith(`${match[1]}_`)) ?? null : null;
  return { task, real: match ? match[2] === "real" : null, seeds: match ? 1 : null, crashes: num(story?.takeover?.killCount), profile: null };
}

export const finish = (story: Story | null) => story?.finish ?? null;

export interface Takeover {
  killed: number | null;
  /** Who held the root, in order: ["o0", "o1", "o2", "o3"]. */
  rootChain: string[];
  /** The mean time from a brain's death to the verdict of the others. */
  verdictS: number | null;
}

export function takeover(story: Story | null): Takeover {
  const run = story?.takeover;
  return { killed: num(run?.killCount), rootChain: run?.chains?.["root"] ?? [], verdictS: num(run?.detection?.meanS) };
}

export const tokens = (story: Story | null): { coordination: number | null; recovery: number | null } => ({
  coordination: num(story?.tokensByModel?.coordinationTokens),
  recovery: num(story?.tokensByModel?.recoveryTokens),
});

/** What the terminal types: each command and the one line the real run printed for it. */
export function proofSteps(story: Story | null): { command: string; lines: string[] }[] {
  const hashes = story?.hashes;
  if (!hashes) return [];
  const steps = [
    { command: hashes.replay.command, line: hashes.replay.line },
    { command: hashes.takeover.command, line: hashes.takeover.line },
  ];
  return steps.filter((step) => step.line).map((step) => ({ command: step.command, lines: [step.line as string] }));
}

export const assumptions = (story: Story | null): AssumptionsSlice["items"] => story?.assumptions?.items ?? [];

export interface FailureFigure {
  value: number;
  label: string;
  /** Digits after the point, as the source writes it (0.90 has two). Default: as few as it needs, up to two. */
  decimals?: number;
}

export interface Failures {
  /** An external supervisor that detects and restarts within a second or less while the swarm keeps its 5 s detection:
   * the swarm's coordinator-dependency time as a multiple of the supervisor's (13.2 and 5.7 in R3). */
  fastRestart: FailureFigure[];
  /** Unnecessary reassignments per run: the gate rows at C2 and C3 (fake model, 1.25 and 2.25 in R3) and the real rows at C3. */
  falseDeaths: FailureFigure[];
  /** Per process, each coordinator process failing at the same rate: the swarm's exposure over the supervisor's (0.90 in R3). */
  perProcess: FailureFigure | null;
}

const remaps = (rows: FalseDeathRow[] | undefined, profile: string): FalseDeathRow | undefined =>
  rows?.find((row) => row.workflow === "swarm" && row.profile === profile);

export function failures(story: Story | null): Failures {
  const fast = story?.regime?.rows.find((row) => row.axis === "rival_recovery_ms")?.points ?? [];
  const gate = story?.falseDeaths;
  const real = story?.verdicts?.falseDeaths;
  const falseDeaths: FailureFigure[] = [];
  for (const [rows, profile, model] of [
    [gate?.rows, "C2", gate?.model === "real" ? "real model" : "fake model, $0 gate"],
    [gate?.rows, "C3", gate?.model === "real" ? "real model" : "fake model, $0 gate"],
    [real, "C3", story?.headline?.model === "fake" ? "fake model" : "real model"],
  ] as const) {
    const row = remaps(rows, profile);
    const value = num(row?.remapsPerRun);
    if (value !== null) falseDeaths.push({ value, label: `per run at ${profile} · ${model} · ${row?.runs} runs` });
  }
  const process = num(story?.perProcess?.ratio?.["cdt_s"]);
  return {
    fastRestart: fast
      .filter((point) => point.locality === "fails" && num(point.cdtRatio) !== null)
      .map((point) => ({ value: point.cdtRatio as number, label: `when the supervisor detects and restarts in ${figure(point.valueMs / 1000)} s`, decimals: 1 })),
    falseDeaths,
    perProcess: process === null ? null : { value: process, label: "swarm's exposure over the supervisor's, per process", decimals: 2 },
  };
}

/** One real extraction: a messy email and what Muse Spark read in it. Not in the data yet. */
export interface Extraction {
  email: string;
  constraints: { text: string; source: [from: number, to: number] | string }[];
  model?: string;
}
export const extraction = (story: Story | null): Extraction | null => ((story as unknown as { extraction?: Extraction } | null)?.extraction ?? null);

/** The hand-written parser against Muse Spark on the same notes. Not in the data yet. */
export interface Ablation {
  parser: number;
  muse: number;
  total: number;
}
export const ablation = (story: Story | null): Ablation | null => ((story as unknown as { ablation?: Ablation } | null)?.ablation ?? null);

// ---- where the text sits in the visuals' progress ----

/** Names the moments of the tree's story that the text of the solution refers to, from W7's keyframes of the log
 * (`TREE_KEYFRAMES`): the first kill, the verdict on it, the first takeover (a hold from `heir1` to `adopt1`), the last kill. */
export interface TreeBeats {
  grown: number;
  log: number;
  kill1: number;
  verdict1: number;
  heir1: number;
  adopt1: number;
  killLast: number;
  settled: number;
}

export function treeBeats(frames: readonly Keyframe[]): TreeBeats {
  const of = (kind: Keyframe["kind"]) => frames.filter((frame) => frame.kind === kind);
  const kills = of("kill");
  const first = kills[0];
  const verdict = of("verdict").find((frame) => frame.node === first?.node) ?? of("verdict")[0];
  const remap = of("remap")[0];
  const grown = of("assign")[0]?.p ?? 0;
  const kill1 = first?.p ?? grown;
  return {
    grown,
    log: grown + (kill1 - grown) / 2,
    kill1,
    verdict1: verdict?.p ?? kill1,
    heir1: remap?.p ?? verdict?.p ?? kill1,
    adopt1: remap?.pEnd ?? remap?.p ?? kill1,
    killLast: kills[kills.length - 1]?.p ?? kill1,
    settled: of("end")[0]?.p ?? 1,
  };
}

/** The moments of the in-process supervisor's run, in the progress of its lanes (the run's own clock). */
export interface LanesBeats {
  /** The team is at work: the first moment the most lanes are busy at once before the crash. */
  filled: number;
  crash: number;
  restart: number;
  /** The first call that is made again, from the restart on. */
  redone: number;
  end: number;
}

/** The first moment before `before` at which the most bars are open at once. */
function busiestBefore(bars: LaneBar[], before: number): number {
  const edges: [number, number][] = bars.filter((bar) => bar[1] < before).flatMap((bar): [number, number][] => [[bar[1], 1], [Math.min(bar[2], before), -1]]);
  // a bar that ends where another starts is not open at the same time as it
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let peak = 0;
  let peakAt = 0;
  for (const [at, step] of edges) {
    open += step;
    if (open > peak) {
      peak = open;
      peakAt = at;
    }
  }
  return peakAt;
}

export function lanesBeats(lanes: LanesSlice | null | undefined): LanesBeats {
  if (!lanes || !(lanes.durationMs > 0)) return { filled: 0.3, crash: 0.34, restart: 0.55, redone: 0.82, end: 1 };
  const at = (ms: number) => Math.min(1, Math.max(0, ms / lanes.durationMs));
  const crashMs = lanes.marks.find((mark) => mark.kind === "crash")?.atMs ?? lanes.durationMs;
  const restartMs = Math.max(crashMs, lanes.marks.find((mark) => mark.kind === "restart")?.atMs ?? crashMs);
  const redoStarts = lanes.bars.filter((bar) => bar[3] === lanes.kinds.again && bar[1] >= crashMs).map((bar) => bar[1]);
  return {
    filled: at(busiestBefore(lanes.bars, crashMs)),
    crash: at(crashMs),
    restart: at(restartMs),
    redone: at(Math.max(restartMs, redoStarts.length ? Math.min(...redoStarts) : restartMs)),
    end: 1,
  };
}

/** The seconds the in-process supervisor's work has stood still by progress `p` of its lanes (the run's own clock). */
export function waitedSeconds(lanes: LanesSlice | null | undefined, p: number): number | null {
  if (!lanes || !(lanes.durationMs > 0)) return null;
  const t = Math.min(1, Math.max(0, p)) * lanes.durationMs;
  let ms = 0;
  for (const [from, to] of lanes.stall.spansMs) ms += Math.max(0, Math.min(to, t) - from);
  return ms / 1000;
}
