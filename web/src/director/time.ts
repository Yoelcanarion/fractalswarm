// A moment of the replay, as a scene names it. The run is not known when a scene is written (the final pair is
// recorded later), so a scene says "four seconds before the first crash", not "31.5 s": the director reads the
// crashes from the log it plays.
//
//   12000            12 s of run time, as it is
//   start | end      the beginning and the end of the run
//   crash:1          where the first coordinator went down (crash:-1 is the last)
//   recovered:2      where the second outage ended: the takeover, or the restart
//   rival-crash:1    the same for the rival of an arena (rival-recovered:2): the two sides of a pair may not crash at the
//                    same second, because a plan fires at a fraction of its own run's progress (kills by hand need not)
//   call:spark       when the call the scene calls "spark" started (call-end: when it ended)
//
// each with an optional offset: `crash:1-4s`, `recovered:1+500ms`, `end-2s`.

import { bad, number } from "../intake/strict";

export type Anchor =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "crash"; index: number; rival?: true }
  | { kind: "recovered"; index: number; rival?: true }
  | { kind: "call"; name: string; end: boolean };

export interface TimeExpr {
  /** Null: ``offsetMs`` is the moment itself. */
  anchor: Anchor | null;
  offsetMs: number;
}

const PATTERN = /^(start|end|(rival-)?(crash|recovered):(-?[1-9]\d*)|call(-end)?:([A-Za-z][A-Za-z0-9_-]*))(?:([+-])(\d+(?:\.\d+)?)(ms|s))?$/;

export function parseTime(value: unknown, where: string): TimeExpr {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return bad(where, `a moment is 0 ms or later, got ${value}`);
    return { anchor: null, offsetMs: value };
  }
  if (typeof value !== "string") return bad(where, `expected a number of ms or a moment such as "crash:1-4s", got ${JSON.stringify(value) ?? "nothing"}`);
  const match = PATTERN.exec(value);
  if (!match) {
    return bad(where, `"${value}" is not a moment: use a number of ms, start, end, crash:N, recovered:N, rival-crash:N, rival-recovered:N or call:NAME, with an optional +/-N s or ms`);
  }
  const [, head, rival, outage, index, callEnd, call, sign, amount, unit] = match;
  let anchor: Anchor;
  if (head === "start" || head === "end") anchor = { kind: head };
  else if (outage === "crash" || outage === "recovered") anchor = { kind: outage, index: Number(index), ...(rival === undefined ? {} : { rival: true as const }) };
  else anchor = { kind: "call", name: call, end: callEnd !== undefined };
  const size = amount === undefined ? 0 : Number(amount) * (unit === "s" ? 1000 : 1);
  return { anchor, offsetMs: sign === "-" ? -size : size };
}

/** What a moment can be resolved against: the run being played. */
export interface TimeContext {
  end: number;
  /** In the order they happened. */
  crashes: readonly { at: number; until: number }[];
  /** The rival's, in an arena; none elsewhere. */
  rivalCrashes?: readonly { at: number; until: number }[];
  /** The calls of the lens, by the names the scene gave them. Empty until the lens has loaded. */
  calls: ReadonlyMap<string, { start: number; end: number | null }>;
}

const nth = <T>(items: readonly T[], index: number): T | undefined => (index > 0 ? items[index - 1] : items[items.length + index]);

/** The run time of a moment, or null when the run does not have it (a third crash in a run with two). */
export function resolveTime(time: TimeExpr, context: TimeContext): number | null {
  const { anchor, offsetMs } = time;
  if (anchor === null) return offsetMs;
  let base: number | null | undefined;
  switch (anchor.kind) {
    case "start":
      base = 0;
      break;
    case "end":
      base = context.end;
      break;
    case "crash":
      base = nth(anchor.rival ? (context.rivalCrashes ?? []) : context.crashes, anchor.index)?.at;
      break;
    case "recovered":
      base = nth(anchor.rival ? (context.rivalCrashes ?? []) : context.crashes, anchor.index)?.until;
      break;
    case "call": {
      const call = context.calls.get(anchor.name);
      base = anchor.end ? call?.end : call?.start;
      break;
    }
  }
  return base === undefined || base === null ? null : Math.max(0, base + offsetMs);
}

export function formatTime(time: TimeExpr): string {
  const { anchor, offsetMs } = time;
  if (anchor === null) return `${offsetMs} ms`;
  const head =
    anchor.kind === "crash" || anchor.kind === "recovered" ? `${anchor.rival ? "rival-" : ""}${anchor.kind}:${anchor.index}` : anchor.kind === "call" ? `${anchor.end ? "call-end" : "call"}:${anchor.name}` : anchor.kind;
  return offsetMs === 0 ? head : `${head}${offsetMs < 0 ? "-" : "+"}${Math.abs(offsetMs)}ms`;
}

/** A number of milliseconds from a field, bounded. */
export function milliseconds(value: unknown, where: string, min: number, max: number): number {
  const ms = number(value, where);
  return ms >= min && ms <= max ? ms : bad(where, `expected ${min} to ${max} ms, got ${ms}`);
}
