// The shape of story.json, as scripts/build_home_data.py writes it. Keep the two in step: the
// generator's docstring names every slice, and data/story.test.ts checks this shape against the file.
// Each visual draws one slice and is handed only that slice (the page does `slice(story, "tree")`).

export type ClaimState = "allowed" | "pending" | "not-claimed";

export interface Claim {
  /** The row's wording, from docs/claims.md. */
  text: string;
  /** The status cell as written. */
  status: string;
  /** What the page makes of it. */
  state: ClaimState;
}

export interface SourceRecord {
  path: string;
  digest?: string | null;
  runId?: string;
  head?: string;
  events?: number;
  cell?: string;
  inGit?: boolean;
  present?: boolean;
}

// -- the tree and the kill sequence of the demo bundle ----------------------------------------

export interface TreeNodeData {
  id: string;
  kind: "brain" | "agent";
  parent: string | null;
  level: number;
  role: string;
  goal: string | null;
  label: string;
  spawnedMs: number;
}

export interface GoalData {
  id: string;
  level: number;
  owner: string;
  parent: string | null;
}

export interface HeartbeatData {
  /** The failure detector's beat (Detector.interval_ms) and its two thresholds. */
  intervalMs: number;
  suspectAfter: number;
  deadAfter: number;
  /** Heartbeat frames in the whole log. */
  frames: number;
  /** Per sender: its first and last tick, the number of ticks, the peers it ever watched. */
  senders: Record<string, { firstMs: number; lastMs: number; ticks: number; peers: string[] }>;
}

/** Everything the swarm tree draws: who is in it, when each brain is killed and declared dead, who
 * takes over, which messages cross it, when each actor has a call in flight. */
export interface TreeSlice {
  root: string;
  nodes: TreeNodeData[];
  goals: GoalData[];
  counts: { orchestrators: number; agents: number; tracks: number; sessions: number };
  durationMs: number;
  talks: { placed: number | null; expected: number | null };
  kills: KillData[];
  adoptions: AdoptionData[];
  /** The HRW rounds of the run: the real scores of the candidates (the same as `hrw.rounds`). */
  rounds: HrwRound[];
  heartbeat: HeartbeatData;
  messageKinds: ["assign", "contract", "contract.result", "result"];
  messageFields: ["tMs", "from", "to", "kind"];
  /** [tMs, from, to, kind index] */
  messages: [number, string, string, number][];
  /** For each actor, the spans [startMs, endMs] with an LLM call in flight. */
  busy: Record<string, [number, number][]>;
}

export interface VerdictData {
  seq: number;
  by: string;
  atMs: number;
  delayS: number;
  missed: number;
  truth: string;
}

export interface KillData {
  i: number;
  seq: number;
  target: string;
  level: number;
  role: string;
  heldRoot: boolean;
  atMs: number;
  progress: number | null;
  stoppedSeq: number | null;
  remainingWork: number | null;
  eventsAfterStop: number;
  suspectedAtMs: number | null;
  verdict: VerdictData | null;
}

export interface SuccessionData {
  seq: number;
  atMs: number;
  goal: string;
  root: boolean;
  previous: string;
  owner: string;
  kind: string;
  works: string[];
  adoptedResults: number;
  pool: string[];
  heir: string | null;
  ok: boolean;
}

export interface AdoptionData {
  seq: number;
  atMs: number;
  goal: string;
  dead: string;
  adopter: string;
  children: string[];
  duties: string[];
}

export interface OrphanData {
  seq: number;
  atMs: number;
  from: string;
  to: string;
  goal: string;
  contract: string;
  fate: string;
  consumer: string | null;
}

export interface TakeoverSlice {
  runId: string;
  durationMs: number;
  killed: number;
  successions: SuccessionData[];
  orphans: OrphanData[];
  chains: Record<string, string[]>;
  /** Who held the root goal, in order. */
  rootChain: string[];
  /** From the kill to the verdict. */
  detection: { minS: number; maxS: number; meanS: number };
  /** From the dead brain's last heartbeat to the verdict (mean, and the range). */
  deathVerdictS: number;
  deathVerdictRangeS: [number, number];
  falseVerdicts: number;
  ok: boolean;
  violations: number;
  okLine: string;
}

export interface FactsSlice {
  talks: number;
  tracks: number;
  days: number;
  sessions: number;
  orchestrators: number;
  agents: number;
}

export interface ProofSlice {
  command: string;
  /** What the command prints when the replay matches. */
  lines: string[];
  takeover: { command: string; line: string };
}

export interface HrwScore {
  member: string;
  /** 16 hex digits, the real blake2b score of (goal, member). */
  score: string;
  /** score / 2^64, for a bar. */
  fraction: number;
}

export interface HrwRound {
  i: number;
  successionIndex: number;
  goal: string;
  root: boolean;
  previous: string;
  atMs: number;
  pool: string[];
  /** Best first. */
  scores: HrwScore[];
  heir: string | null;
  owner: string;
  agree: boolean;
  survivors: string[];
}

export interface HrwSlice {
  rule: string;
  source: string;
  rounds: HrwRound[];
}

export interface FinishSlice {
  /** The setting of the run. */
  task: string;
  real: boolean;
  seeds: number;
  talksPlaced: number | null;
  talksTotal: number | null;
  status: string | null;
  placed: number | null;
  expected: number | null;
  hardViolations: number | null;
  softScore: number | null;
  llmCallsPaid: number;
  duplicateCalls: number;
  cancelledInFlight: number;
  contractRedispatches: number;
  contractsVerified: number;
  contracts: number;
  goalsOk: number;
  goals: number;
  costUsd: number;
  peakCommittedUsd: number;
  runCapUsd: number | null;
  durationS: number;
  killed: number;
  coordinationTokens: number;
  recoveryTokens: number;
}

// -- work lanes ------------------------------------------------------------------------------

export interface LaneInfo {
  id: string;
  kind: "agent" | "brain";
}

/** [lane, startMs, endMs, kind, costMicroUsd, cause] */
export type LaneBar = [number, number, number, number, number, number];
/** [lane, startMs, endMs, endedBy] */
export type LaneLife = [number, number, number, "crash" | "kill" | "done"];

export type LaneMark =
  | { kind: "crash"; atMs: number; n: number; restartInMs: number }
  | { kind: "restart"; atMs: number; n: number }
  | { kind: "kill"; atMs: number; lane: number | null; target: string; role: "agent" | "brain" }
  | { kind: "verdict"; atMs: number; target: string; by: string }
  | { kind: "remap"; atMs: number; goal: string; from: string; to: string };

export interface LanesSlice {
  /** Seconds the work waited, in total (the central run's stall time). */
  stallS?: number;
  /** Where the beats sit in the lanes' progress; the lanes' time map is built from them. */
  keyframes?: { filled: number; crash: number; restart: number; redone: number; end: number };
  /** What the run was: the workflow, the task, the failure profile, the seed, whether the model was real, and how many crashes. */
  setting?: { label: string; task: string; profile: string; seed: string; real: boolean; crashes: number };
  runId: string;
  head: string;
  events: number;
  durationMs: number;
  lanes: LaneInfo[];
  barFields: string[];
  /** counted 0, cutOff 1, again 2, other 3 */
  kinds: { counted: number; cutOff: number; again: number; other: number };
  /** none 0, crash 1, kill 2, other 3 */
  causes: { none: number; crash: number; kill: number; other: number };
  bars: LaneBar[];
  lifeFields: string[];
  life: LaneLife[];
  marks: LaneMark[];
  stall: { windowMs: [number, number]; spansMs: [number, number][]; totalMs: number };
  costs: { totalMicroUsd: number; wastedMicroUsd: number; settledUsd: number };
  metrics: {
    stallS: number;
    workWindowS: number;
    makespanS: number;
    costUsd: number;
    llmCalls: number;
    cancelledLlmCalls: number;
    coordinationTokens: number;
  };
}

// -- hashes ----------------------------------------------------------------------------------

/** [seq, tMs, type, actor, hash, prevHash] */
export type HashEvent = [number, number, string, string, string, string];

export interface HashesSlice {
  count: number;
  head: string;
  headFile: string;
  chainOk: boolean;
  events: HashEvent[];
  eventFields: string[];
  /** By seq: what happened at that event, and what kind of moment it is. */
  marks: Record<string, { kind: "start" | "kill" | "remap" | "end"; label: string }>;
  gaps: { after: number; skipped: number }[];
  replay: { command: string; line: string | null; source: string | null; matches: boolean | null };
  takeover: { command: string; line: string };
}

// -- benchmark results -----------------------------------------------------------------------

/** A point of hero-t2_conference.json, in the file's own names. */
export interface HeroPoint {
  x: number;
  profile: string;
  stall_s: number;
  stall_s_min: number;
  stall_s_max: number;
  extra_cost_pct: number;
  extra_cost_pct_min: number;
  extra_cost_pct_max: number;
  cost_usd: number;
  completion_rate: number;
  seeds: string[];
}

export interface HeroSeries {
  label: string;
  points: HeroPoint[];
}

export interface HeroSlice {
  source: string;
  /** The result set the reading is from: "v1" (2 seeds) or "headline-10" (the 10-seed extension). */
  set: string;
  digest: string;
  task: string;
  /** The file's title: "rivals-real" is the real model against the rivals. */
  title: string;
  model: "real" | "fake";
  xLabel: string;
  x: number[];
  seedCount: number;
  /** The workflows in the order to draw them. */
  order: string[];
  series: Record<string, HeroSeries>;
}

export interface HeadlineCell {
  cell: string;
  workflow: string;
  task: string;
  profile: string;
  seed: string;
  crashes: number;
  coordinatorsKilled: number;
  completed: boolean;
  valid: boolean | null;
  stallS: number;
  extraCostPct: number | null;
  costUsd: number;
  makespanS: number;
  coordinationTokens: number;
  cdtS: number | null;
  blastSessionsPct: number | null;
  blastAgentsPct: number | null;
  idleAgentS: number | null;
  falseDeathRemaps: number | null;
  dupCalls: number | null;
  preservedPct: number | null;
}

export interface HeadlineSlice {
  source: string;
  digest: string;
  task: string;
  model: "real" | "fake";
  real: boolean;
  seeds: string[];
  seedCount: number;
  cells: HeadlineCell[];
}

export interface VerdictRow {
  hypothesis: string;
  name: string;
  metric: string;
  rival: string;
  profile: string;
  seeds: string[];
  swarm: number | null;
  rivalValue: number | null;
  ratio: number | null;
  verdict: "win" | "tie" | "loss" | "n/a";
  mixed: boolean;
}

export interface FalseDeathRow {
  source: string;
  task: string;
  profile: string;
  workflow: string;
  runs: number;
  remapsPerRun: number | null;
  remapsMax: number | null;
  paidTwiceUsdPerRun: number | null;
}

export interface VerdictsSlice {
  source: string;
  prereg: Record<string, string>;
  rules: Record<string, unknown>;
  comparisons: VerdictRow[];
  falseDeaths: FalseDeathRow[];
}

export type Locality = "holds" | "ties" | "fails" | "n/a";

export interface RegimePoint {
  valueMs: number;
  plausible: boolean;
  locality: Locality;
  cdtRatio: number | null;
  blastRatio: number | null;
  idleRatio: number | null;
  source: string;
}

export interface RegimeRow {
  axis: "recovery_ms" | "rival_restart_ms" | "rival_recovery_ms";
  label: string;
  points: RegimePoint[];
}

export interface RegimeSlice {
  source: string;
  against: string;
  task: string;
  profile: string;
  model: "real" | "fake";
  threshold: number;
  defaults: Record<string, number | null>;
  rows: RegimeRow[];
}

export interface GateSlice {
  source: string;
  against: string;
  model: "real" | "fake";
  outcome: string;
  points: {
    task: string;
    profile: string;
    locality: Locality;
    cdtRatio: number | null;
    blastRatio: number | null;
    idleRatio: number | null;
  }[];
}

export interface PerProcessSlice {
  source: string;
  task: string;
  against: string;
  model: "real" | "fake";
  swarmLevels: {
    level: number;
    targets: string[];
    count: number;
    runs: number;
    impact: Record<string, number | null>;
  }[];
  swarmExpected: Record<string, number | null>;
  rival: Record<string, number | null>;
  ratio: Record<string, number | null>;
  reading: Record<string, string>;
}

export interface FalseDeathsSlice {
  source: string;
  model: "real" | "fake";
  rows: FalseDeathRow[];
}

export interface TokensSlice {
  models: {
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
    roles: Record<string, number>;
  }[];
  coordinationTokens: number;
  recoveryTokens: number;
  scans: { count: number; backend: string | null; decisions: Record<string, number> };
}

export interface AssumptionRow {
  id: string;
  label: string;
  value: string;
  why: string;
  checkedBy: string;
}

export interface FailureFigure {
  value: number;
  label: string;
  decimals?: number;
}

/** R3's figures, each with the words that say what it is. */
export interface FailuresSlice {
  fastRestart: FailureFigure[];
  falseDeaths: FailureFigure[];
  perProcess: FailureFigure;
}

export interface R5Numbers {
  task: string;
  seeds: number;
  swarmStallS: number;
  centralStallS: number;
  swarmExtraPct: number;
  centralExtraPct: number;
}

export interface NumbersSlice {
  r5: { t1: R5Numbers; t2: R5Numbers };
  r2: {
    task: string;
    seeds: number;
    swarmStallS: number;
    durableMaxStallS: number;
    swarmExtraPct: number;
    durableMaxExtraPct: number;
  };
  s4: { runs: number; coordinationTokens: number };
  s7: { swarmC3Runs: number; swarmC3Completed: number; allRuns: number; allCompleted: number };
  /** Runs with a valid result, counted from each set's rows: never assumed, and the invalid runs are named. */
  validity: { v1: ValiditySet; headline: ValiditySet; headline10: ValiditySet | null };
  structure: { orchestrators: number; agents: number; tracks: number; sessions: number };
  source: string[];
}

export interface ValiditySet {
  runs: number;
  valid: number;
  invalid: string[];
}

export interface ProfilesSlice {
  crashPoints: number[];
  items: Record<
    string,
    {
      coordinatorCrashes: number;
      agentsKilledPct: number;
      apiFaultPct: number;
      messageLossPct: number;
      partition: boolean;
    }
  >;
}

export interface Story {
  schema: number;
  generator: string;
  sources: Record<string, SourceRecord>;
  claims: Record<string, Claim>;
  notClaimed: { claim: string; why: string }[];
  claimRules: string[];
  /** The one sentence S7 allows. */
  tagline: string;
  tasks: Record<string, { short: string; name: string }>;
  workflows: Record<string, string>;
  profiles: ProfilesSlice;
  numbers: NumbersSlice;
  facts: FactsSlice;
  tree: TreeSlice;
  takeover: TakeoverSlice;
  hrw: HrwSlice;
  finish: FinishSlice;
  proof: ProofSlice;
  lanes: { central: LanesSlice; swarm: LanesSlice };
  hashes: HashesSlice;
  hero: HeroSlice;
  /** The same chart for the ten-seed extension, when it exists. */
  hero10: HeroSlice | null;
  headline: HeadlineSlice | null;
  headline10: HeadlineSlice | null;
  verdicts: VerdictsSlice | null;
  verdicts10: VerdictsSlice | null;
  gate: GateSlice;
  regime: RegimeSlice;
  perProcess: PerProcessSlice;
  falseDeaths: FalseDeathsSlice;
  failures: FailuresSlice;
  tokens: { coordination: number; recovery: number };
  tokensByModel: TokensSlice;
  assumptions: AssumptionRow[];
}
