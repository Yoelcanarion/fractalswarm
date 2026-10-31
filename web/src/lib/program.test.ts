import { describe, expect, it } from "vitest";

import { programOf } from "./program";
import type { Placement } from "./results";
import { Stream } from "./testing";

const startedWith = (params: Record<string, unknown>) => new Stream().at(0).emit("run.started", "@kernel", { params }).events[0];

const CORPUS = {
  conference: "DevConf Live",
  rooms: [
    { id: "main-hall", name: "Main Hall", capacity: 260 },
    { id: "room-b", name: "Room B", capacity: 100 },
    { id: "room-c", name: "Room C", capacity: 60 },
  ],
  slots: [
    { index: 0, start: "09:00", end: "09:45" },
    { index: 1, start: "09:45", end: "10:30" },
    { index: 5, start: "14:00", end: "14:45" },
  ],
  talks: [
    { id: "T01", title: "Why your tests lie", speaker: "Sam Okoye", track_label: "HCI" },
    { id: "T02", title: "Rust for data engineers", speaker: "Ana Ruiz", track_label: "Data" },
    { id: "T03", title: "Small models", speaker: "Lee Park", track_label: "AI" },
  ],
};

const placements: Placement[] = [
  { day: "2", room: "room-b", slot: "1", talk: "T03" },
  { day: "1", room: "room-b", slot: "5", talk: "T01" },
  { day: "1", room: "main-hall", slot: "0", talk: "T02" },
];

describe("the finished program", () => {
  const program = programOf(placements, startedWith({ corpus: CORPUS, truth: { attendance: { T01: 33 } } }));

  it("names the conference, and each room with its seats, in the corpus's order and only those in use", () => {
    expect(program.conference).toBe("DevConf Live");
    expect(program.rooms).toEqual([
      { id: "main-hall", name: "Main Hall", capacity: 260 },
      { id: "room-b", name: "Room B", capacity: 100 },
    ]);
  });

  it("goes by day and by hour, and a day has only the hours in use", () => {
    expect(program.days.map(({ day, slots }) => [day, slots.map((slot) => slot.hours)])).toEqual([
      ["1", ["09:00–09:45", "14:00–14:45"]],
      ["2", ["09:45–10:30"]],
    ]);
  });

  it("puts each talk in its room's column, with its title, speaker and audience, and null where the room is free", () => {
    const [morning, afternoon] = program.days[0].slots;
    expect(morning.talks.map((talk) => talk?.title ?? null)).toEqual(["Rust for data engineers", null]);
    expect(afternoon.talks[1]).toEqual({ id: "T01", title: "Why your tests lie", speaker: "Sam Okoye", track: "HCI", attendance: 33 });
    expect(afternoon.talks[0]).toBeNull();
    expect(morning.talks[0]?.attendance).toBeNull(); // the run was not told
  });

  it("orders slots as numbers: slot 10 comes after slot 9", () => {
    const hours = programOf(
      [
        { day: "1", room: "r", slot: "10", talk: "A" },
        { day: "1", room: "r", slot: "9", talk: "B" },
      ],
      undefined,
    ).days[0].slots.map((slot) => slot.id);
    expect(hours).toEqual(["9", "10"]);
  });

  it("keeps the ids where the log has no corpus to name them: what was decided still shows", () => {
    const bare = programOf(placements, undefined);
    expect(bare.conference).toBeNull();
    expect(bare.rooms.map((room) => room.name)).toEqual(["main-hall", "room-b"]);
    expect(bare.days[0].slots[0].hours).toBe("Slot 0");
    expect(bare.days[0].slots[0].talks[0]).toEqual({ id: "T02", title: "T02", speaker: null, track: null, attendance: null });
  });

  it("shows the fingerprint of an approved reading, as the review does, and none for a task from a file", () => {
    const sha256 = "35002001a434a4af0318107c001d0b825ee42844905399dd036c7310e21572b4";
    expect(programOf(placements, startedWith({ corpus: CORPUS, input: { source: "intake", sha256, truth_mode: "approved" } })).reading).toBe("35002001a434");
    expect(programOf(placements, startedWith({ corpus: CORPUS, input: null })).reading).toBeNull();
  });
});
