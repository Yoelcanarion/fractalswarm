import { describe, expect, it } from "vitest";

import { systemName, type Assumptions, type SystemKind } from "./assumptions";
import { pairEndText, sideText, type EndSide } from "./pairEndText";

/** The words as a person reads them: the no-break space between a number and its unit is a plain space here. */
const plain = (text: string) => text.replace(/\u00a0/g, " ");

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

  it("swarm: says why the takeover check counts more hand-overs than the coordinators lost, in the run page's words, only then, and under the fold", () => {
    const rival = assumptions("durable-max");
    const more = (left: Partial<EndSide>, right: Partial<EndSide> = { system: "durable-max" }) => pairEndText(side(left), side(right), rival).more.join(" ");
    expect(more({ handOvers: 7 })).toBe("The takeover check counts 7 hand-overs for those 5 coordinators: one coordinator's root duties and its subtree are two hand-overs, so there can be more of them than crashes.");
    expect(more({ crashes: 1, handOvers: 2 })).toContain("counts 2 hand-overs for that coordinator:");
    for (const handOvers of [5, 4, 0, null, undefined]) expect(more({ handOvers }), `${handOvers}`).not.toContain("hand-overs");
    expect(more({ crashes: 0, handOvers: 3 })).not.toContain("hand-overs");
    // a supervisor's crashes are not hand-overs
    expect(more({}, { system: "durable-max", handOvers: 7 })).not.toContain("hand-overs");
    // and the two sides stay short: the nuance is not in what a person reads first
    expect(sideText(side({ handOvers: 7 }), rival)).toBe("Lost 5 coordinators and still finished with all 48 talks placed. No call was paid for twice.");
  });

  it("an in-process supervisor: its workers stop with it, and the calls paid for again are counted", () => {
    const text = sideText(side({ system: "central", duplicatedCalls: 14 }), assumptions("central"));
    expect(text).toBe("Its supervisor crashed 5 times, and its workers stopped with it each time. It finished with all 48 talks placed. 14 calls paid for again.");
    expect(sideText(side({ system: "central", duplicatedCalls: 1 }), assumptions("central"))).toContain("1 call paid for again.");
  });

  it("an ideal durable supervisor: its workers go on, and the board pauses for what it takes to notice and restart", () => {
    expect(plain(sideText(side({ system: "durable-max" }), assumptions("durable-max")))).toBe(
      "Its supervisor crashed 5 times; its workers kept going and the board paused 5 s each time. It finished with all 48 talks placed. No call was paid for twice.",
    );
    expect(plain(sideText(side({ system: "durable-max" }), assumptions("durable-max", 2500, 1000)))).toContain("the board paused 3.5 s each time");
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

  it("says when no agent was killed, since the results over ten seeds kill half of them, and only when the logs say so", () => {
    const words = "Here only coordinators crashed and no agent was killed; the results over ten seeds kill half the agents as well.";
    const rival = assumptions("durable-max");
    const of = (agentsKilled: number | undefined, crashes = 5) => pairEndText(side({ agentsKilled, crashes }), side({ system: "durable-max", agentsKilled, crashes }), rival).more.join(" ");
    expect(of(0)).toContain(words);
    expect(of(3)).not.toContain(words);
    expect(of(undefined)).not.toContain(words);
    expect(of(0, 0)).not.toContain(words);
  });

  it("says under the fold what the benchmark does instead, for a pair whose kills were set by hand, and only for that", () => {
    const words = "The benchmark's rule hits each side at the same point of the work instead.";
    const rival = assumptions("durable-max");
    expect(pairEndText(side(), side({ system: "durable-max" }), rival, true).more.join(" ")).toContain(words);
    expect(pairEndText(side(), side({ system: "durable-max" }), rival).more.join(" ")).not.toContain(words);
  });

  it("states the scope: one run of each, on one seed, under one failure plan, with the rival's setting", () => {
    expect(plain(pair().scope)).toBe(
      "This is one run of each, on one seed, under one failure plan, with the rival noticing a crash after 5 s and restarting after 0 s: it shows what happened here, not what usually happens.",
    );
    expect(plain(pairEndText(side(), side({ system: "durable-max" }), assumptions("durable-max", 1000, 500)).scope)).toContain("after 1 s and restarting after 0.5 s");
  });

  it("keeps each number with its unit, so a narrow screen never breaks a line between them", () => {
    expect(pair().scope).toContain("after 5\u00a0s and restarting after 0\u00a0s");
    expect(sideText(side({ system: "durable-max" }), assumptions("durable-max"))).toContain("paused 5\u00a0s each time");
    expect(pair().scope).not.toMatch(/\d s\b/);
  });

  it("never says who is ahead, or anything docs/claims.md does not allow", () => {
    for (const rival of ["central", "durable-max", "durable"] as const) {
      const text = pairEndText(side(), side({ system: rival }), assumptions(rival));
      const all = [text.headline, text.scope, ...text.more, ...text.sides.map((s) => s.text)].join(" ").toLowerCase();
      for (const word of ["simpler", "cheaper", "more reliable", "better", "wins", "won", "beats", "first"]) expect(all, `${rival}: ${word}`).not.toContain(word);
    }
  });
});
