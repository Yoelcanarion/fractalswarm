// The tree's ambient layer: what keeps it alive between the recorded events. The hero's tree passes long stretches in which
// the log says nothing, and a picture that stands still there reads as stopped. So, on a clock of its own that never
// looks at the progress of the run:
//
//   - a pulse runs along each live edge, in a sweep from the root down and, the next time, from the leaves back up;
//   - a halo breathes round each live brain, and a ring pings round each agent that is working.
//
// It follows the recorded frame and invents nothing. A pulse needs a live edge (neither end dead, the child not still
// waiting for work); a brain that dies, and the edges of a brain that is dead, go still; the sweeps come quicker, and
// the pulses brighter, where the frame says a model call is in flight (the busy flag, smoothed, because a call that
// lasts seconds of the run flashes by in a fraction of one on the hero's screen). Idle, it is calm, not off. It adds no
// number and no label, and it is drawn apart from the recorded layer, so that layer keeps its meaning.

import { smoothstep, span } from "../shared";
import { curvePoint, type TreeFrame } from "./frame";
import type { TreeModel } from "./model";

export const AMBIENT = {
  /** Seconds a node's busy flag takes to rise into its activity, and to die away. */
  rise: 0.2,
  fall: 1.2,
  /** The share of its activity a brain passes up: work below it keeps the edges above it moving. */
  carry: 0.92,
  /** Seconds one sweep takes, when nothing works and when a good part of the tree does. */
  sweepIdle: 4.8,
  sweepBusy: 2,
  /** The share of the alive nodes that must be busy for the sweeps to be at their quickest. */
  busyShare: 0.4,
  /** Where in a sweep the first pulse starts; how much later each row's starts; how much of a sweep one pulse takes; how far the edges of a row drift apart. */
  lead: 0.02,
  stagger: 0.2,
  travel: 0.34,
  spread: 0.07,
  /** How far behind its head, as a share of the edge's travel, each tail of a pulse trails. */
  tail: 0.09,
  /** How bright a pulse is when nothing works below it (1 is where the work is). */
  dim: 0.55,
  /** Seconds a brain's halo takes to breathe, and an agent's ring to ping. */
  breath: 3.6,
  ping: 1.7,
} as const;

/** FNV-1a: the same text always gives the same number in [0, 1). Not for anything but spreading phases apart. */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

const fract = (x: number): number => x - Math.floor(x);
const GOLDEN = 0.6180339887498949;

/** The head of a pulse and the tails that trail it. */
export const COMET = 3;

export class Ambient {
  /** Seconds this layer has run. */
  time = 0;
  /** The sweeps made so far, with a fraction: the integer part says which one, and so which way it runs (even: down). */
  sweeps = 0;

  /** What each node is doing, smoothed (0..1), in the order of the model's ids. */
  readonly activity: Float64Array;
  /**
   * The pulse on each node's edge (the edge to its parent) is a comet: its head and two tails, COMET slots to a node, where each
   * is in layout units; and how visible the whole of it is.
   */
  readonly dot: { x: Float64Array; y: Float64Array; opacity: Float64Array };
  /** How visible each brain's halo is (0 for an agent, or a node that is not alive). */
  readonly halo: Float64Array;
  /** The ring round each working agent: its scale and how visible it is. */
  readonly ping: { scale: Float64Array; opacity: Float64Array };

  private readonly index = new Map<string, number>();
  private readonly brain: boolean[];
  private readonly seed: Float64Array;
  private readonly carried: Float64Array;

  constructor(model: TreeModel) {
    const n = model.ids.length;
    model.ids.forEach((id, i) => this.index.set(id, i));
    this.brain = model.ids.map((id) => model.node[id]?.kind === "brain");
    this.seed = Float64Array.from(model.ids, hash01);
    this.activity = new Float64Array(n);
    this.carried = new Float64Array(n);
    this.dot = { x: new Float64Array(n * COMET), y: new Float64Array(n * COMET), opacity: new Float64Array(n) };
    this.halo = new Float64Array(n);
    this.ping = { scale: new Float64Array(n).fill(1), opacity: new Float64Array(n) };
  }

  indexOf(id: string): number {
    return this.index.get(id) ?? -1;
  }

  /** Moves the layer on by ``dt`` seconds over the frame the recorded layer shows now. */
  step(dt: number, frame: TreeFrame): void {
    this.time += dt;
    const { nodes, edges } = frame;

    // What each node is doing: its busy flag, smoothed.
    let alive = 0;
    let working = 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      const target = node.state === "alive" && node.busy ? 1 : 0;
      const tau = target > (this.activity[i] ?? 0) ? AMBIENT.rise : AMBIENT.fall;
      const a = (this.activity[i] ?? 0) + (target - (this.activity[i] ?? 0)) * (1 - Math.exp(-dt / tau));
      this.activity[i] = a;
      this.carried[i] = a;
      if (node.state === "alive") {
        alive += 1;
        working += a;
      }
    }
    // Work below a brain keeps its edge moving: pass it up, a row at a time.
    for (let pass = 0; pass < 3; pass++) {
      for (const e of edges) {
        const c = this.index.get(e.child);
        const p = e.parent === null ? undefined : this.index.get(e.parent);
        if (c === undefined || p === undefined) continue;
        this.carried[p] = Math.max(this.carried[p] ?? 0, (this.carried[c] ?? 0) * AMBIENT.carry);
      }
    }

    // The sweeps come quicker as more of the tree works.
    const load = Math.min(1, working / Math.max(1, AMBIENT.busyShare * alive));
    this.sweeps += dt / (AMBIENT.sweepIdle + (AMBIENT.sweepBusy - AMBIENT.sweepIdle) * load);
    const sweep = Math.floor(this.sweeps);
    const phase = this.sweeps - sweep;
    const down = sweep % 2 === 0;
    let rows = 1;
    for (const e of edges) rows = Math.max(rows, e.row);

    // A pulse on each live edge.
    this.dot.opacity.fill(0);
    for (const e of edges) {
      const c = this.index.get(e.child);
      const p = e.parent === null ? undefined : this.index.get(e.parent);
      if (c === undefined || p === undefined) continue;
      const child = nodes[c];
      const parent = nodes[p];
      if (!child || !parent) continue;
      if (e.opacity < 0.2 || e.broken >= 0.5 || parent.state !== "alive" || child.state !== "alive" || child.waiting) continue;
      const order = down ? e.row - 1 : rows - e.row;
      const start = AMBIENT.lead + order * AMBIENT.stagger + fract((this.seed[c] ?? 0) + sweep * GOLDEN) * AMBIENT.spread;
      const u = span(phase, start, start + AMBIENT.travel);
      if (u <= 0 || u >= 1) continue;
      const from = down ? { x: e.x1, y: e.y1 } : { x: e.x2, y: e.y2 };
      const to = down ? { x: e.x2, y: e.y2 } : { x: e.x1, y: e.y1 };
      for (let k = 0; k < COMET; k++) {
        const v = Math.max(0, u - k * AMBIENT.tail);
        const at = curvePoint(from, to, 0.5 * v + 0.5 * smoothstep(v));
        this.dot.x[c * COMET + k] = at.x;
        this.dot.y[c * COMET + k] = at.y;
      }
      this.dot.opacity[c] =
        smoothstep(span(u, 0, 0.18)) * (1 - smoothstep(span(u, 0.82, 1))) * (AMBIENT.dim + (1 - AMBIENT.dim) * (this.carried[c] ?? 0)) * e.opacity;
    }

    // A halo round each live brain, a ring round each agent that is working.
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const live = node !== undefined && node.state === "alive" && node.opacity > 0;
      this.halo[i] = 0;
      this.ping.opacity[i] = 0;
      if (!live || node === undefined) continue;
      const seed = this.seed[i] ?? 0;
      if (this.brain[i]) {
        const breath = 0.5 + 0.5 * Math.sin(2 * Math.PI * (this.time / AMBIENT.breath + seed));
        this.halo[i] = node.opacity * (0.45 + 0.55 * breath) * (0.55 + 0.45 * (this.carried[i] ?? 0));
      } else if (!node.waiting) {
        const f = fract(this.time / AMBIENT.ping + seed);
        this.ping.scale[i] = 1 + 0.8 * (1 - (1 - f) ** 3);
        this.ping.opacity[i] = (this.activity[i] ?? 0) * (1 - f) ** 1.2 * node.opacity;
      }
    }
  }
}
