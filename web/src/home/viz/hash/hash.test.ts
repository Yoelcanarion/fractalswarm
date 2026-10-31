import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { HASH_COMPACT_MIN, HASH_FULL_MIN, fitHash } from "./fit";
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

  it("goes at one pace, the playhead's, and can cross only the last of the track, with the end in the same place", () => {
    expect(stripState(0.415).shift).toBeCloseTo(0.5, 6);
    expect(offsetFor(0, 3000, 1000, 500)).toBe(-1500);
    expect(offsetFor(1, 3000, 1000, 500)).toBe(offsetFor(1, 3000, 1000));
    expect(offsetFor(0, 1200, 1000, 500)).toBeCloseTo(0);
    expect(offsetFor(1, 1200, 1000, 500)).toBe(-200);
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

  it("is drawn in full until it is measured, and says which tier it is", () => {
    const html = renderToStaticMarkup(createElement(HashStrip, { progress: motionValue(1), data: story.hashes, still: true }));
    expect(html).toContain('data-tier="full"');
  });
});

describe("the strip in the box the page gives it", () => {
  it("is a line of cards where it has 109 px (a desktop stage) or less, two lines of them from 158 px, and in full from 262 px", () => {
    expect(fitHash(52)).toBe("mini");
    expect(fitHash(82)).toBe("mini");
    expect(fitHash(109)).toBe("mini");
    expect(fitHash(HASH_COMPACT_MIN - 1)).toBe("mini");
    expect(fitHash(HASH_COMPACT_MIN)).toBe("compact");
    expect(fitHash(HASH_FULL_MIN - 1)).toBe("compact");
    expect(fitHash(HASH_FULL_MIN)).toBe("full");
    expect(fitHash(1000)).toBe("full");
  });
});
