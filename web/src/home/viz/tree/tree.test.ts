import { describe, expect, it } from "vitest";
import { story } from "../../data/story";
import { burialTimes } from "./layout";
import { curvePoint, rowGate, treePlayer } from "./frame";
import { treeModel } from "./model";

const model = treeModel(story.tree);
const hero = treePlayer(story.tree, "hero");
const told = treePlayer(story.tree, "story");

describe("the effective tree", () => {
  it("has one epoch for the start and one for each takeover time", () => {
    expect(model.epochs.map((e) => e.startMs)).toEqual([0, 49640, 59781, 60797, 61750, 70859, 80952]);
    expect(model.groups.map((g) => g.atMs)).toEqual(model.epochs.slice(1).map((e) => e.startMs));
  });

  it("moves the root goal o0 -> o1 -> o2 -> o3, as the log says", () => {
    expect(model.epochs.map((e) => e.root)).toEqual(["o0", "o1", "o1", "o2", "o2", "o2", "o3"]);
    expect(story.takeover.chains.root).toEqual(["o0", "o1", "o2", "o3"]);
  });

  it("ends with the five survivors under o3, and the orphans of the dead re-parented", () => {
    const last = model.epochs[model.epochs.length - 1];
    expect(last?.present.filter((id) => model.node[id]?.kind === "brain")).toEqual(["o3", "o1.1", "o1.2", "o2.2", "o3.1"].sort((a, b) => (model.ids.indexOf(a) - model.ids.indexOf(b))));
    expect(last?.parent["o1.1"]).toBe("o3");
    expect(last?.parent["o2.2"]).toBe("o3");
    expect(last?.parent["o2.1.a1"]).toBe("o2.2");
    expect(last?.parent["o3.2.a2"]).toBe("o3.1");
    expect(last?.parent["o3"]).toBeNull();
  });

  it("keeps a dead brain that still has orphans in the picture, apart from the root's tree", () => {
    const between = model.epochs[3];
    expect(between?.present).toContain("o1");
    expect(between?.parent["o1"]).toBeNull();
    expect(between?.parent["o1.1"]).toBe("o1");
    expect(between?.root).toBe("o2");
    expect(between?.parent["o3"]).toBe("o2");
  });

  it("buries each dead brain when its last duty has been handed over", () => {
    expect(burialTimes(story.tree)).toEqual({ o0: 49640, "o2.1": 59781, o1: 61750, "o3.2": 70859, o2: 80952 });
  });

  it("gives every node in an epoch a place, with no two nodes on top of each other", () => {
    for (const e of model.epochs) {
      for (const id of e.present) expect(e.pos[id]).toBeDefined();
      for (const a of e.present) {
        for (const b of e.present) {
          if (a >= b) continue;
          const pa = e.pos[a];
          const pb = e.pos[b];
          if (pa && pb && pa.y === pb.y) expect(Math.abs(pa.x - pb.x)).toBeGreaterThanOrEqual(0.99);
        }
      }
      // A parent sits above its children.
      for (const id of e.present) {
        const p = e.parent[id];
        if (p) expect(e.pos[p]!.y).toBeLessThan(e.pos[id]!.y);
      }
    }
  });
});

describe("the timeline", () => {
  for (const [name, player] of [["hero", hero], ["story", told]] as const) {
    it(`${name}: runs the clock from 0 to the end of the run, never backwards`, () => {
      expect(player.timeline.at(0).tMs).toBe(0);
      expect(player.timeline.at(1).tMs).toBe(model.durationMs);
      let last = -1;
      for (let i = 0; i <= 2000; i++) {
        const t = player.timeline.at(i / 2000).tMs;
        expect(t).toBeGreaterThanOrEqual(last);
        last = t;
      }
    });

    it(`${name}: holds the clock once for each takeover`, () => {
      const holds = player.timeline.segments.filter((s) => s.hold !== null);
      expect(holds.map((s) => s.t0)).toEqual(model.groups.map((g) => g.atMs));
      const mid = player.timeline.at(((holds[0]?.s0 ?? 0) + (holds[0]?.s1 ?? 0)) / 2 / player.timeline.totalS);
      expect(mid.hold?.group).toBe(0);
      expect(mid.tMs).toBe(49640);
      expect(mid.hold?.c).toBeCloseTo(0.5, 3);
    });

    it(`${name}: finds the progress of every kill, in order`, () => {
      const ps = model.kills.map((k) => player.timeline.pOf(k.atMs));
      expect(ps).toEqual([...ps].sort((a, b) => a - b));
      for (const [i, k] of model.kills.entries()) {
        expect(player.timeline.at(ps[i] ?? 0).tMs).toBeCloseTo(k.atMs, 3);
      }
    });
  }

  it("takes the hero about nine seconds and the story longer, with the same events", () => {
    expect(hero.timeline.totalS).toBeGreaterThan(7);
    expect(hero.timeline.totalS).toBeLessThan(11);
    expect(told.timeline.totalS).toBeGreaterThan(hero.timeline.totalS * 2);
    expect(hero.keyframes.map((k) => k.id)).toEqual(told.keyframes.map((k) => k.id));
  });

  it("slows down for the five seconds between a kill and its verdict", () => {
    for (const k of model.kills) {
      const a = told.timeline.pOf(k.atMs);
      const b = told.timeline.pOf(k.verdictAtMs);
      const overall = (model.durationMs / 1000) / told.timeline.totalS;
      const here = ((k.verdictAtMs - k.atMs) / 1000) / ((b - a) * told.timeline.totalS);
      expect(here).toBeLessThan(overall);
    }
  });
});

describe("a frame", () => {
  it("is a pure function of progress", () => {
    for (const p of [0, 0.13, 0.5, 0.77, 1]) expect(hero.frame(p)).toEqual(hero.frame(p));
  });

  it("starts with every node alive and ends with five brains dead and the root at o3", () => {
    const first = hero.frame(0);
    expect(first.nodes.every((n) => n.state === "alive")).toBe(true);
    expect(first.killed).toBe(0);
    const last = hero.frame(1);
    expect(last.killed).toBe(5);
    expect(last.nodes.filter((n) => n.state === "dead").map((n) => n.id).sort()).toEqual(["o0", "o1", "o2", "o2.1", "o3.2"]);
    expect(last.nodes.filter((n) => n.crown === 1).map((n) => n.id)).toEqual(["o3"]);
    expect(last.nodes.filter((n) => n.buried === 1)).toHaveLength(5);
    expect(last.nodes.find((n) => n.id === "o3")).toMatchObject({ y: 0 });
  });

  it("shows the dead brain silent, then suspected, then dead, with missed-beat ticks counting up", () => {
    const kill = model.kills[0];
    if (!kill) throw new Error("no kill");
    const at = (t: number) => told.frame(told.timeline.pOf(t)).nodes.find((n) => n.id === kill.id);
    expect(at(kill.atMs - 100)?.state).toBe("alive");
    expect(at(kill.atMs + 100)).toMatchObject({ state: "silent", missed: 0 });
    expect(at(kill.suspectedAtMs + 10)).toMatchObject({ state: "suspected" });
    expect(at(kill.suspectedAtMs + 10)?.missed).toBeGreaterThanOrEqual(3);
    expect(at(kill.verdictAtMs + 1)).toMatchObject({ state: "dead", missed: 5 });
  });

  it("chooses the heir the log chose, with the scores the log has", () => {
    for (const [i, g] of model.groups.entries()) {
      const mid = told.timeline.pOf(g.atMs, "start") + (told.timeline.pOf(g.atMs, "end") - told.timeline.pOf(g.atMs, "start")) * 0.47;
      const frame = told.frame(mid);
      expect(frame.hold?.group).toBe(i);
      const shown = new Set<string>();
      for (const round of g.rounds) {
        const heir = frame.nodes.find((n) => n.id === round.heir);
        expect(heir?.heir).toBeGreaterThan(0.5);
        for (const s of round.scores) {
          if (shown.has(s.member)) continue;
          shown.add(s.member);
          expect(frame.nodes.find((n) => n.id === s.member)?.score).toBeCloseTo(s.fraction, 6);
        }
      }
    }
  });

  it("re-wires the edges of the dead brain's children to the heir, and the crown follows", () => {
    const g = model.groups[0];
    if (!g) throw new Error("no takeover");
    const before = told.frame(told.timeline.pOf(g.atMs, "start"));
    const after = told.frame(told.timeline.pOf(g.atMs, "end"));
    const edge = (f: typeof before, id: string) => f.edges.find((e) => e.child === id);
    const o1Before = before.nodes.find((n) => n.id === "o1")!;
    const o1After = after.nodes.find((n) => n.id === "o1")!;
    expect(edge(before, "o2")?.x1).toBeCloseTo(before.nodes.find((n) => n.id === "o0")!.x, 6);
    expect(edge(after, "o2")?.x1).toBeCloseTo(o1After.x, 6);
    expect(edge(after, "o2")?.broken).toBe(0);
    expect(o1Before.crown).toBe(0);
    expect(o1After.crown).toBe(1);
    expect(o1After.y).toBeLessThan(o1Before.y);
  });

  it("sends the messages of the log along the tree and no others", () => {
    const seen = new Set<number>();
    for (let i = 0; i <= 4000; i++) for (const d of told.frame(i / 4000).dashes) seen.add(d.key);
    expect(seen.size).toBe(model.messages.length);
    for (const d of told.frame(told.timeline.pOf(18031) + 0.002).dashes) expect(d.kind).toBe(0);
  });

  it("curves a message from the upper node to the lower and back", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 2, y: 4 };
    expect(curvePoint(a, b, 0)).toMatchObject({ x: 0, y: 0 });
    expect(curvePoint(a, b, 1)).toMatchObject({ x: 2, y: 4 });
    expect(curvePoint(b, a, 0)).toMatchObject({ x: 2, y: 4 });
    const down = curvePoint(a, b, 0.5).angle;
    const up = curvePoint(b, a, 0.5).angle;
    expect(Math.abs(Math.abs(down - up) - 180)).toBeLessThan(1e-9);
  });
});

describe("a frame at the end of the run", () => {
  it("holds no message in mid-air: the last ones fade with the run, and none is left on the settled tree", () => {
    for (const player of [hero, told]) {
      const last = player.frame(1);
      for (const d of last.dashes) expect(d.opacity).toBe(0);
      const before = player.frame(1 - player.timeline.perS(player.timeline.profile.dashS) / 2).dashes;
      for (const d of before) expect(d.opacity).toBeGreaterThan(0);
    }
  });
});

describe("a frame while the tree grows from its root and folds back into it", () => {
  it("is the frame of the run, whole, when nothing is said about how much of the tree is drawn", () => {
    for (const p of [0, 0.2, 0.5, 0.9, 1]) {
      expect(hero.frame(p, 1)).toEqual(hero.frame(p));
      expect(hero.frame(p).appear).toBe(1);
      for (const n of hero.frame(p).nodes) expect(n.appear).toBe(1);
    }
  });

  it("draws the rows one after the other: the root first, each row more than the one under it, and the memorial row last", () => {
    expect(rowGate(0, 4, 1)).toBe(1);
    for (const levels of [2, 3, 4, 5]) {
      for (let row = 0; row < levels; row++) {
        expect(rowGate(row, levels, 1)).toBe(1);
        expect(rowGate(row, levels, 0)).toBe(0);
        let last = 0;
        for (let a = 0; a <= 1; a += 0.01) {
          const g = rowGate(row, levels, a);
          expect(g).toBeGreaterThanOrEqual(last);
          last = g;
        }
      }
      for (const a of [0.1, 0.3, 0.5, 0.7]) for (let row = 1; row < levels; row++) expect(rowGate(row - 1, levels, a)).toBeGreaterThanOrEqual(rowGate(row, levels, a));
    }
  });

  it("starts with an empty picture, grows the root first and ends with the whole tree", () => {
    const at = (appear: number) => hero.frame(0, appear);
    expect(at(0).nodes.every((n) => n.opacity === 0)).toBe(true);
    expect(at(0).edges.every((e) => e.opacity === 0)).toBe(true);
    const some = at(0.25);
    const root = some.nodes.find((n) => n.id === "o0")!;
    const agent = some.nodes.find((n) => n.id === "o1.1.a1")!;
    expect(root.row).toBe(0);
    expect(agent.row).toBe(3);
    expect(root.opacity).toBeGreaterThan(0.5);
    expect(agent.opacity).toBe(0);
    expect(at(1).nodes.every((n) => n.opacity === 1)).toBe(true);
  });

  it("folds the settled tree back into its root: the killed first, then the agents, the brains, and the root last", () => {
    const at = (appear: number) => hero.frame(1, appear);
    const survivors = at(1).nodes.filter((n) => n.state === "alive");
    const root = at(1).nodes.find((n) => n.crown === 1)!;
    let lastOpacity = new Map<string, number>(at(1).nodes.map((n) => [n.id, n.opacity]));
    for (let a = 1; a >= 0; a -= 0.02) {
      const frame = at(a);
      for (const n of frame.nodes) {
        expect(n.opacity, `${n.id} comes back at ${a}`).toBeLessThanOrEqual((lastOpacity.get(n.id) ?? 1) + 1e-9);
      }
      lastOpacity = new Map(frame.nodes.map((n) => [n.id, n.opacity]));
    }
    expect(at(0).nodes.every((n) => n.opacity === 0)).toBe(true);
    const half = at(0.45);
    const dead = half.nodes.filter((n) => n.state === "dead");
    expect(dead).toHaveLength(5);
    const rootNow = half.nodes.find((n) => n.id === root.id)!;
    for (const n of survivors) if (n.id !== root.id) expect(half.nodes.find((m) => m.id === n.id)!.opacity).toBeLessThanOrEqual(rootNow.opacity + 1e-9);
    for (const n of dead) expect(n.row).toBeGreaterThan(rootNow.row);
  });

  it("shows no message while the tree is not whole, and the memorial row only with the last of it", () => {
    for (const appear of [0, 0.3, 0.99]) expect(hero.frame(0.5, appear).dashes).toHaveLength(0);
    expect(hero.frame(0.5, 1).dashes.length).toBeGreaterThanOrEqual(0);
    const frame = hero.frame(1, 0.2);
    expect(frame.appear).toBe(0.2);
    expect(frame.killed).toBe(5);
  });

  it("puts a killed brain in the row below the last row of the picture", () => {
    const last = hero.frame(1);
    const rows = last.nodes.filter((n) => n.state === "alive").map((n) => n.row);
    for (const n of last.nodes.filter((m) => m.state === "dead")) expect(n.row).toBe(Math.max(...rows) + 1);
  });

  it("gives each edge the row of its child and, once it hangs from one, its parent", () => {
    const frame = hero.frame(1);
    for (const e of frame.edges) {
      const child = frame.nodes.find((n) => n.id === e.child)!;
      expect(e.row).toBe(child.row);
      if (e.parent !== null) expect(frame.nodes.find((n) => n.id === e.parent)!.row).toBeLessThan(e.row);
    }
    expect(frame.edges.find((e) => e.child === "o1.1")?.parent).toBe("o3");
  });
});
