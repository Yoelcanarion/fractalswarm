// Copies one moment of the run onto the lanes' SVG. The only place the lanes touch the DOM per frame:
// every write goes through a Pen, which skips attributes whose value has not changed, so a frame
// in which little moves costs a few string comparisons.

import { fx, smoothstep } from "../shared";
import { Pen } from "../tree/paint";
import type { LanesLayout } from "./layout";
import { barState, drawnMs, lifeTracks, spentMicro, stallElapsedMs, type LanesModel, type TimeMap } from "./model";

/** No call is drawn thinner than this, so that a call of a few milliseconds is still there. */
export const MIN_BAR = 1.5;
/** How long a crash or a kill takes to strike, in ms of the run. */
const STRIKE_MS = 350;
/** How far the calls that counted fade back once the damage is shown (the share of their opacity lost). */
export const DIM = 0.72;

export const usd = (micro: number): string => `$${(micro / 1e6).toFixed(3)}`;
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export interface LanesRig {
  bars: (Pen<SVGRectElement> | null)[];
  tracks: (Pen<SVGLineElement> | null)[];
  stalls: (Pen<SVGRectElement> | null)[];
  crashes: (Pen<SVGGElement> | null)[];
  kills: { cross: Pen<SVGPathElement> | null; label: Pen<SVGTextElement> | null }[];
  cursor: Pen<SVGLineElement> | null;
  counted: Pen<SVGGElement> | null;
  notes: Pen<SVGGElement> | null;
  clock: Pen<SVGTextElement> | null;
  value: Record<"counted" | "cut" | "again" | "idle", Pen<SVGTextElement> | null>;
}

/** The pens of the elements marked ``attr`` = 0, 1, 2 ... ``count``: null where the markup has none. */
const pens = <E extends Element>(svg: Element, selector: string, count: number, attr: string): (Pen<E> | null)[] => {
  const found = new Map<string, E>();
  for (const el of svg.querySelectorAll<E>(selector)) found.set(el.getAttribute(attr) ?? "", el);
  return Array.from({ length: count }, (_, i) => {
    const el = found.get(String(i));
    return el ? new Pen(el) : null;
  });
};

const one = <E extends Element>(svg: Element, selector: string): Pen<E> | null => {
  const el = svg.querySelector<E>(selector);
  return el ? new Pen(el) : null;
};

/** Finds the parts of the markup WorkLanes renders; run once after each render of a new layout. */
export function collectLanes(svg: SVGSVGElement, model: LanesModel): LanesRig {
  const kills = model.kills.map((k) => ({
    cross: one<SVGPathElement>(svg, `[data-kill="${k.lane}"]`),
    label: one<SVGTextElement>(svg, `[data-lane-label="${k.lane}"]`),
  }));
  const crashes = model.crashes.map((c) => one<SVGGElement>(svg, `[data-crash="${c.n}"]`));
  return {
    bars: pens<SVGRectElement>(svg, "[data-bar]", model.bars.length, "data-bar"),
    tracks: pens<SVGLineElement>(svg, "[data-track]", lifeTracks(model).length, "data-track"),
    stalls: pens<SVGRectElement>(svg, "[data-stall]", model.stalls.length, "data-stall"),
    crashes,
    kills,
    cursor: one(svg, ".hv-ln-cursor"),
    counted: one(svg, '[data-group="counted"]'),
    notes: one(svg, '[data-group="notes"]'),
    clock: one(svg, ".hv-ln-clock"),
    value: {
      counted: one(svg, '[data-value="counted"]'),
      cut: one(svg, '[data-value="cut"]'),
      again: one(svg, '[data-value="again"]'),
      idle: one(svg, '[data-value="idle"]'),
    },
  };
}

export function paintLanes(rig: LanesRig, model: LanesModel, layout: LanesLayout, map: TimeMap, p: number): void {
  const t = map.tAt(p);
  const e = map.emphasisAt(p);
  const px = layout.pxPerMs;

  model.bars.forEach((bar, i) => {
    const pen = rig.bars[i];
    if (!pen) return;
    const state = barState(bar, t);
    pen.set("data-state", state);
    pen.set("width", state === "hidden" ? 0 : Math.max(MIN_BAR, drawnMs(bar, t) * px));
  });

  lifeTracks(model).forEach((track, i) => {
    rig.tracks[i]?.set("x2", layout.xAt(Math.min(Math.max(t, track.startMs), track.endMs)));
  });

  model.stalls.forEach((stall, i) => {
    rig.stalls[i]?.set("width", Math.max(0, Math.min(t, stall.endMs) - stall.startMs) * px);
  });

  model.crashes.forEach((crash, i) => rig.crashes[i]?.set("opacity", smoothstep((t - crash.atMs) / STRIKE_MS)));
  model.kills.forEach((kill, i) => {
    const k = smoothstep((t - kill.atMs) / STRIKE_MS);
    rig.kills[i]?.cross?.set("opacity", k);
    rig.kills[i]?.label?.set("opacity", 1 - 0.55 * k);
  });

  rig.cursor?.set("transform", `translate(${fx(layout.xAt(t))} 0)`);
  rig.cursor?.set("opacity", 1 - e);
  rig.counted?.set("opacity", 1 - DIM * e);
  rig.notes?.set("opacity", e);
  rig.clock?.text((t / 1000).toFixed(1));

  const spent = spentMicro(model, t);
  rig.value.counted?.text(usd(spent.counted + spent.other));
  rig.value.cut?.text(usd(spent.cut));
  rig.value.again?.text(usd(spent.again));
  // The seconds nobody worked are told only once the run has passed the last of them, when the page's own count has reached them too.
  const last = model.stalls[model.stalls.length - 1];
  rig.value.idle?.text(last && t >= last.endMs ? seconds(stallElapsedMs(model, t)) : "");
}
