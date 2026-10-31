// The rows of the arena's face-to-face counters: seven rows, the swarm's number on the left and its rival's
// on the right. They run on the UI's own fold (`arenaCounters`, lib/arena.ts) while a run plays, so a
// scrubber can drag them through the run, and a finished run ends on the numbers the Python metrics
// scored (`Official`), because those are the ones a claim may quote. Where the two differ the
// official number is the one shown.
//
// Nothing here says who is ahead: every row is lower-is-better, but a single recorded pair is one
// seed under one plan, and the verdicts that count are the multi-seed ones in the "where it helps"
// panel (PREREG: a difference is one only if every seed agrees). So the bars are drawn to scale and
// carry no colour of a winner.

import type { ArenaCounters, OutageWindow } from "../lib/arena";
import type { Official } from "./official";

export type RowId = "idle" | "recover" | "dependency" | "cost" | "duplicated" | "reassigned" | "violations";

/** What the scoreboard needs to know about one side at one moment. */
export interface SideNumbers {
  counters: ArenaCounters;
  windows: readonly OutageWindow[];
  /** The playhead, in virtual ms: an outage that has not ended grows with it. */
  nowMs: number;
  /** Idle agent-ms by the scored rule, on the log so far (``recoveryAt``, lib/recovery.ts): the number the run is scored on, as it stood. */
  idleMs: number;
  /** The run has played to its last event, so its fold is the whole run. */
  finished: boolean;
  official: Official | null;
  /** A coordinator's crash has stopped workers of this side (an in-process supervisor takes its workers down with it). */
  crashStopped?: boolean;
}

export interface ScoreCell {
  value: number | null;
  /** Where the number comes from: the fold of the log so far, or the run's scored metrics. */
  source: "live" | "official";
}

export interface ScoreRow {
  id: RowId;
  label: string;
  unit: string;
  prefix: string;
  decimals: number;
  /** One plain sentence on what the number counts. */
  definition: string;
  left: ScoreCell;
  right: ScoreCell;
  /** Each side's bar, 0 to 1, against the larger of the two numbers of the row. */
  leftShare: number;
  rightShare: number;
  /** A line under a side's number, for what the number alone leaves out; null where there is none. */
  notes: { left: string | null; right: string | null };
}

interface RowDef {
  id: RowId;
  label: string;
  unit: string;
  prefix?: string;
  decimals: number;
  definition: string;
  /** What the sentence says about the live figure, when it counts something else than the scored one. */
  liveNote?: string;
  /** What the row is called while a number of it is still the fold's, when that is not the scored one. */
  liveLabel?: string;
  live(side: SideNumbers): number | null;
  official(side: SideNumbers, official: Official): number | null;
  /** A line on one side's number, for what it leaves out; it decides for itself when there is one to say. */
  note?(side: SideNumbers): string | null;
}

const seconds = (ms: number): number => ms / 1000;

/** Mean length of the outages so far, in seconds; one still open counts up to the playhead. */
function meanOutageS(side: SideNumbers): number | null {
  if (side.windows.length === 0) return null;
  const total = side.windows.reduce((sum, w) => sum + Math.max(0, (w.until ?? side.nowMs) - w.since), 0);
  return seconds(total / side.windows.length);
}

/** The scored hard-violation count is in the checker's detail line ("placed 48/48, hard violations 0, ..."). */
function scoredViolations(official: Official): number | null {
  const match = /hard violations\s+(\d+)/i.exec(official.detail);
  return match ? Number(match[1]) : null;
}

/** "$0.605 spent, $0.180 estimated for 27 cancelled calls": the scored cost is the spend in the log plus an estimate for the calls a crash
 * cancelled, so where it is more than the spend this says by how much, from the two numbers of the run itself. Nothing where the two agree at the
 * three decimals shown, and nothing where the log holds no spend to split. */
function costNote(side: SideNumbers): string | null {
  const scored = side.finished ? (side.official?.costUsd ?? null) : null;
  const spent = side.counters.costUsd;
  if (scored === null || spent <= 0) return null;
  const estimated = scored - spent;
  if (estimated < 0.0005) return null;
  const cancelled = side.official?.cancelledCalls ?? 0;
  return `$${spent.toFixed(3)} spent, $${estimated.toFixed(3)} estimated${cancelled > 0 ? ` for ${cancelled} cancelled ${cancelled === 1 ? "call" : "calls"}` : ""}`;
}

export const ROW_DEFS: readonly RowDef[] = [
  {
    id: "idle",
    label: "Idle agent-seconds",
    unit: "", // the label says it; "16.0 agent·s" does not fit beside the other side in the strip
    decimals: 1,
    definition: "Agent time spent idle because the coordinator they answer to was down.",
    // The scored rule itself, run on the log so far (lib/recovery.ts, a port of bench/recovery.py): an agent counts only while it is alive, holds no attempt, and
    // a session it served has work waiting on a coordinator that is down, and the log settles that when the wait has ended. So the number moves when a wait
    // ends, and the last frame shows the number the run is scored on. (The fold of every free agent under a coordinator that was out ran ahead of it.)
    live: (s) => seconds(s.idleMs),
    official: (_s, o) => o.recovery?.idleAgentS ?? null,
    // On a side whose crash stopped its workers the number is not how long they waited: they were gone, which is the time the coordinator-dependency row counts.
    note: (s) => (s.crashStopped ? "A worker a crash stopped is not idle: see coordinator-dependency time." : null),
  },
  {
    id: "recover",
    label: "Time to recover",
    unit: "s",
    decimals: 1,
    definition: "Mean time per crash from the coordinator's failure to the first decision on its work.",
    live: meanOutageS,
    official: (_s, o) => o.recovery?.ttrOwnMeanS ?? null,
  },
  {
    id: "dependency",
    label: "Coordinator-dependency time",
    unit: "s",
    decimals: 1,
    definition: "Waiting on a coordinator that was down, added up over the contracts that waited (contract-seconds), so it can be longer than the outage itself.",
    live: (s) => seconds(s.counters.dependencyMs),
    official: (_s, o) => o.recovery?.cdtS ?? null,
  },
  {
    id: "cost",
    // The run page shows the spend alone, so the same run has two costs: this one is the pre-registered basis (docs/claims.md R5), the metrics' cost.
    label: "Cost, pre-registered basis",
    liveLabel: "Cost so far",
    unit: "",
    prefix: "$",
    decimals: 3,
    definition: "What the run cost on the pre-registered basis: what it spent on model calls, plus an estimate for the calls a crash cancelled. The run page shows the spend alone.",
    liveNote: "So far: what the run has spent on model calls. The scored figure adds an estimate for the calls a crash cancelled.",
    live: (s) => s.counters.costUsd,
    official: (_s, o) => o.costUsd,
    note: costNote,
  },
  {
    id: "duplicated",
    label: "Duplicated work",
    unit: "calls",
    decimals: 0,
    definition: "Model calls made again for work already paid for: an attempt that a later one replaced, a plan or a judgement asked again, or one request answered twice.",
    live: (s) => s.counters.duplicatedCalls,
    official: (_s, o) => o.recovery?.dupCalls ?? null,
  },
  {
    id: "reassigned",
    // The fold counts every contract sent again; the metrics count the ones that were not needed, and the two are far apart on a rival whose workers a
    // crash stops (25 sent again, none unnecessary), so the row says which it shows.
    label: "Unnecessary reassignments",
    liveLabel: "Contracts sent again",
    unit: "",
    decimals: 0,
    definition: "Work handed to a new owner again when it did not have to be: the first owner had not stopped, its result was already in the log, or the same attempt was sent twice.",
    liveNote: "So far: every contract sent again after it was lost or already sent. The scored figure counts only the unnecessary ones: the assignee was alive, or its result was already in the log.",
    live: (s) => s.counters.redispatches,
    official: (_s, o) => o.recovery?.unnecessaryReassignments ?? null,
  },
  {
    id: "violations",
    label: "Hard violations",
    unit: "",
    decimals: 0,
    definition: "Hard rules the final schedule breaks.",
    live: (s) => s.counters.hardViolations,
    official: (_s, o) => scoredViolations(o),
  },
];

function cell(def: RowDef, side: SideNumbers): ScoreCell {
  if (side.finished && side.official) {
    const scored = def.official(side, side.official);
    if (scored !== null) return { value: scored, source: "official" };
  }
  return { value: def.live(side), source: "live" };
}

const share = (value: number | null, scale: number): number => (value === null || scale <= 0 ? 0 : Math.min(1, Math.max(0, value / scale)));

/** The seven rows at this moment of the pair. */
export function scoreRows(left: SideNumbers, right: SideNumbers): ScoreRow[] {
  return ROW_DEFS.map((def) => {
    const l = cell(def, left);
    const r = cell(def, right);
    const scale = Math.max(l.value ?? 0, r.value ?? 0);
    const live = l.source === "live" || r.source === "live";
    return {
      id: def.id,
      label: live && def.liveLabel ? def.liveLabel : def.label,
      unit: def.unit,
      prefix: def.prefix ?? "",
      decimals: def.decimals,
      definition: live && def.liveNote ? `${def.definition} ${def.liveNote}` : def.definition,
      left: l,
      right: r,
      leftShare: share(l.value, scale),
      rightShare: share(r.value, scale),
      notes: { left: def.note?.(left) ?? null, right: def.note?.(right) ?? null },
    };
  });
}

/** Whether every number of the row is the scored one: the count-up to the official figure is what a
 * person sees land when a run ends. */
export const isSettled = (row: ScoreRow): boolean => row.left.source === "official" && row.right.source === "official";
