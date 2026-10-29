// Who holds the root duties, on real recorded logs and on the shapes around them.
//
// The reducer once gave every actor spawned with no parent the root duties, which includes the
// board, the network and the chaos monkey, and ignored the way a real root takeover is logged: an
// `ownership.remapped` of the key `root`, with no `duties`. `rootHolder` then answered "chaos" (the
// last of them) for a run that never lost its root, and never moved on a takeover.
//
// `demo/backup` is committed: a T2 run in which the root and four more coordinators are killed. Its
// root goes o0 -> o1 -> o2 -> o3. The two runs from ~/.fractalswarm/runs are read, never written, and
// their tests skip on a machine that does not have them.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";

import { emptyView, foldEvent, foldEvents, rootHolder } from "./reducer";
import { loadJsonl, Stream } from "./testing";
import type { RunEvent } from "./types";

/** Every point of a log where the root holder changes: the seq of the event and who holds it from there. */
function holderChanges(events: RunEvent[]): [number, string | null][] {
  const changes: [number, string | null][] = [];
  let view = emptyView();
  let last: string | null = null; // before the root is spawned, nobody holds it
  for (const event of events) {
    view = foldEvent(view, event);
    const holder = rootHolder(view);
    if (holder !== last) changes.push([event.seq, holder]);
    last = holder;
  }
  return changes;
}

const rootRemaps = (events: RunEvent[]): RunEvent[] =>
  events.filter((event) => event.type === "ownership.remapped" && event.payload.key === "root");

describe("the demo bundle: a T2 run that loses its root and three more coordinators in turn", () => {
  const events = loadJsonl("demo/backup/events.jsonl");
  const view = foldEvents(events);
  const spawnedAt = (id: string): number => events.find((e) => e.type === "actor.spawned" && e.payload.actor_id === id)!.seq;

  it("spawns the board, the network and the chaos monkey with no parent, as it spawns the root", () => {
    const orphans = events.filter((e) => e.type === "actor.spawned" && !e.payload.parent).map((e) => `${e.payload.actor_id}:${e.payload.kind}`);
    expect(orphans).toEqual(["board:board", "net:net", "o0:orchestrator", "chaos:chaos"]);
  });

  it("gives the root duties to the root alone, and then to each heir, never to the infrastructure", () => {
    for (const id of ["board", "net", "chaos"]) expect(view.actors[id].duties).toEqual([]);
    expect(view.order.filter((id) => view.actors[id].duties.includes("root"))).toEqual(["o0", "o1", "o2", "o3"]);
  });

  it("changes the holder at the root's spawn and at each of the three takeovers, and nowhere else", () => {
    const remaps = rootRemaps(events);
    expect(remaps.map((e) => [e.payload.previous, e.payload.owner])).toEqual([
      ["o0", "o1"],
      ["o1", "o2"],
      ["o2", "o3"],
    ]);
    expect(holderChanges(events)).toEqual([
      [spawnedAt("o0"), "o0"],
      ...remaps.map((e): [number, string] => [e.seq, e.payload.owner]),
    ]);
  });

  it("leaves the duties with a killed root until the log hands them over", () => {
    const [first] = rootRemaps(events);
    const before = foldEvents(events.filter((e) => e.seq < first.seq));
    expect(before.actors.o0.status).toBe("killed");
    expect(before.actors.o0.statusSeq).toBeLessThan(first.seq);
    expect(rootHolder(before)).toBe("o0");
  });

  it("ends with the last heir, which was alive when it took over (the run's end stops every actor)", () => {
    const last = rootRemaps(events).at(-1)!;
    const then = foldEvents(events.filter((e) => e.seq <= last.seq));
    expect(rootHolder(then)).toBe("o3");
    expect(then.actors.o3.status).toBe("alive");
    expect(then.actors.o2.status).toBe("killed");
    expect(rootHolder(view)).toBe("o3");
  });
});

describe("the shapes around it, synthetic", () => {
  const infrastructureFirst = (): Stream =>
    new Stream()
      .spawn("board", "board", null)
      .spawn("net", "net", null)
      .spawn("o0", "orchestrator", null)
      .spawn("chaos", "chaos", null)
      .spawn("o1", "orchestrator", "o0");

  it("never names the infrastructure, whatever order it was spawned in", () => {
    expect(rootHolder(foldEvents(infrastructureFirst().events))).toBe("o0");
    const monkeyFirst = new Stream().spawn("chaos", "chaos", null).spawn("o0", "orchestrator", null).spawn("board", "board", null);
    expect(rootHolder(foldEvents(monkeyFirst.events))).toBe("o0");
    expect(rootHolder(foldEvents(new Stream().spawn("board", "board", null).events))).toBeNull();
  });

  it("moves on a takeover logged the way the runtime logs it: key root, no duties", () => {
    const s = infrastructureFirst().emit("ownership.remapped", "o1", { key: "root", owner: "o1", previous: "o0", works: [] });
    const v = foldEvents(s.events);
    expect(rootHolder(v)).toBe("o1");
    expect(v.actors.o1.duties).toEqual(["root"]);
    expect(v.ownership.root).toBe("o1");
  });

  it("stays put on a reclaim (a member back from a false death takes its own key again)", () => {
    const s = infrastructureFirst().emit("ownership.remapped", "o0", { key: "root", owner: "o0", previous: "o0", works: [] });
    const v = foldEvents(s.events);
    expect(rootHolder(v)).toBe("o0");
    expect(v.actors.o0.duties).toEqual(["root"]);
  });

  it("reads the key from `keys` too, and takes the legacy `duties: [root]` once, not twice", () => {
    const s = infrastructureFirst().emit("ownership.remapped", "o1", { keys: ["root", "track-a"], owner: "o1", duties: ["root"] });
    const v = foldEvents(s.events);
    expect(rootHolder(v)).toBe("o1");
    expect(v.actors.o1.duties).toEqual(["root"]);
  });

  it("is not moved by the remap of another key", () => {
    const s = infrastructureFirst().emit("ownership.remapped", "o1", { key: "track-a", owner: "o1", previous: "o0" });
    expect(rootHolder(foldEvents(s.events))).toBe("o0");
  });

  it("falls back to the root actor when the key's owner is not an actor of the run", () => {
    const s = infrastructureFirst().emit("ownership.assigned", "o0", { key: "root", owner: "ghost" });
    expect(rootHolder(foldEvents(s.events))).toBe("o0");
  });
});

const runPath = (run: string): string => `${homedir()}/.fractalswarm/runs/${run}/events.jsonl`;
const recorded = (run: string): boolean => existsSync(runPath(run));
const readRun = (run: string): RunEvent[] =>
  readFileSync(runPath(run), "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunEvent);

describe.skipIf(!recorded("t2-real-c3-swarm-seed1b"))("a swarm run with a reclaim (real run)", () => {
  const events = readRun("t2-real-c3-swarm-seed1b");

  it("keeps the root where it was: the one remap of the key is o0 taking its own key again", () => {
    const remaps = rootRemaps(events);
    expect(remaps.map((e) => [e.payload.previous, e.payload.owner])).toEqual([["o0", "o0"]]);
    expect(holderChanges(events).map(([, holder]) => holder)).toEqual(["o0"]);
  });
});

describe.skipIf(!recorded("t2-real-c3-central-seed1"))("a central baseline that restarts its coordinator (real run)", () => {
  const events = readRun("t2-real-c3-central-seed1");

  it("never remaps the key, so the supervised coordinator is the root throughout, down or not", () => {
    expect(rootRemaps(events)).toEqual([]);
    expect(holderChanges(events).map(([, holder]) => holder)).toEqual(["o0"]);
  });
});
