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
