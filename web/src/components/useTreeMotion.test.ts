import { getViewportForBounds, type Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ACROSS, boundsOf, layoutTree, type Bounds, type Placed } from "../lib/layout";
import { foldEvents } from "../lib/reducer";
import { loadJsonl } from "../lib/testing";
import { FIT_MAX_ZOOM, FIT_PADDING, frameTree, keepSizes } from "./useTreeMotion";

// The committed final run. Its root, o0, is killed at event 4806 (53.3 s) and its heir takes over at 5261 (58.8 s): in between the dead
// root stays where it fell, with the tree under it, because it still holds the root key. The takeover is logged in two steps, the heir taking
// the key and then the adoptions of the dead root's children, and for the moment between them three brains stand side by side in the top row.
const events = loadJsonl("demo/final/events.jsonl");
const ROOT_DOWN = 5100;
const BETWEEN = 5260; // the first 5260 events: the heir has the key, and its brothers have not been adopted yet
const EARLY = 60; // thirteen cards, the tree still growing: the root alone in the top row, and the tree as tall as a pane of 336 px allows

// The pane of a 1366 px window's run page, and the key in its corner (measured on the page): 8 px from the edge, 533 wide and 23 high. A window
// of 1024 px has a pane of 990, which the key reaches past the middle of.
const PANE = { width: 1332, height: 336, minZoom: 0.2 };
const NARROW = { width: 990, height: 336, minZoom: 0.2 };
const KEY = { left: 8, right: 541, bottom: 31 };
const KEY_GAP = 6; // what the camera keeps clear round the key

const cardsOf = (placed: Placed[]): Bounds[] => placed.map(({ x, y, width, height }) => ({ x, y, width, height }));
const plainFrame = (area: Bounds, pane: typeof PANE) => getViewportForBounds(area, pane.width, pane.height, pane.minZoom, FIT_MAX_ZOOM, FIT_PADDING);
// where a card is on the pane when the camera frames the tree as `view` says
const drawn = (p: Placed, view: { x: number; y: number; zoom: number }) => ({
  left: view.x + p.x * view.zoom,
  top: view.y + p.y * view.zoom,
  right: view.x + (p.x + p.width) * view.zoom,
  bottom: view.y + (p.y + p.height) * view.zoom,
});
const underKey = (p: Placed, view: { x: number; y: number; zoom: number }): boolean => {
  const card = drawn(p, view);
  return card.top < KEY.bottom + KEY_GAP && card.left < KEY.right + KEY_GAP && card.right > KEY.left;
};

describe("where the camera puts the tree", () => {
  const rootDown = foldEvents(events.slice(0, ROOT_DOWN));
  const rootPlaced = layoutTree(rootDown);
  const rootArea = boundsOf(rootDown, rootPlaced)!;
  const between = foldEvents(events.slice(0, BETWEEN));
  const betweenPlaced = layoutTree(between);
  const betweenArea = boundsOf(between, betweenPlaced)!;
  const early = foldEvents(events.slice(0, EARLY));
  const earlyPlaced = layoutTree(early);
  const earlyArea = boundsOf(early, earlyPlaced)!;

  it("has the dead root alone in the top row until its heir takes over", () => {
    const top = rootPlaced.filter((p) => p.y === rootArea.y && !p.fallen);
    expect(top.map((p) => p.id)).toEqual(["o0"]);
  });

  it("has three brains side by side in the top row for the moment between the takeover and the adoptions", () => {
    const top = betweenPlaced.filter((p) => p.y === betweenArea.y && !p.fallen);
    expect(top.map((p) => p.id)).toEqual(["o1", "o2", "o3"]);
  });

  it("frames the tree as large as the pane allows where no card is under the key: the root over the middle of a laptop's pane", () => {
    expect(rootPlaced.some((p) => underKey(p, plainFrame(rootArea, PANE)))).toBe(false);
    expect(frameTree(rootArea, PANE, false, KEY, cardsOf(rootPlaced))).toEqual(plainFrame(rootArea, PANE));
  });

  it("keeps every card below the key where one would be under it, and keeps the margin it always had on the other three sides", () => {
    expect(betweenPlaced.some((p) => underKey(p, plainFrame(betweenArea, PANE)))).toBe(true);
    const view = frameTree(betweenArea, PANE, false, KEY, cardsOf(betweenPlaced));
    for (const p of betweenPlaced) {
      const card = drawn(p, view);
      expect(card.top, `${p.id} is under the key`).toBeGreaterThanOrEqual(KEY.bottom);
      expect(card.left).toBeGreaterThanOrEqual(parseFloat(FIT_PADDING) - 1);
      expect(card.right).toBeLessThanOrEqual(PANE.width - parseFloat(FIT_PADDING) + 1);
      expect(card.bottom).toBeLessThanOrEqual(PANE.height - parseFloat(FIT_PADDING) + 1);
    }
  });

  it("keeps the root clear of the key in a pane narrower than the key and the card side by side, which a window of 1024 px is", () => {
    expect(earlyPlaced.filter((p) => p.y === earlyArea.y).map((p) => p.id)).toEqual(["o0"]);
    // over the middle of a pane of 990 px the card starts under the key, which reaches to 541 px; over the middle of 1332 px it does not
    expect(earlyPlaced.some((p) => underKey(p, plainFrame(earlyArea, NARROW)))).toBe(true);
    expect(earlyPlaced.some((p) => underKey(p, plainFrame(earlyArea, PANE)))).toBe(false);
    const view = frameTree(earlyArea, NARROW, false, KEY, cardsOf(earlyPlaced));
    for (const p of earlyPlaced) expect(drawn(p, view).top, `${p.id} is under the key`).toBeGreaterThanOrEqual(KEY.bottom);
  });

  it("does not need the key's room once the tree is wider than the pane lets it be tall: it is centred, with room above it", () => {
    // the whole tree in a pane of 990 px is limited by its width, so it sits lower than the key reaches
    expect(rootPlaced.some((p) => underKey(p, plainFrame(rootArea, NARROW)))).toBe(false);
    expect(frameTree(rootArea, NARROW, false, KEY, cardsOf(rootPlaced))).toEqual(plainFrame(rootArea, NARROW));
  });

  it("costs the tree some of its size where it keeps clear, and no more than the key's height", () => {
    const clear = plainFrame(betweenArea, PANE);
    const kept = frameTree(betweenArea, PANE, false, KEY, cardsOf(betweenPlaced));
    expect(kept.zoom).toBeLessThan(clear.zoom);
    expect(kept.zoom).toBeGreaterThan(clear.zoom * (1 - (KEY.bottom + KEY_GAP) / PANE.height));
  });

  it("frames the tree as before where there is no key to keep clear of", () => {
    expect(frameTree(betweenArea, PANE, false)).toEqual(plainFrame(betweenArea, PANE));
    expect(frameTree(betweenArea, PANE, false, null, cardsOf(betweenPlaced))).toEqual(plainFrame(betweenArea, PANE));
  });

  it("does not look at the key for a tree on its side, which has none", () => {
    const across = layoutTree(rootDown, true);
    const sideways = boundsOf(rootDown, across)!;
    expect(frameTree(sideways, PANE, true, { left: 0, right: 999, bottom: 999 }, cardsOf(across))).toEqual(
      getViewportForBounds(sideways, PANE.width, PANE.height, PANE.minZoom, 1, `${ACROSS.pad}px`),
    );
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
