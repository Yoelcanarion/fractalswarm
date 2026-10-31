import { describe, expect, it } from "vitest";

import { systemName, type Assumptions, type SystemKind } from "./assumptions";
import { pairEndText, sideText, type EndSide } from "./pairEndText";

const assumptions = (system: SystemKind, detectionMs = 5000, restartMs = 0): Assumptions => ({
  system,
  name: systemName(system),
  detectionMs,
  restartMs,
  swarmDetectionMs: detectionMs,
  facts: [],
  caption: "",
});

const side = (over: Partial<EndSide> = {}): EndSide => ({
  system: "swarm",
  finished: true,
  completed: true,
  crashes: 5,
  duplicatedCalls: 0,
  placed: 48,
  total: 48,
  ...over,
});

describe("what a side did, by the kind of system it is", () => {
  it("swarm: the coordinators it lost, and that it finished", () => {
    expect(sideText(side(), assumptions("durable-max"))).toBe("Lost 5 coordinators and still finished with all 48 talks placed. No call was paid for twice.");
    expect(sideText(side({ crashes: 1 }), assumptions("durable-max"))).toContain("Lost 1 coordinator and");
    expect(sideText(side({ crashes: 0 }), assumptions("durable-max"))).toBe("No coordinator crashed. It finished with all 48 talks placed. No call was paid for twice.");
  });

  it("an in-process supervisor: its workers stop with it, and the calls paid for again are counted", () => {
    const text = sideText(side({ system: "central", duplicatedCalls: 14 }), assumptions("central"));
    expect(text).toBe("Its supervisor crashed 5 times, and its workers stopped with it each time. It finished with all 48 talks placed. 14 calls paid for again.");
    expect(sideText(side({ system: "central", duplicatedCalls: 1 }), assumptions("central"))).toContain("1 call paid for again.");
  });

  it("an ideal durable supervisor: its workers go on, and the board pauses for what it takes to notice and restart", () => {
    expect(sideText(side({ system: "durable-max" }), assumptions("durable-max"))).toBe(
      "Its supervisor crashed 5 times; its workers kept going and the board paused 5 s each time. It finished with all 48 talks placed. No call was paid for twice.",
    );
    expect(sideText(side({ system: "durable-max" }), assumptions("durable-max", 2500, 1000))).toContain("the board paused 3.5 s each time");
  });

  it("a durable supervisor: its workers go on, but the plan in progress is lost", () => {
    expect(sideText(side({ system: "durable" }), assumptions("durable"))).toContain("the plan and the judging in progress were lost each time");
  });

  it("says when a run did not finish, and how far it got", () => {
    expect(sideText(side({ completed: false, placed: 30 }), assumptions("durable-max"))).toBe("Lost 5 coordinators and did not finish: 30 of 48 talks placed. No call was paid for twice.");
    expect(sideText(side({ system: "central", placed: 40 }), assumptions("central"))).toContain("It finished with 40 of 48 talks placed.");
  });

  it("counts the talks it has when the task is not a list of talks", () => {
    expect(sideText(side({ total: null, placed: 1 }), assumptions("durable-max"))).toContain("finished with 1 talk placed");
  });
});

describe("the end of a pair", () => {
  const pair = (over: Partial<EndSide> = {}) =>
    pairEndText(side(), side({ system: "durable-max", ...over }), assumptions("durable-max"));

  it("says that both runs finished, and names each side", () => {
    const text = pair();
    expect(text.headline).toBe("Both runs finished.");
    expect(text.sides.map((s) => s.who)).toEqual(["FractalSwarm", "Ideal durable supervisor"]);
  });

  it("says when only one finished, or neither", () => {
    expect(pair({ completed: false }).headline).toBe("Only one of the two runs finished.");
    expect(pairEndText(side({ completed: false }), side({ system: "central", completed: false }), assumptions("central")).headline).toBe("Neither run finished.");
  });

  it("states the scope: one run of each, on one seed, under one failure plan, with the rival's setting", () => {
    expect(pair().scope).toBe(
      "This is one run of each, on one seed, under one failure plan, with the rival noticing a crash after 5 s and restarting after 0 s: it shows what happened here, not what usually happens.",
    );
    expect(pairEndText(side(), side({ system: "durable-max" }), assumptions("durable-max", 1000, 500)).scope).toContain("after 1 s and restarting after 0.5 s");
  });

  it("never says who is ahead, or anything docs/claims.md does not allow", () => {
    for (const rival of ["central", "durable-max", "durable"] as const) {
      const text = pairEndText(side(), side({ system: rival }), assumptions(rival));
      const all = [text.headline, text.scope, ...text.sides.map((s) => s.text)].join(" ").toLowerCase();
      for (const word of ["simpler", "cheaper", "more reliable", "better", "wins", "won", "beats", "first"]) expect(all, `${rival}: ${word}`).not.toContain(word);
    }
  });
});
