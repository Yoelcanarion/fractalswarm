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
  /** The run has played to its last event, so its fold is the whole run. */
  finished: boolean;
  official: Official | null;
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
  live(side: SideNumbers): number | null;
  official(side: SideNumbers, official: Official): number | null;
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

export const ROW_DEFS: readonly RowDef[] = [
  {
    id: "idle",
    label: "Idle agent-seconds",
    unit: "", // the label says it; "16.0 agent·s" does not fit beside the other side in the strip
    decimals: 1,
    definition: "Agent time spent idle because the coordinator they answer to was down.",
    live: (s) => seconds(s.counters.idleAgentMs),
    official: (_s, o) => o.recovery?.idleAgentS ?? null,
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
    definition: "Time during which ready work could not go on because the coordinator that decides it was down.",
    live: (s) => seconds(s.counters.coordinatorDownMs),
    official: (_s, o) => o.recovery?.cdtS ?? null,
  },
  {
    id: "cost",
    label: "Cost",
    unit: "",
    prefix: "$",
    decimals: 3,
    definition: "What the run has spent on model calls.",
    live: (s) => s.counters.costUsd,
    official: (_s, o) => o.costUsd,
  },
  {
    id: "duplicated",
    label: "Duplicated work",
    unit: "calls",
    decimals: 0,
    definition: "Model calls paid for again: work cancelled and redone, or answered twice.",
    live: (s) => s.counters.duplicatedCalls,
    official: (_s, o) => o.recovery?.dupCalls ?? null,
  },
  {
    id: "reassigned",
    label: "Reassignments",
    unit: "",
    decimals: 0,
    definition: "Work handed to a new owner again.",
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
      label: def.label,
      unit: def.unit,
      prefix: def.prefix ?? "",
      decimals: def.decimals,
      definition: live && def.liveNote ? `${def.definition} ${def.liveNote}` : def.definition,
      left: l,
      right: r,
      leftShare: share(l.value, scale),
      rightShare: share(r.value, scale),
    };
  });
}

/** Whether every number of the row is the scored one: the count-up to the official figure is what a
 * person sees land when a run ends. */
export const isSettled = (row: ScoreRow): boolean => row.left.source === "official" && row.right.source === "official";
