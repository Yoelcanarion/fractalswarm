// The small maths the charts share: scales, tick marks, number formats, and the placement of labels
// that would otherwise sit on top of each other. Everything here is pure, so a chart's geometry can
// be tested without a browser.

/** The width of one character of the 12 px monospace the charts' numbers and labels are set in. */
export const CHAR_W = 7.2;

/** The width of a text in the chart's 12 px monospace (every glyph has the same advance). */
export const textWidth = (text: string, size = 12): number => text.length * 0.6 * size;

export interface Scale {
  (v: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

/** A straight line from a domain to a range. A flat domain maps everything to the middle of the range. */
export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const mid = (r0 + r1) / 2;
  const scale = (v: number): number => (d1 === d0 ? mid : r0 + (v - d0) * k);
  return Object.assign(scale, { domain: [d0, d1] as const, range: [r0, r1] as const });
}

export interface Ticks {
  /** The domain widened to whole steps, so the first and the last tick are its ends. */
  min: number;
  max: number;
  step: number;
  values: number[];
}

/** Ticks on 1, 2 or 5 times a power of ten, covering lo..hi with about `count` steps. */
export function niceTicks(lo: number, hi: number, count = 5): Ticks {
  if (!(hi > lo)) {
    const at = Number.isFinite(lo) ? lo : 0;
    return { min: at, max: at + 1, step: 1, values: [at, at + 1] };
  }
  const rough = (hi - lo) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const values: number[] = [];
  for (let i = 0, n = Math.round((max - min) / step); i <= n; i++) values.push(Number((min + i * step).toFixed(10)));
  return { min: Number(min.toFixed(10)), max: Number(max.toFixed(10)), step, values };
}

/** A number with a real minus sign, and never "-0". */
export function signed(n: number, places: number): string {
  const text = Math.abs(n).toFixed(places);
  if (n < 0 && Number(text) !== 0) return `−${text}`;
  return text;
}

/** A tick's label: as many decimals as the step needs, and no more. */
export function tickLabel(value: number, step: number): string {
  const places = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  return signed(value, places);
}

/** A value with its sign always shown: +6.6, −6.8, 0.0. */
export function withSign(n: number, places: number): string {
  const text = signed(n, places);
  return n > 0 && Number(text) !== 0 ? `+${text}` : text;
}

/** An integer with thousands separated by a comma: 274,797. */
export const grouped = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Where to put labels so that none touches another. `wants` is the centre each label would like and
 * `sizes` its height; the labels keep their order and move no further than they must (the least
 * squares of the moves, found by pooling neighbours that collide). Nothing leaves lo..hi unless the
 * stack is taller than that. The result is in the order of the input.
 */
export function dodge(wants: readonly number[], sizes: readonly number[], lo: number, hi: number, pad = 2): number[] {
  const n = wants.length;
  if (n === 0) return [];
  const order = wants.map((_, i) => i).sort((a, b) => wants[a]! - wants[b]! || a - b);
  const offset: number[] = [0];
  for (let k = 0; k < n - 1; k++) offset.push(offset[k]! + (sizes[order[k]!]! + sizes[order[k + 1]!]!) / 2 + pad);

  // z[k] is where label k would sit if it were the first of the stack: a collision makes z fall
  // out of order, and the fix is to pool the neighbours that are out of order into their mean.
  const blocks: { sum: number; count: number }[] = [];
  order.forEach((i, k) => {
    blocks.push({ sum: wants[i]! - offset[k]!, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  });
  const z: number[] = [];
  for (const b of blocks) for (let c = 0; c < b.count; c++) z.push(b.sum / b.count);

  const first = sizes[order[0]!]! / 2;
  const last = sizes[order[n - 1]!]! / 2;
  const floor = lo + first;
  const ceil = Math.max(floor, hi - last - offset[n - 1]!);
  const out = new Array<number>(n);
  order.forEach((i, k) => {
    out[i] = Math.min(ceil, Math.max(floor, z[k]!)) + offset[k]!;
  });
  return out;
}

/** A closed or open polyline through the points, as an SVG path. */
export function polyline(points: readonly (readonly [number, number])[], close = false): string {
  if (points.length === 0) return "";
  const body = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join("");
  return close ? `${body}Z` : body;
}

const round = (n: number): string => {
  const v = n.toFixed(2);
  return v === "-0.00" ? "0.00" : v;
};

/** The words of a seed count: "1 seed", "2 seeds". */
export const seedsText = (n: number): string => `${n} ${n === 1 ? "seed" : "seeds"}`;

/** `t2_conference` is "T2 conference": the task as a person says it. */
export const taskText = (task: string): string => task.replace(/^t(\d+)_/, "T$1 ").replace(/_/g, " ");
export const taskShort = (task: string): string => task.replace(/^(t\d+)_.*/, (_, t: string) => t.toUpperCase());
