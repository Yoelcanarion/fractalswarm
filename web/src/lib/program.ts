// The finished program in words. A run's final report says what was decided in ids (day, room, slot, talk); the conference the run was given,
// which `run.started` carries as `params.corpus`, names them: each talk's title and speaker, each room and its seats, each slot's hours. An id
// the corpus does not list stays an id, so a log without one still shows what was decided.

import { asNumber, asRecord, asString } from "./generic";
import type { Placement } from "./results";
import type { RunEvent } from "./types";

export interface ProgramTalk {
  id: string;
  /** The talk's id where the corpus has no title for it. */
  title: string;
  speaker: string | null;
  track: string | null;
  /** The audience the run was told to expect. */
  attendance: number | null;
}

export interface ProgramRoom {
  id: string;
  name: string;
  capacity: number | null;
}

export interface ProgramSlot {
  id: string;
  /** "09:00–09:45", or "Slot 3" where the corpus has no hours for it. */
  hours: string;
  /** One for each of the program's rooms, in their order: null where the room is free. */
  talks: (ProgramTalk | null)[];
}

export interface ProgramDay {
  day: string;
  slots: ProgramSlot[];
}

export interface Program {
  conference: string | null;
  rooms: ProgramRoom[];
  days: ProgramDay[];
  /** The fingerprint of the reading a person approved, as the review shows it; null for a run not built from one. */
  reading: string | null;
}

const FINGERPRINT = 12; // the characters of the hash the review shows

const natural = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });
const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(asRecord) : []);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const byId = (rows: Record<string, unknown>[], key: string): Map<string, Record<string, unknown>> => new Map(rows.map((row) => [asString(row[key]), row]));

function hoursOf(id: string, slot: Record<string, unknown> | undefined): string {
  const start = text(slot?.start);
  if (start === null) return `Slot ${id}`;
  const end = text(slot?.end);
  return end === null ? start : `${start}–${end}`;
}

/** The fingerprint of the reading a person approved, for a run built from one. */
export function readingOf(started: RunEvent | undefined): string | null {
  const input = asRecord(asRecord(started?.payload.params).input);
  return input.source === "intake" ? (text(input.sha256)?.slice(0, FINGERPRINT) ?? null) : null;
}

/** The program of a report's placements, by day and by hour, in the rooms it uses: free rooms and free hours are left out. */
export function programOf(placements: readonly Placement[], started: RunEvent | undefined): Program {
  const params = asRecord(started?.payload.params);
  const corpus = asRecord(params.corpus);
  const attendance = asRecord(asRecord(params.truth).attendance);
  const rooms = byId(records(corpus.rooms), "id");
  const slots = byId(records(corpus.slots), "index");
  const talks = byId(records(corpus.talks), "id");
  const unique = (pick: (placement: Placement) => string): string[] => [...new Set(placements.map(pick))];

  // In the corpus's order, with any room it does not list after those.
  const used = unique((p) => p.room).sort(natural);
  const roomIds = [...[...rooms.keys()].filter((id) => used.includes(id)), ...used.filter((id) => !rooms.has(id))];
  const at = new Map(placements.map((p) => [`${p.day}|${p.room}|${p.slot}`, p.talk]));
  const talkOf = (id: string | undefined): ProgramTalk | null => {
    if (id === undefined) return null;
    const talk = talks.get(id);
    return {
      id,
      title: text(talk?.title) ?? id,
      speaker: text(talk?.speaker),
      track: text(talk?.track_label),
      attendance: asNumber(attendance[id]),
    };
  };

  return {
    conference: text(corpus.conference),
    rooms: roomIds.map((id) => ({ id, name: text(rooms.get(id)?.name) ?? id, capacity: asNumber(rooms.get(id)?.capacity) })),
    days: unique((p) => p.day)
      .sort(natural)
      .map((day) => ({
        day,
        slots: unique((p) => (p.day === day ? p.slot : ""))
          .filter((slot) => slot !== "")
          .sort(natural)
          .map((slot) => ({ id: slot, hours: hoursOf(slot, slots.get(slot)), talks: roomIds.map((room) => talkOf(at.get(`${day}|${room}|${slot}`))) })),
      })),
    reading: readingOf(started),
  };
}
