import { getViewportForBounds, type Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ACROSS, boundsOf, layoutTree } from "../lib/layout";
import { foldEvents } from "../lib/reducer";
import { loadJsonl } from "../lib/testing";
import { FIT_MAX_ZOOM, FIT_PADDING, frameTree, keepSizes } from "./useTreeMotion";

// The committed final run. Its root, o0, is killed at event 4806 (53.3 s) and its heir takes over at 5261 (58.8 s): in between the dead
// root stays where it fell, with the tree under it, because it still holds the root key.
const events = loadJsonl("demo/final/events.jsonl");
const ROOT_DOWN = 5100;

// The pane of a 1366 px window's run page, and the key in its corner: a line 8 px from the edge and 25 px high.
const PANE = { width: 1332, height: 336, minZoom: 0.2 };
const KEY_REACH = 33;

describe("where the camera puts the tree", () => {
  const view = foldEvents(events.slice(0, ROOT_DOWN));
  const placed = layoutTree(view);
  const area = boundsOf(view, placed)!;

  it("has the dead root alone in the top row until its heir takes over", () => {
    const top = placed.filter((p) => p.y === area.y && !p.fallen);
    expect(top.map((p) => p.id)).toEqual(["o0"]);
  });

  it("keeps every card below the key of the tree, and keeps the margin it always had on the other three sides", () => {
    const { x, y, zoom } = frameTree(area, PANE, false, KEY_REACH);
    for (const p of placed) {
      const card = { left: x + p.x * zoom, top: y + p.y * zoom, right: x + (p.x + p.width) * zoom, bottom: y + (p.y + p.height) * zoom };
      expect(card.top, `${p.id} is under the key`).toBeGreaterThanOrEqual(KEY_REACH);
      expect(card.left).toBeGreaterThanOrEqual(parseFloat(FIT_PADDING) - 1);
      expect(card.right).toBeLessThanOrEqual(PANE.width - parseFloat(FIT_PADDING) + 1);
      expect(card.bottom).toBeLessThanOrEqual(PANE.height - parseFloat(FIT_PADDING) + 1);
    }
  });

  it("costs the tree some of its size, and no more than the key's height", () => {
    const clear = frameTree(area, PANE, false, 0);
    const kept = frameTree(area, PANE, false, KEY_REACH);
    expect(kept.zoom).toBeLessThan(clear.zoom);
    expect(kept.zoom).toBeGreaterThan(clear.zoom * (1 - (KEY_REACH + 6) / PANE.height));
  });

  it("frames the tree as before where there is no key to keep clear of", () => {
    expect(frameTree(area, PANE, false)).toEqual(getViewportForBounds(area, PANE.width, PANE.height, PANE.minZoom, FIT_MAX_ZOOM, FIT_PADDING));
  });

  it("does not look at the key for a tree on its side, which has none", () => {
    const across = layoutTree(view, true);
    const sideways = boundsOf(view, across)!;
    expect(frameTree(sideways, PANE, true, 999)).toEqual(getViewportForBounds(sideways, PANE.width, PANE.height, PANE.minZoom, 1, `${ACROSS.pad}px`));
  });
});

// A press on a card renders the tree (the focus), and a tap makes its mouse-down and mouse-up in one task: if the render left the card
// unmeasured, React Flow hid it until the next frame and the mouse-up landed on the pane. Its size goes back on every node it has measured.
describe("the sizes React Flow measured", () => {
  const node = (id: string, measured?: { width?: number; height?: number }): Node => ({ id, position: { x: 0, y: 0 }, data: {}, ...(measured ? { measured } : {}) });
  const flowOf = (sizes: Record<string, { width?: number; height?: number } | undefined>) => ({
    getInternalNode: (id: string) => (id in sizes ? ({ measured: sizes[id] ?? {} } as ReturnType<Parameters<typeof keepSizes>[0]["getInternalNode"]>) : undefined),
  });

  it("hands each node back with its size, and leaves the node's other fields alone", () => {
    const fresh = [node("o1"), node("o2")];
    const sized = keepSizes(flowOf({ o1: { width: 100, height: 46 }, o2: { width: 84, height: 38 } }), fresh);
    expect(sized.map((n) => n.measured)).toEqual([{ width: 100, height: 46 }, { width: 84, height: 38 }]);
    expect(sized.map(({ measured: _measured, ...rest }) => rest)).toEqual(fresh);
    expect(fresh.every((n) => n.measured === undefined)).toBe(true); // the input is not changed
  });

  it("leaves a node that was not measured yet as it is: it is new, and its first measure is due", () => {
    const fresh = [node("new"), node("half"), node("gone")];
    const sized = keepSizes(flowOf({ new: undefined, half: { width: 100 } }), fresh);
    expect(sized).toBe(fresh);
  });

  it("gives the same array back when every node already has the size, so a quiet tree costs nothing", () => {
    const flow = flowOf({ o1: { width: 100, height: 46 } });
    const once = keepSizes(flow, [node("o1")]);
    expect(keepSizes(flow, once)).toBe(once);
  });

  it("follows a card whose size changed", () => {
    const [moved] = keepSizes(flowOf({ o1: { width: 100, height: 68 } }), [node("o1", { width: 100, height: 46 })]);
    expect(moved.measured).toEqual({ width: 100, height: 68 });
  });
});
