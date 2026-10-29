import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CHART_DRAW_MS, drawProps, useFirstDraw } from "./chartMotion";
import { fadeLife, litMessages, MESSAGE_LIFE_MS, needsNow, RESOLVED_LIFE_MS } from "./decay";
import { boundsOf, NODE_HEIGHT, nodeWidth, structureKey, layoutTree } from "./layout";
import { formatNumber, prefersReducedMotion, tween } from "./motion";
import { summarizeFrames } from "./perf";
import { emptySchedule, rulingsEnd, type Collision, type ScheduleState } from "./schedule";
import { foldEvents } from "./reducer";
import { depthTwoTree, Stream } from "./testing";

describe("reduced motion", () => {
  it("is off where there is no window (the server, the tests)", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("keeps the fades but runs them a third as long", () => {
    expect(fadeLife(MESSAGE_LIFE_MS, false)).toBe(1200);
    expect(fadeLife(MESSAGE_LIFE_MS, true)).toBe(400);
    expect(fadeLife(RESOLVED_LIFE_MS, true)).toBe(1333);
    expect(fadeLife(1200)).toBe(1200);
  });

  it("lets a message be lit for the shorter life", () => {
    const flashes = [100, 900, 1200].map((ts, seq) => ({ seq, ts, from: "a", to: "b", topic: "t" }));
    expect(litMessages(flashes, 1300).map((m) => m.ts)).toEqual([900, 1200]);
    expect(litMessages(flashes, 1300, fadeLife(MESSAGE_LIFE_MS, true)).map((m) => m.ts)).toEqual([1200]);
  });
});

describe("a clock scope that fades rarely", () => {
  it("writes --now while something fades, and once after the last fade ends", () => {
    const until = 5000;
    expect(needsNow(0, until, null)).toBe(true); // the first write
    expect(needsNow(4000, until, 3900)).toBe(true); // inside a fade
    expect(needsNow(5000, until, 4900)).toBe(true); // the last instant of the fade
    expect(needsNow(5100, until, 4900)).toBe(true); // once beyond it, so what has faded reads 0
    expect(needsNow(5200, until, 5100)).toBe(false); // then it is quiet
    expect(needsNow(9000, until, 5100)).toBe(false);
  });

  it("wakes up when the playhead goes back into a fade, and after a seek past its end", () => {
    expect(needsNow(3000, 5000, 9000)).toBe(true);
    expect(needsNow(60_000, 5000, 3000)).toBe(true);
    expect(needsNow(60_001, 5000, 60_000)).toBe(false);
  });

  it("writes every frame for a scope that always fades, and only once for one with nothing to fade", () => {
    expect(needsNow(10, Infinity, 9)).toBe(true);
    expect(needsNow(10, -Infinity, null)).toBe(true);
    expect(needsNow(11, -Infinity, 10)).toBe(false);
  });
});

describe("when the last ruling mark stops fading", () => {
  const collision = (resolvedTs?: number): Collision => ({
    id: "c",
    cells: [],
    squads: [],
    status: resolvedTs === undefined ? "open" : "resolved",
    detectedSeq: 1,
    resolvedTs,
  });
  const withCollisions = (all: Record<string, Collision>): ScheduleState => ({ ...emptySchedule(), collisions: all, collisionOrder: Object.keys(all) });

  it("is the latest ruling plus its life", () => {
    expect(rulingsEnd(withCollisions({ a: collision(1000), b: collision(9000), c: collision() }), RESOLVED_LIFE_MS)).toBe(9000 + RESOLVED_LIFE_MS);
  });

  it("is -Infinity when nothing was ruled, so the grid's clock stays quiet", () => {
    expect(rulingsEnd(emptySchedule(), RESOLVED_LIFE_MS)).toBe(-Infinity);
    expect(rulingsEnd(withCollisions({ c: collision() }), RESOLVED_LIFE_MS)).toBe(-Infinity);
  });
});

describe("tween and number format", () => {
  it("eases between two values and lands exactly", () => {
    expect(tween(0, 10, 0, 100)).toBe(0);
    expect(tween(0, 10, 100, 100)).toBe(10);
    expect(tween(0, 10, 50, 100)).toBeGreaterThan(5);
    expect(tween(4, 8, 5, 0)).toBe(8);
  });

  it("formats with fixed decimals, and a dash for a number that is not one", () => {
    expect(formatNumber(1234.5, 1)).toBe("1,234.5");
    expect(formatNumber(3)).toBe("3");
    expect(formatNumber(Number.NaN)).toBe("—");
  });
});

describe("the tree's camera", () => {
  const view = foldEvents(depthTwoTree().events);
  const placed = layoutTree(view);

  it("frames every node, and nothing else", () => {
    const bounds = boundsOf(view, placed)!;
    for (const { id, x, y } of placed) {
      expect(x).toBeGreaterThanOrEqual(bounds.x);
      expect(y).toBeGreaterThanOrEqual(bounds.y);
      expect(x + nodeWidth(view.actors[id].kind)).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-9);
      expect(y + NODE_HEIGHT).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-9);
    }
    // The widest node touches each side and the deepest one the bottom.
    expect(Math.min(...placed.map((p) => p.x))).toBe(bounds.x);
    expect(Math.max(...placed.map((p) => p.y)) + NODE_HEIGHT).toBe(bounds.y + bounds.height);
  });

  it("has no bounds for an empty tree", () => {
    expect(boundsOf(view, [])).toBeNull();
  });

  it("changes its structure key when a node arrives, leaves or is adopted, and only then", () => {
    const base = depthTwoTree();
    const key = (s: Stream) => {
      const v = foldEvents(s.events);
      return structureKey(v, layoutTree(v));
    };
    const before = key(base);

    // A node arriving.
    const grown = depthTwoTree().spawn("t1-d1-b", "agent", "t1-d1");
    expect(key(grown)).not.toBe(before);

    // A node being adopted by another parent.
    const adopted = depthTwoTree().at(5000).emit("tree.adopted", "t2", { dead: "t1", adopter: "t2", children: ["t1-d1"], duties: [] });
    expect(key(adopted)).not.toBe(before);

    // A node dying, a call, a message, a status change: the shape is the same, so the camera stays.
    const quiet = depthTwoTree()
      .at(1000)
      .emit("chaos.injected", "@chaos", { fault: "kill", target: "t1-d1-a" })
      .emit("member.dead", "@kernel", { actor_id: "t1-d1-a" })
      .emit("msg.sent", "t1", { to: "t1-d1", topic: "work", body: {} });
    expect(key(quiet)).toBe(before);
  });
});

describe("frame statistics", () => {
  it("summarises a steady 60 fps", () => {
    const report = summarizeFrames(Array.from({ length: 120 }, () => 16.67));
    expect(report.frames).toBe(120);
    expect(report.fps).toBeCloseTo(60, 0);
    expect(report.p50Ms).toBeCloseTo(16.7, 1);
    expect(report.p99Ms).toBeCloseTo(16.7, 1);
    expect(report.over20Ms).toBe(0);
  });

  it("finds the slow frames", () => {
    const deltas = [...Array.from({ length: 95 }, () => 16), 25, 25, 40, 40, 120];
    const report = summarizeFrames(deltas);
    expect(report.frames).toBe(100);
    expect(report.maxMs).toBe(120);
    expect(report.p50Ms).toBe(16);
    expect(report.p95Ms).toBe(16);
    expect(report.p99Ms).toBe(40);
    expect(report.over20Ms).toBe(5);
    expect(report.over34Ms).toBe(3);
  });

  it("says zero for no frames", () => {
    expect(summarizeFrames([])).toMatchObject({ frames: 0, fps: 0, meanMs: 0, p95Ms: 0, maxMs: 0 });
  });
});

describe("first draw of a chart", () => {
  it("animates with a duration and an ease-out while it draws, and not after", () => {
    expect(drawProps(true)).toEqual({ isAnimationActive: true, animationDuration: CHART_DRAW_MS, animationEasing: "ease-out" });
    expect(drawProps(false).isAnimationActive).toBe(false);
  });

  it("starts out drawing (the first render is the first draw)", () => {
    let seen: boolean | null = null;
    function Probe() {
      seen = useFirstDraw().isAnimationActive;
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(seen).toBe(true);
  });
});
