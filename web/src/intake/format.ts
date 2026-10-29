// Words for what the review table shows: a speaker's cells of the grid as time ranges, and an edit as a person reads it.

import type { Cell, Proposal, RowKind } from "./proposal";

const times = (p: Pick<Proposal, "slots">, slotIndex: number): { start: string; end: string } | null => p.slots.find((slot) => slot.index === slotIndex) ?? null;

/** "Any time", or per day the ranges of consecutive slots: "Day 1 09:00–10:45, 14:00–15:30 · Day 2 all day". */
export function describeCells(p: Pick<Proposal, "days" | "slots">, cells: readonly Cell[] | null): string {
  if (cells === null) return "Any time";
  const parts: string[] = [];
  for (const day of p.days) {
    const mine = cells.filter(([d]) => d === day).map(([, slot]) => slot).sort((a, b) => a - b);
    if (mine.length === 0) continue;
    if (mine.length === p.slots.length) {
      parts.push(`Day ${day} all day`);
      continue;
    }
    const ranges: string[] = [];
    for (let i = 0; i < mine.length; ) {
      let j = i;
      while (j + 1 < mine.length && mine[j + 1] === mine[j] + 1) j++;
      const first = times(p, mine[i]);
      const last = times(p, mine[j]);
      ranges.push(first && last ? `${first.start}–${last.end}` : `slots ${mine[i]}–${mine[j]}`);
      i = j + 1;
    }
    parts.push(`Day ${day} ${ranges.join(", ")}`);
  }
  return parts.length === 0 ? "No cell" : parts.join(" · ");
}

const KIND_WORDS: Record<RowKind, string> = { tracks: "track", rooms: "room", speakers: "speaker", talks: "talk" };

/** An edit as the server lists it (`talks[T01].attendance`, `talks[T13] added`) in words. */
export function editWords(edit: string): string {
  if (edit === "conference") return "the conference name";
  const match = /^(tracks|rooms|speakers|talks)\[(.+?)\](?:\.(\w+)| (added|removed))$/.exec(edit);
  if (!match) return edit;
  const [, kind, id, field, change] = match;
  const what = `${KIND_WORDS[kind as RowKind]} ${id}`;
  return change ? `${what} ${change}` : `${what}: ${field?.replace(/_/g, " ")}`;
}

/** A server timestamp as one line a person can read, in UTC so it reads the same wherever the page is opened. */
export function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** One line for what the scan found in the boxes: whether anything was blocked, and where addresses were replaced. */
export function scanSummary(scans: readonly { source_id: string; decision: string; findings: readonly string[] }[]): string {
  if (scans.length === 0) return "";
  const blocked = scans.filter((scan) => scan.decision !== "allow").map((scan) => scan.source_id);
  const replaced = scans.filter((scan) => scan.findings.includes("email")).map((scan) => scan.source_id);
  const verdict = blocked.length === 0 ? "all allowed" : `${blocked.join(" and ")} blocked`;
  return `Scanned ${scans.length} ${scans.length === 1 ? "box" : "boxes"}: ${verdict}${replaced.length > 0 ? `; email addresses replaced in ${replaced.join(" and ")}` : ""}.`;
}

/** The first characters of a hash, enough to tell two apart and to read back. */
export const shortHash = (hash: string): string => hash.slice(0, 12);
