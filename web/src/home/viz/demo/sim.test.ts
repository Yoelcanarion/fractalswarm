// The click demo's rules against the recorded run: crashing five coordinators in the order the run lost them gives back its seven
// HRW rounds (goal, previous owner, pool, every score, heir) and the re-wiring its log shows. Then the rules on every order a
// visitor could click: the tree stays one tree and every goal keeps a living owner for as long as anybody is left.

import { describe, expect, it } from "vitest";

import { story } from "../../data/story";
import { naturalCompare } from "../shared";
import { candidates, demoTree, initialState, kill, shapeOf, strays, type DemoState, type Outcome } from "./sim";

const t = demoTree(story.tree);
const ORDER = [...story.tree.kills].sort((a, b) => a.atMs - b.atMs).map((k) => k.target);

function replay(order: string[]): { outcomes: Outcome[]; states: DemoState[] } {
  let state = initialState(t);
  const states = [state];
  const outcomes: Outcome[] = [];
  for (const id of order) {
    const out = kill(t, state, id);
    if (!out) throw new Error(`${id} could not be crashed`);
    outcomes.push(out);
    state = out.after;
    states.push(state);
  }
  return { outcomes, states };
}

describe("the tree the demo starts from", () => {
  it("is the recorded run's: ten coordinators, twelve agents, ten goals, each with its owner", () => {
    expect(t.brains).toHaveLength(10);
    expect(t.agents).toHaveLength(12);
    expect(t.goals).toHaveLength(10);
    expect(t.goals[0]).toBe("root");
    expect(t.initialOwner["root"]).toBe(story.tree.root);
    for (const g of story.tree.goals) expect(t.initialOwner[g.id]).toBe(g.owner);
  });

  it("hangs every agent from its session, every session from its track and every track from the root", () => {
    const shape = shapeOf(t, initialState(t));
    expect(shape.root).toBe("o0");
    expect(strays(shape)).toEqual([]);
    for (const n of story.tree.nodes) {
      if (n.id !== shape.root) expect(shape.parent[n.id], n.id).toBe(n.parent);
    }
  });

  it("gives an agent its session's goal", () => {
    for (const n of story.tree.nodes.filter((x) => x.kind === "agent")) {
      expect(t.birthGoal[n.id], n.id).toBe(t.birthGoal[n.parent ?? ""]);
    }
  });
});

describe("crashing five coordinators in the order the run lost them", () => {
  const { outcomes, states } = replay(ORDER);
  const rounds = outcomes.flatMap((o) => o.rounds);

  it("is the order the log says", () => {
    expect(ORDER).toEqual(["o0", "o2.1", "o1", "o3.2", "o2"]);
  });

  it("gives back every round of the run: the goal, who held it, the pool and the heir", () => {
    expect(rounds).toHaveLength(story.hrw.rounds.length);
    story.hrw.rounds.forEach((want, i) => {
      const got = rounds[i];
      expect(got, `round ${i}`).toBeDefined();
      expect(got?.goal, `round ${i} goal`).toBe(want.goal);
      expect(got?.previous, `round ${i} previous`).toBe(want.previous);
      expect(got?.pool, `round ${i} pool`).toEqual([...want.pool].sort(naturalCompare));
      expect(got?.heir, `round ${i} heir`).toBe(want.heir);
    });
  });

  it("gives back every score the run recorded, to the digit, best first", () => {
    let seen = 0;
    story.hrw.rounds.forEach((want, i) => {
      const got = rounds[i];
      if (want.scores.length === 0) return;
      expect(got?.ranked.map((r) => r.member), `round ${i}`).toEqual(want.scores.map((s) => s.member));
      want.scores.forEach((s, k) => {
        expect(got?.ranked[k]?.score, `round ${i} ${s.member}`).toBe(s.score);
        expect(got?.ranked[k]?.fraction ?? -1, `round ${i} ${s.member}`).toBeCloseTo(s.fraction, 4);
        seen += 1;
      });
    });
    expect(seen).toBeGreaterThanOrEqual(11);
  });

  it("leaves the survivors the run lists after each round", () => {
    story.hrw.rounds.forEach((want, i) => {
      const sorted = [...want.survivors].sort(naturalCompare);
      // a round's survivors are the coordinators alive once its kill has happened
      const kills = story.tree.kills.filter((k) => k.atMs <= want.atMs).length;
      const alive = [...(states[kills]?.alive ?? [])].sort(naturalCompare);
      expect(alive, `round ${i}`).toEqual(sorted);
    });
  });

  it("re-wires what the log says it re-wired", () => {
    let checked = 0;
    for (const a of story.tree.adoptions) {
      const index = ORDER.indexOf(a.dead);
      const before = shapeOf(t, states[index] as DemoState);
      const after = shapeOf(t, states[index + 1] as DemoState);
      for (const child of a.children) {
        expect(before.parent[child], `${child} before ${a.dead} died`).toBe(a.dead);
        expect(after.parent[child], `${child} after ${a.dead} died`).toBe(a.adopter);
        checked += 1;
      }
      if (a.goal === "root") expect(after.root, `root after ${a.dead}`).toBe(a.adopter);
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it("ends with one coordinator holding the root and every survivor under it", () => {
    const last = shapeOf(t, states[states.length - 1] as DemoState);
    expect(last.root).toBe("o3");
    expect(strays(last)).toEqual([]);
    expect(last.present.filter((id) => id.startsWith("o")).length).toBeGreaterThan(0);
  });

  it("runs the same again", () => {
    expect(replay(ORDER).outcomes.flatMap((o) => o.rounds)).toEqual(rounds);
  });
});

describe("the pool of an heir", () => {
  const all = initialState(t).alive;

  it("is the live members of the dead coordinator's group", () => {
    expect(candidates(t, "o2.1", all)).toEqual(["o2.1", "o2.2"]);
    expect(candidates(t, "o1", all)).toEqual(["o1", "o2", "o3"]);
  });

  it("is, for the root, its children", () => {
    expect(candidates(t, "o0", new Set(["o1", "o2", "o3", "o1.1"]))).toEqual(["o1", "o2", "o3"]);
  });

  it("is, for the root with none of its children left, whoever is left", () => {
    expect(candidates(t, "o0", new Set(["o1.1", "o3.2"]))).toEqual(["o1.1", "o3.2"]);
  });
});

describe("every order a visitor could click", () => {
  // a small seeded generator, so a failure names the order that broke it
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = (list: string[], next: () => number): string[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j] as string, out[i] as string];
    }
    return out;
  };

  it("keeps one tree and a living owner for every goal while anybody is left, over 300 orders", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const order = shuffle(t.brains, rng(seed));
      let state = initialState(t);
      order.forEach((id, k) => {
        const out = kill(t, state, id);
        const where = `order ${order.join(" ")} after ${id}`;
        expect(out, where).not.toBeNull();
        if (!out) return;
        state = out.after;
        const left = order.length - k - 1;
        const shape = shapeOf(t, state);
        if (left > 0) {
          expect(out.rounds.every((r) => r.heir !== null), where).toBe(true);
          for (const g of t.goals) expect(state.alive.has(state.owner[g] ?? ""), `${where}: owner of ${g}`).toBe(true);
          expect(shape.root, where).not.toBeNull();
          expect(strays(shape), where).toEqual([]);
          for (const n of shape.present) {
            let at: string | null | undefined = n;
            let steps = 0;
            while (at && at !== shape.root && steps++ <= shape.present.length) at = shape.parent[at];
            expect(at, `${where}: ${n} reaches the root`).toBe(shape.root);
          }
        } else {
          expect(out.rounds.every((r) => r.heir === null), where).toBe(true);
          expect(shape.root, where).toBeNull();
        }
      });
    }
  });

  it("does not crash a coordinator twice", () => {
    const first = kill(t, initialState(t), "o1");
    expect(first).not.toBeNull();
    expect(kill(t, (first as Outcome).after, "o1")).toBeNull();
    expect(kill(t, initialState(t), "o1.1.a1")).toBeNull();
  });

  it("hands a track whose sessions are both gone to the track itself", () => {
    const { outcomes } = replay(["o2.1", "o2.2"]);
    const second = outcomes[1]?.rounds ?? [];
    expect(second.map((r) => r.heir)).toEqual(["o2", "o2"]);
    expect(second.map((r) => r.goal)).toEqual(["track-ai/d1", "track-ai/d2"]);
  });
});
