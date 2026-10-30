import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { foldEvents } from "../lib/reducer";
import { Stream } from "../lib/testing";
import { GridCell, isFreshPlacement, placementKey, ScheduleGrid } from "./ScheduleGrid";

const grid = { days: [1], rooms: ["A", "B"], slots: ["09:00", "10:00"] };

function conference(): Stream {
  return new Stream()
    .emit("run.started", "@kernel", { seed: "0", scenario: "t2", clock: "sim", params: { grid } })
    .spawn("root", "root", null)
    .spawn("t1", "track", "root")
    .at(1000)
    .emit("schedule.placed", "t1", { talk_id: "talk-1", title: "Fractals", day: 1, room: "A", slot: "09:00", squad: "t1" })
    .emit("schedule.placed", "t1", { talk_id: "talk-2", day: 1, room: "B", slot: "09:00", squad: "t1" });
}

const render = (stream: Stream): string => renderToStaticMarkup(createElement(ScheduleGrid, { view: foldEvents(stream.events) }));
const classesOf = (html: string): string[] => [...html.matchAll(/<td class="([^"]*)"/g)].map((m) => m[1].trim().replace(/\s+/g, " "));

describe("the schedule grid", () => {
  it("shows what was already placed when it first appears, without playing the fill-in", () => {
    const html = render(conference());
    const filled = classesOf(html).filter((c) => c.includes("cell--filled"));
    expect(filled).toHaveLength(2);
    expect(html).not.toContain("cell--new");
    expect(html).toContain("Fractals");
  });

  it("marks only a placement that landed after the last jump as new", () => {
    expect(isFreshPlacement(12, 10)).toBe(true);
    expect(isFreshPlacement(10, 10)).toBe(false);
    expect(isFreshPlacement(3, 10)).toBe(false);
  });

  it("keys a cell by its placement, so a new talk replaces the element and a re-render keeps it", () => {
    const view = foldEvents(conference().events);
    const cell = view.schedule.cells["1|A|09:00"];
    expect(placementKey("09:00", cell)).toBe(placementKey("09:00", { ...cell }));
    expect(placementKey("09:00", cell)).not.toBe(placementKey("09:00", { ...cell, placedSeq: cell.placedSeq + 5 }));
    expect(placementKey("09:00", undefined)).toBe("09:00");
  });

  it("memoizes its cells", () => {
    expect((GridCell as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("shows an open collision on its cell", () => {
    const s = conference()
      .at(2000)
      .emit("collision.detected", "board", { collision_id: "c1", cells: [{ day: 1, room: "A", slot: "09:00" }], squads: ["t1"], kind: "cell" });
    const html = render(s);
    expect(classesOf(html).some((c) => c.includes("cell--collision"))).toBe(true);
    expect(html).toContain("collision</span>");
  });

  it("marks a ruling on the cell with its time, for the CSS fade to read", () => {
    const s = conference()
      .at(2000)
      .emit("collision.detected", "board", { collision_id: "c1", cells: [{ day: 1, room: "A", slot: "09:00" }], squads: ["t1"], kind: "cell" })
      .at(3500)
      .emit("collision.resolved", "arbiter", { collision_id: "c1", arbiter: "arbiter", rule: "earliest wins" });
    const html = render(s);
    expect(classesOf(html).some((c) => c.includes("cell--ruled"))).toBe(true);
    expect(classesOf(html).some((c) => c.includes("cell--collision"))).toBe(false);
    expect(html).toContain("--born:3500");
    expect(html).toContain("--life:4000");
    expect(html).toContain("cell__tag--ruling");
    expect(html).toContain("earliest wins");
  });

  it("says so when a run has no schedule", () => {
    const empty = new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "t", clock: "sim", params: {} });
    expect(render(empty)).toContain("No schedule in this run yet");
    // the jargon in that sentence is defined where it is read
    expect(render(empty)).toContain('<span class="term">T2</span>');
    expect(render(empty)).toContain('role="tooltip"');
  });
});
