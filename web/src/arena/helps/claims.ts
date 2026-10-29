// The claims the panel may put on screen, in the words docs/claims.md gives them (arena spec §C.5).
//
// claims.test.ts holds this file to claims.md: the same words, and a claim that is still "pending" there
// is drawn here as a placeholder. When the decision gate allows one, flip its `placeholder` and the test
// goes green again.

export type ClaimId = "R1" | "R2" | "R3";

export interface Claim {
  id: ClaimId;
  text: string;
  /** Not yet allowed by docs/claims.md: the panel marks it as wording still to be settled. */
  placeholder: boolean;
}

export const CLAIMS: Record<ClaimId, Claim> = {
  R1: { id: "R1", text: "Recovery stays local to the affected subtree.", placeholder: true },
  R2: {
    id: "R2",
    text: "Resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism.",
    placeholder: true,
  },
  R3: {
    id: "R3",
    text: "The conditions where the gap shrinks or reverses: per-process view, fast external restart, short detection",
    placeholder: true,
  },
};

/** The headline the decision rule allows: outcome A is R1, outcome B is R2 (bench/PREREG.md §7). */
export function headlineClaim(outcomeLabel: string): Claim | null {
  if (outcomeLabel === "A") return CLAIMS.R1;
  if (outcomeLabel === "B") return CLAIMS.R2;
  return null;
}
