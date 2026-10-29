// The supervisor's recovery report: what its restarts did, read from the log. It is the rival side's
// counterpart of "takeover OK": that chip says who took over was not arbitrary, this one says what the
// supervisor got back after each crash, and what it had to do again.
//
// The scored report is W1's (`GET api/runs/{id}/recovery`, verify/recovery.py): the five rules a supervisor
// that keeps its workers must hold to, checked by the server on the finished log. When the server offers it,
// the chip says what it says. When it does not (an older server), the chip falls back to the run's own
// events (lib/supervision.ts) and labels them so: the words are the log's, a number there is a count of
// events and never a verdict.

import { asRecord, asString } from "../lib/generic";
import type { ViewState } from "../lib/reducer";
import { supervisionTotals } from "../lib/supervision";

export interface RecoveryReport {
  crashes: number;
  restarts: number;
  /** Contracts run again after a restart. */
  redone: number;
  /** Results a durable supervisor read back from its log instead. */
  readBack: number;
  /** Mean restart, crash to back up, in ms; null when no crash was restarted. */
  restartMs: number | null;
  /** Crashes the log does not show restarted: the run ended (or was cut) with the supervisor down. */
  unfinished: number;
}

/** The report of a run's whole log, or null when it logged no supervisor crash (the swarm has none). */
export function recoveryOf(view: ViewState): RecoveryReport | null {
  const totals = supervisionTotals(view.supervision);
  if (totals.crashes === 0) return null;
  const restarted = view.supervision.crashes.filter((c) => c.restartedTs !== null);
  const restartMs = restarted.length === 0 ? null : restarted.reduce((sum, c) => sum + ((c.restartedTs ?? c.ts) - c.ts), 0) / restarted.length;
  return {
    crashes: totals.crashes,
    restarts: totals.restarts,
    redone: totals.redone,
    readBack: totals.adopted,
    restartMs,
    unfinished: totals.crashes - totals.restarts,
  };
}

const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`;

export interface RecoveryChipText {
  tone: "good" | "bad" | "warn" | "muted";
  text: string;
  detail: string;
}

/** The words of the chip. */
export function describeRecovery(report: RecoveryReport | null): RecoveryChipText {
  if (report === null) {
    return { tone: "muted", text: "No supervisor crash to recover from", detail: "The log holds no baseline.crashed event." };
  }
  const parts = [`${plural(report.crashes, "crash", "crashes")}, ${report.restarts} restarted`];
  if (report.readBack > 0) parts.push(`${plural(report.readBack, "result")} read back from the log`);
  if (report.redone > 0) parts.push(`${plural(report.redone, "contract")} run again`);
  const complete = report.unfinished === 0;
  return {
    tone: complete ? "good" : "warn",
    text: `Recovery: ${parts.join(" · ")}`,
    detail: `Counted from this run's log (baseline.crashed, baseline.restarted, supervisor.adopted).${
      report.restartMs === null ? "" : ` Mean time from crash to restart ${(report.restartMs / 1000).toFixed(1)} s.`
    }${complete ? "" : ` ${plural(report.unfinished, "crash", "crashes")} not restarted before the log ends.`}`,
  };
}

export interface RecoveryCheck {
  name: string;
  title: string;
  /** The rule has something to read in this log. */
  applies: boolean;
  ok: boolean;
  detail: string;
  violations: number;
}

/** The server's scored report of a finished run. */
export interface ServerRecovery {
  ok: boolean;
  /** The log holds a supervisor crash; without one only the rule about repeated work is read. */
  supervised: boolean;
  system: string;
  /** Restarts the log shows, one per supervisor crash. */
  restarts: number;
  checks: RecoveryCheck[];
}

/** Read the body of `GET api/runs/{id}/recovery`, or null when it is not a report this chip can trust: no
 * verdict, a malformed check, or an `ok` that the checks do not add up to. */
export function readRecoveryReport(body: unknown): ServerRecovery | null {
  const b = asRecord(body);
  if (typeof b.ok !== "boolean" || !Array.isArray(b.checks) || !Array.isArray(b.restarts)) return null;
  const checks: RecoveryCheck[] = [];
  for (const raw of b.checks) {
    const c = asRecord(raw);
    if (typeof c.name !== "string" || typeof c.applies !== "boolean" || typeof c.ok !== "boolean") return null;
    checks.push({ name: c.name, title: asString(c.title, c.name), applies: c.applies, ok: c.ok, detail: asString(c.detail), violations: Array.isArray(c.violations) ? c.violations.length : 0 });
  }
  if (b.ok !== checks.every((c) => c.ok)) return null;
  return { ok: b.ok, supervised: b.supervised === true, system: asString(b.system), restarts: b.restarts.length, checks };
}

/** The words of the chip for the server's report: its verdict, and under it each rule it read, in its own words. */
export function describeServerRecovery(report: ServerRecovery): RecoveryChipText {
  if (!report.supervised) {
    return { tone: "muted", text: "No supervisor crash to recover from", detail: "The log holds no baseline.crashed event, so the restart rules have nothing to check." };
  }
  const read = report.checks.filter((c) => c.applies).map((c) => `${c.ok ? "✓" : "✗"} ${c.title}: ${c.detail}`);
  if (report.ok) {
    return { tone: "good", text: `Recovery OK ✓ ${plural(report.restarts, "restart")}`, detail: ["Checked on the finished log:", ...read].join("\n") };
  }
  const failed = report.checks.filter((c) => !c.ok);
  return {
    tone: "bad",
    text: `Recovery check failed: ${failed.map((c) => c.name).join(", ")}`,
    detail: [`${plural(failed.reduce((n, c) => n + c.violations, 0), "violation")} on the finished log:`, ...read].join("\n"),
  };
}

/** What the chip shows: "checking" until the server has answered, its scored report when it has one (an
 * `answer` of null is a server that has none), and the log's own count when it has not. */
export function recoveryChipOf(answer: ServerRecovery | null | undefined, view: ViewState): RecoveryChipText | "checking" {
  if (answer === undefined) return "checking";
  return answer === null ? describeRecovery(recoveryOf(view)) : describeServerRecovery(answer);
}
