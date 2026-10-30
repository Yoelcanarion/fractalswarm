import { describe, expect, it } from "vitest";

import { colorOf, forestOf, layoutTree, LEVEL_GAP, placedWidth, structureKey, type Placed } from "./layout";
import { foldEvents, type ViewState } from "./reducer";
import { depthTwoTree, loadJsonl, Stream } from "./testing";

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
