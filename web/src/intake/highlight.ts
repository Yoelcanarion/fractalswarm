// Where each fact of the reading stands in the text the person pasted. Every extracted fact carries the sentence it
// was read from; the review table shows it, and the text pane marks it. A mark that is not where the sentence really
// is would be false provenance, so a sentence is only ever marked where it is found.
//
// The test is the server's (`present` in intake/shape.py): spacing and case aside. One thing it cannot do is tell
// two equal sentences apart, and the pasted text has many ("Track: HCC track", "A morning slot would be ideal."):
// each is placed at the occurrence nearest the row's own anchor (a talk's abstract, a speaker's email), which is
// unique, so it lands in the right submission and the right email.

import type { Proposal } from "./proposal";

export type Box = "talks" | "notes" | "conference";
export const BOXES: readonly Box[] = ["talks", "notes", "conference"];
export type Texts = Partial<Record<Box, string>>;

export interface Span {
  box: Box;
  start: number;
  end: number;
}

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every place the sentence stands in the pasted boxes, in the order of `BOXES` then of the text. */
export function occurrences(quote: string, texts: Texts): Span[] {
  const words = quote.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const pattern = new RegExp(words.map(escaped).join("\\s+"), "gi");
  const spans: Span[] = [];
  for (const box of BOXES) {
    const body = texts[box];
    if (!body) continue;
    for (const match of body.matchAll(pattern)) spans.push({ box, start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

const gap = (a: Span, b: Span): number => Math.max(0, a.start - b.end, b.start - a.end);

/** The occurrence nearest the anchor, in the anchor's own box when it has one there; the first one without an anchor. */
export function nearest(spans: Span[], anchor: Span | null): Span | null {
  if (spans.length === 0) return null;
  if (anchor === null) return spans[0];
  const inBox = spans.filter((span) => span.box === anchor.box);
  const pool = inBox.length > 0 ? inBox : spans;
  return pool.reduce((best, span) => (gap(span, anchor) < gap(best, anchor) ? span : best));
}

export type Field = "abstract" | "track_source" | "attendance_source" | "note" | "availability_source" | "preference_source";

/** The long quotes: a talk's abstract and a speaker's email. They anchor the row, and are marked only when the row is picked. */
export const BLOCK_FIELDS: ReadonlySet<Field> = new Set<Field>(["abstract", "note"]);

export const FIELD_WORDS: Record<Field, string> = {
  abstract: "Abstract",
  track_source: "Track",
  attendance_source: "Attendance",
  note: "Email",
  availability_source: "Availability",
  preference_source: "Preference",
};

export interface Fact {
  /** `talks:T01:attendance_source`: unique in a proposal, and what a mark is named by. */
  key: string;
  kind: "talks" | "speakers";
  id: string;
  field: Field;
  quote: string;
  /** Where it stands in the text, or null when it is not there (Muse reworded it). */
  span: Span | null;
}

export const factKey = (kind: "talks" | "speakers", id: string, field: Field): string => `${kind}:${id}:${field}`;

/** Every quote of the reading, placed in the text. A quote that is empty is no fact: nothing was stated. */
export function placeFacts(p: Proposal, texts: Texts): Fact[] {
  const facts: Fact[] = [];
  // `fields[0]` is the row's long quote: it anchors the others
  const place = (kind: "talks" | "speakers", id: string, fields: [Field, string][], anchorFallback: string): void => {
    const [blockField, blockText] = fields[0];
    const blockSpan = blockText.trim() === "" ? null : (occurrences(blockText, texts)[0] ?? null);
    // a row whose long quote is not there is anchored by its title, when that is there
    const anchor = blockSpan ?? (anchorFallback.trim() === "" ? null : (occurrences(anchorFallback, texts)[0] ?? null));
    for (const [field, text] of fields) {
      if (text.trim() === "") continue;
      const span = field === blockField ? blockSpan : nearest(occurrences(text, texts), anchor);
      facts.push({ key: factKey(kind, id, field), kind, id, field, quote: text, span });
    }
  };
  for (const talk of p.talks) {
    place("talks", talk.id, [["abstract", talk.abstract], ["track_source", talk.track_source], ["attendance_source", talk.attendance_source]], talk.title);
  }
  for (const speaker of p.speakers) {
    place("speakers", speaker.id, [["note", speaker.note], ["availability_source", speaker.availability_source], ["preference_source", speaker.preference_source]], "");
  }
  return facts;
}

export interface Piece {
  text: string;
  /** The keys of the facts whose quote covers this piece; none for plain text. */
  keys: string[];
}

/** A pasted box cut into pieces at every edge of a mark, each knowing which marks cover it. */
export function pieces(body: string, marks: { key: string; start: number; end: number }[]): Piece[] {
  const edges = [...new Set([0, body.length, ...marks.flatMap((mark) => [mark.start, mark.end])])].filter((edge) => edge >= 0 && edge <= body.length).sort((a, b) => a - b);
  const cut: Piece[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const [start, end] = [edges[i], edges[i + 1]];
    cut.push({ text: body.slice(start, end), keys: marks.filter((mark) => mark.start <= start && mark.end >= end).map((mark) => mark.key) });
  }
  return cut;
}

/** The marks the pane draws for a box: the short sentences always, and the whole row (its abstract or email too)
 * for the row the person picked. */
export function marksFor(facts: Fact[], box: Box, active: { kind: "talks" | "speakers"; id: string } | null): { key: string; start: number; end: number }[] {
  const marks: { key: string; start: number; end: number }[] = [];
  for (const fact of facts) {
    if (fact.span === null || fact.span.box !== box) continue;
    if (BLOCK_FIELDS.has(fact.field) && !(active !== null && active.kind === fact.kind && active.id === fact.id)) continue;
    marks.push({ key: fact.key, start: fact.span.start, end: fact.span.end });
  }
  return marks;
}

/** What the person picked in the review table: a row, or one sentence of it. */
export interface Selection {
  kind: "talks" | "speakers";
  id: string;
  /** The sentence picked; null for the whole row. */
  field: Field | null;
}

/** The marks that are "the one you picked": the sentence, or every sentence of the picked row. */
export function activeKeysOf(facts: Fact[], selection: Selection | null): Set<string> {
  if (selection === null) return new Set();
  return new Set(facts.filter((fact) => fact.kind === selection.kind && fact.id === selection.id && (selection.field === null || fact.field === selection.field)).map((fact) => fact.key));
}

/** The selection a mark stands for (`talks:T01:attendance_source`), to pick its row by clicking the text. */
export function selectionOfKey(key: string): Selection | null {
  const [kind, id, field] = key.split(":");
  return (kind === "talks" || kind === "speakers") && id !== undefined && field !== undefined ? { kind, id, field: field as Field } : null;
}

/** The box the picked sentence stands in, if it stands in one. */
export const boxOf = (facts: Fact[], selection: Selection | null): Box | null =>
  facts.find((fact) => selection !== null && fact.kind === selection.kind && fact.id === selection.id && (selection.field === null || fact.field === selection.field) && fact.span !== null)?.span?.box ?? null;
