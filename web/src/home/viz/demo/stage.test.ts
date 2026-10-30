// The click demo's picture: a coordinator crashed goes dark, its neighbours notice, an heir is picked and the tree re-forms around
// it, all as one playhead under the page's one ease; nothing jumps when a visitor clicks again mid-way; a person who asked for
// less motion gets the end of every change at once.

import { describe, expect, it } from "vitest";

import { story } from "../../data/story";
import { SECONDS } from "../ease";
import type { NodeFrame, TreeFrame } from "../tree/frame";
import { createStage, PLAY, type Stage } from "./stage";

const D = SECONDS.takeover * 1000;
const node = (f: TreeFrame, id: string): NodeFrame => f.nodes.find((n) => n.id === id) as NodeFrame;
const edge = (f: TreeFrame, id: string) => f.edges.find((e) => e.child === id) as TreeFrame["edges"][number];
const snap = (stage: Stage, now: number): Record<string, [number, number]> => {
  const f = stage.at(now);
  return Object.fromEntries(f.nodes.map((n) => [n.id, [n.x, n.y] as [number, number]]));
};

describe("the picture before anything is crashed", () => {
  const stage = createStage(story.tree);
  const f = stage.at(0);

  it("is the recorded tree: every node alive, the root crowned, a live edge to every node but the root", () => {
    expect(f.nodes).toHaveLength(22);
    expect(f.nodes.every((n) => n.state === "alive" && n.opacity === 1)).toBe(true);
    expect(node(f, "o0").crown).toBe(1);
    expect(f.nodes.filter((n) => n.crown > 0).map((n) => n.id)).toEqual(["o0"]);
    expect(f.edges.filter((e) => e.opacity === 1)).toHaveLength(21);
    expect(edge(f, "o0").opacity).toBe(0);
    for (const e of f.edges.filter((x) => x.opacity === 1)) expect(e.broken).toBe(0);
  });

  it("puts every node where the hero's first picture does", () => {
    for (const n of f.nodes) expect([n.x, n.y]).toEqual([stage.model.epochs[0]?.pos[n.id]?.x, stage.model.epochs[0]?.pos[n.id]?.y]);
  });

  it("shows no score, no candidate and no heir", () => {
    expect(f.nodes.every((n) => n.candidate === 0 && n.heir === 0 && n.score === null)).toBe(true);
  });

  it("is not playing", () => {
    expect(stage.playing(0)).toBe(false);
    expect(stage.progress(0)).toBe(1);
  });
});

describe("crashing the root", () => {
  const stage = createStage(story.tree);
  const out = stage.kill("o0", 1000);

  it("hands the root to the heir the rule picks, the one the run picked", () => {
    expect(out?.rounds[0]?.heir).toBe("o1");
    expect(stage.holder()).toBe("o1");
  });

  it("goes dark at once, with its neighbours' dots filling by the middle of the takeover", () => {
    const start = stage.at(1000);
    expect(node(start, "o0").state).toBe("silent");
    expect(node(start, "o0").flash).toBe(1);
    expect(node(start, "o0").missed).toBe(0);
    const mid = stage.at(1000 + D * 0.5);
    expect(["suspected", "dead"]).toContain(node(mid, "o0").state);
    expect(node(mid, "o0").missed).toBeGreaterThanOrEqual(3);
  });

  it("breaks the edges the dead one carried, from the first instant", () => {
    const f = stage.at(1000);
    for (const id of ["o1", "o2", "o3"]) expect(edge(f, id).broken, id).toBe(1);
    expect(edge(f, "o1").parent).toBe("o0");
  });

  it("lights the pool and scores it in the middle, then the heir", () => {
    let pool = 0;
    let heir = 0;
    let scored = 0;
    for (let ms = 0; ms <= D; ms += 20) {
      const f = stage.at(1000 + ms);
      pool = Math.max(pool, ...f.nodes.filter((n) => ["o1", "o2", "o3"].includes(n.id)).map((n) => n.candidate));
      heir = Math.max(heir, node(f, "o1").heir);
      scored = Math.max(scored, ...f.nodes.filter((n) => n.score !== null).map((n) => n.score as number));
    }
    expect(pool).toBeCloseTo(1, 1);
    expect(heir).toBeCloseTo(1, 1);
    expect(scored).toBeGreaterThan(0.5);
  });

  it("ends with the heir crowned at the top, the others hanging from it and the dead one among the killed", () => {
    const f = stage.at(1000 + D + 10);
    expect(node(f, "o1").crown).toBe(1);
    expect(node(f, "o0").crown).toBe(0);
    expect(node(f, "o0").state).toBe("dead");
    expect(node(f, "o0").stamp).toBe(1);
    expect(node(f, "o0").y).toBeGreaterThan(node(f, "o1.1.a1").y);
    expect(node(f, "o1").y).toBe(0);
    for (const id of ["o2", "o3"]) {
      const e = edge(f, id);
      expect(e.parent, id).toBe("o1");
      expect(e.broken, id).toBe(0);
      expect(e.opacity, id).toBe(1);
      expect([e.x1, e.y1]).toEqual([node(f, "o1").x, node(f, "o1").y]);
    }
    expect(edge(f, "o1").opacity).toBe(0);
    expect(f.nodes.filter((n) => n.candidate > 0 || n.heir > 0)).toEqual([]);
  });

  it("stops playing when it is done", () => {
    expect(stage.playing(1000 + D * 0.5)).toBe(true);
    expect(stage.playing(1000 + D + 1)).toBe(false);
  });
});

describe("the whole sequence the run lived through", () => {
  it("crashes five in turn and ends where the log ends: the last standing track holds the root", () => {
    const stage = createStage(story.tree);
    let now = 0;
    for (const id of ["o0", "o2.1", "o1", "o3.2", "o2"]) {
      expect(stage.kill(id, now), id).not.toBeNull();
      now += D;
    }
    const f = stage.at(now + 50);
    expect(stage.holder()).toBe("o3");
    expect(node(f, "o3").crown).toBe(1);
    expect(f.nodes.filter((n) => n.state === "dead").map((n) => n.id).sort()).toEqual(["o0", "o1", "o2", "o2.1", "o3.2"]);
    // the dead stand in a row of their own, the first one furthest left, and every survivor hangs from a living coordinator
    const dead = ["o0", "o2.1", "o1", "o3.2", "o2"].map((id) => node(f, id));
    for (let i = 1; i < dead.length; i++) expect((dead[i] as NodeFrame).x).toBeGreaterThan((dead[i - 1] as NodeFrame).x);
    expect(new Set(dead.map((n) => n.y)).size).toBe(1);
    for (const e of f.edges.filter((x) => x.opacity === 1)) expect(node(f, e.parent as string).state, e.child).toBe("alive");
  });

  it("says nothing is left when everyone has gone: no heir, no crown, no edge", () => {
    const stage = createStage(story.tree);
    let now = 0;
    for (const id of stage.tree.brains) {
      stage.kill(id, now);
      now += D;
    }
    expect(stage.holder()).toBeNull();
    const f = stage.at(now + 50);
    expect(f.nodes.filter((n) => n.state === "alive" && n.id.split(".").length < 3)).toEqual([]);
    expect(f.edges.filter((e) => e.opacity > 0)).toEqual([]);
    expect(f.nodes.filter((n) => n.crown > 0)).toEqual([]);
  });
});

describe("a change of mind mid-way", () => {
  it("does not move anything at the instant of a second click", () => {
    const stage = createStage(story.tree);
    stage.kill("o0", 0);
    for (const during of [150, 600, 1100, 1500, 1900]) {
      const s = createStage(story.tree);
      s.kill("o0", 0);
      const before = snap(s, during - 0.001);
      s.kill("o2", during);
      const after = snap(s, during);
      for (const id of Object.keys(before)) {
        expect(after[id]?.[0], `${id} x at ${during}`).toBeCloseTo(before[id]?.[0] ?? NaN, 3);
        expect(after[id]?.[1], `${id} y at ${during}`).toBeCloseTo(before[id]?.[1] ?? NaN, 3);
      }
    }
  });

  it("does not move an edge's parent end at the instant of a second click", () => {
    const s = createStage(story.tree);
    s.kill("o0", 0);
    const during = 1500;
    const before = s.at(during - 0.001).edges.map((e) => [e.x1, e.y1]);
    s.kill("o1", during);
    s.at(during).edges.forEach((e, i) => {
      expect(e.x1, e.child).toBeCloseTo(before[i]?.[0] ?? NaN, 3);
      expect(e.y1, e.child).toBeCloseTo(before[i]?.[1] ?? NaN, 3);
    });
  });
});

describe("the reset", () => {
  it("brings every node home, alive, with the root crowned again", () => {
    const stage = createStage(story.tree);
    stage.kill("o0", 0);
    stage.kill("o2.1", D);
    stage.reset(3 * D);
    const f = stage.at(3 * D + SECONDS.grow * 1000 + 50);
    expect(f.nodes.every((n) => n.state === "alive" && n.opacity === 1)).toBe(true);
    for (const n of f.nodes) expect([n.x, n.y]).toEqual([stage.model.epochs[0]?.pos[n.id]?.x, stage.model.epochs[0]?.pos[n.id]?.y]);
    expect(f.nodes.filter((n) => n.crown > 0).map((n) => n.id)).toEqual(["o0"]);
    expect(f.edges.filter((e) => e.opacity === 1)).toHaveLength(21);
    expect(f.edges.every((e) => e.broken === 0)).toBe(true);
    expect(stage.crashed()).toEqual([]);
  });

  it("can crash the same coordinators again afterwards, to the same answer", () => {
    const stage = createStage(story.tree);
    const first = stage.kill("o0", 0);
    stage.reset(D * 2);
    const again = stage.kill("o0", D * 4);
    expect(again?.rounds).toEqual(first?.rounds);
  });
});

describe("for a person who asked for less motion", () => {
  it("shows the end of a change the instant it is made", () => {
    const calm = createStage(story.tree, 0);
    calm.kill("o0", 5);
    const f = calm.at(5);
    const full = createStage(story.tree);
    full.kill("o0", 5);
    const end = full.at(5 + D + 50);
    for (const n of f.nodes) {
      const want = node(end, n.id);
      expect([n.x, n.y, n.state, n.crown, n.candidate, n.heir]).toEqual([want.x, want.y, want.state, want.crown, want.candidate, want.heir]);
    }
    expect(f.edges.map((e) => [e.parent, e.broken, e.opacity])).toEqual(end.edges.map((e) => [e.parent, e.broken, e.opacity]));
    expect(calm.playing(5 + 1)).toBe(false);
  });
});

describe("every frame of every order", () => {
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  it("is made of finite numbers in range, whatever is clicked when, resets included, over 40 orders", () => {
    // the checks are plain code and the first one that fails is reported once: an expect() per number would be millions of them
    const bad: string[] = [];
    const unit = (v: number): boolean => v >= -1e-9 && v <= 1 + 1e-9;
    for (let seed = 1; seed <= 40 && bad.length === 0; seed++) {
      const next = rng(seed);
      const stage = createStage(story.tree);
      let now = 0;
      for (let step = 0; step < 14; step++) {
        if (next() < 0.12) stage.reset(now);
        else {
          const alive = stage.alive();
          const id = alive[Math.floor(next() * alive.length)];
          if (id) stage.kill(id, now);
        }
        const until = now + next() * 2600;
        for (; now < until; now += 50) {
          const f = stage.at(now);
          for (const n of f.nodes) {
            const numbers = [n.x, n.y, n.opacity, n.crown, n.candidate, n.heir, n.flash, n.stamp, n.buried, n.missed];
            if (!numbers.every(Number.isFinite) || Math.abs(n.x) >= 40 || Math.abs(n.y) >= 40) bad.push(`seed ${seed} t ${now} ${n.id}: ${numbers.join(" ")}`);
            if (![n.opacity, n.crown, n.candidate, n.heir, n.flash, n.stamp, n.buried].every(unit)) bad.push(`seed ${seed} t ${now} ${n.id} out of 0..1`);
            if (n.score !== null && !unit(n.score)) bad.push(`seed ${seed} t ${now} ${n.id} score ${n.score}`);
          }
          for (const e of f.edges) {
            if (![e.x1, e.y1, e.x2, e.y2, e.opacity, e.broken].every(Number.isFinite) || !unit(e.opacity)) bad.push(`seed ${seed} t ${now} edge ${e.child}`);
          }
        }
      }
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });
});

describe("the choreography", () => {
  it("plays its parts in the order the story goes: dark, noticed, decided, re-wired, settled", () => {
    expect(PLAY.flash[0]).toBe(0);
    expect(PLAY.notice[1]).toBeLessThanOrEqual(PLAY.verdict);
    expect(PLAY.verdict).toBeLessThanOrEqual(PLAY.decide[0]);
    expect(PLAY.decide[0]).toBeLessThan(PLAY.rewire[0]);
    expect(PLAY.rewire[1]).toBeLessThanOrEqual(PLAY.glide[1]);
    expect(PLAY.glide[1]).toBe(1);
  });
});
