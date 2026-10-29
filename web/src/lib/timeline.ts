// The markers on the replay timeline: the moments of a run worth jumping to. A pure pass over the
// whole log (the timeline shows the run's future too), kept apart from the component so the
// classification can be tested.
//
// A coordinator kill and an agent kill look different because they mean different things: the
// first is what the run must survive, the second is routine. A supervisor's crash is the same
// event seen from the baseline's side, so the kill that caused it does not get a second marker.

import type { RunEvent } from "./types";

export type MarkKind =
  | "coordinator-kill" // a coordinator killed by the chaos monkey, or crashed (a supervisor)
  | "agent-kill"
  | "restart" // a supervised coordinator back up
  | "adopted" // a dead orchestrator's subtree taken over
  | "death" // the failure detector's verdict
  | "collision"
  | "halt"
  | "breaker"
  | "escalation"
  | "shock"
  | "chaos"; // any other injected fault worth a marker (a partition)

export interface Mark {
  seq: number;
  ts: number;
  kind: MarkKind;
  /** One line for the tooltip and the screen reader. */
  label: string;
}

/** Kinds that read as a failure, a recovery, or a hazard, for colour and size. */
export const MARK_TONE: Record<MarkKind, "kill" | "recovery" | "warn" | "minor"> = {
  "coordinator-kill": "kill",
  "agent-kill": "kill",
  restart: "recovery",
  adopted: "recovery",
  death: "minor",
  collision: "warn",
  halt: "kill",
  breaker: "warn",
  escalation: "warn",
  shock: "warn",
  chaos: "warn",
};

const list = (...values: unknown[]): string[] =>
  values.flatMap((value) => (Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)]));

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

export function marksOf(events: RunEvent[]): Mark[] {
  const marks: Mark[] = [];
  // Coordinators whose kill already has a marker and whose baseline.crashed has not come yet.
  const killed = new Set<string>();
  const at = (e: RunEvent, kind: MarkKind, what: string): void => {
    marks.push({ seq: e.seq, ts: e.ts_virtual, kind, label: `${seconds(e.ts_virtual)} · ${what}` });
  };

  for (const e of events) {
    const p = e.payload;
    switch (e.type) {
      case "chaos.injected": {
        const fault = String(p.fault ?? p.kind ?? "");
        const targets = list(p.target, p.targets);
        const who = targets.join(", ") || "?";
        if (fault === "kill_coordinator") {
          for (const id of targets) killed.add(id);
          at(e, "coordinator-kill", `coordinator ${who} killed`);
        } else if (fault === "kill_agent") {
          at(e, "agent-kill", `agent ${who} killed`);
        } else if (fault === "partition") {
          at(e, "chaos", `network partition${targets.length ? `: ${who}` : ""}`);
        }
        // The other faults (drop, delay, duplicate, reorder, heal) come by the thousand.
        break;
      }
      case "baseline.crashed": {
        const id = String(p.coordinator ?? e.actor);
        if (killed.delete(id)) break; // the kill above is this crash
        at(e, "coordinator-kill", `coordinator ${id} crashed`);
        break;
      }
      case "baseline.restarted":
        at(e, "restart", `${String(p.coordinator ?? e.actor)} restarted`);
        break;
      case "tree.adopted":
        at(e, "adopted", `${String(p.adopter ?? e.actor)} adopted the subtree of ${String(p.dead ?? "?")}`);
        break;
      case "member.dead":
        at(e, "death", `${String(p.member)} declared dead`);
        break;
      case "collision.detected":
        at(e, "collision", "collision detected");
        break;
      case "run.halted":
        at(e, "halt", `run halted: ${String(p.reason ?? "")}`.trim());
        break;
      case "breaker.opened":
        at(e, "breaker", `breaker opened${p.name ? `: ${String(p.name)}` : ""}`);
        break;
      case "escalation.raised":
        at(e, "escalation", "escalation raised");
        break;
      case "budget.shock":
        at(e, "shock", "budget shock");
        break;
    }
  }
  return marks;
}

/** Where a time falls along the track, 0 to 1. */
export const fraction = (ts: number, end: number): number => (end > 0 ? Math.min(1, Math.max(0, ts / end)) : 0);
