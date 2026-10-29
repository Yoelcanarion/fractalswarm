// The takeover check as the UI shows it: "Takeover OK" when every heir recomputed from the log is the
// heir the run used (verify/takeover.py). The server's report is a TakeoverReport; W2's route
// (`GET api/runs/{id}/takeover`) sends at least `ok` and `violations`, and may send the lists the
// check found (`successions`, `adoptions`, `kills`). Only `ok` and `violations` are required here.
//
// A run in which no goal changed hands has nothing to take over, and the check passes trivially. The
// chip must not call that "Takeover OK": it would claim a proof the run never exercised (a supervisor's
// run, or a swarm run without chaos). When the report counts what it checked, a count of zero says
// "No takeover to check"; when it does not, the log decides, by the two events the check starts from.
//
// The count on the chip is of hand-overs: goals that changed owner, each with its own recomputed heir. It is
// not a count of kills or of distinct heirs (a coordinator can hold two goals, so 5 coordinator kills can be
// 7 hand-overs). A reclaim, where a member back from a false death took its own goal back, is a succession
// too, but no heir is compared for it: it is not a hand-over, and the hover text names it apart.

import { asNumber, asRecord, asString } from "./generic";
import type { RunEvent } from "./types";

export interface TakeoverViolation {
  check: string;
  kind: string;
  seq: number | null;
  detail: string;
}

export interface TakeoverSummary {
  ok: boolean;
  violations: TakeoverViolation[];
  /** Takeovers the check recomputed an heir for: goals that changed hands. Null if the report does not say. */
  heirs: number | null;
  /** Reclaims: a member back from a false death took its own goal back. The check does not compare an
   * heir for those, so they are not counted in `heirs`. Null if the report does not say. */
  reclaims: number | null;
  /** Tree adoptions it checked. Null if the report does not say. */
  adoptions: number | null;
  /** Kills the run had. Null if the report does not say. */
  kills: number | null;
}

const count = (value: unknown): number | null => (Array.isArray(value) ? value.length : null);

/** Read a takeover report, or null when the body is not one (no boolean `ok`). */
export function readTakeover(body: unknown): TakeoverSummary | null {
  const b = asRecord(body);
  if (typeof b.ok !== "boolean") return null;
  // A succession is a takeover unless the owner is the member that already held the goal (`kind`).
  const kinds = Array.isArray(b.successions) ? b.successions.map((s) => asString(asRecord(s).kind)) : null;
  const reclaims = kinds ? kinds.filter((kind) => kind === "reclaim").length : null;
  return {
    ok: b.ok,
    violations: (Array.isArray(b.violations) ? b.violations : []).map((raw) => {
      const v = asRecord(raw);
      return { check: asString(v.check), kind: asString(v.kind), seq: asNumber(v.seq), detail: asString(v.detail) };
    }),
    heirs: kinds && reclaims !== null ? kinds.length - reclaims : null,
    reclaims,
    adoptions: count(b.adoptions),
    kills: count(b.kills),
  };
}

/** The events the check starts from: each `ownership.remapped` is a succession, each `tree.adopted`
 * an adoption. A log without either has nothing to take over. */
export const logHasTakeover = (events: readonly RunEvent[]): boolean =>
  events.some((event) => event.type === "ownership.remapped" || event.type === "tree.adopted");

export type ChipTone = "good" | "bad" | "muted";

export interface Chip {
  tone: ChipTone;
  /** The short text on the chip. */
  text: string;
  /** The longer explanation, on hover. */
  detail: string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What the chip says. `inLog`: whether the run's own log holds a succession or an adoption, which
 * decides when the report does not count them itself. */
export function describeTakeover(report: TakeoverSummary, inLog: boolean): Chip {
  if (!report.ok || report.violations.length > 0) {
    const shown = report.violations
      .slice(0, 3)
      .map((v) => `${v.check || "check"}${v.kind ? `/${v.kind}` : ""}${v.seq !== null ? ` at seq ${v.seq}` : ""}: ${v.detail}`);
    const more = report.violations.length - shown.length;
    return {
      tone: "bad",
      text: report.violations.length > 0 ? `Takeover check failed: ${plural(report.violations.length, "violation")}` : "Takeover check failed",
      detail: [...shown, ...(more > 0 ? [`and ${more} more`] : [])].join("\n") || "The check reported a failure without saying which.",
    };
  }

  const counted = report.heirs !== null || report.adoptions !== null;
  const heirs = report.heirs ?? 0;
  const adoptions = report.adoptions ?? 0;
  const reclaims = report.reclaims ?? 0;
  if (counted ? heirs + adoptions === 0 : !inLog) {
    const seen = [report.kills ? plural(report.kills, "kill") : "", reclaims > 0 ? plural(reclaims, "reclaim") : ""].filter(Boolean);
    return {
      tone: "muted",
      text: "No takeover to check",
      detail: `${reclaims > 0 ? "No goal was taken over" : "No goal changed hands"} in this run${seen.length > 0 ? ` (${seen.join(", ")})` : ""}, so there was no heir to recompute from the log.`,
    };
  }

  const checked = [
    heirs > 0 ? `${plural(heirs, "hand-over")}: ${heirs === 1 ? "its heir" : "the heir of each"}, recomputed from the log, is the one the run used.` : "",
    reclaims > 0 ? `${plural(reclaims, "reclaim")}: a member back from a false death took its own goal back (no heir is compared).` : "",
    adoptions > 0 ? `${plural(adoptions, "tree adoption")} checked against the log.` : "",
  ].filter(Boolean);
  return {
    tone: "good",
    text: heirs > 0 ? `Takeover OK ✓ ${plural(heirs, "hand-over")}` : "Takeover OK ✓",
    detail: checked.length > 0 ? checked.join(" ") : "Every heir recomputed from the log is the one the run used.",
  };
}
