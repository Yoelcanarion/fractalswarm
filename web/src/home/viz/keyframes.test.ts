import { describe, expect, it } from "vitest";
import { story } from "../data/story";
import { TREE_HERO_KEYFRAMES, TREE_HERO_SECONDS, TREE_KEYFRAMES, TREE_MOMENTS, TREE_STORY_SECONDS } from "./keyframes";
import { treePlayer } from "./tree/frame";

// The names the page's steps use (web/src/home/chapters/Solution.tsx), in the order they happen.
const NAMES = ["grown", "log", "kill1", "verdict1", "heir1", "adopt1", "kill5", "settled"] as const;

describe("the tree's moments under the page's names", () => {
  for (const [label, frames] of [
    ["story", TREE_KEYFRAMES],
    ["hero", TREE_HERO_KEYFRAMES],
  ] as const) {
    it(`${label}: every moment exists, inside 0..1, in order`, () => {
      const values = NAMES.map((name) => frames[name]);
      expect(values.every((v) => typeof v === "number" && v >= 0 && v <= 1)).toBe(true);
      for (let i = 1; i < values.length; i++) expect(values[i]!, `${NAMES[i]} after ${NAMES[i - 1]}`).toBeGreaterThanOrEqual(values[i - 1]!);
      expect(frames["settled"]).toBe(1);
      expect(frames["verdict1"]!).toBeLessThan(frames["heir1"]!);
      expect(frames["heir1"]!).toBeLessThan(frames["adopt1"]!);
      expect(frames["kill1"]!).toBeLessThan(frames["verdict1"]!);
    });
  }

  it("puts the verdict of the first kill at the start of the first takeover's hold, and the heir inside it", () => {
    const player = treePlayer(story.tree, "story");
    const first = player.model.groups[0]!;
    expect(TREE_KEYFRAMES["verdict1"]).toBeCloseTo(player.timeline.pOf(first.atMs, "start"), 9);
    expect(TREE_KEYFRAMES["adopt1"]!).toBeLessThanOrEqual(player.timeline.pOf(first.atMs, "end"));
    // the page lets the survivors' panels run from the verdict to the heir: the run clock is frozen there
    const at = (p: number): number => player.timeline.at(p).tMs;
    expect(at(TREE_KEYFRAMES["heir1"]!)).toBe(first.atMs);
    expect(at(TREE_KEYFRAMES["kill1"]!)).toBe(story.tree.kills[0]!.atMs);
    expect(at(TREE_KEYFRAMES["kill5"]!)).toBe(story.tree.kills[4]!.atMs);
  });

  it("lasts about nine seconds in the hero and long enough to read in the story", () => {
    expect(TREE_HERO_SECONDS).toBeGreaterThan(7);
    expect(TREE_HERO_SECONDS).toBeLessThan(12);
    expect(TREE_STORY_SECONDS).toBeGreaterThan(TREE_HERO_SECONDS * 3);
    expect(TREE_MOMENTS.length).toBeGreaterThan(20);
  });
});
