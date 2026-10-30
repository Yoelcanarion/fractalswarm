import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePen, seen, type Log } from "../charts/fakes";
import type { Pen } from "../tree/paint";
import { DoorGlyph, paintDoor } from "./DoorGlyph";
import { DOOR_IDS, DOOR_LABELS, GEOM, doorFrame, isDoor, quad } from "./doors";

const numbers = (text: string): number[] => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

const markup = (id: string, extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(createElement(DoorGlyph, { progress: motionValue(0), data: id, ...extra }));

const partsIn = (html: string): string[] => [...html.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]!);

afterEach(() => vi.restoreAllMocks());

describe("the door glyphs' frames", () => {
  it("are six, the six doors of the page, and nothing is drawn for a door that is not one", () => {
    expect(DOOR_IDS).toEqual(["arena", "live", "replays", "director", "numbers", "ablation"]);
    expect(DOOR_IDS.every(isDoor)).toBe(true);
    expect(isDoor("new-task")).toBe(false);
    expect(doorFrame("new-task", 0.5)).toEqual({});
  });

  for (const id of DOOR_IDS) {
    it(`${id}: a complete picture at rest and another at the end, with finite numbers between`, () => {
      const rest = doorFrame(id, 0);
      const end = doorFrame(id, 1);
      expect(Object.keys(rest).sort()).toEqual(Object.keys(end).sort());
      expect(Object.keys(rest).length).toBeGreaterThan(0);
      expect(JSON.stringify(rest)).not.toBe(JSON.stringify(end));
      for (let i = 0; i <= 200; i++) {
        for (const state of Object.values(doorFrame(id, i / 200))) {
          if (state.opacity !== undefined) {
            expect(Number.isFinite(state.opacity)).toBe(true);
            expect(state.opacity).toBeGreaterThanOrEqual(-1e-12);
            expect(state.opacity).toBeLessThanOrEqual(1 + 1e-12);
          }
          if (state.transform !== undefined) for (const n of numbers(state.transform)) expect(Number.isFinite(n)).toBe(true);
          expect(state.transform ?? "").not.toMatch(/NaN|undefined|Infinity/);
        }
      }
    });

    it(`${id}: moves smoothly, with no jump between one hundredth of the way and the next`, () => {
      let before = doorFrame(id, 0);
      for (let i = 1; i <= 400; i++) {
        const now = doorFrame(id, i / 400);
        for (const [name, state] of Object.entries(now)) {
          const prev = before[name]!;
          if (state.opacity !== undefined) expect(Math.abs(state.opacity - prev.opacity!), `${name} opacity at ${i}`).toBeLessThan(0.1);
          if (state.transform !== undefined) {
            const a = numbers(prev.transform!);
            const b = numbers(state.transform);
            expect(b).toHaveLength(a.length);
            b.forEach((n, k) => expect(Math.abs(n - a[k]!), `${name} transform at ${i}`).toBeLessThan(2.5));
          }
        }
        before = now;
      }
    });

    it(`${id}: the markup has the parts the frames move, and only those`, () => {
      const html = markup(id);
      expect([...new Set(partsIn(html))].sort()).toEqual(Object.keys(doorFrame(id, 0.5)).sort());
      // each part once: a part drawn twice would be moved by the painter once
      expect(partsIn(html)).toHaveLength(new Set(partsIn(html)).size);
    });

    it(`${id}: is described in words that say what the door is for and promise no outcome`, () => {
      const html = markup(id);
      expect(html).toContain(`aria-label="${DOOR_LABELS[id]}"`);
      expect(DOOR_LABELS[id]).not.toMatch(/\b(better|worse|faster|slower|wins?|beats?|survives?|cheaper|simpler|more reliable|first|valid)\b/i);
      expect(html).not.toMatch(/NaN|undefined|Infinity/);
    });
  }

  it("shows the same failure in both systems of the arena at the same moment, and gives neither of them an outcome", () => {
    for (let i = 0; i <= 100; i++) {
      const f = doorFrame("arena", i / 100);
      expect(f["x-left"]!.opacity).toBe(f["x-right"]!.opacity);
      expect(f["dead-left"]!.opacity).toBe(f["dead-right"]!.opacity);
    }
    expect(Object.keys(doorFrame("arena", 1)).sort()).toEqual(["dead-left", "dead-right", "x-left", "x-right"]);
  });

  it("has the parser and Muse reach the same notes at the same pace in the ablation, and shows no result", () => {
    for (let i = 0; i <= 100; i++) {
      const f = doorFrame("ablation", i / 100);
      expect(f["arrow-left"]).toEqual(f["arrow-right"]);
      expect(f["dot-left"]!.opacity).toBe(f["dot-right"]!.opacity);
    }
    const dots = doorFrame("ablation", 0.5);
    expect(dots["dot-left"]!.transform).not.toBe(dots["dot-right"]!.transform);
  });

  it("puts the marks where the drawing has its targets, and the rows of a replay in order", () => {
    const end = doorFrame("replays", 1);
    GEOM.replays.rows.forEach((y, i) => expect(end[`check-${i}`]!.transform).toBe(`translate(${GEOM.replays.checkX.toFixed(2)} ${y.toFixed(2)}) scale(1.000)`));
    const early = doorFrame("replays", 0.3);
    expect(early["check-0"]!.opacity!).toBeGreaterThan(early["check-1"]!.opacity!);
    expect(early["check-1"]!.opacity!).toBeGreaterThanOrEqual(early["check-3"]!.opacity!);
    const live = doorFrame("live", 1);
    expect(live["crosshair"]!.transform).toBe(`translate(${GEOM.live.target[0].toFixed(2)} ${GEOM.live.target[1].toFixed(2)}) scale(1.000)`);
    expect(live["tree-fill"]!.opacity).toBe(1);
    expect(live["stream-0"]!.opacity!).toBeLessThan(1e-9);
  });

  it("closes the clapper and lights every point of the chart by the end, and none at rest", () => {
    expect(doorFrame("director", 0)["clapper"]!.transform).toBe("rotate(-18.00 36 46)");
    expect(doorFrame("director", 1)["clapper"]!.transform).toBe("rotate(0.00 36 46)");
    const rest = doorFrame("numbers", 0);
    const end = doorFrame("numbers", 1);
    GEOM.numbers.marks.forEach((_, j) => expect([rest[`pt-${j}`]!.opacity, end[`pt-${j}`]!.opacity]).toEqual([0, 1]));
    expect([rest["scrub"]!.opacity, end["scrub"]!.opacity]).toEqual([0, 0]);
  });

  it("walks a quadratic curve from its start to its end", () => {
    expect(quad(0, [0, 0], [10, 0], [10, 10])).toEqual([0, 0]);
    expect(quad(1, [0, 0], [10, 0], [10, 10])).toEqual([10, 10]);
    const [x, y] = quad(0.5, [0, 0], [10, 0], [10, 10]);
    expect([x, y]).toEqual([7.5, 2.5]);
  });
});

describe("DoorGlyph markup", () => {
  it("is what the first frame will be: the picture at rest, and the end picture for a visitor who asked for less motion", () => {
    const rest = markup("arena");
    const still = markup("arena", { still: true });
    expect(rest).toContain('data-part="x-left" opacity="0.00"');
    expect(still).toContain('data-part="x-left" opacity="1.00"');
    expect(markup("arena", { still: true, stillAt: 0 })).toContain('data-part="x-left" opacity="0.00"');
  });

  it("draws nothing for a door it does not know, and says only that it is a door", () => {
    const html = markup("new-task");
    expect(html).toContain('aria-label="A door"');
    expect(partsIn(html)).toEqual([]);
  });

  it("keeps its picture to the left of its frame and scales it down, never crops it", () => {
    const html = markup("live");
    expect(html).toContain('viewBox="0 0 220 110"');
    expect(html).toContain('preserveAspectRatio="xMinYMid meet"');
    expect(html).toContain('data-door="live"');
  });

  it("gives each element of a list a key of its own", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const id of DOOR_IDS) markup(id);
    expect(errors.mock.calls.filter((c) => String(c[0]).includes("key"))).toEqual([]);
  });
});

describe("paintDoor", () => {
  it("sets only what a part's state says, and skips a part the markup does not have", () => {
    const log: Log = new Map();
    const pens = new Map<string, Pen<SVGGElement>>([
      ["clapper", fakePen<SVGGElement>(log)],
      ["board-lines", fakePen<SVGGElement>(log)],
    ]);
    paintDoor(pens, doorFrame("director", 0.2));
    expect(Object.keys(seen(log, pens.get("clapper")))).toEqual(["transform"]);
    expect(Object.keys(seen(log, pens.get("board-lines")))).toEqual(["opacity"]);
    expect(() => paintDoor(new Map(), doorFrame("arena", 0.5))).not.toThrow();
  });
});
