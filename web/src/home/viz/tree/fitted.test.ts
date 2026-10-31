// The tree drawn to fill a figure of a given shape (the hero's column is a square): narrower, taller, each epoch down to the row of the dead.

import { describe, expect, it } from "vitest";
import { story } from "../../data/story";
import { treePlayer } from "./frame";
import { fitted, treeModel, type TreeModel } from "./model";

const model = treeModel(story.tree);
const shape = (m: TreeModel): number => (m.bounds.x1 - m.bounds.x0) / (m.bounds.y1 - m.bounds.y0);
const height = (m: TreeModel): number => m.bounds.y1 - m.bounds.y0;
const lowest = (m: TreeModel, i: number): number => Math.max(...Object.values(m.epochs[i]?.pos ?? {}).map((s) => s.y));
/** The places of the nodes of an epoch, in reading order: top to bottom, left to right. */
const order = (m: TreeModel, i: number): string[] => {
  const pos = m.epochs[i]?.pos ?? {};
  const at = (id: string): { x: number; y: number } => pos[id] ?? { x: 0, y: 0 };
  return Object.keys(pos).sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x || a.localeCompare(b));
};
const gaps = (xs: number[]): number[] => [...new Set(xs.map((x) => Math.round(x * 1e6)))].sort((a, b) => a - b).map((x, i, all) => (i === 0 ? Infinity : x - (all[i - 1] as number)) / 1e6);

describe("a tree drawn to fill a figure", () => {
  it("is the shape asked, where the picture of the run is a wider one", () => {
    expect(shape(model)).toBeGreaterThan(1.3);
    for (const aspect of [0.7, 1, 1.12, 1.3]) expect(shape(fitted(model, aspect))).toBeCloseTo(aspect, 6);
  });

  it("keeps the shape of a picture that is already narrower, but for the reach of its epochs", () => {
    const same = fitted(model, 4);
    expect(same.bounds).toEqual(model.bounds);
    expect(same.memorial).toEqual(model.memorial);
  });

  it("does not touch the model it is made from, which the film and the demo draw", () => {
    const before = JSON.stringify([model.epochs, model.memorial, model.bounds]);
    const drawn = fitted(model, 1.12);
    expect(JSON.stringify([model.epochs, model.memorial, model.bounds])).toBe(before);
    expect(drawn).not.toBe(model);
    expect(drawn.epochs[0]?.pos).not.toBe(model.epochs[0]?.pos);
    expect(drawn.node).toBe(model.node);
  });

  it("lays the leaves out narrower, no closer than the narrowest, and makes the picture taller when that is not enough", () => {
    const leaves = (m: TreeModel): number[] => gaps(Object.entries(m.epochs[0]?.pos ?? {}).filter(([id]) => m.node[id]?.kind === "agent").map(([, s]) => s.x));
    const before = Math.min(...leaves(model));
    expect(Math.min(...leaves(fitted(model, 1.12)))).toBeLessThan(before);
    const tall = fitted(model, 0.7);
    expect(Math.min(...leaves(tall))).toBeCloseTo(before * 0.7, 6);
    expect(height(tall)).toBeGreaterThan(height(model));
  });

  it("keeps every node where it was in the order of the rows and of the columns, in each epoch", () => {
    const drawn = fitted(model, 1.12);
    for (let i = 0; i < model.epochs.length; i++) expect(order(drawn, i)).toEqual(order(model, i));
  });

  it("brings each epoch down to the row of the dead, so that no picture hangs above a hole", () => {
    const drawn = fitted(model, 1.12);
    const last = model.epochs.length - 1;
    expect(lowest(model, last)).toBeLessThan(lowest(model, 0));
    for (let i = 0; i <= last; i++) expect(lowest(drawn, i)).toBeCloseTo(lowest(drawn, 0), 9);
    const shelf = Math.max(...Object.values(drawn.memorial).map((s) => s.y));
    expect(shelf).toBeGreaterThan(lowest(drawn, 0));
  });

  it("leaves the dead their own step, which is the width of their stamps", () => {
    const steps = (m: TreeModel): number[] => gaps(Object.values(m.memorial).map((s) => s.x)).slice(1);
    expect(steps(fitted(model, 1.12))).toEqual(steps(model));
    expect(steps(model).length).toBeGreaterThan(0);
  });

  it("draws every node of every frame inside the picture, through the glides of a takeover", () => {
    const player = treePlayer(story.tree, "hero", 1.12);
    const { bounds: b } = player.model;
    for (let i = 0; i <= 40; i++) {
      for (const n of player.frame(i / 40).nodes) {
        expect(n.x).toBeGreaterThanOrEqual(b.x0);
        expect(n.x).toBeLessThanOrEqual(b.x1);
        expect(n.y).toBeGreaterThanOrEqual(b.y0);
        expect(n.y).toBeLessThanOrEqual(b.y1);
      }
    }
  });
});

describe("the player of a tree drawn to a shape", () => {
  const plain = treePlayer(story.tree, "hero");
  const square = treePlayer(story.tree, "hero", 1.12);

  it("is its own player, made once, and leaves the plain one as it was", () => {
    expect(square).not.toBe(plain);
    expect(treePlayer(story.tree, "hero", 1.12)).toBe(square);
    expect(treePlayer(story.tree, "hero")).toBe(plain);
    expect(plain.model).toBe(model);
    expect(shape(square.model)).toBeCloseTo(1.12, 6);
  });

  it("plays the same run in the same time: the timeline reads times, never places", () => {
    expect(square.timeline.totalS).toBe(plain.timeline.totalS);
    expect(square.keyframes.map((k) => [k.id, k.p])).toEqual(plain.keyframes.map((k) => [k.id, k.p]));
  });
});
