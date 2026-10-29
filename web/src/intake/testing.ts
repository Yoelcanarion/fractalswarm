// Test helpers for the intake page: the real bodies of W2's API at $0 (the fake reader, scratch dirs), saved under
// fixtures/ by a script that drove the server through the same calls the page makes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readIntakeState, type IntakeState } from "./api";
import type { Proposal } from "./proposal";

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
