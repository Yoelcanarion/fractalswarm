// The supervisor's recovery report: what its restarts did, read from the log. It is the rival side's
// counterpart of "takeover OK": that chip says who took over was not arbitrary, this one says what the
// supervisor got back after each crash, and what it had to do again.
//
// It is derived from the run's own events (lib/supervision.ts), and labelled so: W1's scored recovery
// report (`GET api/runs/{id}/recovery`) replaces it when the server offers one. The words are the
// log's: a number here is a count of events, never a verdict.

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
  tone: "good" | "warn" | "muted";
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
