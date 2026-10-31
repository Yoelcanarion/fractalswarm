import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACROSS, boundsOf, colorOf, forestOf, layoutTree, LEVEL_GAP, placedWidth, structureKey, type Placed } from "./layout";
import { foldEvents, type ViewState } from "./reducer";
import { depthTwoTree, loadJsonl, REPO_ROOT, Stream } from "./testing";

/** root → t1, t2, t3 → two sessions each → one agent each, with every brain holding the key of its own name. */
const owned = (): Stream => {
  const s = depthTwoTree();
  for (const key of ["root", "t1", "t2", "t3"]) s.emit("ownership.assigned", "root", { key, owner: key });
  return s;
};

const kill = (s: Stream, id: string): Stream => s.emit("chaos.injected", "@env", { kind: "kill_coordinator", target: id }).emit("member.dead", "t3", { member: id });

/** What a death looks like once the survivors have taken everything over: the key moves, then the children. */
const hand = (s: Stream, dead: string, adopter: string, duties: string[] = []): Stream =>
  s
    .emit("ownership.remapped", adopter, { from: dead, to: adopter, keys: [dead], duties })
    .emit("tree.adopted", adopter, { dead, adopter });

const byId = (placed: Placed[], id: string): Placed => placed.find((p) => p.id === id)!;

describe("the tree as it is drawn", () => {
  it("keeps a dead brain where it fell for as long as it still holds something", () => {
    const view = foldEvents(kill(owned(), "t1").events);
    expect(forestOf(view).fallen).toEqual([]);
    const placed = layoutTree(view);
    expect(byId(placed, "t1")).toMatchObject({ depth: 1, parent: "root", fallen: false });
    expect(byId(placed, "t1-d1")).toMatchObject({ depth: 2, parent: "t1" });
  });

  it("moves a dead brain that handed everything over to a row of the fallen under the tree, and hangs its children from its heir", () => {
    const view = foldEvents(hand(kill(owned(), "t1"), "t1", "t2").events);
    expect(forestOf(view).fallen).toEqual(["t1"]);
    const placed = layoutTree(view);
    const deepest = Math.max(...placed.filter((p) => !p.fallen).map((p) => p.depth));
    expect(byId(placed, "t1")).toMatchObject({ depth: deepest + 1, parent: null, fallen: true });
    expect(byId(placed, "t1-d1")).toMatchObject({ depth: 2, parent: "t2" });
    expect(byId(placed, "t1-d1-a")).toMatchObject({ depth: 3, parent: "t1-d1" });
  });

  it("does not make the tree a row deeper for each root that dies: its root is the brain that holds the root duty", () => {
    const view = foldEvents(hand(kill(owned(), "root"), "root", "t2", ["root"]).events);
    const placed = layoutTree(view);
    expect(forestOf(view).fallen).toEqual(["root"]);
    expect(placed.filter((p) => !p.fallen && p.parent === null).map((p) => p.id)).toEqual(["t2"]);
    expect(byId(placed, "t2").depth).toBe(0);
    expect(byId(placed, "t1")).toMatchObject({ depth: 1, parent: "t2" });
    expect(byId(placed, "t3")).toMatchObject({ depth: 1, parent: "t2" });
  });

  it("keeps the dead of a run that logs no ownership where they are: they have nothing to hand over", () => {
    const view = foldEvents(kill(depthTwoTree(), "t1").events);
    expect(forestOf(view).fallen).toEqual([]);
    expect(byId(layoutTree(view), "t1")).toMatchObject({ depth: 1, parent: "root", fallen: false });
  });

  it("never lets a leaf fall: an agent is not a coordinator", () => {
    const view = foldEvents(kill(owned(), "t1-d1-a").events);
    expect(forestOf(view).fallen).toEqual([]);
  });

  it("re-fits the camera when a brain falls, not when one merely dies", () => {
    const standing = foldEvents(owned().events);
    const dead = foldEvents(kill(owned(), "t1").events);
    const fallen = foldEvents(hand(kill(owned(), "t1"), "t1", "t2").events);
    const key = (view: ViewState): string => structureKey(view, layoutTree(view));
    expect(key(dead)).toBe(key(standing));
    expect(key(fallen)).not.toBe(key(dead));
  });

  it("gives a subtree its heir's colour once it is handed over", () => {
    const before = foldEvents(owned().events);
    const after = foldEvents(hand(kill(owned(), "t1"), "t1", "t2").events);
    expect(colorOf(before, "t1-d1")).toBe(colorOf(before, "t1"));
    expect(colorOf(after, "t1-d1")).toBe(colorOf(after, "t2"));
  });
});

describe("the committed final run, at the end", () => {
  const events = loadJsonl("demo/final/events.jsonl");
  const end = foldEvents(events);
  const placed = layoutTree(end);

  it("has five fallen brains in the order they died, under a tree rooted in the brain that holds the root duty", () => {
    expect(forestOf(end).fallen).toEqual(["o0", "o2.1", "o1", "o3.2", "o2"]);
    expect(placed.filter((p) => !p.fallen && p.parent === null).map((p) => p.id)).toEqual(["o3"]);
  });

  it("is three rows tall, and the fallen are a fourth, whatever the dead root chain was", () => {
    expect(Math.max(...placed.filter((p) => !p.fallen).map((p) => p.depth))).toBe(2);
    expect(placed.filter((p) => p.fallen).map((p) => p.depth)).toEqual([3, 3, 3, 3, 3]);
    expect(Math.max(...placed.map((p) => p.y))).toBe(3 * LEVEL_GAP);
  });

  it("puts no card on its neighbour, at the end and halfway", () => {
    for (const view of [end, foldEvents(events.slice(0, 5300)), foldEvents(events.slice(0, 6350))]) {
      const rows = new Map<number, Placed[]>();
      for (const p of layoutTree(view)) rows.set(p.depth, [...(rows.get(p.depth) ?? []), p]);
      for (const row of rows.values()) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        sorted.slice(1).forEach((p, i) => expect(p.x, `${sorted[i].id} and ${p.id}`).toBeGreaterThanOrEqual(sorted[i].x + placedWidth(view, sorted[i])));
      }
    }
  });

  it("lays out the same every time", () => {
    expect(layoutTree(foldEvents(events))).toEqual(placed);
  });
});

describe("the tree on its side, for a phone", () => {
  const events = loadJsonl("demo/final/events.jsonl");
  // the end (three levels and the fallen) and two points in the run with four levels
  const views = [foldEvents(events), foldEvents(events.slice(0, 5300)), foldEvents(events.slice(0, 6350))];
  const PANE = 390 - 2 * 16 - 2; // the pane at 390 px: the page's margins and the pane's own border
  const column = (placed: Placed[], depth: number): Placed[] => placed.filter((p) => p.depth === depth).sort((a, b) => a.y - b.y);

  it("has the same cards, the same hangings and the same fallen as the tree upright: only where they are changes", () => {
    for (const view of views) {
      const key = (placed: Placed[]) => placed.map(({ id, depth, parent, fallen }) => ({ id, depth, parent, fallen }));
      expect(key(layoutTree(view, true))).toEqual(key(layoutTree(view)));
    }
  });

  it("makes the levels columns, left to right, and the fallen the last of them, in the order they died", () => {
    for (const view of views) {
      const placed = layoutTree(view, true);
      const depths = [...new Set(placed.map((p) => p.depth))].sort((a, b) => a - b);
      let right = -Infinity;
      for (const depth of depths) {
        const cards = column(placed, depth);
        // one x for a column, and the columns do not overlap
        expect(new Set(cards.map((p) => p.x)).size, `level ${depth}`).toBe(1);
        expect(cards[0].x, `level ${depth}`).toBeGreaterThanOrEqual(right);
        right = Math.max(...cards.map((p) => p.x + p.width));
      }
      const fallen = placed.filter((p) => p.fallen);
      expect(fallen.map((p) => p.depth)).toEqual(fallen.map(() => depths.at(-1)));
      expect([...fallen].sort((a, b) => a.y - b.y).map((p) => p.id)).toEqual(forestOf(view).fallen);
    }
  });

  it("puts no card on its neighbour in a column", () => {
    for (const view of views) {
      const placed = layoutTree(view, true);
      for (const depth of new Set(placed.map((p) => p.depth))) {
        const cards = column(placed, depth);
        cards.slice(1).forEach((p, i) => expect(p.y, `${cards[i].id} and ${p.id}`).toBeGreaterThanOrEqual(cards[i].y + cards[i].height));
      }
    }
  });

  it("is a box that fits a phone's pane at a scale of one, with the camera's margin, at every point of the run", () => {
    for (const view of views) {
      const bounds = boundsOf(view, layoutTree(view, true))!;
      expect(bounds.width + 2 * ACROSS.pad).toBeLessThanOrEqual(PANE);
    }
  });

  it("is taller than it is wide at the end, which is the point of turning it", () => {
    const bounds = boundsOf(views[0], layoutTree(views[0], true))!;
    expect(bounds.height).toBeGreaterThan(bounds.width);
  });

  it("keeps a brain level with its children, and puts the fallen level with what stands", () => {
    const placed = layoutTree(views[0], true);
    const middle = (cards: Placed[]) => (Math.min(...cards.map((p) => p.y)) + Math.max(...cards.map((p) => p.y + p.height))) / 2;
    const standing = placed.filter((p) => !p.fallen);
    expect(middle(placed.filter((p) => p.fallen))).toBeCloseTo(middle(standing), 6);
    const root = placed.find((p) => !p.fallen && p.parent === null)!;
    const children = standing.filter((p) => p.parent === root.id).sort((a, b) => a.y - b.y);
    const centre = root.y + root.height / 2;
    expect(centre).toBeGreaterThanOrEqual(children[0].y + children[0].height / 2);
    expect(centre).toBeLessThanOrEqual(children.at(-1)!.y + children.at(-1)!.height / 2);
  });

  it("lays out the same every time, and leaves the upright layout as it was", () => {
    expect(layoutTree(views[0], true)).toEqual(layoutTree(foldEvents(events), true));
    expect(layoutTree(views[0], false)).toEqual(layoutTree(views[0]));
  });

  it("has the card widths the style sheet gives a card on its side", () => {
    const css = readFileSync(`${REPO_ROOT}web/src/styles.css`, "utf-8").replace(/\r\n/g, "\n");
    const brain = /\.actor--across \{[^}]*?width: (\d+)px/.exec(css)?.[1];
    const leaf = /\.actor--across\.actor--leaf \{[^}]*?width: (\d+)px/.exec(css)?.[1];
    const fallen = /\.actor--across\.actor--fallen \{[^}]*?width: (\d+)px/.exec(css)?.[1];
    expect([Number(brain), Number(leaf), Number(fallen)]).toEqual([ACROSS.node, ACROSS.leaf, ACROSS.fallen]);
  });
});
