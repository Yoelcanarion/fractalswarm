// What the page itself reads from story.json (the numbers in its sentences, the figures it sets large,
// the rows of its tables). It is the contract with scripts/build_home_data.py (W7): every field is
// optional, because the file may not exist yet or may lack a slice, and the page then shows a dash, never
// a guess. The slices W7's visuals draw (`tree`, `lanes`, `hrw`, `hashes`, ...) are theirs; the page passes
// them through untouched, and reads only the `keyframes` object, if a slice has one.
//
// `keyframes` names the positions, in the visual's own progress (0 to 1), of the events the text refers to:
//   tree:        grown, log, kill1, verdict1, heir1, adopt1, kill5, settled
//   lanes.central: filled, crash, restart, redone, end

export interface Keyframes {
  [name: string]: number;
}

/** The structural facts of the running example. */
export interface StoryFacts {
  talks?: number; // 48
  tracks?: number; // 3
  days?: number; // 2
  sessions?: number; // 6
  orchestrators?: number; // 10
  agents?: number; // 12
}

/** hero-t2_conference.json as it is: one series per workflow, one point per failure profile. */
export interface HeroPoint {
  profile: string; // "C3"
  x: number; // coordinators killed: 5
  stall_s: number;
  extra_cost_pct: number;
  seeds: string[];
}

export interface StoryHero {
  task?: string; // "t2_conference"
  title?: string; // "rivals-real"
  series?: Record<string, { points: HeroPoint[] }>;
}

/** The numbers of the demo bundle's last beat, read from its `task.result` and its metrics. */
export interface StoryFinish {
  talksPlaced?: number;
  talksTotal?: number;
  hardViolations?: number;
  duplicateCalls?: number;
  costUsd?: number;
  /** The setting of the run, for the caption: its task id ("t2_conference"), whether the model was real, its seeds. */
  task?: string;
  real?: boolean;
  seeds?: number;
}

export interface StoryTakeover {
  killed?: number; // orchestrators killed in the demo run
  rootChain?: string[]; // who held the root: ["o0", "o1", "o2", "o3"]
  deathVerdictS?: number; // seconds from the last heartbeat to the verdict
  keyframes?: Keyframes;
}

export interface StoryLanes {
  central?: { stallS?: number; keyframes?: Keyframes };
}

/** A number with the words that say what it is, written by the generator from the regime it comes from. */
export interface StoryFigure {
  value: number;
  label: string;
  /** Digits after the point, as the source writes it (0.90 has two). Default: as few as it needs, up to two. */
  decimals?: number;
}

/** The figures of "where it does not help" (R3; `honesty.json`, `regime.json`). */
export interface StoryFailures {
  /** An external supervisor that detects and restarts within a second or less while the swarm keeps its detection:
   * the swarm's coordinator-dependency time as a multiple of the supervisor's (13.2 and 5.7 in R3). */
  fastRestart?: StoryFigure[];
  /** False deaths per run (1.25 to 2.25 in R3); the supervisors have none. */
  falseDeaths?: StoryFigure[];
  /** Per process, each coordinator process failing at the same rate: the swarm's exposure over the supervisor's (0.90 in R3). */
  perProcess?: StoryFigure;
}

/** One row of the table of what the rival is granted (bench/REPORT.md §1). */
export interface StoryAssumption {
  id: string;
  label: string;
  value: string;
}

export interface StoryTokens {
  coordination?: number; // 0
  recovery?: number; // 0
}

/** One real extraction: a messy email and what Muse Spark read in it. */
export interface StoryExtraction {
  email?: string;
  /** What was read, and where from: a character range of `email`, or the sentence itself. */
  constraints?: { text: string; source: [from: number, to: number] | string }[];
  model?: string;
}

export interface StoryAblation {
  parser?: number;
  muse?: number;
  total?: number;
}

/** The terminal lines of `demo --verify`, as the command printed them. */
export interface StoryProof {
  lines?: string[];
}
