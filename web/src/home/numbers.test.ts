import { describe, expect, it } from "vitest";

import { captionFor, facts, heroReading, heroSetting, keyframes, seedCount, settingText, taskName } from "./numbers";
import { claimState, resolveClaim, slice } from "./story";
import { FIXTURE_STORY } from "./testing";

describe("what the page reads from the story", () => {
  it("reads the last point of a workflow of the hero chart", () => {
    expect(heroReading(FIXTURE_STORY, "swarm")).toEqual({ stallS: 7.7, extraCostPct: 3.3, crashes: 5, seeds: 2, profile: "C3" });
    expect(heroReading(FIXTURE_STORY, "central").stallS).toBe(91.1);
  });

  it("knows a real model by the title of the hero chart", () => {
    expect(heroSetting(FIXTURE_STORY)).toEqual({ task: "t2_conference", real: true });
  });

  it("has nothing, not a guess, where the story has no data", () => {
    expect(heroReading(null, "swarm")).toEqual({ stallS: null, extraCostPct: null, crashes: null, seeds: null, profile: null });
    expect(heroReading({ claims: {} }, "swarm").stallS).toBeNull();
    expect(facts(null)).toEqual({ talks: null, tracks: null, days: null, sessions: null, orchestrators: null, agents: null });
    expect(seedCount(null, "headline")).toBeNull();
  });

  it("counts the seeds of a slice however it lists them", () => {
    const story = { claims: {}, a: { seeds: ["1", "2", "3"] }, b: { seeds: 4 }, c: { cells: [{ seed: 1 }, { seed: 2 }, { seed: 1 }] }, d: [{ seed: 7 }] };
    expect(seedCount(story, "a")).toBe(3);
    expect(seedCount(story, "b")).toBe(4);
    expect(seedCount(story, "c")).toBe(2);
    expect(seedCount(story, "d")).toBe(1);
    expect(seedCount(story, "missing")).toBeNull();
  });

  it("writes the setting of a result with its task, failures, model and seeds", () => {
    expect(settingText({ task: "t2_conference", crashes: 5, profile: "C3", real: true, seeds: 2 })).toBe("T2 conference · 5 coordinators crashed (C3) · real model · 2 seeds");
    expect(settingText({ task: "t1_x", crashes: 1, profile: null, real: false, seeds: 1 })).toBe("T1 x · 1 coordinator crashed · fake model · 1 seed");
    expect(settingText({ task: null, crashes: null, profile: null, real: null, seeds: null })).toBe("— · — · — · —");
    expect(taskName("t2_conference")).toBe("T2 conference");
  });

  it("names the setting of the 3-seed rows from their own seeds", () => {
    expect(captionFor(FIXTURE_STORY, "headline")).toBe("T2 conference · 5 coordinators crashed (C3) · real model · 3 seeds");
    expect(captionFor(FIXTURE_STORY, "hero")).toBe("T2 conference · 5 coordinators crashed (C3) · real model · 2 seeds");
  });

  it("lets a visual name its keyframes and falls back to the defaults for the rest", () => {
    const story = { claims: {}, tree: { keyframes: { kill1: 0.5, bogus: "x" } } };
    expect(keyframes(story, "tree", { kill1: 0.3, heir1: 0.4 })).toEqual({ kill1: 0.5, heir1: 0.4 });
    expect(keyframes(null, "tree", { a: 1 })).toEqual({ a: 1 });
  });
});

describe("the story's claims", () => {
  it("resolve to the row's own words and the state its status gives", () => {
    expect(resolveClaim(FIXTURE_STORY, "R2")).toEqual({ id: "R2", text: "Test claim R2.", state: "allowed" });
    expect(resolveClaim(FIXTURE_STORY, "S5")?.state).toBe("pending");
    expect(resolveClaim(FIXTURE_STORY, "R1")?.state).toBe("refused");
    expect(resolveClaim(FIXTURE_STORY, "S9")).toBeNull();
    expect(resolveClaim(null, "R2")).toBeNull();
  });

  it("never treat wording nobody has classified as allowed", () => {
    expect(claimState("")).toBe("pending");
    expect(claimState("maybe")).toBe("pending");
    expect(claimState("**allowed** (gate)")).toBe("allowed");
    expect(claimState("allowed by construction; pending the recorded check")).toBe("pending");
    expect(claimState("**not claimed** (outcome B)")).toBe("refused");
  });

  it("walk a dotted path and stop at the first gap", () => {
    expect(slice(FIXTURE_STORY, "hero.series.swarm.points")).toHaveLength(2);
    expect(slice(FIXTURE_STORY, "hero.series.nobody.points")).toBeUndefined();
    expect(slice(null, "a")).toBeUndefined();
  });
});
