// The claims the panel may put on screen, in the words docs/claims.md gives them (arena spec §C.5).
//
// claims.test.ts holds this file to claims.md: the same words and the same status, claim by claim. When a row
// changes there (the gate decides, the real rows land), that test fails until this file follows.

export type ClaimId = "R1" | "R2" | "R3";

/** What docs/claims.md lets the panel do with a claim: quote it, quote it as wording still to be settled, or not at all. */
export type ClaimStatus = "allowed" | "pending" | "not claimed";

export interface Claim {
  id: ClaimId;
  text: string;
  status: ClaimStatus;
  /** The status cell as docs/claims.md words it, so what it adds to "allowed" ("at $0 ...") is shown with the claim. */
  note: string;
}

export type Claims = Record<ClaimId, Claim>;

export const CLAIMS: Claims = {
  R1: {
    id: "R1",
    text: "Recovery stays local to the affected subtree.",
    status: "not claimed",
    note: "not claimed (outcome B)",
  },
  R2: {
    id: "R2",
    text: "Resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism.",
    status: "allowed",
    note: "allowed (gate, Oct 29; real rows, Oct 30)",
  },
  R3: {
    id: "R3",
    text: "The conditions, stated next to R2: against durable-max on T2 at C3, locality holds when the supervisor needs 1–3 s more to restart a coordinator (coordinator-dependency time 0.28 and 0.19 of the supervisor's); it ties at the default assumptions (both detect a failure in 5 s, no extra restart) and when both detect in 1–10 s; it fails when an external supervisor detects and restarts within 0.5–1 s while the swarm keeps its 5 s detection (13.2 and 5.7 times the supervisor's). Per process, each coordinator process failing at the same rate, the two are comparable (ratio 0.90), and the supervisor recovers sooner. The swarm's failure detector also produces false deaths (1.25–2.25 per run at C2–C3), the supervisors none.",
    status: "allowed",
    note: "allowed, always with R2",
  },
};

/** The headline the decision rule allows: outcome A is R1, outcome B is R2 (bench/PREREG.md §7). */
export function headlineClaim(outcomeLabel: string, claims: Claims = CLAIMS): Claim | null {
  if (outcomeLabel === "A") return claims.R1;
  if (outcomeLabel === "B") return claims.R2;
  return null;
}

/** What the outcome strip may quote: the headline its outcome allows and, next to it only, the conditions (R3). A
 * claim docs/claims.md does not allow is not quoted at all. */
export function claimsToShow(outcomeLabel: string, claims: Claims = CLAIMS): { headline: Claim | null; conditions: Claim | null } {
  const found = headlineClaim(outcomeLabel, claims);
  const headline = found !== null && found.status !== "not claimed" ? found : null;
  const conditions = headline !== null && claims.R3.status !== "not claimed" ? claims.R3 : null;
  return { headline, conditions };
}
