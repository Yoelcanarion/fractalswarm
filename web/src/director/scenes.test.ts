import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../lib/testing";
import { missingSources } from "./sources";
import { SCENE_FILES, SOURCES } from "./scenes";
import { createTake, tooltipTargets } from "./take";
import { fakeReplay, fakeSurface } from "./testing";
import { pointsAtRegion, type Scene } from "./script";
import type { TimeContext } from "./time";

const scenes: Scene[] = SCENE_FILES.map((file) => {
  if (!file.read.ok) throw new Error(`${file.id}: ${file.read.reason}`);
  return file.read.value;
});

const VIDEO_SCRIPT = readFileSync(`${REPO_ROOT}docs/video-script.md`, "utf-8");
const squash = (text: string): string => text.toLowerCase().replace(/\s+/g, " ");

describe("the scenes of the video", () => {
  it("are one file per scene of docs/video-script.md that director mode plays, named by the scene id", () => {
    expect(SCENE_FILES.map((file) => file.id)).toEqual(["s1-arena-open", "s3-ablation", "s4-lens", "s5-recovery", "s6-fair-fight", "s7-where-it-helps", "s8-proof", "s9-close"]);
    for (const file of SCENE_FILES) {
      expect(file.read.ok, file.id).toBe(true);
      expect(file.read.ok && file.read.value.id).toBe(file.id);
      expect(VIDEO_SCRIPT, file.id).toContain(`### ${file.id} `);
    }
  });

  it("are not s2: the intake is recorded live", () => {
    expect(SCENE_FILES.find((file) => file.id === "s2-intake")).toBeUndefined();
    expect(VIDEO_SCRIPT).toMatch(/s2-intake[^\n]*recorded live/);
  });

  it("say on screen only what the video script says on screen: every caption and card line is in it", () => {
    const script = squash(VIDEO_SCRIPT);
    for (const scene of scenes) {
      const words = [
        ...scene.steps.flatMap((step) => (step.do === "caption" ? [step.text, ...(step.kicker === null ? [] : [step.kicker])] : [])),
        ...(scene.card === null ? [] : [scene.card.title, ...scene.card.lines]),
      ];
      for (const text of words) {
        expect(text, `${scene.id}: ${text}`).not.toMatch(/\{\{|\}\}/);
        expect(script, `${scene.id}: "${text}" is not in docs/video-script.md`).toContain(squash(text));
      }
    }
  });

  it("show the replay note on a replay, and nowhere else", () => {
    for (const scene of scenes) expect(scene.replayNote, scene.id).toBe(scene.stage === "arena" || scene.stage === "run");
  });

  it("use the stage the video script gives them", () => {
    const stages = Object.fromEntries(scenes.map((scene) => [scene.id, scene.stage]));
    expect(stages).toEqual({
      "s1-arena-open": "arena",
      "s3-ablation": "ablation",
      "s4-lens": "run",
      "s5-recovery": "run",
      "s6-fair-fight": "arena",
      "s7-where-it-helps": "helps",
      "s8-proof": "arena",
      "s9-close": "title",
    });
  });

  it("last as long as the scene's slot in the video script, to the second", () => {
    const slot = (id: string): number => {
      const found = new RegExp(`### ${id} \\((\\d+):(\\d+)–(\\d+):(\\d+)\\)`).exec(VIDEO_SCRIPT);
      if (!found) throw new Error(`no slot for ${id}`);
      return (Number(found[3]) * 60 + Number(found[4])) - (Number(found[1]) * 60 + Number(found[2]));
    };
    for (const scene of scenes) {
      // the close has a terminal capture before its title card, recorded apart
      if (scene.id === "s9-close") continue;
      expect(scene.durationMs / 1000, scene.id).toBe(slot(scene.id));
    }
  });

  it("name no run: the runs are the manifest's (sources.json) or the address's, and the manifest is the first pair on record", () => {
    // the pair that opens `#/arena` on a fresh clone (demo/pairs.json lists it first), the final kill-half run, the real model,
    // and no ablation until there is one on a person's own text
    const first = (JSON.parse(readFileSync(`${REPO_ROOT}demo/pairs.json`, "utf-8")) as { left: { run_id: string }; right: { run_id: string } }[])[0];
    expect(SOURCES).toEqual({ swarm: first.left.run_id, rival: first.right.run_id, run: "demo-final", ablation: null, real: true });
    expect(JSON.stringify(scenes)).not.toMatch(/t2-real|bench-gate|seed1|demo-/);
  });

  it("open the Muse meter's fold for the scene that points at it, and for no other", () => {
    // the meter is a fold of the run page's strip ("What the models cost"), closed on the page: a ring on it needs it open
    expect(scenes.filter((scene) => pointsAtRegion(scene, "meter")).map((scene) => scene.id)).toEqual(["s4-lens"]);
    const read = (name: string): string => readFileSync(new URL(name, import.meta.url), "utf-8");
    expect(read("./DirectorPage.tsx")).toContain('<RunStageView stage={stage} meterOpen={pointsAtRegion(scene, "meter")} />');
    expect(read("./StageViews.tsx")).toContain("<RunStrip unfold={meterOpen} />");
  });

  it("need only what their stage needs", () => {
    const need = (id: string) => missingSources(scenes.find((scene) => scene.id === id)!.stage, { swarm: null, rival: null, run: null, ablation: null, real: false });
    expect(need("s1-arena-open")).toEqual(["swarm", "rival"]);
    expect(need("s4-lens")).toEqual(["run"]);
    expect(need("s3-ablation")).toEqual(["ablation"]);
    expect(need("s7-where-it-helps")).toEqual([]);
    expect(need("s9-close")).toEqual([]);
  });
});

// A run with two outages of 5.5 s, one named call of each model, and a replay that moves at the clock's own step.
const context: TimeContext = {
  end: 60_000,
  crashes: [
    { at: 10_000, until: 15_500 },
    { at: 30_000, until: 35_500 },
  ],
  // the rival's plan fires at a fraction of its own run: here its first outage is later than the swarm's, as in the pair against
  // the ideal durable supervisor, and the second is earlier than the swarm's
  rivalCrashes: [
    { at: 16_000, until: 21_000 },
    { at: 27_000, until: 32_000 },
  ],
  calls: new Map([
    ["spark", { start: 4000, end: 6500 }],
    ["wonder", { start: 1000, end: 3500 }],
  ]),
};

/** The tooltips of a scene: each says where it points and never what it says. */
describe("the tooltip steps of the scenes", () => {
  it("s8 shows the hover text of both proofs, and has no words of its own", () => {
    const scene = scenes.find((s) => s.id === "s8-proof")!;
    const tips = scene.steps.filter((step) => step.do === "tooltip");
    expect(tips.map((step) => step.do === "tooltip" && step.target)).toEqual([
      { kind: "region", region: "swarm-proof" },
      { kind: "region", region: "rival-proof" },
    ]);
    for (const step of tips) expect(Object.keys(step).sort()).toEqual(["do", "ms", "target"]);
  });

  it("are the ones the page waits for the hover text of before it starts the take, and only those", () => {
    expect(tooltipTargets(scenes.find((s) => s.id === "s8-proof")!)).toEqual([
      { kind: "region", region: "swarm-proof" },
      { kind: "region", region: "rival-proof" },
    ]);
    // a highlight points at things too; it needs no words from them
    expect(scenes.some((s) => s.steps.some((step) => step.do === "highlight"))).toBe(true);
    for (const scene of scenes.filter((s) => s.id !== "s8-proof")) expect(tooltipTargets(scene)).toEqual([]);
  });
});

describe("each scene played on a run of that shape", () => {
  for (const scene of scenes) {
    it(`${scene.id}: runs every step inside its duration, with nothing asked of the page that is not there`, () => {
      const replay = fakeReplay(60_000);
      const take = createTake(scene, scene.stage === "arena" || scene.stage === "run" ? replay : null, fakeSurface({}, context, { x: 300, y: 200, w: 400, h: 200 }, "the hover text of the page"));
      for (let i = 0; i < take.frames; i++) take.tick();
      const state = take.state.getState();
      expect(state.warnings).toEqual([]);
      expect(state.position, `${scene.id} stopped at step ${state.position} of ${scene.steps.length}`).toBe(scene.steps.length);
      expect(state.done).toBe(true);
    });
  }
});
