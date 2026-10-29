// Real spend from the page (api/spend.py), in W2's two steps: a preflight that prices the launch at its worst case
// and says whether it may go, then the launch itself with the token and the typed word. The page shows the worst case
// and the caps before the word can be typed, and ties the token to the settings it priced: change one, and the token
// is no longer for this launch. This module only reads and decides; it sends nothing.

import { bad, count, flag, list, number, oneOf, reading, record, text, type Read } from "./strict";

export const KINDS = ["task", "arena", "intake"] as const;
export type Kind = (typeof KINDS)[number];

export interface Standing {
  settled_usd: number;
  reserved_usd: number;
  committed_usd: number;
  project_cap_usd: number;
  project_remaining_usd: number;
  phase_start_usd: number;
  phase_cap_usd: number;
  phase_spent_usd: number;
  phase_remaining_usd: number;
}

export interface Preflight {
  ok: boolean;
  /** Only when nothing stands in the way. It works once, for this launch, and expires. */
  token: string | null;
  expires_in_s: number | null;
  /** The word to type: the server's own, not one the page chose. */
  confirm_word: string;
  kind: Kind;
  runs: number;
  calls_per_run: number;
  estimate_usd_per_run: number;
  run_cap_usd: number;
  worst_case_usd: number;
  standing: Standing;
  refusals: string[];
}

const STANDING_FIELDS: (keyof Standing)[] = [
  "settled_usd",
  "reserved_usd",
  "committed_usd",
  "project_cap_usd",
  "project_remaining_usd",
  "phase_start_usd",
  "phase_cap_usd",
  "phase_spent_usd",
  "phase_remaining_usd",
];

/** Read the body of a preflight, and refuse one that contradicts itself: a token with a refusal, or none without. */
export function readPreflight(raw: unknown): Read<Preflight> {
  return reading(() => {
    const r = record(raw, "preflight");
    const standing = record(r.standing, "preflight.standing");
    const refusals = list(r.refusals, "preflight.refusals").map((reason, i) => text(reason, `preflight.refusals[${i}]`));
    const ok = flag(r.ok, "preflight.ok");
    const token = r.token === null || r.token === undefined ? null : text(r.token, "preflight.token");
    if (ok !== (refusals.length === 0)) bad("preflight", "ok does not agree with its refusals");
    if (ok !== (token !== null)) bad("preflight", "a token must come with ok, and only then");
    return {
      ok,
      token,
      expires_in_s: r.expires_in_s === null || r.expires_in_s === undefined ? null : number(r.expires_in_s, "preflight.expires_in_s"),
      confirm_word: text(r.confirm_word, "preflight.confirm_word"),
      kind: oneOf(r.kind, KINDS, "preflight.kind"),
      runs: count(r.runs, "preflight.runs"),
      calls_per_run: count(r.calls_per_run, "preflight.calls_per_run"),
      estimate_usd_per_run: number(r.estimate_usd_per_run, "preflight.estimate_usd_per_run"),
      run_cap_usd: number(r.run_cap_usd, "preflight.run_cap_usd"),
      worst_case_usd: number(r.worst_case_usd, "preflight.worst_case_usd"),
      standing: Object.fromEntries(STANDING_FIELDS.map((field) => [field, number(standing[field], `preflight.standing.${field}`)])) as unknown as Standing,
      refusals,
    };
  });
}

/** Dollars at the precision they have: $0.156, $0.75, $8.24, $11.82. */
export function dollars(usd: number): string {
  const digits = usd.toFixed(4).replace(/0+$/, "");
  const [whole, cents = ""] = digits.split(".");
  return `$${whole}.${cents.padEnd(2, "0")}`;
}

/** What the launch would cost at worst, in the order a person reads it: the total, then how it is made. */
export function worstCaseLines(p: Preflight): string[] {
  const runs = p.runs === 1 ? "1 run" : `${p.runs} runs`;
  const each = p.estimate_usd_per_run <= p.run_cap_usd ? `${dollars(p.estimate_usd_per_run)} each` : `the lower of ${dollars(p.estimate_usd_per_run)} and the ${dollars(p.run_cap_usd)} cap each`;
  return [
    `Worst case ${dollars(p.worst_case_usd)}`,
    `${runs} × ${each}, ${p.calls_per_run} ${p.calls_per_run === 1 ? "request" : "requests"} a run at their worst.`,
    `Settled so far ${dollars(p.standing.settled_usd)}${p.standing.reserved_usd > 0 ? `, ${dollars(p.standing.reserved_usd)} reserved` : ""}.`,
    `Left under the project cap (${dollars(p.standing.project_cap_usd)}): ${dollars(p.standing.project_remaining_usd)}. Left under the phase cap (${dollars(p.standing.phase_cap_usd)}): ${dollars(p.standing.phase_remaining_usd)}.`,
  ];
}

/** The settings a token was priced for, as one string: the launch body without what the server does not bind it to. */
export function canonicalBody(body: Record<string, unknown>): string {
  const unbound = new Set(["preflight_token", "confirm", "run_id", "pair_id"]);
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([key]) => !unbound.has(key))
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, inner]) => [key, sort(inner)]),
          )
        : value;
  return JSON.stringify(sort(body));
}

export interface Checked {
  preflight: Preflight;
  /** `canonicalBody` of the launch it priced. */
  priced: string;
  /** When the answer arrived (ms), to tell when the token has run out. */
  at: number;
}

export type Gate = { launch: true; token: string } | { launch: false; reason: string };

/** Whether the launch may go now, and if not what is missing: the check, a check that still fits these settings and
 * has not run out, nothing in its way, and the word typed exactly. */
export function gateFor(checked: Checked | null, current: string, typed: string, now: number): Gate {
  if (checked === null) return { launch: false, reason: "Check the cost first." };
  const { preflight } = checked;
  if (!preflight.ok || preflight.token === null) return { launch: false, reason: preflight.refusals.join(" ") || "The server refused the launch." };
  if (checked.priced !== current) return { launch: false, reason: "The settings changed since the check: check the cost again." };
  if (preflight.expires_in_s !== null && now >= checked.at + preflight.expires_in_s * 1000) return { launch: false, reason: "The check has run out: check the cost again." };
  if (typed !== preflight.confirm_word) return { launch: false, reason: `Type ${preflight.confirm_word} to confirm.` };
  return { launch: true, token: preflight.token };
}
