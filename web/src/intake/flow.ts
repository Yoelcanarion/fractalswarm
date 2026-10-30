// Where a person is in the flow, as the server's state says it: nothing here is kept in the page that the server
// could say. A reading is being read, waits for review, is approved, or stopped (and why).

import type { IntakeState } from "./api";
import type { Proposal } from "./proposal";

export type Phase =
  | { name: "form" }
  | { name: "loading"; intakeId: string }
  | { name: "reading"; state: IntakeState }
  | { name: "review"; state: IntakeState }
  | { name: "approved"; state: IntakeState }
  | { name: "stopped"; state: IntakeState; headline: string; details: string[] };

export const STEPS = ["Paste", "Read", "Review", "Run"] as const;
export type Step = (typeof STEPS)[number];

/** The rows the review starts from. Muse's reading is what they are compared against; an approved intake starts from the
 * version that was approved (servers that keep it send it), so what the person changed shows as edits and not as a note. */
export function startingReading(state: IntakeState): { original: Proposal; working: Proposal } | null {
  if (state.proposal === null) return null;
  return { original: state.proposal, working: state.approved?.proposal ?? state.proposal };
}

/** How often the page asks a reading that is still being read. */
export const POLL_MS = 1000;

/** The phase of an address: the form, or a reading, by what the server last said about it (which may be of another one). */
export function phaseFor(intakeId: string | null, state: IntakeState | null): Phase {
  if (intakeId === null) return { name: "form" };
  return state === null || state.intake_id !== intakeId ? { name: "loading", intakeId } : phaseOf(state);
}

export function phaseOf(state: IntakeState): Phase {
  switch (state.state) {
    case "reading":
      return { name: "reading", state };
    case "proposed":
      return state.proposal === null ? { name: "reading", state } : { name: "review", state };
    case "approved":
      return { name: "approved", state };
    case "refused": {
      const where = state.refused?.segments.length ? state.refused.segments.join(" and ") : "the text";
      return {
        name: "stopped",
        state,
        headline: `The firewall blocked ${where} before any model read it.`,
        details: [state.refused?.reason ?? "", "Nothing was sent to a model. Take out what it flagged, or paste the text again without it."].filter(Boolean),
      };
    }
    case "failed":
      return {
        name: "stopped",
        state,
        headline: "The reading could not be put into the program's shape.",
        details: state.failed?.errors.length ? state.failed.errors.slice(0, 5) : ["The reader gave no answer the schema accepts."],
      };
    case "interrupted":
      return { name: "stopped", state, headline: "The reading was interrupted.", details: ["The process that was reading it is gone, most likely because the server restarted. Start it again."] };
  }
}

/** The step of the stepper that is current. */
export function stepOf(phase: Phase): Step {
  switch (phase.name) {
    case "form":
      return "Paste";
    case "loading":
    case "reading":
      return "Read";
    case "review":
      return "Review";
    case "approved":
      return "Run";
    case "stopped":
      return "Read";
  }
}

/** The reading is still going: ask again. */
export const isWorking = (phase: Phase): boolean => phase.name === "reading" || phase.name === "loading";
