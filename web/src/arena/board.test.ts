import { describe, expect, it } from "vitest";

import { foldEvents } from "../lib/reducer";
import {
  agentsOf,
  boundsOfNodes,
  busyAgents,
  chipState,
  dotState,
  headcount,
  layoutBoard,
  LEAF_ROW_MAX,
  outagesNow,
  pad,
  PITCH,
  rootOf,
  teamSize,
  type Box,
} from "./board";
import { call, CENTRAL_SCENARIO, crash, kill, remapRoot, restart, rivalStream, swarmStream, takeOver, withInfra } from "./testing";

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the board layout", () => {
  const view = foldEvents(swarmStream().events);
  const board = layoutBoard(view);
  const at = (id: string) => board.nodes.find((n) => n.id === id)!;

  it("places every coordinator and agent of the run, parents before children", () => {
    expect(board.nodes.map((n) => n.id)).toEqual(["o0", "o1", "o2", "o1.a1", "o1.a2", "o2.a1", "o2.a2"]);
    expect(board.nodes.filter((n) => n.leaf)).toHaveLength(4);
  });

  it("centres a parent over its children and puts the children one row down", () => {
    const centre = (id: string) => at(id).x + at(id).w / 2;
    expect(centre("o0")).toBeCloseTo((centre("o1") + centre("o2")) / 2, 6);
    expect(at("o1").y).toBeGreaterThan(at("o0").y);
    expect(at("o1").y).toBe(at("o2").y);
  });

  it("hangs a team of agents centred under the coordinator it answers to", () => {
    const team = board.teams.find((t) => t.owner === "o1")!;
    expect(team.leaves).toEqual(["o1.a1", "o1.a2"]);
    const middle = (at("o1.a1").x + at("o1.a2").x + at("o1.a2").w) / 2;
    expect(middle).toBeCloseTo(at("o1").x + at("o1").w / 2, 6);
    expect(at("o1.a1").y).toBeGreaterThan(at("o1").y + at("o1").h);
  });

  it("never draws two nodes on top of each other", () => {
    for (const a of board.nodes) for (const b of board.nodes) if (a !== b) expect(overlaps(a, b), `${a.id} / ${b.id}`).toBe(false);
  });

  it("is a function of the view: the same run gives the same board", () => {
    expect(layoutBoard(foldEvents(swarmStream().events))).toEqual(board);
  });

  it("wraps a large team into rows and keeps them apart", () => {
    const wide = layoutBoard(foldEvents(rivalStream(undefined, 12).events));
    const leaves = wide.nodes.filter((n) => n.leaf);
    expect(leaves).toHaveLength(12);
    expect(new Set(leaves.map((n) => n.y)).size).toBe(2);
    expect(leaves.filter((n) => n.y === leaves[0].y)).toHaveLength(LEAF_ROW_MAX);
    for (const a of wide.nodes) for (const b of wide.nodes) if (a !== b) expect(overlaps(a, b), `${a.id} / ${b.id}`).toBe(false);
    expect(teamSize(12)).toEqual({ w: LEAF_ROW_MAX * PITCH + 12, h: 2 * PITCH + 12 });
  });

  it("changes its structure key when a subtree is adopted, and for nothing else", () => {
    const s = swarmStream();
    const before = layoutBoard(foldEvents(s.events)).structure;
    kill(s, "o1", 10_000);
    const killed = layoutBoard(foldEvents(s.events));
    expect(killed.structure).toBe(before); // a death is not a change of shape: the chip just goes red
    takeOver(s, "o1", "o2", 12_000, 12_500);
    const adopted = layoutBoard(foldEvents(s.events));
    expect(adopted.structure).not.toBe(before);
    expect(adopted.nodes.find((n) => n.id === "o1.a1")?.parent).toBe("o2");
  });

  it("measures the box around its nodes", () => {
    expect(boundsOfNodes([])).toBeNull();
    expect(board.bounds).toEqual(boundsOfNodes(board.nodes));
    expect(pad({ x: 0, y: 0, w: 10, h: 4 }, 2)).toEqual({ x: -2, y: -2, w: 14, h: 8 });
  });

  it("lays out an empty run as nothing", () => {
    const empty = layoutBoard(foldEvents([]));
    expect(empty.nodes).toEqual([]);
    expect(empty.bounds).toBeNull();
  });
});

describe("what each node is doing", () => {
  it("tells a coordinator that is up from one under suspicion, one that is out and one on its way back", () => {
    const s = swarmStream();
    s.at(100).emit("member.suspected", "@detector", { member: "o2" });
    kill(s, "o1", 200);
    const view = foldEvents(s.events);
    expect(chipState(view.actors.o0)).toBe("up");
    expect(chipState(view.actors.o2)).toBe("suspected");
    expect(chipState(view.actors.o1)).toBe("down");

    const supervised = rivalStream();
    crash(supervised, "o0", 300, 5000);
    expect(chipState(foldEvents(supervised.events).actors.o0)).toBe("restarting");
    restart(supervised, "o0", 5300);
    expect(chipState(foldEvents(supervised.events).actors.o0)).toBe("up");
  });

  it("calls an agent working while its model call is in flight, idle after", () => {
    const s = swarmStream();
    call(s, "o1.a1", "e1");
    const during = foldEvents(s.events);
    expect([...busyAgents(during)]).toEqual(["o1.a1"]);
    expect(dotState(during, "o1.a1")).toBe("working");
    expect(dotState(during, "o1.a2")).toBe("idle");
    s.emit("effect.completed", "o1.a1", { effect_id: "e1", status: "ok", result: {} });
    expect(dotState(foldEvents(s.events), "o1.a1")).toBe("idle");
  });

  it("has an idle agent wait while the coordinator it answers to is out, and only then", () => {
    const s = rivalStream(undefined, 3);
    call(s, "o0.a1", "e1");
    crash(s, "o0", 1000, 5000);
    const view = foldEvents(s.events);
    expect(dotState(view, "o0.a1")).toBe("working"); // a durable supervisor's workers finish what they started
    expect(dotState(view, "o0.a2")).toBe("waiting");
    restart(s, "o0", 6000);
    expect(dotState(foldEvents(s.events), "o0.a2")).toBe("idle");
  });

  it("does not make agents wait on a coordinator the detector wrongly declared dead", () => {
    const s = swarmStream();
    s.at(500).emit("member.dead", "@detector", { member: "o1" }); // a false death: no kill came first
    expect(dotState(foldEvents(s.events), "o1.a1")).toBe("idle");
  });

  it("marks an agent the crash stopped as down, and counts it apart from the ones still waiting", () => {
    const s = rivalStream(CENTRAL_SCENARIO, 3);
    crash(s, "o0", 1000, 5000, ["o0.a1", "o0.a2", "o0.a3"]);
    const view = foldEvents(s.events);
    expect(dotState(view, "o0.a1")).toBe("down");
    expect(agentsOf(view, "o0")).toEqual({ agents: 0, idle: 0, stopped: 3 });
    restart(s, "o0", 6000, ["o0.a1", "o0.a2", "o0.a3"]);
    expect(agentsOf(foldEvents(s.events), "o0").agents).toBe(3);
  });
});

describe("the outages a board reports", () => {
  it("counts, for each outage, the agents that answer to the coordinator that is out", () => {
    const s = rivalStream(undefined, 4);
    call(s, "o0.a1", "e1");
    crash(s, "o0", 1000, 5000);
    const view = foldEvents(s.events);
    expect(outagesNow(view, view.arena.windows)).toEqual([
      { coordinator: "o0", since: 1000, agents: 4, idle: 3, stopped: 0, restartInMs: 5000 },
    ]);
  });

  it("has no restart time for the swarm's outage: nothing restarts it, its subtree is adopted", () => {
    const s = swarmStream();
    kill(s, "o1", 1000);
    const view = foldEvents(s.events);
    expect(outagesNow(view, view.arena.windows)[0]).toMatchObject({ coordinator: "o1", restartInMs: null });
  });

  it("counts the coordinators and the agents of a team", () => {
    expect(headcount(foldEvents(swarmStream().events))).toEqual({ coordinators: 3, agents: 4 });
    expect(headcount(foldEvents(rivalStream(undefined, 12).events))).toEqual({ coordinators: 1, agents: 12 });
  });
});

describe("who holds the root", () => {
  it("is the root coordinator, not the infrastructure actors that are spawned without a parent too", () => {
    const s = withInfra(swarmStream());
    expect(rootOf(foldEvents(s.events))).toBe("o0");
    kill(s, "o0", 10_000);
    // o0 is dead and nobody has taken the root yet: the tag stays on o0, never on the board or the network
    expect(rootOf(foldEvents(s.events))).toBe("o0");
  });

  it("moves to the coordinator the log gives the root key to", () => {
    const s = withInfra(swarmStream());
    kill(s, "o0", 10_000);
    remapRoot(s, "o0", "o1", 15_000);
    expect(rootOf(foldEvents(s.events))).toBe("o1");
  });

  it("follows the duties of an adoption when the log says it that way", () => {
    const s = withInfra(swarmStream());
    takeOver(s, "o0", "o2", 10_000, 12_000);
    expect(rootOf(foldEvents(s.events))).toBe("o2");
  });

  it("is the supervisor of a rival", () => {
    expect(rootOf(foldEvents(withInfra(rivalStream()).events))).toBe("o0");
  });

  it("is nobody in an empty run", () => {
    expect(rootOf(foldEvents([]))).toBeNull();
  });
});
