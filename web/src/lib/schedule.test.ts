import { describe, expect, it } from "vitest";

import { foldEvents } from "./reducer";
import { cellCollision, cellKey, openCollisions } from "./schedule";
import { Stream } from "./testing";

const grid = { days: [1, 2], rooms: ["A", "B", "C", "D"], slots: ["09:00", "10:00", "11:30"] };

function t2Stream(withGrid = true): Stream {
  return new Stream()
    .emit("run.started", "@kernel", { seed: "0", scenario: "t2", clock: "sim", params: withGrid ? { grid } : {} })
    .spawn("root", "root", null)
    .spawn("t1", "track", "root")
    .spawn("t1-d1", "session", "t1")
    .spawn("t2", "track", "root")
    .spawn("t2-d1", "session", "t2");
}

describe("the T2 schedule grid", () => {
  it("takes its axes from run.started and fills cells from placements", () => {
    const s = t2Stream()
      .emit("schedule.placed", "t1-d1", { talk_id: "talk-7", title: "Fractals", day: 1, room: "A", slot: "09:00", squad: "t1-d1" })
      .emit("schedule.placed", "t2-d1", { talk_id: "talk-9", day: 1, room: "B", slot: "09:00", squad: "t2-d1" });
    const { schedule } = foldEvents(s.events);
    expect(schedule.days).toEqual(["1", "2"]);
    expect(schedule.rooms).toEqual(["A", "B", "C", "D"]);
    expect(schedule.slots).toEqual(["09:00", "10:00", "11:30"]);
    expect(schedule.cells[cellKey(1, "A", "09:00")]).toMatchObject({ talkId: "talk-7", squad: "t1-d1", title: "Fractals" });
    expect(schedule.placements).toBe(2);
  });

  it("infers sorted axes when the run declares none", () => {
    const s = t2Stream(false)
      .emit("schedule.placed", "t1-d1", { talk_id: "x", day: 2, room: "Room 10", slot: 3, squad: "t1-d1" })
      .emit("schedule.placed", "t1-d1", { talk_id: "y", day: 1, room: "Room 9", slot: 1, squad: "t1-d1" });
    const { schedule } = foldEvents(s.events);
    expect(schedule.days).toEqual(["1", "2"]);
    expect(schedule.rooms).toEqual(["Room 9", "Room 10"]);
    expect(schedule.slots).toEqual(["1", "3"]);
  });

  it("flashes a collision, then shows its resolution and arbiter", () => {
    const cells = [{ day: 1, room: "A", slot: "10:00" }];
    const s = t2Stream()
      .emit("schedule.placed", "t1-d1", { talk_id: "a", day: 1, room: "A", slot: "10:00", squad: "t1-d1" })
      .emit("collision.detected", "t2-d1", { collision_id: "c1", kind: "room", cells, squads: ["t1-d1", "t2-d1"] });
    let schedule = foldEvents(s.events).schedule;
    const key = cellKey(1, "A", "10:00");
    expect(cellCollision(schedule, key)?.status).toBe("open");
    expect(openCollisions(schedule)).toBe(1);

    s.emit("collision.resolved", "root", { collision_id: "c1", arbiter: "root", rule: "priority", winner: "t1-d1" });
    schedule = foldEvents(s.events).schedule;
    expect(cellCollision(schedule, key)).toMatchObject({ status: "resolved", arbiter: "root", rule: "priority" });
    expect(openCollisions(schedule)).toBe(0);
  });

  it("moves a talk: removal frees the cell only for the same talk", () => {
    const s = t2Stream()
      .emit("schedule.placed", "t1-d1", { talk_id: "a", day: 1, room: "A", slot: "09:00", squad: "t1-d1" })
      .emit("schedule.removed", "t1-d1", { day: 1, room: "A", slot: "09:00", talk_id: "other" });
    expect(foldEvents(s.events).schedule.cells[cellKey(1, "A", "09:00")]).toBeDefined();
    s.emit("schedule.removed", "t1-d1", { day: 1, room: "A", slot: "09:00", talk_id: "a" });
    expect(foldEvents(s.events).schedule.cells[cellKey(1, "A", "09:00")]).toBeUndefined();
  });

  it("shows the checker's violation count", () => {
    const s = t2Stream();
    expect(foldEvents(s.events).schedule.hardViolations).toBeNull();
    s.emit("schedule.checked", "@kernel", { hard_violations: 0, soft_score: 0.91 });
    expect(foldEvents(s.events).schedule).toMatchObject({ hardViolations: 0, softScore: 0.91 });
  });
});

// The shapes the T2 slice logs today (actors/board.py, actors/orchestrator.py).
describe("the T2 schedule grid, from the bookings the runtime logs", () => {
  const corpus = {
    days: [1, 2],
    rooms: [{ id: "main-hall", capacity: 260 }, { id: "room-b", capacity: 120 }],
    slots: [{ index: 0, start: "09:00" }, { index: 1, start: "09:45" }, { index: 2, start: "10:30" }],
  };
  const write = (talk: string, room: string, slot: number, day = 1) => ({
    expected: 0,
    key: `cell:d${day}:s${slot}:${room}`,
    value: { day, room, slot, session: "track-hci/d1", speaker_id: "S15", talk_id: talk },
  });
  const speakerKey = { expected: 0, key: "speaker:S15:d1:s0", value: { day: 1, room: "room-b", slot: 0, talk_id: "T06" } };
  const body = (goal: string, writes: unknown[], attempt = 0) => ({ goal_id: goal, contract_id: "place", attempt, writes });

  function stream(): Stream {
    return new Stream()
      .emit("run.started", "@kernel", { seed: "1", scenario: "swarm", clock: "sim", params: { corpus } })
      .spawn("o0", "orchestrator", null)
      .spawn("o3", "orchestrator", "o0")
      .spawn("o3.3", "orchestrator", "o3")
      .spawn("o2.1", "orchestrator", "o0");
  }

  it("takes its axes from the conference in the run params", () => {
    const { schedule } = foldEvents(stream().events);
    expect(schedule).toMatchObject({ days: ["1", "2"], rooms: ["main-hall", "room-b"], slots: ["0", "1", "2"], fixedAxes: true });
  });

  it("places the cells of a booking once the board answers without conflicts", () => {
    const s = stream();
    s.emit("msg.sent", "o3.3", { to: "board", topic: "book", body: body("track-hci/d1", [write("T06", "room-b", 0), speakerKey, write("T09", "room-b", 1)]) });
    expect(Object.keys(foldEvents(s.events).schedule.cells)).toEqual([]); // asked, not yet booked
    s.emit("msg.sent", "board", { to: "o3.3", topic: "book.result", body: { goal_id: "track-hci/d1", contract_id: "place", attempt: 0, conflicts: [] } });
    const { schedule } = foldEvents(s.events);
    expect(Object.keys(schedule.cells).sort()).toEqual([cellKey(1, "room-b", 0), cellKey(1, "room-b", 1)]);
    expect(schedule.cells[cellKey(1, "room-b", 0)]).toMatchObject({ talkId: "T06", squad: "o3.3", speaker: "S15" });
    expect(schedule.placements).toBe(2);
    expect(schedule.pending).toEqual({});
  });

  it("places nothing for a booking that conflicted, and flashes the collision until its owner re-places", () => {
    const s = stream();
    s.emit("msg.sent", "o2.1", { to: "board", topic: "book", body: body("track-ai/d1", [write("T04", "room-b", 0)]) });
    s.emit("collision.detected", "board", {
      kind: "temporal",
      goal_id: "track-ai/d1",
      holder: "o2.1",
      conflicts: [{ key: "cell:d1:s0:room-b", reason: "leased", holder: "o3.3", version: 1, value: null }],
    });
    s.emit("msg.sent", "board", {
      to: "o2.1",
      topic: "book.result",
      body: { goal_id: "track-ai/d1", contract_id: "place", attempt: 0, conflicts: [{ key: "cell:d1:s0:room-b", reason: "leased" }] },
    });
    let { schedule } = foldEvents(s.events);
    const key = cellKey(1, "room-b", 0);
    expect(schedule.cells).toEqual({});
    expect(cellCollision(schedule, key)).toMatchObject({ status: "open", kind: "temporal", squads: ["o2.1"] });
    expect(openCollisions(schedule)).toBe(1);

    // The owner re-places the goal at the next attempt; the collision resolves and the cell fills.
    s.emit("msg.sent", "o2.1", { to: "board", topic: "book", body: body("track-ai/d1", [write("T04", "room-b", 2)], 1) });
    s.emit("msg.sent", "board", { to: "o2.1", topic: "book.result", body: { goal_id: "track-ai/d1", contract_id: "place", attempt: 1, conflicts: [] } });
    s.emit("collision.resolved", "o2.1", { kind: "temporal", goal_id: "track-ai/d1", resolution: "re-placed after 1 booking conflict(s)" });
    schedule = foldEvents(s.events).schedule;
    expect(cellCollision(schedule, key)).toMatchObject({ status: "resolved", arbiter: "o2.1", rule: "re-placed after 1 booking conflict(s)" });
    expect(openCollisions(schedule)).toBe(0);
    expect(Object.keys(schedule.cells)).toEqual([cellKey(1, "room-b", 2)]);
  });

  it("resolves only the goal that was re-placed", () => {
    const s = stream();
    for (const goal of ["g1", "g2"]) {
      s.emit("collision.detected", "board", { kind: "temporal", goal_id: goal, holder: "o2.1", conflicts: [] });
    }
    s.emit("collision.resolved", "o2.1", { kind: "temporal", goal_id: "g2", resolution: "x" });
    const { schedule } = foldEvents(s.events);
    expect(schedule.collisionOrder.map((id) => schedule.collisions[id].status)).toEqual(["open", "resolved"]);
  });

  it("lets an heir that re-books a dead owner's cells take them over", () => {
    const s = stream();
    const asked = body("track-hci/d1", [write("T06", "room-b", 0)]);
    const answer = { goal_id: "track-hci/d1", contract_id: "place", attempt: 0, conflicts: [] };
    s.emit("msg.sent", "o3.3", { to: "board", topic: "book", body: asked });
    s.emit("msg.sent", "board", { to: "o3.3", topic: "book.result", body: answer });
    s.emit("msg.sent", "o2.1", { to: "board", topic: "book", body: asked });
    s.emit("msg.sent", "board", { to: "o2.1", topic: "book.result", body: answer });
    const { schedule } = foldEvents(s.events);
    expect(schedule.cells[cellKey(1, "room-b", 0)].squad).toBe("o2.1");
  });

  it("reads the final check from task.result", () => {
    const s = stream();
    expect(foldEvents(s.events).schedule.hardViolations).toBeNull();
    s.emit("task.result", "o0", { task: "t2_conference", status: "ok", report: { expected: 48, placed: 48, hard_violations: 0, soft_score: 0.83 } });
    expect(foldEvents(s.events).schedule).toMatchObject({ hardViolations: 0, softScore: 0.83 });
    s.emit("task.result", "o0", { task: "t1", status: "ok", report: { rows: 3 } }); // a task with no schedule says nothing
    expect(foldEvents(s.events).schedule.hardViolations).toBe(0);
  });
});
