import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { playhead, SECONDS } from "../ease";
import { Pen } from "../tree/paint";
import { BOTTOM_PLAIN, MOMENT_EM, MOMENT_GAP, READOUT_W, layoutFor, keepApart, ledgerColumns, ledgerNeed, momentsLayout, textWidth, type LanesLayout } from "./layout";
import { MOMENT_FADE, barState, drawnMs, lanesModel, lifeTracks, momentOpacity, momentStarts, spentMicro, stallElapsedMs, timeMap } from "./model";
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
  it("crosses the run at one speed, from its start to its end", () => {
    expect(map.tAt(0)).toBe(0);
    expect(map.tAt(1)).toBe(model.durationMs);
    const step = model.durationMs / 4000;
    for (let i = 1; i <= 4000; i++) expect(map.tAt(i / 4000) - map.tAt((i - 1) / 4000)).toBeCloseTo(step, 6);
  });

  it("gives the film no crawl, no burst and no stop, frame by frame through the page's one ease", () => {
    const frames = SECONDS.film * 60;
    const shownAt = (frame: number): number => map.tAt(playhead(frame / 60, SECONDS.film));
    const steps = Array.from({ length: frames }, (_, i) => shownAt(i + 1) - shownAt(i));
    const mean = model.durationMs / frames;
    expect(Math.max(...steps)).toBeLessThanOrEqual(1.6 * mean);
    expect(Math.min(...steps.slice(frames * 0.1, frames * 0.9))).toBeGreaterThan(0.5 * mean);
  });

  it("marks the first crash, the start of the longest wait and the end of the last one, where the run has them", () => {
    const long = model.stalls[7]!;
    expect(Math.max(...model.stalls.map((s) => s.endMs - s.startMs))).toBe(long.endMs - long.startMs);
    expect(map.tAt(kf.crash)).toBeCloseTo(model.crashes[0]!.atMs, 6);
    expect(map.tAt(kf.wait)).toBeCloseTo(long.startMs, 6);
    expect(map.tAt(kf.restart)).toBeCloseTo(long.endMs, 6);
  });

  it("marks a run with no crash by its waits", () => {
    const calm = lanesModel(story.lanes.swarm);
    const [start, end] = story.lanes.swarm.stall.spansMs[0]!;
    expect(calm.crashes).toHaveLength(0);
    expect(calm.keyframes.crash).toBeCloseTo(start / calm.durationMs, 12);
    expect(calm.keyframes.wait).toBeCloseTo(start / calm.durationMs, 12);
    expect(calm.keyframes.restart).toBeCloseTo(end / calm.durationMs, 12);
  });

  it("starts the damage as the last wait ends and shows all of it at the end of the run", () => {
    expect(map.emphasisAt(0)).toBe(0);
    expect(map.emphasisAt(kf.restart)).toBe(0);
    expect(map.emphasisAt((kf.restart + 1) / 2)).toBeCloseTo(0.5, 6);
    expect(map.emphasisAt(1)).toBe(1);
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
      const need = ledgerNeed(new Set(layout.ledger.map((cell) => cell.x)).size);
      layout.ledger.forEach((cell, i) => expect(cell.x + need[i % need.length]!).toBeLessThanOrEqual(layout.width - 8 + 0.001));
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
    moments: [fake<SVGTextElement>(log), fake<SVGTextElement>(log), fake<SVGTextElement>(log)],
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
    paintLanes(rig, model, layout, map, kf.crash + 0.015);
    expect(Number(at(rig.crashes[0])["opacity"])).toBeGreaterThan(0.5);
    expect(rig.kills.every((k) => Number(at(k.cross)["opacity"]) > 0.5)).toBe(true);
    const cut = model.bars.filter((b) => b.kind === "cut" && b.endMs === model.crashes[0]!.atMs);
    expect(cut.length).toBeGreaterThan(2);
    for (const b of cut) expect(at(rig.bars[b.index])["data-state"]).toBe("done");
    expect(Number(at(rig.stalls[0])["width"])).toBeGreaterThan(0);
  });

  it("shows the waiting by the restart mark, and the damage and the whole bill at the end", () => {
    paintLanes(rig, model, layout, map, kf.restart + 1e-9);
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

describe("the key under the lanes", () => {
  it("fits every width from a small phone to a wide screen: no cell clipped by the box, none over its neighbour", () => {
    for (let width = 210; width <= 1700; width += 3) {
      const xs = ledgerColumns(width);
      const need = ledgerNeed(xs.length);
      expect([1, 2, 4], `columns at ${width}`).toContain(xs.length);
      expect(xs[0]!, `first column at ${width}`).toBeGreaterThanOrEqual(8);
      xs.forEach((x, k) => {
        expect(x + need[k]!, `column ${k} at ${width}`).toBeLessThanOrEqual(width - 8 + 0.001);
        if (k > 0) expect(x - (xs[k - 1]! + need[k - 1]!), `gap before column ${k} at ${width}`).toBeGreaterThanOrEqual(11.99);
      });
    }
  });

  it("uses as many columns as fit: four on a screen, two on a phone's width, one below that", () => {
    expect(ledgerColumns(1280)).toHaveLength(4);
    expect(ledgerColumns(640)).toHaveLength(4);
    expect(ledgerColumns(600)).toHaveLength(2);
    expect(ledgerColumns(358)).toHaveLength(2);
    expect(ledgerColumns(340)).toHaveLength(1);
  });

  it("gives the lanes the room the extra rows take, and the setting stays under the key", () => {
    const model = lanesModel(story.lanes.central);
    const narrow = layoutFor(model, 300, 420, 24);
    const wide = layoutFor(model, 1200, 420, 24);
    expect(narrow.ledger[3]!.y).toBeGreaterThan(narrow.ledger[0]!.y);
    expect(narrow.captionY).toBeGreaterThan(narrow.ledger[3]!.y);
    expect(narrow.captionY).toBeLessThanOrEqual(420);
    expect(wide.captionY).toBeLessThanOrEqual(420);
  });
});

describe("the film's captions", () => {
  const TEXTS = ["It crashes.", "The work waits.", "The work is paid for again."];
  const kf = model.keyframes;

  it("begin one after the other: the first to be there as the crash strikes, the second as the longest wait begins, the third as the damage is shown", () => {
    const [a, b, c] = momentStarts(kf) as [number, number, number];
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(a + MOMENT_FADE).toBeCloseTo(kf.crash, 12);
    expect(b).toBe(kf.wait);
    expect(b).toBeGreaterThan(kf.crash);
    expect(c).toBe(kf.restart);
  });

  it("fade in once and stay: nothing at the start, all three at the end, never fainter as the film goes on", () => {
    for (let i = 0; i < 3; i++) {
      expect(momentOpacity(kf, i, 0), `caption ${i} at the start`).toBe(0);
      expect(momentOpacity(kf, i, 1), `caption ${i} at the end`).toBe(1);
      let before = 0;
      for (let k = 0; k <= 1000; k++) {
        const now = momentOpacity(kf, i, k / 1000);
        expect(now, `caption ${i} at ${k / 1000}`).toBeGreaterThanOrEqual(before - 1e-12);
        before = now;
      }
    }
    expect(momentOpacity(kf, 3, 1)).toBe(0);
  });

  it("are all there from the moment the damage is shown, and a later one is never ahead of an earlier one", () => {
    for (let k = 0; k <= 1000; k++) {
      const p = k / 1000;
      for (let i = 0; i < 2; i++) expect(momentOpacity(kf, i, p)).toBeGreaterThanOrEqual(momentOpacity(kf, i + 1, p));
    }
    for (let i = 0; i < 3; i++) expect(momentOpacity(kf, i, kf.restart + MOMENT_FADE)).toBe(1);
  });

  it("are written onto the pens of the captions by paintLanes, and nothing else", () => {
    const log = new Map<object, Record<string, string>>();
    const rig = {
      bars: [],
      tracks: [],
      stalls: [],
      crashes: [],
      kills: [],
      cursor: null,
      counted: null,
      notes: null,
      clock: null,
      readout: null,
      moments: TEXTS.map(() => fake<SVGTextElement>(log)),
      value: { counted: null, cut: null, again: null, idle: null },
    } as LanesRig;
    const lay = layoutFor(model, 820, 460, 0, [], { moments: TEXTS });
    paintLanes(rig, model, lay, map, 0);
    expect(rig.moments.map((pen) => Number(log.get(pen!.el)?.opacity))).toEqual([0, 0, 0]);
    paintLanes(rig, model, lay, map, 1);
    expect(rig.moments.map((pen) => Number(log.get(pen!.el)?.opacity))).toEqual([1, 1, 1]);
  });

  it("are laid out in a row when the box is wide, at 24 px or more, and one under the other when it is not", () => {
    expect(momentsLayout(TEXTS, 1480, 8)).toMatchObject({ row: true, size: 32 });
    expect(momentsLayout(TEXTS, 1000, 8).row).toBe(true);
    expect(momentsLayout(TEXTS, 1000, 8).size).toBeGreaterThanOrEqual(24);
    expect(momentsLayout(TEXTS, 700, 8).row).toBe(false);
    expect(momentsLayout(TEXTS, 292, 8).row).toBe(false);
  });

  it("stay inside the box and apart, at every width from 224 to 1700 px", () => {
    for (let width = 224; width <= 1700; width += 4) {
      const m = momentsLayout(TEXTS, width, 8);
      const right = (i: number): number => m.at[i]!.x + TEXTS[i]!.length * MOMENT_EM * m.size;
      expect(m.size, `size at ${width}`).toBeGreaterThanOrEqual(12);
      expect(m.size, `size at ${width}`).toBeLessThanOrEqual(32);
      for (let i = 0; i < TEXTS.length; i++) {
        expect(m.at[i]!.x, `left of ${i} at ${width}`).toBeGreaterThanOrEqual(8);
        expect(right(i), `right of ${i} at ${width}`).toBeLessThanOrEqual(width - 8 + 0.001);
        expect(m.at[i]!.y, `baseline of ${i} at ${width}`).toBeLessThan(m.height);
        if (i > 0 && m.row) expect(m.at[i]!.x - right(i - 1), `gap before ${i} at ${width}`).toBeGreaterThanOrEqual(MOMENT_GAP - 0.001);
        if (i > 0 && !m.row) expect(m.at[i]!.y - m.at[i - 1]!.y, `step before ${i} at ${width}`).toBe(m.lead);
      }
    }
  });

  it("leave the lanes below their band, the key of two inside the box, no names and no setting, in the film's two heights and at any width", () => {
    for (const height of [400, 460]) {
      for (let width = 224; width <= 1700; width += 12) {
        const lay = layoutFor(model, width, height, 0, ["a setting"], { moments: TEXTS });
        const where = `${width} x ${height}`;
        expect(lay.moments, where).not.toBeNull();
        expect(lay.caption, where).toBe("");
        expect(lay.x0, where).toBe(8);
        expect(lay.crashMarks.length, where).toBe(model.crashes.length);
        expect(lay.yTop, where).toBeGreaterThanOrEqual(lay.moments!.height + 20);
        expect(lay.ledger, where).toHaveLength(2);
        const columns = new Set(lay.ledger.map((cell) => cell.x)).size;
        const need = ledgerNeed(columns, [16 + 7 * 7.2 + 8 + 6 * 7.2, 16 + 10 * 7.2 + 8 + 6 * 7.2]);
        lay.ledger.forEach((cell, i) => expect(cell.x + need[i % need.length]!, `key cell ${i} at ${where}`).toBeLessThanOrEqual(width - 8 + 0.001));
        if (columns === 2) expect(lay.ledger[1]!.x - lay.ledger[0]!.x, `the two cells of the key stand together at ${where}`).toBeLessThan(200);
        const lowest = Math.max(...lay.ledger.map((cell) => cell.y));
        expect(lowest + 10, `the key's bottom at ${where}`).toBeLessThanOrEqual(height);
        expect(lay.yBottom - lay.yTop, `the lanes' height at ${where}`).toBeGreaterThanOrEqual(model.lanes.length * 12);
      }
    }
    expect(BOTTOM_PLAIN).toBeLessThan(126);
  });
});
