import { describe, expect, it } from "vitest";

import { figure, percent, seconds } from "./format";
import {
  assumptions,
  bundleSetting,
  captionFor,
  facts,
  failures,
  heroReading,
  lanesBeats,
  proofSteps,
  settingOf,
  settingText,
  takeover,
  taskName,
  tokens,
  treeBeats,
  waitedSeconds,
} from "./numbers";
import { bundledStory, claimState, resolveClaim } from "./story";
import { fixtureClaimText, FIXTURE_STORY } from "./testing";
import type { Keyframe, KeyframeKind } from "./viz/tree/timeline";
import { TREE_KEYFRAMES } from "./viz/keyframes";

const ascending = (values: number[]) => expect(values).toEqual([...values].sort((a, b) => a - b));

describe("what the page reads from the story", () => {
  it("reads the last point of a workflow of the hero chart", () => {
    expect(heroReading(FIXTURE_STORY, "swarm")).toEqual({ stallS: 7.7, extraCostPct: 3.3, crashes: 5, seeds: 7, profile: "C3" });
    expect(heroReading(FIXTURE_STORY, "central").stallS).toBe(91.1);
    expect(heroReading(FIXTURE_STORY, "central").extraCostPct).toBe(77.7);
  });

  it("knows the task, the model, the seeds and the failures of a hero chart", () => {
    expect(settingOf(FIXTURE_STORY, "v1")).toEqual({ task: "t2_conference", real: true, seeds: 7, crashes: 5, profile: "C3" });
  });

  it("counts the facts of the example from the tree", () => {
    expect(facts(FIXTURE_STORY)).toEqual({ talks: 31, tracks: 4, sessions: 5, orchestrators: 9, agents: 11 });
  });

  it("has nothing, not a guess, where the story has no data", () => {
    expect(heroReading(null, "swarm")).toEqual({ stallS: null, extraCostPct: null, crashes: null, seeds: null, profile: null });
    expect(heroReading(FIXTURE_STORY, "nobody").stallS).toBeNull();
    expect(facts(null)).toEqual({ talks: null, tracks: null, sessions: null, orchestrators: null, agents: null });
    expect(settingOf(null, "v1")).toEqual({ task: null, real: null, seeds: null, crashes: null, profile: null });
    expect(bundleSetting(null)).toEqual({ task: null, real: null, seeds: null, crashes: null, profile: null });
    expect(failures(null)).toEqual({ fastRestart: [], falseDeaths: [], perProcess: null });
    expect(takeover(null)).toEqual({ killed: null, rootChain: [], verdictS: null });
    expect(tokens(null)).toEqual({ coordination: null, recovery: null });
    expect(proofSteps(null)).toEqual([]);
    expect(assumptions(null)).toEqual([]);
    expect(waitedSeconds(null, 0.5)).toBeNull();
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
    expect(captionFor(FIXTURE_STORY, "v1")).toBe("T2 conference planning · 5 coordinators crashed (C3) · real model · 7 seeds");
    expect(captionFor(FIXTURE_STORY, "headline-rows")).toBe("T2 conference planning · 5 coordinators crashed (C3) · real model · 5 seeds");
  });

  it("reads the setting of the demo bundle from the name of its run", () => {
    expect(bundleSetting(FIXTURE_STORY)).toEqual({ task: "t1_extraction", real: false, seeds: 1, crashes: 4, profile: null });
    expect(bundleSetting(bundledStory)).toMatchObject({ task: "t2_conference", real: true, seeds: 1 });
  });

  it("reads who held the root, and what the swarm says about its own failures", () => {
    expect(takeover(FIXTURE_STORY)).toEqual({ killed: 4, rootChain: ["o0", "o7", "o8"], verdictS: 5.5 });
    const found = failures(FIXTURE_STORY);
    expect(found.fastRestart.map((item) => item.value)).toEqual([13.4, 5.9]);
    expect(found.falseDeaths.map((item) => item.value)).toEqual([1.3, 2.3, 2.5]);
    expect(found.perProcess?.value).toBe(0.91);
    expect(tokens(FIXTURE_STORY)).toEqual({ coordination: 7, recovery: 9 });
  });

  it("lists the commands of the proof with the one line each printed", () => {
    const steps = proofSteps(bundledStory);
    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.command)).toEqual([bundledStory.hashes.replay.command, bundledStory.hashes.takeover.command]);
    for (const step of steps) expect(step.lines).toHaveLength(1);
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
    expect(text).toContain(`${c2}–${c3} per run at C2–C3`);
  });
});

describe("where the text sits in the visuals' progress", () => {
  const frame = (kind: KeyframeKind, p: number, extra: Partial<Keyframe> = {}): Keyframe => ({ id: `${kind}@${p}`, kind, label: kind, tMs: 0, p, pEnd: p, ...extra });

  it("names the moments of the tree's story from its keyframes", () => {
    const beats = treeBeats([
      frame("assign", 0.1),
      frame("kill", 0.3, { node: "o0" }),
      frame("verdict", 0.4, { node: "o0" }),
      frame("remap", 0.45, { pEnd: 0.55 }),
      frame("kill", 0.8, { node: "o1" }),
      frame("end", 1),
    ]);
    expect(beats).toEqual({ grown: 0.1, log: 0.2, kill1: 0.3, verdict1: 0.4, heir1: 0.45, adopt1: 0.55, killLast: 0.8, settled: 1 });
  });

  it("follows the verdict of the first kill, not the first verdict", () => {
    const beats = treeBeats([frame("assign", 0), frame("verdict", 0.2, { node: "o9" }), frame("kill", 0.3, { node: "o0" }), frame("verdict", 0.5, { node: "o0" })]);
    expect(beats.verdict1).toBe(0.5);
  });

  it("puts the moments of the real kill sequence in order, and the takeover is a hold", () => {
    const beats = treeBeats(TREE_KEYFRAMES);
    ascending([beats.grown, beats.log, beats.kill1, beats.verdict1, beats.heir1, beats.adopt1, beats.killLast, beats.settled]);
    expect(beats.heir1).toBeLessThan(beats.adopt1);
    expect(beats.settled).toBeLessThanOrEqual(1);
  });

  it("stays a number when the tree has no keyframes", () => {
    for (const value of Object.values(treeBeats([]))) expect(Number.isFinite(value)).toBe(true);
  });

  it("puts the moments of the real in-process run in order, on the clock of the run", () => {
    const lanes = bundledStory.lanes.central;
    const beats = lanesBeats(lanes);
    ascending([beats.filled, beats.crash, beats.restart, beats.redone, beats.end]);
    const crash = lanes.marks.find((mark) => mark.kind === "crash");
    expect(beats.crash).toBeCloseTo((crash?.atMs ?? Number.NaN) / lanes.durationMs, 9);
  });

  it("counts the seconds the work stood still up to a point of the run", () => {
    const lanes = bundledStory.lanes.central;
    expect(waitedSeconds(lanes, 0)).toBe(0);
    expect(waitedSeconds(lanes, 1)).toBeCloseTo(lanes.stall.totalMs / 1000, 6);
    expect(waitedSeconds(lanes, 0.4)!).toBeLessThanOrEqual(waitedSeconds(lanes, 0.8)!);
    expect(waitedSeconds(lanes, 7)).toBe(waitedSeconds(lanes, 1));
  });
});

describe("the story's claims", () => {
  it("resolve to the row's own words and the state its status gives", () => {
    expect(resolveClaim(FIXTURE_STORY, "R2")).toEqual({ id: "R2", text: fixtureClaimText("R2"), state: "allowed" });
    expect(resolveClaim(FIXTURE_STORY, "S5")?.state).toBe("pending");
    expect(resolveClaim(FIXTURE_STORY, "R1")?.state).toBe("refused");
    expect(resolveClaim(FIXTURE_STORY, "S9")).toBeNull();
    expect(resolveClaim(null, "R2")).toBeNull();
  });

  it("never treat a status nobody has classified as allowed", () => {
    expect(claimState("")).toBe("pending");
    expect(claimState("maybe")).toBe("pending");
    expect(claimState("allowed")).toBe("allowed");
    expect(claimState("pending")).toBe("pending");
    expect(claimState("not-claimed")).toBe("refused");
  });
});
