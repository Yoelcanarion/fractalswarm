import { describe, expect, it } from "vitest";

import { arenaCounters, fingerprint, idleAgents } from "./arena";
import { openArbitrationCount } from "./collisions";
import { ADOPTION_LIFE_MS, adoptionGlow, glow, litMessages, MESSAGE_LIFE_MS, messageGlow, restartProgress } from "./decay";
import { foldEvents, type ViewState } from "./reducer";
import { supervisionTotals } from "./supervision";
import { Stream } from "./testing";

/** root o0 with two agents, started at t = 0. */
function supervised(): Stream {
  const s = new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "central", params: {}, clock: "sim" });
  s.spawn("o0", "root", null);
  s.spawn("o0.a1", "agent", "o0");
  s.spawn("o0.a2", "agent", "o0");
  return s;
}

const llm = (s: Stream, actor: string, id: string, request: Record<string, unknown>, tag = id) =>
  s.emit("effect.started", actor, { kind: "llm", effect_id: id, tag, request });

/** The central baseline's crash, as the run t2-real-c3-central-seed1 logs it: the chaos kill, the
 * crash, the agents' calls cancelled and the agents stopped. */
function centralCrash(s: Stream, at: number, crash = 1): Stream {
  s.at(at).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: "o0", detail: {} });
  s.emit("baseline.crashed", "o0", { coordinator: "o0", crash, dispatched: 2, lost: ["g1/c1", "g1/c2"], restart_in_ms: 5000 });
  s.emit("actor.stopped", "o0.a1", { actor_id: "o0.a1", reason: "crash" });
  s.emit("actor.stopped", "o0.a2", { actor_id: "o0.a2", reason: "crash" });
  return s;
}

function restart(s: Stream, at: number, crash = 1, redo = ["g1/c1", "g1/c2"]): Stream {
  s.at(at).spawn("o0.a1", "agent", "o0").spawn("o0.a2", "agent", "o0");
  s.emit("baseline.restarted", "o0", { coordinator: "o0", crash, redo });
  return s;
}

describe("supervised coordinator", () => {
  it("goes down at baseline.crashed, shows the outage, and comes back at baseline.restarted", () => {
    const s = supervised();
    centralCrash(s, 37_047);
    const down = foldEvents(s.events);
    expect(down.actors.o0.status).toBe("restarting");
    expect(down.actors.o0.outage).toEqual({ crash: 1, sinceTs: 37_047, sinceSeq: expect.any(Number), restartInMs: 5000 });

    restart(s, 42_062);
    const back = foldEvents(s.events);
    expect(back.actors.o0.status).toBe("alive");
    expect(back.actors.o0.outage).toBeUndefined();
    expect(back.actors.o0.restartedTs).toBe(42_062);
    expect(back.actors["o0.a1"].status).toBe("alive"); // respawned
  });

  it("survives the next crash too: the chaos kill no longer pins the node down", () => {
    const s = supervised();
    centralCrash(s, 10_000);
    restart(s, 15_000);
    centralCrash(s, 20_000, 2);
    expect(foldEvents(s.events).actors.o0.status).toBe("restarting");
    restart(s, 25_000, 2);
    const v = foldEvents(s.events);
    expect(v.actors.o0.status).toBe("alive");
    expect(v.counters.kills).toBeGreaterThanOrEqual(2); // each chaos kill of o0 counted
  });

  it("records one entry per crash with the contracts redone", () => {
    const s = supervised();
    centralCrash(s, 10_000);
    restart(s, 15_015, 1, ["g1/c1"]);
    centralCrash(s, 30_000, 2);
    const v = foldEvents(s.events);
    expect(v.supervision.crashes).toHaveLength(2);
    expect(v.supervision.crashes[0]).toMatchObject({
      coordinator: "o0",
      crash: 1,
      ts: 10_000,
      restartInMs: 5000,
      dispatched: 2,
      lost: ["g1/c1", "g1/c2"],
      restartedTs: 15_015,
      redo: ["g1/c1"],
      adopted: null,
    });
    expect(v.supervision.crashes[1].restartedSeq).toBeNull(); // still down
    expect(supervisionTotals(v.supervision)).toEqual({ crashes: 2, restarts: 1, redone: 1, adopted: 0 });
  });
});

describe("durable supervisors", () => {
  it("registers the goals a supervisor keeps in its log", () => {
    const s = supervised();
    s.at(100).emit("goal.opened", "o0", { goal_id: "g1", owner: "o0", parent: null, level: 1, goal: "place the talks of day 1" });
    s.at(200).emit("goal.opened", "o0", { goal_id: "g1.1", owner: "o0", parent: "g1", level: 2, goal: { title: "morning" } });
    const v = foldEvents(s.events);
    expect(v.supervision.goalOrder).toEqual(["g1", "g1.1"]);
    expect(v.supervision.goals["g1.1"]).toMatchObject({ owner: "o0", parent: "g1", level: 2, goal: "morning" });
  });

  it("durable-max loses nothing, and counts what it adopted from the log", () => {
    const s = supervised();
    s.at(1000).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: "o0" });
    s.emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 2, lost: [], restart_in_ms: 5000 });
    s.at(6000).emit("supervisor.adopted", "o0", { results: ["c1", "c2", "c3"], verdicts: 2, plans: [], bookings: { b1: {} }, waiting: ["c4"] });
    s.emit("baseline.restarted", "o0", { coordinator: "o0", crash: 1, redo: [] });
    const v = foldEvents(s.events);
    expect(v.supervision.crashes[0].lost).toEqual([]);
    expect(v.supervision.crashes[0].adopted).toMatchObject({ results: 3, verdicts: 2, plans: 0, bookings: 1, waiting: 1 });
    expect(supervisionTotals(v.supervision)).toMatchObject({ redone: 0, adopted: 3 });
    expect(v.actors.o0.status).toBe("alive");
  });

  it("durable names the own calls it cancelled", () => {
    const s = supervised();
    s.at(1000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 1, lost: ["plan|g1", "judge|g1/c1"], restart_in_ms: 5000 });
    expect(foldEvents(s.events).supervision.crashes[0].lost).toEqual(["plan|g1", "judge|g1/c1"]);
  });
});

describe("arena counters", () => {
  const at = (v: ViewState, now: number) => arenaCounters(v, now);

  it("counts a supervisor crash once, and its down-time from the crash to the restart", () => {
    const s = supervised();
    centralCrash(s, 10_000);
    restart(s, 15_000);
    const v = foldEvents(s.events);
    expect(at(v, 20_000)).toMatchObject({ coordinatorCrashes: 1, coordinatorDownMs: 5000 });
  });

  it("lets an outage that has not ended grow with the playhead", () => {
    const s = supervised();
    centralCrash(s, 10_000);
    const v = foldEvents(s.events);
    expect(at(v, 10_000).coordinatorDownMs).toBe(0);
    expect(at(v, 12_500).coordinatorDownMs).toBe(2500);
    expect(at(v, 14_000).coordinatorDownMs).toBe(4000);
  });

  it("counts agent-time idle while their coordinator is down", () => {
    const s = supervised();
    centralCrash(s, 10_000);
    restart(s, 15_000);
    const v = foldEvents(s.events);
    // Two agents, idle for the 5 s between the crash and the restart.
    expect(at(v, 15_000).idleAgentMs).toBe(2 * 5000);
    expect(at(v, 15_000).idleAgentsNow).toBe(0);
    expect(at(v, 99_000).idleAgentMs).toBe(2 * 5000); // nothing accrues once it is back
  });

  it("does not count an agent that finished, or was killed by chaos, under a coordinator that goes down", () => {
    const s = supervised();
    s.at(500).emit("actor.stopped", "o0.a1", { actor_id: "o0.a1", reason: "done" }); // finished its work
    s.at(600).emit("chaos.injected", "@chaos", { fault: "kill_agent", target: "o0.a2" });
    s.emit("actor.stopped", "chaos", { actor_id: "o0.a2", reason: "chaos" });
    s.at(1000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 0, lost: [], restart_in_ms: 5000 });
    const v = foldEvents(s.events);
    expect(idleAgents(v)).toBe(0); // a1 is done and a2 is dead: nobody is waiting for o0
    expect(at(v, 6000).idleAgentMs).toBe(0);
  });

  it("does not count the agents of a member the detector declared dead without a kill", () => {
    const s = new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "swarm", params: {}, clock: "sim" });
    s.spawn("o0", "root", null).spawn("o1", "track", "o0").spawn("o1.a", "agent", "o1");
    s.at(5000).emit("member.dead", "o0", { member: "o1", last_heard_ms: 1100, missed: 5 }); // a false death
    const v = foldEvents(s.events);
    expect(v.actors.o1.status).toBe("dead");
    expect(idleAgents(v)).toBe(0);
    expect(at(v, 60_000)).toMatchObject({ idleAgentMs: 0, coordinatorCrashes: 0 });
  });

  it("counts an agent the crash stopped, until the restart brings it back", () => {
    const s = supervised();
    s.at(1000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 2, lost: [], restart_in_ms: 5000 });
    s.emit("actor.stopped", "o0", { actor_id: "o0.a1", reason: "crash" });
    s.emit("actor.stopped", "o0", { actor_id: "o0.a2", reason: "crash" });
    expect(idleAgents(foldEvents(s.events))).toBe(2);
    restart(s, 6000, 1, []);
    const v = foldEvents(s.events);
    expect(idleAgents(v)).toBe(0);
    expect(at(v, 9000).idleAgentMs).toBe(2 * 5000);
  });

  it("does not count an agent that is in the middle of a call", () => {
    const s = supervised();
    llm(s, "o0.a1", "e1", { role: "agent", n: 1 });
    s.at(1000).emit("baseline.crashed", "o0", { coordinator: "o0", crash: 1, dispatched: 1, lost: [], restart_in_ms: 5000 });
    const v = foldEvents(s.events);
    expect(idleAgents(v)).toBe(1); // o0.a2 only: o0.a1 is still working (durable-max)
    expect(at(v, 3000).idleAgentMs).toBe(1 * 2000);
  });

  it("counts a swarm kill from the kill to the last takeover event for the victim", () => {
    const s = new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "swarm", params: {}, clock: "sim" });
    s.spawn("o0", "root", null).spawn("o1", "track", "o0").spawn("o1.a", "agent", "o1");
    s.at(50_000).emit("chaos.injected", "@chaos", { fault: "kill_coordinator", target: "o0" });
    s.at(52_000).emit("member.dead", "o1", { member: "o0" });
    s.at(52_300).emit("ownership.remapped", "o1", { key: "g1", owner: "o1", previous: "o0" });
    s.at(52_900).emit("ownership.remapped", "o1", { key: "g2", owner: "o1", previous: "o0" });
    s.at(53_500).emit("msg.sent", "o1", { to: "o1.a", topic: "later" }); // unrelated
    const v = foldEvents(s.events);
    expect(at(v, 60_000)).toMatchObject({ coordinatorCrashes: 1, coordinatorDownMs: 2900 });
  });

  it("counts re-dispatches of lost work, and of an idem_key sent twice", () => {
    const s = supervised();
    const dispatch = (goal: string, contract: string, attempt: number, key: string) =>
      s.emit("contract.dispatched", "o0", { goal_id: goal, contract_id: contract, attempt, assignee: "o0.a1", idem_key: key, work: "w" });
    dispatch("g1", "c1", 1, "k1");
    dispatch("g1", "c2", 1, "k2");
    expect(at(foldEvents(s.events), 0).redispatches).toBe(0);
    s.emit("contract.rejected", "o0", { goal_id: "g1", contract_id: "c1", attempt: 1, stage: "lost", reasons: ["lost in a crash"] });
    dispatch("g1", "c1", 2, "k1b");
    expect(at(foldEvents(s.events), 0).redispatches).toBe(1);
    dispatch("g1", "c2", 1, "k2"); // the same idem_key again: a takeover dispatching it a second time
    expect(at(foldEvents(s.events), 0).redispatches).toBe(2);
    s.emit("contract.rejected", "o0", { goal_id: "g1", contract_id: "c2", attempt: 1, stage: "judge", reasons: ["bad"] });
    dispatch("g1", "c2", 2, "k2c"); // rework after a verdict is not a recovery re-dispatch
    expect(at(foldEvents(s.events), 0).redispatches).toBe(2);
  });

  it("counts a call whose request was cancelled before as duplicated", () => {
    const s = supervised();
    llm(s, "o0.a1", "e1", { role: "agent", prompt: "place talk 7" });
    s.emit("effect.cancelled", "o0.a1", { effect_id: "e1", kind: "llm" });
    llm(s, "o0.a1", "e2", { role: "agent", prompt: "place talk 8" });
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(0);
    llm(s, "o0.a2", "e3", { role: "agent", prompt: "place talk 7" }); // the cancelled work, again
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(1);
    llm(s, "o0.a2", "e4", { role: "agent", prompt: "place talk 7" }); // a third call is not a second duplicate of the cancelled one
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(1);
  });

  it("counts an agent's cancelled call as redone when its contract is dispatched again", () => {
    const s = supervised();
    const dispatch = (attempt: number, key: string) =>
      s.emit("contract.dispatched", "o0", { goal_id: "g1", contract_id: "c1", attempt, assignee: "o0.a1", idem_key: key, work: "w" });
    dispatch(1, "c-aaa");
    llm(s, "o0.a1", "e1", { role: "agent", contract: "c-aaa" }, "c-aaa:1");
    s.emit("effect.cancelled", "o0.a1", { effect_id: "e1", kind: "llm" });
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(0); // cancelled, nothing redone yet
    s.emit("contract.rejected", "o0", { goal_id: "g1", contract_id: "c1", attempt: 1, stage: "lost", reasons: [] });
    dispatch(2, "c-bbb");
    let v = foldEvents(s.events);
    expect(at(v, 0)).toMatchObject({ duplicatedCalls: 1, redispatches: 1 });
    // The redone call has another request (a new attempt), and nothing is counted twice.
    llm(s, "o0.a2", "e2", { role: "agent", contract: "c-bbb" }, "c-bbb:1");
    v = foldEvents(s.events);
    expect(at(v, 0).duplicatedCalls).toBe(1);
  });

  it("counts a cancelled call once even when both its request and its contract come back", () => {
    const s = supervised();
    const dispatch = (key: string) =>
      s.emit("contract.dispatched", "o0", { goal_id: "g1", contract_id: "c1", attempt: 1, assignee: "o0.a1", idem_key: key, work: "w" });
    dispatch("c-aaa");
    llm(s, "o0.a1", "e1", { role: "agent", prompt: "same" }, "c-aaa:1");
    s.emit("effect.cancelled", "o0.a1", { effect_id: "e1", kind: "llm" });
    llm(s, "o0.a2", "e2", { role: "agent", prompt: "same" }); // the same request again
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(1);
    dispatch("c-aaa"); // and the same attempt sent again
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(1);
  });

  it("counts a completed call whose request was already paid for", () => {
    const s = supervised();
    const done = (id: string, status: string) =>
      s.emit("effect.completed", "@env", { effect_id: id, kind: "llm", status, result: { cost_usd: 0.01 } });
    llm(s, "o0.a1", "e1", { role: "agent", prompt: "x" });
    llm(s, "o0.a2", "e2", { role: "agent", prompt: "x" });
    llm(s, "o0.a2", "e3", { role: "agent", prompt: "x" });
    done("e1", "ok");
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(0);
    done("e2", "error"); // not billed: not a duplicate
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(0);
    done("e3", "incomplete"); // billed, and the same request as e1
    expect(at(foldEvents(s.events), 0).duplicatedCalls).toBe(1);
  });

  it("reads cost and the final hard violations from the run", () => {
    const s = supervised();
    s.at(5000).emit("budget.settled", "@kernel", { effect_id: "e1", actual_usd: 0.25, reserved_usd: 0.4 });
    s.at(6000).emit("budget.settled", "@kernel", { effect_id: "e2", actual_usd: 0.5, reserved_usd: 0.4 });
    expect(at(foldEvents(s.events), 0)).toMatchObject({ costUsd: 0.75, hardViolations: null });
    s.at(9000).emit("task.result", "o0", { task: "t2", status: "done", report: { expected: 10, placed: 10, hard_violations: 3, soft_score: 0.5 } });
    expect(at(foldEvents(s.events), 0).hardViolations).toBe(3);
  });

  it("is a pure fold: seeking from a snapshot gives the same counters as folding from the start", () => {
    const s = supervised();
    centralCrash(s, 10_000);
    restart(s, 15_000);
    const whole = foldEvents(s.events);
    const half = s.events.length >> 1;
    const resumed = foldEvents(s.events.slice(half), foldEvents(s.events.slice(0, half)));
    expect(arenaCounters(resumed, 30_000)).toEqual(arenaCounters(whole, 30_000));
  });
});

describe("fingerprint", () => {
  it("is the same for equal requests and different for different ones", () => {
    expect(fingerprint({ a: 1, b: ["x"] })).toBe(fingerprint({ a: 1, b: ["x"] }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe("highlight decay in virtual time", () => {
  it("fades linearly from 1 at the event to 0 after its life", () => {
    expect(glow(1000, 1000, 1200)).toBe(1);
    expect(glow(1600, 1000, 1200)).toBeCloseTo(0.5, 10);
    expect(glow(2200, 1000, 1200)).toBe(0);
    expect(glow(9000, 1000, 1200)).toBe(0);
  });

  it("lights a message for 1.2 s and an adoption for 4 s, at any speed or event density", () => {
    expect(messageGlow(100 + MESSAGE_LIFE_MS, 100)).toBe(0);
    expect(messageGlow(100 + MESSAGE_LIFE_MS / 2, 100)).toBeCloseTo(0.5, 10);
    expect(adoptionGlow(100 + ADOPTION_LIFE_MS / 4, 100)).toBeCloseTo(0.75, 10);
    const flashes = [0, 400, 900, 1100].map((ts, i) => ({ seq: i, ts, from: "a", to: "b", topic: "t" }));
    expect(litMessages(flashes, 1500).map((m) => m.ts)).toEqual([400, 900, 1100]);
    // The same messages a minute later: none, however few events came in between.
    expect(litMessages(flashes, 61_000)).toEqual([]);
  });

  it("fills the restart ring over the crash-to-restart time", () => {
    const outage = { sinceTs: 37_047, restartInMs: 5000 };
    expect(restartProgress(37_047, outage)).toBe(0);
    expect(restartProgress(39_547, outage)).toBeCloseTo(0.5, 10);
    expect(restartProgress(60_000, outage)).toBe(1);
    expect(restartProgress(37_047, { sinceTs: 0, restartInMs: 0 })).toBe(1);
  });

  it("stamps an adoption with its virtual time", () => {
    const s = new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "swarm", params: {}, clock: "sim" });
    s.spawn("o0", "root", null).spawn("o1", "track", "o0").spawn("o2", "track", "o0").spawn("o2.a", "agent", "o2");
    s.at(7000).emit("tree.adopted", "o1", { dead: "o2", adopter: "o1", children: ["o2.a"] });
    const v = foldEvents(s.events);
    expect(v.actors["o2.a"]).toMatchObject({ adoptedBy: "o1", adoptedTs: 7000 });
  });
});

describe("arbitration", () => {
  const dispute = () => {
    const s = new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "swarm", params: {}, clock: "sim" });
    s.spawn("o0", "root", null);
    s.at(1000).emit("collision.detected", "board", { kind: "semantic", key: "speaker:7:room", holders: ["c1", "c2"] });
    return s;
  };

  it("shows a semantic collision with the disputed key", () => {
    const { collisions } = foldEvents(dispute().events).panels;
    expect(collisions.rows).toHaveLength(1);
    expect(collisions.rows[0]).toMatchObject({ kind: "semantic", key: "speaker:7:room", status: "open" });
    expect(collisions.rows[0].conflicts[0]).toMatchObject({ key: "speaker:7:room", holder: "c1 vs c2" });
  });

  it("follows a dispute from the request to the ruling and the resolution", () => {
    const s = dispute();
    s.at(2000).emit("arbitration.requested", "o0", { key: "speaker:7:room", arbiter: "o0" });
    let { collisions } = foldEvents(s.events).panels;
    expect(openArbitrationCount(collisions)).toBe(1);
    expect(collisions.arbitrations[0]).toMatchObject({ key: "speaker:7:room", status: "requested", arbiter: "o0" });

    s.at(4500).emit("arbitration.ruled", "o0", {
      key: "speaker:7:room",
      winner: "c2",
      reason: "the abstract names room B",
      confidence: 0.82,
      evidence: ["email-31", "email-44"],
    });
    s.at(4600).emit("collision.resolved", "o0", { kind: "semantic", key: "speaker:7:room", resolution: "arbitrated" });
    ({ collisions } = foldEvents(s.events).panels);
    expect(openArbitrationCount(collisions)).toBe(0);
    expect(collisions.arbitrations[0]).toMatchObject({
      status: "ruled",
      winner: "c2",
      reason: "the abstract names room B",
      confidence: 0.82,
      evidence: ["email-31", "email-44"],
      requestedTs: 2000,
      ruledTs: 4500,
    });
    expect(collisions.rows[0]).toMatchObject({ status: "resolved", resolution: "arbitrated" });
  });

  it("reads the aliases of the ruling's fields, and a structured winner", () => {
    const s = dispute();
    s.at(2000).emit("arbitration.requested", "o0", { key: "speaker:7:room" });
    s.at(3000).emit("arbitration.ruled", "o0", { key: "speaker:7:room", value: { room: "B" }, rationale: "newer", confidence: "0.5", evidence_ids: ["e1"] });
    const row = foldEvents(s.events).panels.collisions.arbitrations[0];
    expect(row).toMatchObject({ winner: '{"room":"B"}', reason: "newer", confidence: 0.5, evidence: ["e1"] });
  });

  it("keeps a ruling whose request is not in the log", () => {
    const s = dispute();
    s.at(3000).emit("arbitration.ruled", "o0", { key: "speaker:7:room", winner: "c1", reason: "r", confidence: 0.9, evidence: [] });
    expect(foldEvents(s.events).panels.collisions.arbitrations).toHaveLength(1);
  });
});
