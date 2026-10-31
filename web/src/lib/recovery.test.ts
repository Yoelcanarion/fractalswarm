import { describe, expect, it } from "vitest";

import { foldEvents } from "./reducer";
import { emptyRecorded, isRecoveryEvent, record, recordedEvents, recoveryAt } from "./recovery";
import { Stream } from "./testing";

/** A supervised run: root o0 with two agents. */
function run(scenario = "central"): Stream {
  const s = new Stream().emit("run.started", "@kernel", { seed: "0", scenario, params: {}, clock: "sim" });
  s.spawn("o0", "orchestrator", null).spawn("o0.a1", "agent", "o0").spawn("o0.a2", "agent", "o0");
  return s;
}

const created = (s: Stream, goal: string, cid: string, dependsOn: string[] = []) =>
  s.emit("contract.created", "o0", { owner: "o0", contract: { id: cid, goal_id: goal, depends_on: dependsOn, assignee: "o0.a1" } });
const dispatched = (s: Stream, goal: string, cid: string, attempt: number, key: string) =>
  s.emit("contract.dispatched", "o0", { goal_id: goal, contract_id: cid, attempt, assignee: "o0.a1", idem_key: key, work: `${goal}/${cid}` });
const verified = (s: Stream, goal: string, cid: string, attempt: number) =>
  s.emit("contract.verified", "o0", { goal_id: goal, contract_id: cid, attempt, work: `${goal}/${cid}` });
const resultSent = (s: Stream, goal: string, cid: string, attempt: number) =>
  s.emit("msg.sent", "o0.a1", { to: "o0", topic: "contract.result", body: { goal_id: goal, contract_id: cid, attempt, agent: "o0.a1" } });
const completed = (s: Stream, goal: string, cid: string, attempt: number) =>
  s.emit("contract.completed", "o0", { goal_id: goal, contract_id: cid, attempt, agent: "o0.a1", status: "ok" });

const asked = (s: Stream, actor: string, id: string, tag: string, request: Record<string, unknown> = { prompt: id }) =>
  s.emit("effect.started", actor, { kind: "llm", effect_id: id, tag, request });
const answered = (s: Stream, id: string, tag: string, status = "ok") =>
  s.emit("effect.completed", "@env", { kind: "llm", effect_id: id, tag, status });
const cancelled = (s: Stream, actor: string, id: string, tag: string) =>
  s.emit("effect.cancelled", actor, { kind: "llm", effect_id: id, tag });

const at = (s: Stream, nowMs = s.ts) => recoveryAt(foldEvents(s.events).arena.recorded, nowMs);

describe("coordinator-dependency time", () => {
  /** Goal g1 (owned by o0) has a contract c1, created at 1 s and sent out at `sentAt`; o0 is down from 10 s to 15 s. */
  function crashed(sentAt: number): Stream {
    const s = run();
    created(s.at(1000), "g1", "c1");
    s.at(10_000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 0, lost: [], restart_in_ms: 5000 });
    s.at(15_000).emit("baseline.restarted", "o0", { coordinator: "o0", crash: 1, redo: [] });
    dispatched(s.at(sentAt), "g1", "c1", 1, "k1");
    return s;
  }

  it("is the time a contract's work waited inside the outage of the coordinator that owned its goal", () => {
    // Ready at 1 s, sent at 16 s: the wait [1 s, 16 s] holds the whole outage [10 s, 15 s].
    expect(at(crashed(16_000))).toMatchObject({ dependencyMs: 5000, blockedMs: 15_000 });
  });

  it("counts only the part of a wait that lies inside the outage", () => {
    expect(at(crashed(12_000))).toMatchObject({ dependencyMs: 2000, blockedMs: 11_000 });
  });

  it("is nothing for a wait that ended before the coordinator went down", () => {
    expect(at(crashed(9000))).toMatchObject({ dependencyMs: 0, blockedMs: 8000 });
  });

  it("counts a wait only once it has ended: an outage that is still going has cost nothing yet", () => {
    const s = run();
    created(s.at(1000), "g1", "c1");
    s.at(10_000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 0, lost: [], restart_in_ms: 5000 });
    expect(at(s, 14_000)).toMatchObject({ dependencyMs: 0, blockedMs: 0 });
  });

  it("does not count work waiting on another coordinator's goals", () => {
    const s = run();
    s.spawn("o1", "orchestrator", "o0");
    s.at(500).emit("goal.opened", "o1", { goal_id: "g2", owner: "o1", parent: null, level: 1, goal: "elsewhere" });
    created(s.at(1000), "g2", "c1");
    s.at(10_000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 0, lost: [], restart_in_ms: 5000 });
    s.at(15_000).emit("baseline.restarted", "o0", { coordinator: "o0", crash: 1, redo: [] });
    dispatched(s.at(16_000), "g2", "c1", 1, "k1");
    expect(at(s)).toMatchObject({ dependencyMs: 0, blockedMs: 15_000 });
  });

  it("measures a result waiting to be taken in, from the agent's result to the coordinator's completion", () => {
    const s = run();
    created(s.at(1000), "g1", "c1");
    dispatched(s.at(1000), "g1", "c1", 1, "k1");
    s.at(10_000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 1, lost: [], restart_in_ms: 5000 });
    resultSent(s.at(12_000), "g1", "c1", 1); // the agent finished while its coordinator was down
    s.at(15_000).emit("baseline.restarted", "o0", { coordinator: "o0", crash: 1, redo: [] });
    completed(s.at(15_500), "g1", "c1", 1);
    // result [12 s, 15.5 s] inside the outage [10 s, 15 s]: 3 s; the dispatch wait is zero-length.
    expect(at(s)).toMatchObject({ dependencyMs: 3000, blockedMs: 3500 });
  });

  it("swarm: an outage ends at the first takeover of each goal, so each goal waits a different time", () => {
    const s = run("swarm");
    s.spawn("o1", "orchestrator", "o0");
    s.at(1000).emit("ownership.assigned", "o0", { key: "g1", owner: "o0", group: "o0" });
    s.emit("ownership.assigned", "o0", { key: "g2", owner: "o0", group: "o0" });
    for (const goal of ["g1", "g2"]) {
      created(s.at(2000), goal, "c1");
      dispatched(s.at(3000), goal, "c1", 1, `k-${goal}`);
    }
    s.at(50_000).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: "o0", detail: {} });
    resultSent(s.at(49_000 + 1500), "g1", "c1", 1); // sent 0.5 s into the outage, taken in at 53 s
    resultSent(s.at(50_500), "g2", "c1", 1);
    s.at(52_300).emit("ownership.remapped", "o1", { key: "g1", owner: "o1", previous: "o0", works: [] });
    s.at(52_900).emit("ownership.remapped", "o1", { key: "g2", owner: "o1", previous: "o0", works: [] });
    completed(s.at(53_000), "g1", "c1", 1);
    completed(s.at(53_100), "g2", "c1", 1);
    // g1: result [50.5 s, 53 s] inside the outage [50 s, 52.3 s] = 1.8 s; g2: [50.5 s, 53.1 s] inside [50 s, 52.9 s] = 2.4 s.
    expect(at(s).dependencyMs).toBe(1800 + 2400);
  });

  it("an outage that is still open ends at the playhead, so a wait that closes later is only counted so far", () => {
    const s = run("swarm");
    s.at(1000).emit("ownership.assigned", "o0", { key: "g1", owner: "o0", group: "o0" });
    created(s.at(2000), "g1", "c1");
    dispatched(s.at(3000), "g1", "c1", 1, "k1");
    s.at(50_000).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: "o0", detail: {} });
    resultSent(s.at(51_000), "g1", "c1", 1);
    completed(s.at(60_000), "g1", "c1", 1); // nobody took the goal over: the log goes on with o0's own completion
    expect(at(s, 60_000).dependencyMs).toBe(9000);
  });
});

describe("idle agent-seconds", () => {
  const give = (s: Stream, goal: string, cid: string, agent: string) =>
    s.emit("contract.created", "o0", { owner: "o0", contract: { id: cid, goal_id: goal, depends_on: [], assignee: agent } });
  const send = (s: Stream, goal: string, cid: string, attempt: number, agent: string) =>
    s.emit("contract.dispatched", "o0", { goal_id: goal, contract_id: cid, attempt, assignee: agent, idem_key: `k-${goal}-${cid}-${attempt}`, work: `${goal}/${cid}` });
  const report = (s: Stream, goal: string, cid: string, attempt: number, agent: string) =>
    s.emit("msg.sent", agent, { to: "o0", topic: "contract.result", body: { goal_id: goal, contract_id: cid, attempt, agent } });

  /** A swarm. Session g1 has two contracts: c1 went to a1, which handed it in and was paid at 6 s; c2 went to a2, which hands
   * its result in at 22 s. The coordinator o0 is killed at 20 s and the session is taken over at 25 s, which is when the result
   * is taken in: it waited 3 s on a coordinator that was down. a1 and a2 both hold nothing for those 3 s. */
  function sessionLosesItsCoordinator(): Stream {
    const s = run("swarm");
    s.spawn("o1", "orchestrator", "o0");
    s.at(1000).emit("ownership.assigned", "o0", { key: "g1", owner: "o0", group: "o0" });
    give(s, "g1", "c1", "o0.a1");
    give(s, "g1", "c2", "o0.a2");
    send(s.at(1500), "g1", "c1", 1, "o0.a1");
    send(s.at(2000), "g1", "c2", 1, "o0.a2");
    report(s.at(5000), "g1", "c1", 1, "o0.a1");
    completed(s.at(6000), "g1", "c1", 1);
    s.at(20_000).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: "o0", detail: {} });
    report(s.at(22_000), "g1", "c2", 1, "o0.a2");
    s.at(25_000).emit("ownership.remapped", "o1", { key: "g1", owner: "o1", previous: "o0", works: [] });
    completed(s, "g1", "c2", 1);
    return s;
  }

  it("is the time the agents of a session were free while its work waited on a coordinator that was down", () => {
    const s = sessionLosesItsCoordinator();
    expect(at(s)).toMatchObject({ dependencyMs: 3000, idleMs: 2 * 3000 });
  });

  it("is nothing when no outage held anything up", () => {
    expect(at(run("swarm"))).toMatchObject({ dependencyMs: 0, idleMs: 0 });
    const s = run();
    created(s.at(1000), "g1", "c1");
    s.at(10_000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 0, lost: [], restart_in_ms: 5000 });
    s.at(15_000).emit("baseline.restarted", "o0", { coordinator: "o0", crash: 1, redo: [] });
    dispatched(s.at(9000), "g1", "c1", 1, "k1"); // sent before the crash: the wait ended while the owner was up
    expect(at(s).idleMs).toBe(0);
  });

  it("does not count an agent that holds an attempt, only the ones that are free", () => {
    const s = sessionLosesItsCoordinator();
    send(s.at(21_000), "g1", "c3", 1, "o0.a1"); // a1 takes another attempt before the result arrives and never hands it in
    expect(at(s).idleMs).toBe(3000); // a2 alone
  });

  it("counts an agent only for as long as it was alive", () => {
    const s = sessionLosesItsCoordinator();
    s.at(23_000).emit("actor.stopped", "o0.a2", { actor_id: "o0.a2", reason: "chaos" });
    expect(at(s).idleMs).toBe(3000 + 1000); // a2 is gone from 23 s, so its free time stops there
  });

  it("counts only the agents that served the session that waited", () => {
    const s = sessionLosesItsCoordinator();
    s.spawn("o0.a3", "agent", "o0"); // never given anything of g1
    expect(at(s).idleMs).toBe(2 * 3000);
  });

  it("ignores the playhead: an outage that has not ended costs the same however far on it is read", () => {
    const s = run("swarm");
    s.at(1000).emit("ownership.assigned", "o0", { key: "g1", owner: "o0", group: "o0" });
    give(s, "g1", "c1", "o0.a1");
    send(s.at(3000), "g1", "c1", 1, "o0.a1");
    s.at(50_000).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: "o0", detail: {} });
    report(s.at(51_000), "g1", "c1", 1, "o0.a1");
    completed(s.at(60_000), "g1", "c1", 1); // nobody took the goal over: o0's own completion ends the wait
    const figures = at(s, 60_000);
    expect(figures.idleMs).toBe(9000);
    expect(at(s, 3_600_000)).toEqual(figures);
  });

  it("says whether a crash has stopped workers, so far", () => {
    const s = run();
    expect(at(s).crashStopped).toBe(false);
    s.at(10_000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 0, lost: [], restart_in_ms: 5000 });
    expect(at(s).crashStopped).toBe(false);
    s.emit("actor.stopped", "o0.a1", { actor_id: "o0.a1", reason: "crash" });
    expect(at(s).crashStopped).toBe(true);
  });

  it("is read once for each change of the log: a frame that brings no event costs a lookup", () => {
    const s = sessionLosesItsCoordinator();
    const rows = foldEvents(s.events).arena.recorded;
    expect(recoveryAt(rows, 30_000)).toBe(recoveryAt(rows, 31_000));
  });
});

describe("duplicated work", () => {
  const dup = (s: Stream) => at(s).duplicatedCalls;

  it("counts the calls of an attempt that a later attempt of its contract replaced, once that attempt is verified", () => {
    const s = run();
    created(s, "g1", "c1");
    dispatched(s, "g1", "c1", 1, "k1");
    asked(s, "o0.a1", "e1", "k1:1");
    answered(s, "e1", "k1:1");
    expect(dup(s)).toBe(0); // nothing replaced it
    dispatched(s, "g1", "c1", 2, "k2");
    asked(s, "o0.a2", "e2", "k2:1");
    answered(s, "e2", "k2:1");
    expect(dup(s)).toBe(0); // the contract is not settled: neither attempt is wasted yet
    verified(s, "g1", "c1", 2);
    expect(dup(s)).toBe(1); // attempt 1's call paid for work that attempt 2 did again
  });

  it("counts every call of the replaced attempt, including one that was cancelled", () => {
    const s = run();
    dispatched(s, "g1", "c1", 1, "k1");
    asked(s, "o0.a1", "e1", "k1:1");
    answered(s, "e1", "k1:1");
    asked(s, "o0.a1", "e2", "k1:2");
    cancelled(s, "o0.a1", "e2", "k1:2");
    dispatched(s, "g1", "c1", 2, "k2");
    asked(s, "o0.a2", "e3", "k2:1");
    answered(s, "e3", "k2:1");
    verified(s, "g1", "c1", 2);
    expect(dup(s)).toBe(2);
  });

  it("does not count a failed call, which cost nothing", () => {
    const s = run();
    dispatched(s, "g1", "c1", 1, "k1");
    asked(s, "o0.a1", "e1", "k1:1");
    answered(s, "e1", "k1:1", "error");
    dispatched(s, "g1", "c1", 2, "k2");
    verified(s, "g1", "c1", 2);
    expect(dup(s)).toBe(0);
  });

  it("counts an own call (plan, judge, scan) that was asked again, once the second one has completed", () => {
    const s = run();
    asked(s, "o0", "p1", "plan|g1|0");
    cancelled(s, "o0", "p1", "plan|g1|0"); // the crash took it
    asked(s, "o0", "p2", "plan|g1|0", { prompt: "p1" });
    expect(dup(s)).toBe(0); // asked again, not answered yet
    answered(s, "p2", "plan|g1|0");
    expect(dup(s)).toBe(1);
  });

  it("counts a completed call whose request was already paid for, but not a failed one", () => {
    const s = run();
    asked(s, "o0.a1", "e1", "t1", { prompt: "x" });
    asked(s, "o0.a2", "e2", "t2", { prompt: "x" });
    asked(s, "o0.a2", "e3", "t3", { prompt: "x" });
    answered(s, "e1", "t1");
    expect(dup(s)).toBe(0);
    answered(s, "e2", "t2", "error");
    expect(dup(s)).toBe(0);
    answered(s, "e3", "t3", "incomplete");
    expect(dup(s)).toBe(1);
  });

  it("does not tell two requests apart by the order of their keys", () => {
    const s = run();
    asked(s, "o0.a1", "e1", "t1", { a: 1, b: { c: 2, d: [3] } });
    asked(s, "o0.a2", "e2", "t2", { b: { d: [3], c: 2 }, a: 1 });
    answered(s, "e1", "t1");
    answered(s, "e2", "t2");
    expect(dup(s)).toBe(1);
  });
});

describe("the recorded events", () => {
  it("keeps what the figures read and drops the rest", () => {
    const s = run();
    s.emit("effect.started", "o0", { kind: "timer", effect_id: "t1", tag: "member.tick" });
    s.emit("effect.started", "o0", { kind: "firewall", effect_id: "f1", tag: "scan|g1|x" });
    s.emit("effect.started", "o0", { kind: "firewall", effect_id: "f2", tag: "other" });
    s.emit("msg.sent", "o0", { to: "o1", topic: "heartbeat", body: {} });
    s.emit("msg.sent", "o0.a1", { to: "o0", topic: "book.result", body: { goal_id: "g", contract_id: "c", attempt: 0 } });
    const kept = s.events.filter(isRecoveryEvent).map((e) => `${e.type}:${String(e.payload.effect_id ?? e.payload.topic ?? e.payload.actor_id ?? "")}`);
    expect(kept).toEqual(["run.started:", "actor.spawned:o0", "actor.spawned:o0.a1", "actor.spawned:o0.a2", "effect.started:f1", "msg.sent:book.result"]);
  });

  it("is persistent: a view keeps its own events when the fold goes on", () => {
    const s = run();
    let rows = emptyRecorded();
    const seen: number[] = [];
    const views: (typeof rows)[] = [];
    for (let i = 0; i < 150; i++) {
      s.emit("contract.dispatched", "o0", { goal_id: "g", contract_id: `c${i}`, attempt: 0, assignee: "o0.a1", idem_key: `k${i}` });
      rows = record(rows, s.events[s.events.length - 1]);
      views.push(rows);
      seen.push(recordedEvents(rows).length);
    }
    expect(seen).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(recordedEvents(views[10])).toHaveLength(11); // unchanged by the 139 events after it
    expect(recordedEvents(views[70])).toHaveLength(71); // across a chunk boundary
  });

  it("is the same whether folded whole or resumed from a snapshot", () => {
    const s = crashedWithWait();
    const half = s.events.length >> 1;
    const whole = foldEvents(s.events);
    const resumed = foldEvents(s.events.slice(half), foldEvents(s.events.slice(0, half)));
    expect(recoveryAt(resumed.arena.recorded, 30_000)).toEqual(recoveryAt(whole.arena.recorded, 30_000));
  });
});

function crashedWithWait(): Stream {
  const s = run();
  created(s.at(1000), "g1", "c1");
  s.at(10_000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 0, lost: [], restart_in_ms: 5000 });
  s.at(15_000).emit("baseline.restarted", "o0", { coordinator: "o0", crash: 1, redo: [] });
  dispatched(s.at(16_000), "g1", "c1", 1, "k1");
  asked(s, "o0.a1", "e1", "k1:1");
  answered(s, "e1", "k1:1");
  return s;
}
