import { getViewportForBounds } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ACROSS, boundsOf, layoutTree } from "../lib/layout";
import { foldEvents } from "../lib/reducer";
import { loadJsonl } from "../lib/testing";
import { FIT_MAX_ZOOM, FIT_PADDING, frameTree } from "./useTreeMotion";

// The committed final run. Its root, o0, is killed at event 4806 (53.3 s) and its heir takes over at 5261 (58.8 s): in between there is
// no root, and the three tracks' brains stand side by side in the top row.
const events = loadJsonl("demo/final/events.jsonl");
const ROOTLESS = 5100;

// The pane of a 1366 px window's run page, and the key in its corner: a line 8 px from the edge and 25 px high.
const PANE = { width: 1332, height: 336, minZoom: 0.2 };
const KEY_REACH = 33;

describe("where the camera puts the tree", () => {
  const view = foldEvents(events.slice(0, ROOTLESS));
  const placed = layoutTree(view);
  const area = boundsOf(view, placed)!;

  it("has three brains in the top row while the run has no root: the situation the key used to cover", () => {
    const top = placed.filter((p) => p.y === area.y && !p.fallen);
    expect(top.map((p) => p.id)).toEqual(["o1", "o2", "o3"]);
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
