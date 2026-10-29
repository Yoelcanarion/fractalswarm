// Where each row of the reading comes from: Muse's reading as it stood, a row the person edited, or one they added.
// `diffProposal` is the server's own list of edits (`diff` in intake/service.py), computed the same way, so what the
// page shows before approving is what the approval then reports; a test holds the two to one real answer.

import type { Proposal, RowKind } from "./proposal";

export type Provenance = "muse" | "edited" | "added";

export const PROVENANCE_WORDS: Record<Provenance, string> = { muse: "Muse", edited: "Edited by you", added: "Added by you" };

/** Structural equality, the way Python's `!=` reads two JSON values. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]));
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

const KINDS: readonly RowKind[] = ["tracks", "rooms", "speakers", "talks"];
type Row = { id: string } & Record<string, unknown>;

const rowsOf = (p: Proposal, kind: RowKind): Map<string, Row> => new Map((p[kind] as unknown as Row[]).map((row) => [row.id, row]));
const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** The fields a person changed against Muse's reading: `conference`, `kind[id].field`, `kind[id] added` or `removed`. */
export function diffProposal(original: Proposal, edited: Proposal): string[] {
  const changes: string[] = [];
  if (original.conference !== edited.conference) changes.push("conference");
  for (const kind of KINDS) {
    const before = rowsOf(original, kind);
    const after = rowsOf(edited, kind);
    changes.push(...sorted([...after.keys()].filter((id) => !before.has(id))).map((id) => `${kind}[${id}] added`));
    changes.push(...sorted([...before.keys()].filter((id) => !after.has(id))).map((id) => `${kind}[${id}] removed`));
    for (const id of sorted([...before.keys()].filter((key) => after.has(key)))) {
      const was = before.get(id) as Row;
      const now = after.get(id) as Row;
      for (const field of sorted(new Set([...Object.keys(was), ...Object.keys(now)]))) {
        if (!same(was[field], now[field])) changes.push(`${kind}[${id}].${field}`);
      }
    }
  }
  return changes;
}

/** How a row stands against Muse's reading, and which fields differ. */
export function provenanceOf(original: Proposal, edited: Proposal, kind: RowKind, id: string): { provenance: Provenance; fields: string[] } {
  const was = rowsOf(original, kind).get(id);
  const now = rowsOf(edited, kind).get(id);
  if (was === undefined) return { provenance: "added", fields: [] };
  if (now === undefined) return { provenance: "edited", fields: [] };
  const fields = sorted(new Set([...Object.keys(was), ...Object.keys(now)])).filter((field) => !same(was[field], now[field]));
  return { provenance: fields.length > 0 ? "edited" : "muse", fields };
}

/** Muse's rows that the person took out, in their original order: shown so that nothing vanishes silently, and so it can be undone. */
export function removedRows<K extends "talks" | "speakers">(original: Proposal, edited: Proposal, kind: K): Proposal[K] {
  const kept = new Set((edited[kind] as { id: string }[]).map((row) => row.id));
  return (original[kind] as { id: string }[]).filter((row) => !kept.has(row.id)) as Proposal[K];
}
