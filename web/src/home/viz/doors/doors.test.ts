import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePen, seen, type Log } from "../charts/fakes";
import type { Pen } from "../tree/paint";
import { DoorDrawing, DoorGlyph, paintDoor } from "./DoorGlyph";
import { CANVAS, DOOR_IDS, DOOR_LABELS, GEOM, WIDE_CANVAS, WIDE_FROM, arenaShape, doorFrame, hasWide, isDoor, liveShape, quad } from "./doors";

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
    for (const wide of [false, true]) {
      const live = doorFrame("live", 1, wide);
      const [tx, ty] = liveShape(wide).target;
      expect(live["crosshair"]!.transform).toBe(`translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(1.000)`);
      expect(live["tree-fill"]!.opacity).toBe(1);
      expect(live["stream-0"]!.opacity!).toBeLessThan(1e-9);
    }
  });

  it("closes the clapper and lights every point of the chart by the end, and none at rest", () => {
    const [hx, hy] = GEOM.director.hinge;
    expect(doorFrame("director", 0)["clapper"]!.transform).toBe(`rotate(${GEOM.director.open.toFixed(2)} ${hx} ${hy})`);
    expect(doorFrame("director", 1)["clapper"]!.transform).toBe(`rotate(0.00 ${hx} ${hy})`);
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

const drawing = (id: string, wide: boolean, p = 0): string => renderToStaticMarkup(createElement(DoorDrawing, { id, wide, frame: doorFrame(id, p, wide) }));

describe("the wide drawings of the two doors the page gives two columns", () => {
  it("are the arena's and the live run's, on a canvas of their own that is wider than the shape they are used from", () => {
    expect(DOOR_IDS.filter(hasWide)).toEqual(["arena", "live"]);
    expect(CANVAS.width / CANVAS.height).toBeLessThan(WIDE_FROM);
    expect(WIDE_CANVAS.width / WIDE_CANVAS.height).toBeGreaterThan(WIDE_FROM);
    expect(WIDE_CANVAS.height).toBe(CANVAS.height);
    expect(drawing("arena", true)).toContain(`viewBox="0 0 ${WIDE_CANVAS.width} ${WIDE_CANVAS.height}"`);
    expect(drawing("live", false)).toContain(`viewBox="0 0 ${CANVAS.width} ${CANVAS.height}"`);
  });

  for (const id of ["arena", "live"]) {
    it(`${id}: has the parts of the compact drawing, moved by frames that are complete, finite and smooth`, () => {
      expect([...new Set(partsIn(drawing(id, true)))].sort()).toEqual([...new Set(partsIn(drawing(id, false)))].sort());
      expect(partsIn(drawing(id, true))).toHaveLength(new Set(partsIn(drawing(id, true))).size);
      expect(Object.keys(doorFrame(id, 0, true)).sort()).toEqual(Object.keys(doorFrame(id, 1, true)).sort());
      expect(JSON.stringify(doorFrame(id, 0, true))).not.toBe(JSON.stringify(doorFrame(id, 1, true)));
      let before = doorFrame(id, 0, true);
      for (let i = 1; i <= 400; i++) {
        const now = doorFrame(id, i / 400, true);
        for (const [name, state] of Object.entries(now)) {
          expect(JSON.stringify(state), name).not.toMatch(/NaN|undefined|Infinity/);
          if (state.opacity !== undefined) expect(Math.abs(state.opacity - before[name]!.opacity!), `${name} opacity at ${i}`).toBeLessThan(0.1);
          if (state.transform !== undefined) {
            const a = numbers(before[name]!.transform!);
            numbers(state.transform).forEach((n, k) => expect(Math.abs(n - a[k]!), `${name} transform at ${i}`).toBeLessThan(2.5));
          }
        }
        before = now;
      }
    });
  }

  it("keep the arena's failure where the drawing has its dead coordinator and its dead worker, in both of its sizes", () => {
    for (const wide of [false, true]) {
      const { deadLeft, deadRight, swarm, workers } = arenaShape(wide);
      const end = doorFrame("arena", 1, wide);
      expect(end["x-left"]!.transform).toBe(`translate(${deadLeft[0].toFixed(2)} ${deadLeft[1].toFixed(2)}) scale(1.000)`);
      expect(end["x-right"]!.transform).toBe(`translate(${deadRight[0].toFixed(2)} ${deadRight[1].toFixed(2)}) scale(1.000)`);
      expect(swarm.tracks).toContainEqual(deadLeft);
      expect(workers).toContainEqual(deadRight);
      // the swarm has more coordinators than the one that fails, and the supervisor more workers than the one
      expect(swarm.tracks.length).toBeGreaterThan(1);
      expect(workers.length).toBeGreaterThan(1);
    }
    expect(arenaShape(true).workers.length).toBeGreaterThan(arenaShape(false).workers.length);
    expect(liveShape(true).tree.leaves.length).toBeGreaterThan(liveShape(false).tree.leaves.length);
  });

  it("have the stream follow the whole of the arrow and the crosshair land on the last coordinator", () => {
    for (const wide of [false, true]) {
      const { arrow, flow, target, tree } = liveShape(wide);
      expect(arrow[0] + flow).toBeGreaterThanOrEqual(arrow[1]);
      expect(arrow[0] + flow).toBeLessThan(tree.leaves[0]![0]);
      expect(target).toEqual(tree.tracks[tree.tracks.length - 1]);
    }
  });
});

/** Every number a path's absolute commands say, as the x and y it reaches (the only commands the glyphs use). */
function pathPoints(d: string): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = numbers(args!);
    if (cmd === "M" || cmd === "L") for (let i = 0; i < n.length; i += 2) out.push([(x = n[i]!), (y = n[i + 1]!)]);
    else if (cmd === "Q") for (let i = 0; i < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
    else if (cmd === "H") for (const v of n) out.push([(x = v), y]);
    else if (cmd === "V") for (const v of n) out.push([x, (y = v)]);
    else if (cmd !== "Z") throw new Error(`the path command ${cmd} is not one the glyphs use, so the fit test cannot read it`);
  }
  return out;
}

/** The box the markup's circles, rectangles, lines and paths cover, leaving out the parts that are moved by a transform (their targets are held below). */
function extent(html: string): { x0: number; y0: number; x1: number; y1: number } {
  const still = html.replace(/<g data-part="[^"]*"[^>]*\btransform="[^"]*"[^>]*>[\s\S]*?<\/g>/g, "");
  const attr = (tag: string, name: string): number => Number(new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(tag)?.[1] ?? 0);
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const take = (x: number, y: number): void => {
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  };
  for (const [tag] of still.matchAll(/<circle [^>]*>/g)) {
    const [cx, cy, r] = [attr(tag, "cx"), attr(tag, "cy"), attr(tag, "r")];
    take(cx - r, cy - r);
    take(cx + r, cy + r);
  }
  for (const [tag] of still.matchAll(/<rect [^>]*>/g)) {
    take(attr(tag, "x"), attr(tag, "y"));
    take(attr(tag, "x") + attr(tag, "width"), attr(tag, "y") + attr(tag, "height"));
  }
  for (const [tag] of still.matchAll(/<line [^>]*>/g)) {
    take(attr(tag, "x1"), attr(tag, "y1"));
    take(attr(tag, "x2"), attr(tag, "y2"));
  }
  for (const [, d] of still.matchAll(/<path [^>]*\bd="([^"]*)"/g)) for (const [x, y] of pathPoints(d!)) take(x, y);
  return box;
}

describe("a drawing fits its canvas", () => {
  // two units of air inside the edge for the thickness of a stroke
  const AIR = 2;
  const cases = DOOR_IDS.flatMap((id) => (hasWide(id) ? [[id, false] as const, [id, true] as const] : [[id, false] as const]));

  for (const [id, wide] of cases) {
    it(`${id}${wide ? " (wide)" : ""}: everything that is drawn, and where each moving part ends up, is inside the canvas`, () => {
      const canvas = wide ? WIDE_CANVAS : CANVAS;
      const box = extent(drawing(id, wide));
      expect(box.x0, "left").toBeGreaterThanOrEqual(AIR);
      expect(box.y0, "top").toBeGreaterThanOrEqual(AIR);
      expect(box.x1, "right").toBeLessThanOrEqual(canvas.width - AIR);
      expect(box.y1, "bottom").toBeLessThanOrEqual(canvas.height - AIR);
      // and the parts that move: every translate they reach, a part's reach from its own origin being at most 17 units (the crosshair's arms)
      for (let i = 0; i <= 100; i++) {
        for (const [name, state] of Object.entries(doorFrame(id, i / 100, wide))) {
          if (!state.transform || state.opacity === 0 || name === "clapper") continue;
          const [tx, ty] = numbers(state.transform);
          // a stream dot is drawn at the start of the arrow and moved along it; every other part is moved to where it is
          const stream = name.startsWith("stream-");
          const x = stream ? liveShape(wide).arrow[0] + tx! : tx!;
          const y = stream ? 55 : ty!;
          const reach = name === "crosshair" ? 17 : name.startsWith("check-") ? 7 : name.startsWith("x-") ? 8 : 3;
          if ((state.opacity ?? 1) < 0.5) continue;
          expect(x - reach, `${name} left at ${i}`).toBeGreaterThanOrEqual(0);
          expect(x + reach, `${name} right at ${i}`).toBeLessThanOrEqual(canvas.width);
          if (name !== "scrub") {
            expect(y - reach, `${name} top at ${i}`).toBeGreaterThanOrEqual(0);
            expect(y + reach, `${name} bottom at ${i}`).toBeLessThanOrEqual(canvas.height);
          }
        }
      }
    });
  }

  it("director: the clapper, open or shut or on its way, never leaves the canvas, so the glyph's box is all it needs", () => {
    const [hx, hy] = GEOM.director.hinge;
    const { width, bar } = GEOM.director;
    const corners = [[0, 0], [width, 0], [width, -bar], [0, -bar]] as const;
    let highest = Infinity;
    for (let i = 0; i <= 200; i++) {
      const angle = Number(/rotate\((-?[\d.]+)/.exec(doorFrame("director", i / 200)["clapper"]!.transform!)![1]);
      const t = (angle * Math.PI) / 180;
      for (const [dx, dy] of corners) {
        const x = hx + dx * Math.cos(t) - dy * Math.sin(t);
        const y = hy + dx * Math.sin(t) + dy * Math.cos(t);
        highest = Math.min(highest, y);
        expect(x).toBeGreaterThanOrEqual(AIR);
        expect(x).toBeLessThanOrEqual(CANVAS.width - AIR);
        expect(y).toBeGreaterThanOrEqual(AIR);
        expect(y).toBeLessThanOrEqual(CANVAS.height - AIR);
      }
    }
    // and it opens as far as the canvas allows, so that it is not drawn smaller than it has to be
    expect(highest).toBeLessThan(AIR + 4);
  });
});
