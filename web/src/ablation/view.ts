// What the ablation view says, from what the server scored: the headline in the brief's form, who understood each note,
// where a reading differs from the approved one, and the words for a score. The numbers are the server's; this only says them.

import type { RunListing } from "../lib/types";
import type { AblationStatus, Agreement, Caveat, Note, Result } from "./model";

interface Count {
  understood: number;
  of: number;
}

/** The two halves of the headline: "parser 3 of 6" and "Muse 5 of 6". */
export const headlineParts = (counts: { parser: Count; muse: Count }): [string, string] => [`parser ${counts.parser.understood} of ${counts.parser.of}`, `Muse ${counts.muse.understood} of ${counts.muse.of}`];

/** "parser 3 of 6 · Muse 5 of 6", from the result's own tallies. */
export const headlineOf = (counts: { parser: Count; muse: Count }): string => headlineParts(counts).join(" · ");

/** The same line for the notes scored so far, before the server gives its tallies. */
export const soFarCounts = (notes: readonly Note[]): { parser: Count; muse: Count } => {
  const now = soFar(notes);
  return { parser: { understood: now.parser, of: now.scored }, muse: { understood: now.muse, of: now.scored } };
};

// ---- who understood a note ----

export type Split = keyof Agreement;
export const SPLITS: readonly Split[] = ["both", "only_muse", "only_parser", "neither"];
export const SPLIT_WORDS: Record<Split, string> = { both: "Both understood", only_muse: "Only Muse", only_parser: "Only the parser", neither: "Neither" };

export function splitOf(note: Note): Split {
  const parser = note.parser.score.understood;
  const muse = note.muse.score.understood;
  return parser && muse ? "both" : muse ? "only_muse" : parser ? "only_parser" : "neither";
}

/** The notes scored so far, counted by who understood them: what the server's `agreement` says once the run is done. */
export function splitCounts(notes: readonly Note[]): Agreement {
  const counts: Agreement = { both: 0, only_muse: 0, only_parser: 0, neither: 0 };
  for (const note of notes) counts[splitOf(note)]++;
  return counts;
}

/** How many of the notes scored so far each reader understood: shown as "so far" until the server gives its tallies. */
export function soFar(notes: readonly Note[]): { parser: number; muse: number; scored: number } {
  return { parser: notes.filter((note) => note.parser.score.understood).length, muse: notes.filter((note) => note.muse.score.understood).length, scored: notes.length };
}

// ---- the notes to show ----

export type Filter = "all" | "differ" | Split;
export const FILTERS: readonly Filter[] = ["all", "differ", ...SPLITS];
export const FILTER_WORDS: Record<Filter, string> = { all: "All notes", differ: "Where they differ", ...SPLIT_WORDS };

export function filterNotes(notes: readonly Note[], filter: Filter, differing: ReadonlySet<string>): Note[] {
  if (filter === "all") return [...notes];
  if (filter === "differ") return notes.filter((note) => differing.has(note.note_id));
  return notes.filter((note) => splitOf(note) === filter);
}

// ---- a reading against the approved one ----

export interface Part {
  text: string;
  /** The approved reading says the same. Always true when there is nothing to compare with. */
  same: boolean;
}

const partsOf = (words: string | null): string[] => (words === null ? [] : words.split("; ").filter((part) => part !== ""));

/** A reading in words (`day 1: 14:00-17:00; day 2: all day; prefers afternoon`) cut into its parts, each marked by whether the
 * approved reading has it too, and the parts of the approved reading this one lacks. */
export function compare(words: string | null, reference: string | null): { parts: Part[]; missing: string[] } {
  const wanted = partsOf(reference);
  const got = partsOf(words);
  return {
    parts: got.map((text) => ({ text, same: reference === null || wanted.includes(text) })),
    missing: reference === null || words === null ? [] : wanted.filter((part) => !got.includes(part)),
  };
}

export const percent = (value: number): string => `${value.toFixed(1)} %`;

/** How a reader scored on a note, in words. */
export function scoreParts(note: Note, side: "parser" | "muse"): string[] {
  if (note[side].text === null) return ["no reading"];
  if (note.kind === "email") {
    const score = note[side].score;
    return [score.cells_exact ? "cells exact" : `cells not exact (Jaccard ${score.jaccard.toFixed(2)})`, score.preference ? "preference right" : "preference wrong"];
  }
  const score = note[side].score;
  if (score.error === null || score.error_pct === null) return ["no reading"];
  if (score.error === 0) return ["exact"];
  return [`${percent(score.error_pct)} off`, score.within ? "within 10 %" : "outside 10 %"];
}

// ---- the run ----

/** What to say about a run that is not a clean, finished one; null when there is nothing to say. */
export function statusLine(run: AblationStatus): string | null {
  switch (run.status) {
    case "running":
      return `Scoring: ${run.progress.done} of ${run.progress.of} notes.`;
    case "completed":
      return run.result?.complete === false ? "The deadline cut this run: the notes with no answer by then count as missed." : null;
    case "halted":
      return "The run was halted before it finished, so there is no result. These are the notes scored so far.";
    case "failed":
      return `The run failed${run.error === null ? "" : `: ${run.error}`}. These are the notes scored so far.`;
    case "interrupted":
      return "The run stopped before it finished (the server may have restarted), so there is no result. These are the notes scored so far.";
  }
}

export const CAVEAT_LABELS: Record<string, string> = { generator: "Generated notes", reference: "The reference", fake: "Practice backend" };
export const caveatLabel = (id: string): string => CAVEAT_LABELS[id] ?? id;

/** The caveats the result says apply to this run, as it wrote them. */
export const appliedCaveats = (result: Pick<Result, "caveats">): Caveat[] => result.caveats.filter((caveat) => caveat.applies);

/** The ablation runs among the runs the server lists: recorded from the page, or from the CLI. */
export const ablationRuns = (runs: readonly RunListing[]): RunListing[] => runs.filter((run) => run.id.startsWith("ablation") || (run.scenario ?? "").includes("ablation"));
