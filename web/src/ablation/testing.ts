// Test helpers for the ablation view: the real bodies of the ablation API at $0 (the fake backend, scratch dirs), saved under
// fixtures/ by scratchpad scripts that drove the server through the same calls the page makes.
//
//   ablation.sample.json       W3's hand-written approved sample with the Muse they script per note (parser 3 of 6, Muse 5
//                              of 6), recorded by their own test helpers and read through GET /api/ablation/{id}. The
//                              Muse here is a script: it shows what the view does with a difference, it measures nothing.
//   ablation.generator.json    the generator's 16 notes through POST /api/ablation on the fake backend: the fake Muse is
//                              the parser, so the two agree on every note by construction.
//   ablation.running.json      the same run asked for while it was still going (6 of 16).
//   ablation.interrupted.json  the sample's log cut after three notes, as the route reads a log that never ended.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readAblation, type AblationStatus, type Note } from "./model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixture = (name: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8"));

/** A fresh copy of a body the server gave, read the way the page reads it. */
export function ablationOf(name: string): AblationStatus {
  const read = readAblation(fixture(name));
  if (!read.ok) throw new Error(`fixture ${name} could not be read: ${read.reason}`);
  return read.value;
}

export function noteOf(run: AblationStatus, id: string): Note {
  const note = run.notes.find((candidate) => candidate.note_id === id);
  if (!note) throw new Error(`no note ${id} in ${run.run_id}`);
  return note;
}
