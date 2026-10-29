// What a person can do to the reading in the review table, as pure functions on a proposal. Each returns a new
// proposal and touches no field the server does not know; the server fits the result to the program again on
// approval (it renumbers the ids), so an id made here only has to be free.

import type { Cell, Proposal, Speaker, Talk, Track } from "./proposal";

type Patch<T> = Partial<Omit<T, "id">>;

const withRow = <T extends { id: string }>(rows: T[], id: string, patch: Patch<T>): T[] => rows.map((row) => (row.id === id ? { ...row, ...patch } : row));

export const setConference = (p: Proposal, conference: string): Proposal => ({ ...p, conference });
export const patchTalk = (p: Proposal, id: string, patch: Patch<Talk>): Proposal => ({ ...p, talks: withRow(p.talks, id, patch) });
export const patchSpeaker = (p: Proposal, id: string, patch: Patch<Speaker>): Proposal => ({ ...p, speakers: withRow(p.speakers, id, patch) });
export const patchTrack = (p: Proposal, id: string, patch: Patch<Track>): Proposal => ({ ...p, tracks: withRow(p.tracks, id, patch) });

export const removeTalk = (p: Proposal, id: string): Proposal => ({ ...p, talks: p.talks.filter((talk) => talk.id !== id) });

/** The talks that still name this speaker: a speaker with talks cannot be removed. */
export const talksOf = (p: Proposal, speakerId: string): Talk[] => p.talks.filter((talk) => talk.speaker_id === speakerId);

/** Remove a speaker who has no talk left; one who has is kept (the talks would be left without a speaker). */
export function removeSpeaker(p: Proposal, id: string): Proposal {
  return talksOf(p, id).length > 0 ? p : { ...p, speakers: p.speakers.filter((speaker) => speaker.id !== id) };
}

/** The first `T01`, `S01`... no row of the reading, as Muse gave it or as it stands now, already has. */
function freeId(prefix: "T" | "S", ...rows: { id: string }[][]): string {
  const taken = new Set(rows.flat().map((row) => row.id));
  for (let n = 1; ; n++) {
    const id = `${prefix}${String(n).padStart(2, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** A blank talk, for the person to fill in: on the first speaker and the first track until they say otherwise. */
export function addTalk(p: Proposal, original: Proposal): Proposal {
  const talk: Talk = {
    id: freeId("T", p.talks, original.talks),
    title: "",
    speaker_id: p.speakers[0]?.id ?? "",
    track_id: p.tracks[0]?.id ?? "",
    track_label: "",
    abstract: "",
    track_source: "",
    attendance: null,
    attendance_source: "",
  };
  return { ...p, talks: [...p.talks, talk] };
}

export function addSpeaker(p: Proposal, original: Proposal): Proposal {
  const speaker: Speaker = { id: freeId("S", p.speakers, original.speakers), name: "", email: "", note: "", available: null, availability_source: "", preference: null, preference_source: "" };
  return { ...p, speakers: [...p.speakers, speaker] };
}

/** Put a removed row back where it stood among the rows that remain. */
export function restoreRow(p: Proposal, original: Proposal, kind: "talks" | "speakers", id: string): Proposal {
  const row = (original[kind] as { id: string }[]).find((candidate) => candidate.id === id);
  if (row === undefined || (p[kind] as { id: string }[]).some((candidate) => candidate.id === id)) return p;
  const at = (original[kind] as { id: string }[]).findIndex((candidate) => candidate.id === id);
  const kept = new Set((p[kind] as { id: string }[]).map((candidate) => candidate.id));
  const before = (original[kind] as { id: string }[]).slice(0, at).filter((candidate) => kept.has(candidate.id)).length;
  const rows = [...(p[kind] as { id: string }[])];
  rows.splice(before, 0, row);
  return { ...p, [kind]: rows };
}

// ---- availability: the cells of the 2-day, 9-slot grid a speaker can give ----

const sortCells = (cells: Cell[]): Cell[] => [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

export function gridCells(p: Pick<Proposal, "days" | "slots">): Cell[] {
  return p.days.flatMap((day) => p.slots.map((slot): Cell => [day, slot.index]));
}

/** The cells a speaker gives: when nothing was stated, all of them. */
export const givenCells = (p: Pick<Proposal, "days" | "slots">, speaker: Speaker): Cell[] => speaker.available ?? gridCells(p);

/** Give or take back one cell. Taking back every cell is refused: the server reads an empty list as "nothing
 * stated", which is the opposite of what it looks like. Giving every cell is the same as no constraint. */
export function toggleCell(p: Pick<Proposal, "days" | "slots">, speaker: Speaker, cell: Cell): Speaker {
  const current = givenCells(p, speaker);
  const has = current.some(([day, slot]) => day === cell[0] && slot === cell[1]);
  const next = sortCells(has ? current.filter(([day, slot]) => day !== cell[0] || slot !== cell[1]) : [...current, cell]);
  if (next.length === 0) return speaker;
  return { ...speaker, available: next.length === gridCells(p).length ? null : next };
}
