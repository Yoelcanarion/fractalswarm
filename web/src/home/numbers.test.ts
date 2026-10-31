import { describe, expect, it } from "vitest";

import { figure, percent, seconds } from "./format";
import {
  assumptions,
  captionFor,
  facts,
  failures,
  gateCrashes,
  heroReading,
  heroSetting,
  limits,
  proofSteps,
  realFalseDeaths,
  runSetting,
  settingText,
  takeover,
  taskName,
  tokens,
} from "./numbers";
import { bundledStory, claimState, resolveClaim, slice } from "./story";
import { fixtureClaimText, FIXTURE_STORY } from "./testing";

describe("what the page reads from the story", () => {
  it("reads the last point of a workflow of the hero chart", () => {
    expect(heroReading(FIXTURE_STORY, "swarm")).toEqual({ stallS: 7.7, extraCostPct: 3.3, crashes: 5, seeds: 7, profile: "C3" });
    expect(heroReading(FIXTURE_STORY, "central").stallS).toBe(91.1);
    expect(heroReading(FIXTURE_STORY, "central").extraCostPct).toBe(77.7);
  });

  it("knows the task, the model, the seeds and the failures of the hero chart", () => {
    expect(heroSetting(FIXTURE_STORY)).toEqual({ task: "t2_conference", real: true, seeds: 7, crashes: 5, profile: "C3" });
  });

  it("reads the crash counts of the gate's two profiles from the failure profiles, and none where they are missing", () => {
    expect(gateCrashes(FIXTURE_STORY)).toEqual([3, 5]);
    expect(gateCrashes(null)).toEqual([]);
    expect(gateCrashes({ ...FIXTURE_STORY, profiles: { ...FIXTURE_STORY.profiles, items: {} } })).toEqual([]);
  });

  it("counts the facts of the example", () => {
    expect(facts(FIXTURE_STORY)).toEqual({ talks: 31, tracks: 4, days: 3, sessions: 5, orchestrators: 9, agents: 11 });
  });

  it("has nothing, not a guess, where the story has no data", () => {
    expect(heroReading(null, "swarm")).toEqual({ stallS: null, extraCostPct: null, crashes: null, seeds: null, profile: null });
    expect(heroReading(FIXTURE_STORY, "nobody").stallS).toBeNull();
    expect(facts(null)).toEqual({ talks: null, tracks: null, days: null, sessions: null, orchestrators: null, agents: null });
    expect(heroSetting(null)).toEqual({ task: null, real: null, seeds: null, crashes: null, profile: null });
    expect(runSetting(null)).toEqual({ task: null, real: null, seeds: null, crashes: null, profile: null });
    expect(failures(null)).toEqual({ fastRestart: [], falseDeaths: [], perProcess: null });
    expect(limits(null)).toEqual({ deaths: null, trackLead: null });
    expect(limits({ ...FIXTURE_STORY, notClaimed: [] })).toEqual({ deaths: null, trackLead: null });
    expect(realFalseDeaths(null)).toBeNull();
    expect(takeover(null)).toEqual({ killed: null, rootChain: [] });
    expect(tokens(null)).toEqual({ coordination: null, recovery: null });
    expect(proofSteps(null)).toEqual([]);
    expect(assumptions(null)).toEqual([]);
  });

  it("writes the setting of a result with its task, failures, model and seeds", () => {
    expect(settingText(FIXTURE_STORY, { task: "t2_conference", crashes: 5, profile: "C3", real: true, seeds: 2 })).toBe(
      "T2 conference planning · 5 coordinators crashed (C3) · real model · 2 seeds",
    );
    expect(settingText(FIXTURE_STORY, { task: "t1_extraction", crashes: 1, profile: null, real: false, seeds: 1 })).toBe(
      "T1 extraction · 1 coordinator crashed · fake model · 1 seed",
    );
    expect(settingText(null, { task: null, crashes: null, profile: null, real: null, seeds: null })).toBe("— · — · — · —");
    expect(taskName(null, "t9_new_task")).toBe("T9 new task");
  });

  it("names the setting of each chart from its own seeds", () => {
    expect(captionFor(FIXTURE_STORY, "hero")).toBe("T2 conference planning · 5 coordinators crashed (C3) · real model · 7 seeds");
    expect(captionFor(FIXTURE_STORY, "headline")).toBe("T2 conference planning · 5 coordinators crashed (C3) · real model · 5 seeds");
  });

  it("reads the setting of the demo run from the finish slice, and who the run killed from the takeover", () => {
    expect(runSetting(FIXTURE_STORY)).toEqual({ task: "t1_extraction", real: false, seeds: 1, crashes: 4, profile: null });
    expect(runSetting(bundledStory)).toMatchObject({ task: "t2_conference", real: true, seeds: 1 });
  });

  it("reads who held the root, and what the swarm says about its own failures", () => {
    expect(takeover(FIXTURE_STORY)).toEqual({ killed: 4, rootChain: ["o0", "o7", "o8"] });
    const found = failures(FIXTURE_STORY);
    expect(found.fastRestart.map((item) => [item.value, item.decimals])).toEqual([
      [13.4, 1],
      [5.9, 1],
    ]);
    expect(found.falseDeaths.map((item) => item.value)).toEqual([1.3, 2.3]);
    expect(found.perProcess?.value).toBe(0.91);
    expect(tokens(FIXTURE_STORY)).toEqual({ coordination: 7, recovery: 9 });
  });

  it("keeps the real runs' false deaths apart: they belong to R4's setting, not to R3's figures", () => {
    expect(failures(FIXTURE_STORY).falseDeaths.some((item) => /real model/.test(item.label))).toBe(false);
    expect(realFalseDeaths(FIXTURE_STORY)).toEqual({ perRun: 2.5, runs: 10 });
    expect(realFalseDeaths(bundledStory)?.runs).toBe(bundledStory.headline?.seedCount);
  });

  it("lists the commands of the proof with the lines each printed", () => {
    const steps = proofSteps(bundledStory);
    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.command)).toEqual([bundledStory.proof.command, bundledStory.proof.takeover.command]);
    expect(steps[0].lines).toEqual(bundledStory.proof.lines);
    expect(steps[1].lines).toEqual([bundledStory.proof.takeover.line]);
  });
});

describe("the numbers the page prints beside a claim are the numbers of its words", () => {
  it("R5: the stall and the extra cost of the two workflows of the first real matrix", () => {
    const text = bundledStory.claims.R5.text;
    const swarm = heroReading(bundledStory, "swarm");
    const central = heroReading(bundledStory, "central");
    for (const printed of [seconds(swarm.stallS), seconds(central.stallS), percent(swarm.extraCostPct), percent(central.extraCostPct)]) {
      expect(text, printed).toContain(printed);
    }
  });

  it("R3: the ratios of the fast external restart, the false deaths of the gate, and the per-process ratio", () => {
    const text = bundledStory.claims.R3.text;
    const found = failures(bundledStory);
    const written = (item: { value: number; decimals?: number }) => figure(item.value, item.decimals);
    expect(found.fastRestart.map(written)).toEqual(["13.2", "5.7"]);
    for (const item of [...found.fastRestart, ...(found.perProcess ? [found.perProcess] : [])]) expect(text, written(item)).toContain(written(item));
    const [c2, c3] = found.falseDeaths.map(written);
    expect(text).toContain(`${c2}–${c3} per run under the two heaviest fault profiles`);
  });
});

describe("the story's claims", () => {
  it("resolve to the row's own words and the state the generator gave", () => {
    expect(resolveClaim(FIXTURE_STORY, "R2")).toEqual({ id: "R2", text: fixtureClaimText("R2"), state: "allowed" });
    expect(resolveClaim(FIXTURE_STORY, "S5")?.state).toBe("pending");
    expect(resolveClaim(FIXTURE_STORY, "R1")?.state).toBe("refused");
    expect(resolveClaim(FIXTURE_STORY, "S9")).toBeNull();
    expect(resolveClaim(null, "R2")).toBeNull();
  });

  it("never treat a state nobody has classified as allowed", () => {
    expect(claimState("")).toBe("pending");
    expect(claimState("maybe")).toBe("pending");
    expect(claimState("toString")).toBe("pending");
    expect(claimState("allowed")).toBe("allowed");
    expect(claimState("pending")).toBe("pending");
    expect(claimState("not-claimed")).toBe("refused");
  });

  it("walk a dotted path and stop at the first gap", () => {
    expect(slice(FIXTURE_STORY, "hero.series.swarm.points")).toHaveLength(2);
    expect(slice(FIXTURE_STORY, "hero.series.nobody.points")).toBeUndefined();
    expect(slice(null, "a")).toBeUndefined();
  });
});
