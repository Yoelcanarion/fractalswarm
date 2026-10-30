import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { Pen } from "../tree/paint";
import { READOUT_W, layoutFor, keepApart, textWidth, type LanesLayout } from "./layout";
import { barState, drawnMs, lanesModel, lifeTracks, linearStallMs, spentMicro, stallElapsedMs, timeMap } from "./model";
import { paintLanes, usd, type LanesRig } from "./paint";
import { WorkLanes, captionsFor, summaryFor } from "./WorkLanes";

const data = story.lanes.central;
const model = lanesModel(data);
const map = timeMap(model);
const kf = model.keyframes;

describe("the lanes' model", () => {
  it("puts the brain first and keeps the agents in order, every lane named for what it is", () => {
    expect(model.lanes).toHaveLength(14);
    expect(model.lanes[0]).toMatchObject({ label: "brain", brain: true });
    expect(model.lanes.slice(1).map((l) => l.label)).toEqual(Array.from({ length: 13 }, (_, i) => `a${i + 1}`));
  });

  it("keeps every call, by kind, with the money paid for each kind adding up to the run's cost", () => {
    expect(model.bars).toHaveLength(data.bars.length);
    expect(model.counts).toEqual({ counted: 64, cut: 28, again: 26, other: 0 });
    expect(model.micro.total).toBe(data.costs.totalMicroUsd);
    expect(model.micro.cut + model.micro.again).toBe(data.costs.wastedMicroUsd);
    expect(model.micro.counted + model.micro.cut + model.micro.again + model.micro.other).toBe(model.micro.total);
  });

  it("reads the five crashes, the six agents killed for good, and the time nobody worked", () => {
    expect(model.crashes.map((c) => c.n)).toEqual([1, 2, 3, 4, 5]);
    expect(model.crashes.every((c) => c.restartAtMs > c.atMs)).toBe(true);
    expect(model.kills).toHaveLength(6);
    expect(new Set(model.kills.map((k) => k.atMs))).toEqual(new Set([model.crashes[0]!.atMs]));
    expect(model.stalls.map((s) => [s.startMs, s.endMs])).toEqual(data.stall.spansMs);
    expect(model.stallMs).toBe(data.stall.totalMs);
    // the first five open with a crash, the others are the agents waiting for the coordinator
    expect(model.stalls.map((s) => s.crash)).toEqual([1, 2, 3, 4, 5, null, null, null]);
  });

  it("gives overlapping calls of one lane separate rows, and no two calls of a row overlap", () => {
    expect(model.lanes[0]!.rows).toBeGreaterThan(1);
    expect(model.lanes.slice(1).every((l) => l.rows === 1)).toBe(true);
    const key = (b: { lane: number; row: number }): string => `${b.lane}/${b.row}`;
    const rows = new Map<string, { startMs: number; endMs: number }[]>();
    for (const b of model.bars) rows.set(key(b), [...(rows.get(key(b)) ?? []), b]);
    for (const list of rows.values()) {
      const ordered = [...list].sort((a, b) => a.startMs - b.startMs);
      ordered.slice(1).forEach((b, i) => expect(b.startMs).toBeGreaterThanOrEqual(ordered[i]!.endMs));
    }
  });

  it("draws a call as it goes and tells when it is paid for", () => {
    const bar = { startMs: 1000, endMs: 3000 };
    expect(barState(bar, 999)).toBe("hidden");
    expect(barState(bar, 1000)).toBe("run");
    expect(barState(bar, 3000)).toBe("done");
    expect(drawnMs(bar, 2000)).toBe(1000);
    expect(drawnMs(bar, 9000)).toBe(2000);
    const all = spentMicro(model, model.durationMs);
    expect(all.total).toBeCloseTo(model.micro.total, 3);
    expect(spentMicro(model, 0).total).toBe(0);
    expect(spentMicro(model, 60_000).total).toBeGreaterThan(0);
    expect(stallElapsedMs(model, model.durationMs)).toBe(model.stallMs);
    expect(lifeTracks(model).length).toBe(model.lanes.slice(1).reduce((n, l) => n + l.life.length, 0));
  });
});

describe("the time map", () => {
  it("is a straight, never backwards road from the start of the run to its end", () => {
    expect(map.tAt(0)).toBe(0);
    expect(map.tAt(1)).toBe(model.durationMs);
    let before = -1;
    for (let i = 0; i <= 4000; i++) {
      const t = map.tAt(i / 4000);
      expect(t).toBeGreaterThanOrEqual(before);
      before = t;
    }
    expect(map.knots.every((k, i, all) => i === 0 || (k.p >= all[i - 1]!.p && k.t >= all[i - 1]!.t))).toBe(true);
  });

  it("puts the first crash at the crash mark, the end of the last stall at the restart mark, and stands still until the redone mark", () => {
    expect(map.tAt(kf.crash)).toBe(model.crashes[0]!.atMs);
    const settled = model.stalls[model.stalls.length - 1]!.endMs;
    expect(map.tAt(kf.restart)).toBeCloseTo(settled, 6);
    expect(map.tAt(kf.redone)).toBeCloseTo(settled, 6);
    expect(map.tAt((kf.restart + kf.redone) / 2)).toBeCloseTo(settled, 6);
    expect(map.tAt(kf.filled)).toBe(model.filledMs);
    expect(map.tAt(kf.filled)).toBeLessThan(model.crashes[0]!.atMs);
  });

  it("starts the damage after the restart and shows all of it by the redone mark", () => {
    expect(map.emphasisAt(0)).toBe(0);
    expect(map.emphasisAt(kf.restart)).toBe(0);
    expect(map.emphasisAt(kf.redone)).toBe(1);
    expect(map.emphasisAt(1)).toBe(1);
    expect(map.emphasisAt((kf.restart + kf.redone) / 2)).toBeGreaterThan(0.5);
  });

  it("counts the time nobody worked as a straight line of the progress from the crash to the restart, as the page counts it", () => {
    expect(stallElapsedMs(model, map.tAt(kf.crash))).toBe(0);
    expect(stallElapsedMs(model, map.tAt(kf.restart))).toBe(model.stallMs);
    expect(linearStallMs(model, kf.crash)).toBe(0);
    expect(linearStallMs(model, kf.restart)).toBe(model.stallMs);
    let worst = 0;
    for (let i = 0; i <= 2000; i++) {
      const p = kf.crash + ((kf.restart - kf.crash) * i) / 2000;
      worst = Math.max(worst, Math.abs(stallElapsedMs(model, map.tAt(p)) - linearStallMs(model, p)));
    }
    // the lanes hurry through the work between two crashes, so the page's straight line runs a little ahead there: never by more than this
    expect(worst).toBeLessThan(model.stallMs * 0.04);
  });

  it("gives the long wait the most of the stretch and each crash a stretch of its own", () => {
    const shares = model.stalls.map((s) => {
      const from = map.knots.find((k) => k.t === s.startMs)!;
      const to = map.knots.find((k) => k.t === s.endMs)!;
      return (to.p - from.p) / (kf.restart - kf.crash);
    });
    expect(Math.max(...shares)).toBe(shares[7]);
    expect(shares.slice(0, 5).every((x) => x > 0.03)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.9);
  });
});

describe("the layout", () => {
  const sizes: [number, number, number][] = [
    [820, 780, 180],
    [700, 583, 148],
    [350, 641, 108],
    [1280, 720, 160],
  ];

  const inside = (l: LanesLayout, x: number): boolean => x >= 0 && x <= l.width;

  for (const [width, height, top] of sizes) {
    const layout = layoutFor(model, width, height, top, captionsFor(data));
    const label = `${width}x${height}`;

    it(`${label}: puts the lanes under the counter, inside the box, each tall enough for its bars`, () => {
      expect(layout.yTop).toBeGreaterThanOrEqual(top);
      expect(layout.lanes[0]!.y).toBeCloseTo(layout.yTop, 6);
      const last = layout.lanes[layout.lanes.length - 1]!;
      expect(last.y + last.h).toBeCloseTo(layout.yBottom, 6);
      for (const lane of layout.lanes) expect(lane.barH).toBeLessThanOrEqual(lane.h);
      for (const b of model.bars) {
        const at = layout.barBox(b);
        const lane = layout.lanes[b.lane]!;
        expect(at.y).toBeGreaterThanOrEqual(lane.y - 0.001);
        expect(at.y + at.h).toBeLessThanOrEqual(lane.y + lane.h + 0.001);
        expect(at.x).toBeGreaterThanOrEqual(layout.x0 - 0.001);
        expect(at.x).toBeLessThanOrEqual(layout.x1 + 0.001);
      }
    });

    it(`${label}: keeps the labels apart and inside the box`, () => {
      const spans = layout.stallLabels.map((l) => ({ x: l.x, w: textWidth(l.text) }));
      for (let i = 1; i < spans.length; i++) {
        for (let j = 0; j < i; j++) expect(Math.abs(spans[i]!.x - spans[j]!.x)).toBeGreaterThanOrEqual((spans[i]!.w + spans[j]!.w) / 2);
      }
      for (const s of spans) {
        expect(s.x - s.w / 2).toBeGreaterThanOrEqual(layout.x0 - 1);
        expect(s.x + s.w / 2).toBeLessThanOrEqual(layout.width);
      }
      // the longest wait is always labelled
      expect(layout.stallLabels.some((l) => l.text === `${(model.stalls[7]!.endMs / 1000 - model.stalls[7]!.startMs / 1000).toFixed(1)} s`)).toBe(true);
      const numbered = layout.crashMarks.filter((m) => m.numbered);
      for (let i = 1; i < numbered.length; i++) expect(numbered[i]!.x - numbered[i - 1]!.x).toBeGreaterThan(textWidth("1") + 12);
      expect(layout.crashMarks.every((m) => inside(layout, m.x))).toBe(true);
      expect(layout.ticks.every((t) => inside(layout, t.x))).toBe(true);
    });

    it(`${label}: sets the ledger and the setting inside the width, the setting in the longest form that fits`, () => {
      expect(layout.ledger).toHaveLength(4);
      for (const cell of layout.ledger) expect(cell.x + textWidth("no agent working") + 16 + 8 + textWidth("$0.000")).toBeLessThanOrEqual(layout.width + 40);
      expect(textWidth(layout.caption)).toBeLessThanOrEqual(width - 16);
      expect(layout.captionY).toBeLessThanOrEqual(layout.height + 40);
    });
  }

  it("lets the more important of two labels win and drops the other", () => {
    expect(keepApart([{ x: 10, w: 20 }, { x: 20, w: 20 }, { x: 80, w: 20 }])).toEqual([{ x: 10, w: 20 }, { x: 80, w: 20 }]);
  });

  it("names the setting of the run, with the model, the profile and the seed", () => {
    expect(captionsFor(data)[0]).toBe("In-process supervisor · T2 conference · failure profile C3 · real model · seed 1");
    expect(captionsFor({ ...data, setting: undefined })).toEqual([]);
  });
});

/** An element that only records what is set on it. */
function fake<E extends Element>(log: Map<object, Record<string, string>>): Pen<E> {
  const store: Record<string, string> = {};
  const el = {
    setAttribute: (name: string, value: string) => {
      store[name] = value;
    },
    set textContent(v: string) {
      store["#text"] = v;
    },
  } as unknown as E;
  log.set(el, store);
  return new Pen(el);
}

describe("paintLanes", () => {
  const layout = layoutFor(model, 820, 780, 180, captionsFor(data));
  const log = new Map<object, Record<string, string>>();
  const rig: LanesRig = {
    bars: model.bars.map(() => fake<SVGRectElement>(log)),
    tracks: lifeTracks(model).map(() => fake<SVGLineElement>(log)),
    stalls: model.stalls.map(() => fake<SVGRectElement>(log)),
    crashes: model.crashes.map(() => fake<SVGGElement>(log)),
    kills: model.kills.map(() => ({ cross: fake<SVGPathElement>(log), label: fake<SVGTextElement>(log) })),
    cursor: fake(log),
    counted: fake(log),
    notes: fake(log),
    clock: fake(log),
    readout: fake(log),
    value: { counted: fake(log), cut: fake(log), again: fake(log), idle: fake(log) },
  };
  const at = (pen: Pen<Element> | null | undefined): Record<string, string> => log.get(pen!.el) ?? {};

  it("writes finite numbers for the whole run", () => {
    for (let i = 0; i <= 1200; i++) {
      paintLanes(rig, model, layout, map, i / 1200);
      for (const store of log.values()) {
        for (const [name, value] of Object.entries(store)) expect(value, name).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  it("starts with the lanes empty, nothing struck, and the cost at nothing", () => {
    paintLanes(rig, model, layout, map, 0);
    expect(rig.bars.every((pen) => at(pen)["data-state"] === "hidden" && Number(at(pen)["width"]) === 0)).toBe(true);
    expect(rig.crashes.every((pen) => Number(at(pen)["opacity"]) === 0)).toBe(true);
    expect(at(rig.value.cut)["#text"]).toBe("$0.000");
    expect(at(rig.value.idle)["#text"]).toBe("");
    expect(at(rig.clock)["#text"]).toBe("0.0 s");
  });

  it("strikes the first crash and the six kills when the run reaches it, and cuts off the calls in flight", () => {
    paintLanes(rig, model, layout, map, kf.crash - 0.003);
    expect(Number(at(rig.crashes[0])["opacity"])).toBe(0);
    paintLanes(rig, model, layout, map, kf.crash + 0.004);
    expect(Number(at(rig.crashes[0])["opacity"])).toBeGreaterThan(0.5);
    expect(rig.kills.every((k) => Number(at(k.cross)["opacity"]) > 0.5)).toBe(true);
    const cut = model.bars.filter((b) => b.kind === "cut" && b.endMs === model.crashes[0]!.atMs);
    expect(cut.length).toBeGreaterThan(2);
    for (const b of cut) expect(at(rig.bars[b.index])["data-state"]).toBe("done");
    expect(Number(at(rig.stalls[0])["width"])).toBeGreaterThan(0);
  });

  it("shows the waiting and the damage by the restart mark, and the whole bill at the end", () => {
    paintLanes(rig, model, layout, map, kf.restart);
    expect(at(rig.value.idle)["#text"]).toBe("101.8 s");
    expect(Number(at(rig.notes)["opacity"])).toBe(0);
    paintLanes(rig, model, layout, map, 1);
    expect(at(rig.value.counted)["#text"]).toBe(usd(model.micro.counted));
    expect(at(rig.value.cut)["#text"]).toBe(usd(model.micro.cut));
    expect(at(rig.value.again)["#text"]).toBe(usd(model.micro.again));
    expect(Number(at(rig.notes)["opacity"])).toBe(1);
    expect(Number(at(rig.counted)["opacity"])).toBeCloseTo(0.28, 6);
    expect(Number(at(rig.cursor)["opacity"])).toBe(0);
    expect(at(rig.clock)["#text"]).toBe(`${(model.durationMs / 1000).toFixed(1)} s`);
    expect(Number(at(rig.readout)["opacity"])).toBe(0);
    expect(model.bars.every((_, i) => at(rig.bars[i])["data-state"] === "done")).toBe(true);
    for (const stall of model.stalls) expect(at(rig.stalls[stall.index])["width"]).toBe((((stall.endMs - stall.startMs) * layout.pxPerMs).toFixed(2)));
  });

  it("keeps the time of the run on the cursor, inside the box at both ends, and gone with it", () => {
    const moved = (): number => Number(/translate\(([-\d.]+)/.exec(at(rig.readout)["transform"] ?? "")?.[1]);
    paintLanes(rig, model, layout, map, 0);
    expect(moved()).toBeGreaterThanOrEqual(READOUT_W / 2);
    expect(Number(at(rig.readout)["opacity"])).toBe(1);
    paintLanes(rig, model, layout, map, kf.crash + 0.01);
    expect(moved()).toBeCloseTo(Number(/translate\(([-\d.]+)/.exec(at(rig.cursor)["transform"] ?? "")?.[1]), 1);
    for (let i = 0; i <= 200; i++) {
      paintLanes(rig, model, layout, map, i / 200);
      expect(moved()).toBeGreaterThanOrEqual(READOUT_W / 2);
      expect(moved()).toBeLessThanOrEqual(layout.width - READOUT_W / 2);
    }
  });

  it("is the same picture whichever way it got there", () => {
    paintLanes(rig, model, layout, map, 0.45);
    const forward = new Map([...log].map(([el, store]) => [el, { ...store }]));
    paintLanes(rig, model, layout, map, 1);
    paintLanes(rig, model, layout, map, 0.1);
    paintLanes(rig, model, layout, map, 0.45);
    for (const [el, store] of log) expect(store).toEqual(forward.get(el));
  });
});

describe("WorkLanes markup", () => {
  beforeEach(() => {
    // React warns that useLayoutEffect does nothing on the server; the markup is what is under test.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const html = renderToStaticMarkup(createElement(WorkLanes, { progress: motionValue(0), data, still: true }));

  it("draws every call, crash, kill and period of waiting of the run, and each lane's name", () => {
    expect(html.match(/data-bar="/g)).toHaveLength(data.bars.length);
    expect(html.match(/data-crash="/g)).toHaveLength(model.crashes.length);
    expect(html.match(/data-kill="/g)).toHaveLength(model.kills.length);
    expect(html.match(/data-stall="/g)).toHaveLength(model.stalls.length);
    expect(html.match(/data-lane-label="/g)).toHaveLength(model.lanes.length);
    expect(html).toContain(">brain<");
    expect(html).toContain(">a13<");
  });

  it("has a text alternative from the data, names its setting and its key, and no number that is not a number", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain(summaryFor(model, data).replace(/'/g, "&#x27;"));
    expect(html).toContain("In-process supervisor");
    for (const word of ["counted", "cut off", "paid again", "no agent working"]) expect(html).toContain(`>${word}<`);
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("tells what the run was without calling the waiting a crash's, and without a word the claims do not allow", () => {
    const text = summaryFor(model, data);
    expect(text).toContain("5 times");
    expect(text).toContain("6 agents are killed");
    expect(text).toContain("101.8 s");
    expect(text).not.toMatch(/\b(simpler|cheaper|more reliable|first)\b/i);
  });
});
