// The intake's proposal as the review table holds it: Muse's reading of the pasted text, fitted to the program's
// shape by the server (intake/shape.py). It is also exactly what `POST api/intake/{id}/approve` takes back
// (intake/proposal.py: every row is `extra="forbid"`), so the fields here are the server's, snake_case and all, and a
// reader keeps those and no others: nothing the page invents can ride along to the server.

import { bad, count, list, oneOf, reading, record, text, textOrEmpty, type Read } from "./strict";

/** [day, slot]: one cell of the program's grid. */
export type Cell = readonly [day: number, slot: number];

export const PREFERENCES = ["morning", "afternoon"] as const;
export type Preference = (typeof PREFERENCES)[number];

export interface Slot {
  index: number;
  start: string;
  end: string;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
}

export interface Track {
  id: string;
  name: string;
  description: string;
}

export interface Speaker {
  id: string;
  name: string;
  email: string;
  /** Their email, word for word. */
  note: string;
  /** The cells they can give; null when nothing was stated (no constraint). */
  available: Cell[] | null;
  availability_source: string;
  preference: Preference | null;
  preference_source: string;
}

export interface Talk {
  id: string;
  title: string;
  speaker_id: string;
  track_id: string;
  track_label: string;
  abstract: string;
  track_source: string;
  attendance: number | null;
  attendance_source: string;
}

export interface Proposal {
  conference: string;
  days: number[];
  slots: Slot[];
  rooms: Room[];
  tracks: Track[];
  speakers: Speaker[];
  talks: Talk[];
  warnings: string[];
  errors: string[];
}

export type RowKind = "tracks" | "rooms" | "speakers" | "talks";

function readCells(raw: unknown, where: string): Cell[] | null {
  if (raw === null || raw === undefined) return null;
  return list(raw, where).map((cell, i): Cell => {
    const pair = list(cell, `${where}[${i}]`);
    if (pair.length !== 2) return bad(`${where}[${i}]`, "expected [day, slot]");
    return [count(pair[0], `${where}[${i}][0]`), count(pair[1], `${where}[${i}][1]`)];
  });
}

function readSpeaker(raw: unknown, where: string): Speaker {
  const r = record(raw, where);
  return {
    id: text(r.id, `${where}.id`),
    name: textOrEmpty(r.name, `${where}.name`),
    email: textOrEmpty(r.email, `${where}.email`),
    note: textOrEmpty(r.note, `${where}.note`),
    available: readCells(r.available, `${where}.available`),
    availability_source: textOrEmpty(r.availability_source, `${where}.availability_source`),
    preference: r.preference === null || r.preference === undefined ? null : oneOf(r.preference, PREFERENCES, `${where}.preference`),
    preference_source: textOrEmpty(r.preference_source, `${where}.preference_source`),
  };
}

function readTalk(raw: unknown, where: string): Talk {
  const r = record(raw, where);
  return {
    id: text(r.id, `${where}.id`),
    title: textOrEmpty(r.title, `${where}.title`),
    speaker_id: textOrEmpty(r.speaker_id, `${where}.speaker_id`),
    track_id: textOrEmpty(r.track_id, `${where}.track_id`),
    track_label: textOrEmpty(r.track_label, `${where}.track_label`),
    abstract: textOrEmpty(r.abstract, `${where}.abstract`),
    track_source: textOrEmpty(r.track_source, `${where}.track_source`),
    attendance: r.attendance === null || r.attendance === undefined ? null : count(r.attendance, `${where}.attendance`),
    attendance_source: textOrEmpty(r.attendance_source, `${where}.attendance_source`),
  };
}

function readSlot(raw: unknown, where: string): Slot {
  const r = record(raw, where);
  return { index: count(r.index, `${where}.index`), start: text(r.start, `${where}.start`), end: text(r.end, `${where}.end`) };
}

function readRoom(raw: unknown, where: string): Room {
  const r = record(raw, where);
  return { id: textOrEmpty(r.id, `${where}.id`), name: text(r.name, `${where}.name`), capacity: count(r.capacity, `${where}.capacity`) };
}

function readTrack(raw: unknown, where: string): Track {
  const r = record(raw, where);
  return { id: text(r.id, `${where}.id`), name: text(r.name, `${where}.name`), description: textOrEmpty(r.description, `${where}.description`) };
}

/** Read a proposal as `GET api/intake/{id}` sends it, or say which field is not what the page expects. */
export function readProposal(raw: unknown, where = "proposal"): Read<Proposal> {
  return reading(() => {
    const r = record(raw, where);
    return {
      conference: textOrEmpty(r.conference, `${where}.conference`),
      days: list(r.days ?? [], `${where}.days`).map((day, i) => count(day, `${where}.days[${i}]`)),
      slots: list(r.slots ?? [], `${where}.slots`).map((slot, i) => readSlot(slot, `${where}.slots[${i}]`)),
      rooms: list(r.rooms ?? [], `${where}.rooms`).map((room, i) => readRoom(room, `${where}.rooms[${i}]`)),
      tracks: list(r.tracks, `${where}.tracks`).map((track, i) => readTrack(track, `${where}.tracks[${i}]`)),
      speakers: list(r.speakers, `${where}.speakers`).map((speaker, i) => readSpeaker(speaker, `${where}.speakers[${i}]`)),
      talks: list(r.talks, `${where}.talks`).map((talk, i) => readTalk(talk, `${where}.talks[${i}]`)),
      warnings: list(r.warnings ?? [], `${where}.warnings`).map((w, i) => text(w, `${where}.warnings[${i}]`)),
      errors: list(r.errors ?? [], `${where}.errors`).map((e, i) => text(e, `${where}.errors[${i}]`)),
    };
  });
}
