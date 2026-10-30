import { describe, expect, it } from "vitest";

import { GAP, MARGIN, tooltipPosition, type Box } from "./tooltipPlacement";

const VIEW = { width: 1000, height: 600 };
const BUBBLE = { width: 200, height: 60 };
const trigger = (left: number, top: number, width = 80, height = 24): Box => ({ left, top, width, height });

describe("tooltipPosition", () => {
  it("opens above and centred by default", () => {
    const spot = tooltipPosition(trigger(400, 300), BUBBLE, "top", VIEW);
    expect(spot).toEqual({ left: 440 - 100, top: 300 - GAP - 60, side: "top" });
  });

  it("opens below, to the left and to the right of the trigger", () => {
    expect(tooltipPosition(trigger(400, 300), BUBBLE, "bottom", VIEW)).toEqual({ left: 340, top: 324 + GAP, side: "bottom" });
    const left = tooltipPosition(trigger(400, 300), BUBBLE, "left", VIEW);
    expect(left).toEqual({ left: 400 - GAP - 200, top: 312 - 30, side: "left" });
    const right = tooltipPosition(trigger(400, 300), BUBBLE, "right", VIEW);
    expect(right).toEqual({ left: 480 + GAP, top: 312 - 30, side: "right" });
  });

  it("lines the right edges up for the -end placements", () => {
    const top = tooltipPosition(trigger(700, 300), BUBBLE, "top-end", VIEW);
    expect(top.left + BUBBLE.width).toBe(780);
    const bottom = tooltipPosition(trigger(700, 300), BUBBLE, "bottom-end", VIEW);
    expect(bottom.left + BUBBLE.width).toBe(780);
    expect(bottom.side).toBe("bottom");
  });

  it("flips to the other side when there is no room and the other side has some", () => {
    expect(tooltipPosition(trigger(400, 20), BUBBLE, "top", VIEW).side).toBe("bottom");
    expect(tooltipPosition(trigger(400, 560), BUBBLE, "bottom", VIEW).side).toBe("top");
    expect(tooltipPosition(trigger(10, 300), BUBBLE, "left", VIEW).side).toBe("right");
    expect(tooltipPosition(trigger(900, 300), BUBBLE, "right", VIEW).side).toBe("left");
  });

  it("stays where it was asked when neither side has room", () => {
    const tall = { width: 200, height: 580 };
    expect(tooltipPosition(trigger(400, 300), tall, "top", VIEW).side).toBe("top");
  });

  it("keeps the bubble inside the window", () => {
    const nearLeft = tooltipPosition(trigger(4, 300, 30), BUBBLE, "top", VIEW);
    expect(nearLeft.left).toBe(MARGIN);
    const nearRight = tooltipPosition(trigger(980, 300, 16), BUBBLE, "top", VIEW);
    expect(nearRight.left + BUBBLE.width).toBe(VIEW.width - MARGIN);
    const flipped = tooltipPosition(trigger(400, 4), BUBBLE, "top", VIEW);
    expect(flipped.top).toBeGreaterThanOrEqual(MARGIN);
  });

  it("puts a bubble wider than the window at the margin rather than off the screen", () => {
    const wide = tooltipPosition(trigger(400, 300), { width: 2000, height: 60 }, "top", VIEW);
    expect(wide.left).toBe(MARGIN);
  });
});
