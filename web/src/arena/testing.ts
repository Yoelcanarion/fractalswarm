// Synthetic logs for the arena's tests, in the shape the recorded pairs have (a swarm of
// orchestrators with agents under them, and a supervisor with its workers), so every test builds the
// run it needs without a fixture file.

import { Stream } from "../lib/testing";

export const SWARM_SCENARIO = "fractalswarm.actors.swarm:SWARM";
export const DURABLE_MAX_SCENARIO = "fractalswarm.actors.swarm:DURABLE_MAX";
export const CENTRAL_SCENARIO = "fractalswarm.actors.swarm:CENTRAL";

export const started = (scenario: string, params: Record<string, unknown> = {}): Stream =>
  new Stream().emit("run.started", "@kernel", { seed: "1", scenario, params, clock: "sim" });

/** o0 over o1 and o2, two agents under each. */
export function swarmStream(params: Record<string, unknown> = {}): Stream {
  const s = started(SWARM_SCENARIO, params);
  s.spawn("o0", "orchestrator", null).spawn("o1", "orchestrator", "o0").spawn("o2", "orchestrator", "o0");
  s.spawn("o1.a1", "agent", "o1").spawn("o1.a2", "agent", "o1").spawn("o2.a1", "agent", "o2").spawn("o2.a2", "agent", "o2");
  return s;
}

/** A supervisor o0 with ``workers`` workers directly under it. */
export function rivalStream(scenario = DURABLE_MAX_SCENARIO, workers = 4, params: Record<string, unknown> = {}): Stream {
  const s = started(scenario, params);
  s.spawn("o0", "orchestrator", null);
  for (let i = 1; i <= workers; i++) s.spawn(`o0.a${i}`, "agent", "o0");
  return s;
}

/** The chaos monkey kills ``target`` at ``at``. */
export function kill(s: Stream, target: string, at: number): Stream {
  s.at(at).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target, detail: {} });
  return s.emit("actor.stopped", target, { actor_id: target, reason: "chaos" });
}

/** The swarm's takeover of ``dead`` by ``adopter``: the detector's verdict, then the adoption. */
export function takeOver(s: Stream, dead: string, adopter: string, deadAt: number, adoptedAt: number): Stream {
  s.at(deadAt).emit("member.dead", "@detector", { member: dead });
  return s.at(adoptedAt).emit("tree.adopted", adopter, { dead, adopter, duties: dead === "o0" ? ["root"] : [] });
}

/** The supervisor's crash of ``coordinator`` at ``at`` and its restart ``restartMs`` later. A crash of an
 * in-process supervisor (``stopWorkers``) stops its workers too. */
export function crash(s: Stream, coordinator: string, at: number, restartMs: number, stopWorkers: string[] = []): Stream {
  s.at(at).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: coordinator, detail: {} });
  s.emit("baseline.crashed", coordinator, { coordinator, crash: 1, dispatched: 2, lost: [], restart_in_ms: restartMs });
  for (const id of stopWorkers) s.emit("actor.stopped", id, { actor_id: id, reason: "crash" });
  return s;
}

export function restart(s: Stream, coordinator: string, at: number, respawn: string[] = []): Stream {
  s.at(at);
  for (const id of respawn) s.spawn(id, "agent", coordinator);
  return s.emit("baseline.restarted", coordinator, { coordinator, crash: 1, redo: [] });
}

/** An agent of ``actor`` starts a model call at the stream's time. */
export const call = (s: Stream, actor: string, id: string): Stream =>
  s.emit("effect.started", actor, { kind: "llm", effect_id: id, tag: id, request: { id } });

/** The infrastructure actors of a real run: the board and the network are spawned without a parent, like the root. */
export function withInfra(s: Stream): Stream {
  return s.spawn("board", "board", null).spawn("net", "net", null);
}

/** The root key changes hands, as a takeover of the root is logged (`ownership.remapped`, no `duties`). */
export function remapRoot(s: Stream, from: string, to: string, at: number): Stream {
  return s.at(at).emit("ownership.remapped", "@kernel", { key: "root", owner: to, previous: from, works: [] });
}
