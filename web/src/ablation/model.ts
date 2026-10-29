// The ablation's bodies (api/lens.py, `GET /api/ablation/{run_id}` and `POST /api/ablation`), read strictly: a field of the
// wrong kind is named by its path and refused, never repaired. The page shows what the server scored; it scores nothing.
// Only what the page shows is read; the readings in structured form (`reading`) are not, the server gives them in words.

import { bad, count, flag, list, number, oneOf, reading, record, text, type Read } from "../intake/strict";

export const STATUSES = ["running", "completed", "halted", "failed", "interrupted"] as const;
export type Status = (typeof STATUSES)[number];

export interface EmailScore {
  understood: boolean;
  cells_exact: boolean;
  jaccard: number;
  preference: boolean;
}

export interface AbstractScore {
  understood: boolean;
  /** The reading is within 10 % of the reference. */
  within: boolean;
  error: number | null;
  error_pct: number | null;
}

/** What one reader made of a note: the reading in words (none when there is no reading) and how it scored. */
export interface Answer<S> {
  text: string | null;
  score: S;
}

export interface MuseAnswer<S> extends Answer<S> {
  /** The call in the lens. */
  effect_id: string | null;
  /** Why Muse has no reading, when it has none. */
  error: string | null;
}

interface NoteBase {
  note_id: string;
  subject: string;
  /** The note itself: untrusted text, shown as text. */
  text: string;
  /** The approved reading, in words. */
  reference_text: string | null;
}

export type Note =
  | (NoteBase & { kind: "email"; parser: Answer<EmailScore>; muse: MuseAnswer<EmailScore> })
  | (NoteBase & { kind: "abstract"; parser: Answer<AbstractScore>; muse: MuseAnswer<AbstractScore> });

export interface Tally {
  understood: number;
  of: number;
  emails: { of: number; understood: number; cells_exact: number; preference: number; mean_jaccard: number | null };
  abstracts: { of: number; understood: number; mean_error_pct: number | null };
}

export interface Agreement {
  both: number;
  only_muse: number;
  only_parser: number;
  neither: number;
}

export interface Caveat {
  id: string;
  text: string;
  /** Only the caveats that apply are shown. */
  applies: boolean;
}

export interface Result {
  /** False: the deadline cut the run, and the notes with no answer count as missed. */
  complete: boolean;
  headline: string;
  source: string;
  backend: string;
  notes: number;
  parser: Tally;
  muse: Tally;
  agreement: Agreement;
  /** The notes on which the two readings are not the same. */
  differences: string[];
  caveats: Caveat[];
  definitions: Record<string, string>;
}

export interface AblationStatus {
  run_id: string;
  status: Status;
  error: string | null;
  progress: { done: number; of: number };
  result: Result | null;
  notes: Note[];
}

export interface Started {
  run_id: string;
  notes: number;
  /** False: that exact request already has a run. */
  started: boolean;
}

const nullable = <T>(value: unknown, read: (value: unknown) => T): T | null => (value === null || value === undefined ? null : read(value));

function readEmailScore(raw: unknown, where: string): EmailScore {
  const r = record(raw, where);
  return { understood: flag(r.understood, `${where}.understood`), cells_exact: flag(r.cells_exact, `${where}.cells_exact`), jaccard: number(r.jaccard, `${where}.jaccard`), preference: flag(r.preference, `${where}.preference`) };
}

function readAbstractScore(raw: unknown, where: string): AbstractScore {
  const r = record(raw, where);
  return {
    understood: flag(r.understood, `${where}.understood`),
    within: flag(r.within, `${where}.within`),
    error: nullable(r.error, (value) => number(value, `${where}.error`)),
    error_pct: nullable(r.error_pct, (value) => number(value, `${where}.error_pct`)),
  };
}

function readAnswer<S>(raw: unknown, where: string, score: (raw: unknown, where: string) => S): Answer<S> {
  const r = record(raw, where);
  return { text: nullable(r.text, (value) => text(value, `${where}.text`)), score: score(r.score, `${where}.score`) };
}

function readMuse<S>(raw: unknown, where: string, score: (raw: unknown, where: string) => S): MuseAnswer<S> {
  const r = record(raw, where);
  return {
    ...readAnswer(raw, where, score),
    effect_id: nullable(r.effect_id, (value) => text(value, `${where}.effect_id`)),
    error: nullable(r.error, (value) => text(value, `${where}.error`)),
  };
}

function readNote(raw: unknown, where: string): Note {
  const r = record(raw, where);
  const base = {
    note_id: text(r.note_id, `${where}.note_id`),
    subject: text(r.subject, `${where}.subject`),
    text: text(r.text, `${where}.text`),
    reference_text: nullable(r.reference_text, (value) => text(value, `${where}.reference_text`)),
  };
  const kind = oneOf(r.kind, ["email", "abstract"] as const, `${where}.kind`);
  return kind === "email"
    ? { ...base, kind, parser: readAnswer(r.parser, `${where}.parser`, readEmailScore), muse: readMuse(r.muse, `${where}.muse`, readEmailScore) }
    : { ...base, kind, parser: readAnswer(r.parser, `${where}.parser`, readAbstractScore), muse: readMuse(r.muse, `${where}.muse`, readAbstractScore) };
}

function readTally(raw: unknown, where: string): Tally {
  const r = record(raw, where);
  const emails = record(r.emails, `${where}.emails`);
  const abstracts = record(r.abstracts, `${where}.abstracts`);
  return {
    understood: count(r.understood, `${where}.understood`),
    of: count(r.of, `${where}.of`),
    emails: {
      of: count(emails.of, `${where}.emails.of`),
      understood: count(emails.understood, `${where}.emails.understood`),
      cells_exact: count(emails.cells_exact, `${where}.emails.cells_exact`),
      preference: count(emails.preference, `${where}.emails.preference`),
      mean_jaccard: nullable(emails.mean_jaccard, (value) => number(value, `${where}.emails.mean_jaccard`)),
    },
    abstracts: {
      of: count(abstracts.of, `${where}.abstracts.of`),
      understood: count(abstracts.understood, `${where}.abstracts.understood`),
      mean_error_pct: nullable(abstracts.mean_error_pct, (value) => number(value, `${where}.abstracts.mean_error_pct`)),
    },
  };
}

function readResult(raw: unknown, where: string): Result {
  const r = record(raw, where);
  const agreement = record(r.agreement, `${where}.agreement`);
  const definitions = record(r.definitions ?? {}, `${where}.definitions`);
  return {
    complete: flag(r.complete, `${where}.complete`),
    headline: text(r.headline, `${where}.headline`),
    source: text(r.source, `${where}.source`),
    backend: text(r.backend, `${where}.backend`),
    notes: count(r.notes, `${where}.notes`),
    parser: readTally(r.parser, `${where}.parser`),
    muse: readTally(r.muse, `${where}.muse`),
    agreement: {
      both: count(agreement.both, `${where}.agreement.both`),
      only_muse: count(agreement.only_muse, `${where}.agreement.only_muse`),
      only_parser: count(agreement.only_parser, `${where}.agreement.only_parser`),
      neither: count(agreement.neither, `${where}.agreement.neither`),
    },
    differences: list(r.differences, `${where}.differences`).map((id, i) => text(id, `${where}.differences[${i}]`)),
    caveats: list(r.caveats, `${where}.caveats`).map((caveat, i) => {
      const c = record(caveat, `${where}.caveats[${i}]`);
      return { id: text(c.id, `${where}.caveats[${i}].id`), text: text(c.text, `${where}.caveats[${i}].text`), applies: flag(c.applies, `${where}.caveats[${i}].applies`) };
    }),
    definitions: Object.fromEntries(Object.entries(definitions).map(([term, meaning]) => [term, text(meaning, `${where}.definitions.${term}`)])),
  };
}

export function readAblation(raw: unknown): Read<AblationStatus> {
  return reading(() => {
    const r = record(raw, "ablation");
    const progress = record(r.progress, "ablation.progress");
    const status = oneOf(r.status, STATUSES, "ablation.status");
    const result = nullable(r.result, (value) => readResult(value, "ablation.result"));
    if (status === "completed" && result === null) bad("ablation", "a completed run without its result");
    return {
      run_id: text(r.run_id, "ablation.run_id"),
      status,
      error: nullable(r.error, (value) => text(value, "ablation.error")),
      progress: { done: count(progress.done, "ablation.progress.done"), of: count(progress.of, "ablation.progress.of") },
      result,
      notes: list(r.notes, "ablation.notes").map((note, i) => readNote(note, `ablation.notes[${i}]`)),
    };
  });
}

export function readStarted(raw: unknown): Read<Started> {
  return reading(() => {
    const r = record(raw, "ablation");
    return { run_id: text(r.run_id, "ablation.run_id"), notes: count(r.notes, "ablation.notes"), started: flag(r.started, "ablation.started") };
  });
}
