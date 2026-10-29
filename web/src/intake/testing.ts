// Test helpers for the intake page: the real bodies of W2's API at $0 (the fake reader, scratch dirs), saved under
// fixtures/ by a script that drove the server through the same calls the page makes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readIntakeState, type IntakeState } from "./api";
import type { Proposal } from "./proposal";
import { readPreflight, type Preflight } from "./spend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixture = (name: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8"));

/** A fresh copy of a state the server gave, read the way the page reads it. */
export function stateOf(name: string): IntakeState {
  const read = readIntakeState(fixture(name));
  if (!read.ok) throw new Error(`fixture ${name} could not be read: ${read.reason}`);
  return read.value;
}

/** Muse's reading of the sample text, as `GET api/intake/{id}` sent it. */
export function museReading(): Proposal {
  const { proposal } = stateOf("intake.proposed.json");
  if (proposal === null) throw new Error("the proposed fixture has no proposal");
  return proposal;
}

export const museTexts = () => stateOf("intake.proposed.json").texts;

const STANDING = { settled_usd: 12.5, reserved_usd: 0, committed_usd: 12.5, project_cap_usd: 150, project_remaining_usd: 137.5, phase_start_usd: 11.82, phase_cap_usd: 50, phase_spent_usd: 0.68, phase_remaining_usd: 49.32 };

/** A preflight as api/spend.py words it (it cannot be captured: a real preflight needs the server flag and a key). */
export function preflightBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: true, token: "tok-1", expires_in_s: 600, confirm_word: "SPEND", kind: "arena", runs: 2, calls_per_run: 560, estimate_usd_per_run: 11.4, run_cap_usd: 0.75, worst_case_usd: 1.5, standing: STANDING, refusals: [], ...over };
}

export function preflightOf(over: Record<string, unknown> = {}): Preflight {
  const read = readPreflight(preflightBody(over));
  if (!read.ok) throw new Error(`the test preflight could not be read: ${read.reason}`);
  return read.value;
}
