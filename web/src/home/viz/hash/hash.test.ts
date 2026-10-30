import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { HashStrip } from "./HashStrip";
import { offsetFor, shortHash, stripItems, stripState } from "./state";

describe("the hash strip", () => {
  const items = stripItems(story.hashes);
  const events = items.flatMap((i) => (i.type === "event" ? [i] : []));

  it("lists the sampled events in log order, with a gap wherever it skips some", () => {
    expect(events.map((e) => e.seq)).toEqual(story.hashes.events.map((e) => e[0]));
    const skipped = items.flatMap((i) => (i.type === "gap" ? [i.skipped] : []));
    expect(skipped).toEqual(story.hashes.gaps.map((g) => g.skipped));
  });

  it("points each directly following event at the hash of the one before", () => {
    items.forEach((item, i) => {
      const before = items[i - 1];
      if (item.type === "event" && item.linked) {
        expect(before?.type).toBe("event");
        if (before?.type === "event") expect(item.prev).toBe(before.hash);
      }
    });
    expect(events.filter((e) => e.linked).length).toBeGreaterThan(30);
  });

  it("ends on the run's head hash", () => {
    expect(events[events.length - 1]?.hash).toBe(story.hashes.head);
    expect(story.hashes.head).toBe(story.sources["bundle"]?.head);
  });

  it("moves along the log, rests on the end, and then stamps", () => {
    expect(stripState(0)).toEqual({ shift: 0, stamp: 0 });
    expect(stripState(1)).toEqual({ shift: 1, stamp: 1 });
    expect(stripState(0.8).shift).toBe(1);
    expect(stripState(0.8).stamp).toBe(0);
    expect(offsetFor(0, 3000, 1000)).toBeCloseTo(0);
    expect(offsetFor(1, 3000, 1000)).toBe(-2000);
    expect(offsetFor(1, 800, 1000)).toBeCloseTo(0);
    expect(shortHash("58ab5fbfa3459277554acc7d3b280293")).toBe("58ab5fbfa3…");
  });
});

describe("HashStrip markup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("draws every sampled event, its marks, the head and the verdict of the replay", () => {
    const html = renderToStaticMarkup(createElement(HashStrip, { progress: motionValue(0), data: story.hashes, still: true }));
    expect(html.match(/<article/g)).toHaveLength(story.hashes.events.length);
    for (const mark of Object.values(story.hashes.marks)) expect(html).toContain(mark.label);
    expect(html).toContain(story.hashes.head);
    expect(html).toContain("MATCH");
    expect(html).not.toMatch(/NaN|undefined/);
  });
});
