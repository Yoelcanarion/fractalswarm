import { describe, expect, it } from "vitest";
import { story } from "../../data/story";
import { AMBIENT, Ambient, COMET, hash01 } from "./ambient";
import { curvePoint, treePlayer, type EdgeFrame, type TreeFrame } from "./frame";

const player = treePlayer(story.tree, "hero");
const { model } = player;
const DT = 1 / 60;

const fresh = (): Ambient => new Ambient(model);
const nodeOf = (frame: TreeFrame, id: string) => frame.nodes.find((n) => n.id === id)!;

/** An edge that carries a pulse: neither end is dead, the child has work, and it is drawn. */
const isLive = (frame: TreeFrame, e: EdgeFrame): boolean => {
  const child = nodeOf(frame, e.child);
  const parent = e.parent === null ? undefined : nodeOf(frame, e.parent);
  return !!parent && parent.state === "alive" && child.state === "alive" && !child.waiting && e.broken < 0.5 && e.opacity >= 0.2;
};

const run = (layer: Ambient, frame: TreeFrame, seconds: number, each?: (step: number) => void): void => {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    layer.step(DT, frame);
    each?.(i);
  }
};

/** The frame of the run where most of the alive nodes have a model call in flight. */
const busiest = ((): TreeFrame => {
  let best = player.frame(0);
  let count = -1;
  for (let i = 0; i <= 800; i++) {
    const frame = player.frame(i / 800);
    const busy = frame.nodes.filter((n) => n.busy).length;
    if (busy > count) {
      best = frame;
      count = busy;
    }
  }
  return best;
})();

const settled = player.frame(1);

describe("hash01", () => {
  it("gives the same number for the same text, and different ones for different text, all in [0, 1)", () => {
    expect(hash01("o2.1")).toBe(hash01("o2.1"));
    const seen = new Set(model.ids.map(hash01));
    expect(seen.size).toBe(model.ids.length);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("the ambient layer, through the whole recorded run", () => {
  it("keeps every number finite and in range", () => {
    const layer = fresh();
    for (let i = 0; i <= 900; i++) {
      layer.step(DT, player.frame(i / 900));
      for (const v of [...layer.dot.x, ...layer.dot.y, ...layer.dot.opacity, ...layer.halo, ...layer.ping.scale, ...layer.ping.opacity, ...layer.activity]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      for (const v of [...layer.dot.opacity, ...layer.halo, ...layer.ping.opacity, ...layer.activity]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (const v of layer.ping.scale) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(1.81);
      }
    }
  });

  it("pulses only along live edges, and lights a halo only round a live brain and a ring only round a live agent", () => {
    const layer = fresh();
    let pulses = 0;
    for (let i = 0; i <= 1800; i++) {
      const frame = player.frame(i / 1800);
      layer.step(DT, frame);
      const live = new Set(frame.edges.filter((e) => isLive(frame, e)).map((e) => e.child));
      for (const n of frame.nodes) {
        const k = layer.indexOf(n.id);
        if (layer.dot.opacity[k]! > 0) {
          pulses += 1;
          expect(live.has(n.id), `${n.id} pulses at ${frame.p} on an edge that is not live`).toBe(true);
        }
        if (layer.halo[k]! > 0) {
          expect(n.state).toBe("alive");
          expect(model.node[n.id]?.kind).toBe("brain");
        }
        if (layer.ping.opacity[k]! > 0) {
          expect(n.state).toBe("alive");
          expect(n.waiting).toBe(false);
          expect(model.node[n.id]?.kind).toBe("agent");
        }
      }
    }
    expect(pulses).toBeGreaterThan(100);
  });

  it("keeps the head of a pulse on the curve of its edge", () => {
    const layer = fresh();
    let checked = 0;
    for (let i = 0; i <= 900; i += 3) {
      const frame = player.frame(i / 900);
      layer.step(DT * 3, frame);
      for (const e of frame.edges) {
        const k = layer.indexOf(e.child);
        if (layer.dot.opacity[k]! <= 0.05) continue;
        const head = { x: layer.dot.x[k * COMET]!, y: layer.dot.y[k * COMET]! };
        let nearest = Infinity;
        for (let s = 0; s <= 1000; s++) {
          const on = curvePoint({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, s / 1000);
          nearest = Math.min(nearest, Math.hypot(on.x - head.x, on.y - head.y));
        }
        expect(nearest, `${e.child} at ${frame.p}`).toBeLessThan(0.02);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("is the same every time it is run with the same frames: no randomness", () => {
    const a = fresh();
    const b = fresh();
    for (let i = 0; i <= 300; i++) {
      const frame = player.frame(i / 300);
      a.step(DT, frame);
      b.step(DT, frame);
    }
    expect([...a.dot.opacity, ...a.halo, ...a.ping.opacity]).toEqual([...b.dot.opacity, ...b.halo, ...b.ping.opacity]);
    expect(a.sweeps).toBe(b.sweeps);
  });
});

describe("the ambient layer on the settled tree", () => {
  it("is calm and never off: every live edge is pulsed and every live brain breathes, in twenty seconds with nothing working", () => {
    const layer = fresh();
    run(layer, settled, 6);
    for (const n of settled.nodes) expect(layer.activity[layer.indexOf(n.id)]).toBeLessThan(0.01);
    const brightest = new Float64Array(model.ids.length);
    const halo = new Float64Array(model.ids.length);
    run(layer, settled, 20, () => {
      for (let k = 0; k < model.ids.length; k++) {
        brightest[k] = Math.max(brightest[k]!, layer.dot.opacity[k]!);
        halo[k] = Math.max(halo[k]!, layer.halo[k]!);
      }
    });
    const live = settled.edges.filter((e) => isLive(settled, e));
    expect(live.length).toBeGreaterThan(5);
    for (const e of live) expect(brightest[layer.indexOf(e.child)], `${e.child} is never pulsed`).toBeGreaterThan(0.3);
    for (const n of settled.nodes) {
      const k = layer.indexOf(n.id);
      if (n.state === "alive" && model.node[n.id]?.kind === "brain") expect(halo[k], `${n.id} never breathes`).toBeGreaterThan(0.2);
    }
  });

  it("leaves the dead still: no pulse on their edges, no halo, no ring", () => {
    const layer = fresh();
    const dead = settled.nodes.filter((n) => n.state === "dead").map((n) => layer.indexOf(n.id));
    expect(dead).toHaveLength(5);
    run(layer, settled, 20, () => {
      for (const k of dead) {
        expect(layer.dot.opacity[k]).toBe(0);
        expect(layer.halo[k]).toBe(0);
        expect(layer.ping.opacity[k]).toBe(0);
      }
    });
  });

  it("sends the pulse of one sweep down an edge, and the pulse of the next back up it", () => {
    const layer = fresh();
    const edge = settled.edges.find((e) => isLive(settled, e) && e.row === 1)!;
    const k = layer.indexOf(edge.child);
    const nearParent = (): boolean => Math.hypot(layer.dot.x[k * COMET]! - edge.x1, layer.dot.y[k * COMET]! - edge.y1) < Math.hypot(layer.dot.x[k * COMET]! - edge.x2, layer.dot.y[k * COMET]! - edge.y2);
    const starts: boolean[] = [];
    let shown = false;
    const sweepsOf = (): number => Math.floor(layer.sweeps);
    let lastSweep = 0;
    run(layer, settled, 4 * AMBIENT.sweepIdle, () => {
      const on = layer.dot.opacity[k]! > 0.02;
      if (on && !shown) starts.push(nearParent());
      shown = on;
      lastSweep = sweepsOf();
    });
    expect(lastSweep).toBeGreaterThanOrEqual(3);
    expect(starts.length).toBeGreaterThanOrEqual(3);
    expect(starts.slice(0, 4)).toEqual([true, false, true, false]);
  });
});

describe("the ambient layer where the model works", () => {
  it("lifts a node's activity within a second of its call starting, and lets it go within a few seconds of the call ending", () => {
    const layer = fresh();
    const workers = busiest.nodes.filter((n) => n.busy && n.state === "alive").map((n) => layer.indexOf(n.id));
    expect(workers.length).toBeGreaterThanOrEqual(2);
    run(layer, busiest, 1.2);
    for (const k of workers) expect(layer.activity[k]).toBeGreaterThan(0.9);
    run(layer, settled, 6);
    for (const k of workers) expect(layer.activity[k]).toBeLessThan(0.01);
  });

  it("sweeps quicker while the tree works than while it does not", () => {
    const busy = fresh();
    const idle = fresh();
    run(busy, busiest, 20);
    run(idle, settled, 20);
    expect(busy.sweeps).toBeGreaterThan(idle.sweeps * 1.15);
    expect(idle.sweeps).toBeCloseTo(20 / AMBIENT.sweepIdle, 0);
  });

  it("pulses brighter along the edges above work than along the edges of a tree at rest", () => {
    const peak = (frame: TreeFrame): number => {
      const layer = fresh();
      let best = 0;
      run(layer, frame, 3 * AMBIENT.sweepBusy + 2, () => {
        for (const e of frame.edges) best = Math.max(best, layer.dot.opacity[layer.indexOf(e.child)]!);
      });
      return best;
    };
    expect(peak(busiest)).toBeGreaterThan(0.9);
    expect(peak(settled)).toBeLessThan(AMBIENT.dim + 0.05);
    expect(peak(settled)).toBeGreaterThan(AMBIENT.dim - 0.1);
  });
});

describe("the ambient layer while the tree grows", () => {
  it("pulses only on the edges that are drawn, and has nothing before they are", () => {
    for (const appear of [0, 0.15, 0.4, 0.7]) {
      const frame = player.frame(0, appear);
      const layer = fresh();
      run(layer, frame, 8, () => {
        for (const e of frame.edges) if (layer.dot.opacity[layer.indexOf(e.child)]! > 0) expect(e.opacity).toBeGreaterThanOrEqual(0.2);
        if (appear === 0) for (const v of [...layer.dot.opacity, ...layer.halo, ...layer.ping.opacity]) expect(v).toBe(0);
      });
    }
  });
});
