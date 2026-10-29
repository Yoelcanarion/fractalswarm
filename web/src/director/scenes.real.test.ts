// The scenes on a real log: the demo's own, a swarm that lost five coordinators, the root first, with the lens rows the
// server made of it. The other tests of the director play logs they made up, and the scenes' moments and actors were
// written against those; this is what they meet in a log the system wrote: adoptions two levels down, the root handed
// over by an ownership remap, the infrastructure actors beside the tree.

import { describe, expect, it } from "vitest";

import { readCalls } from "../lib/lens";
import { foldEvents } from "../lib/reducer";
import { loadFixture, loadJsonl } from "../lib/testing";
import { crashesOf, endOf, resolveActor } from "./anchors";
import { callTimes, pickCall } from "./calls";
import { SCENE_FILES } from "./scenes";
import { createTake } from "./take";
import { fakeReplay, fakeSurface } from "./testing";
import type { Scene } from "./script";
import type { Target } from "./targets";
import type { TimeContext } from "./time";

const scenes: Scene[] = SCENE_FILES.map((file) => {
  if (!file.read.ok) throw new Error(`${file.id}: ${file.read.reason}`);
  return file.read.value;
});

const events = loadJsonl("demo/backup/events.jsonl");
const crashes = crashesOf(events);
const rows = readCalls(loadFixture<{ calls: unknown }>("lens-demo-backup.json").calls).calls;
const byId = (id: string): Scene => scenes.find((scene) => scene.id === id)!;

/** Everything a scene points the camera, a ring or a tooltip at. */
const targetsOf = (scene: Scene): Target[] =>
  scene.steps.flatMap((step) => (step.do === "highlight" || step.do === "tooltip" ? [step.target] : step.do === "camera" && step.fit !== null ? [step.fit] : []));

/** An actor the way a scene names it, as the page resolves it with the log played up to ``at``. */
const actor = (ref: string, at = endOf(events)): string | null =>
  resolveActor(ref, { events, view: foldEvents(events.filter((event) => event.ts_virtual <= at)), crashes });

describe("the moments and actors of the scenes, on the demo's real log", () => {
  it("finds its five outages, the root's first", () => {
    expect(crashes.map((crash) => crash.coordinator)).toEqual(["o0", "o2.1", "o1", "o3.2", "o2"]);
    expect(crashes.map((crash) => Math.round(crash.at / 100) / 10)).toEqual([44.5, 55.4, 56.7, 65.9, 76.9]);
    for (const crash of crashes) expect(crash.until).toBeGreaterThan(crash.at);
  });

  it("names the coordinator that crashed and the heir that took over, as s1, s5 and s6 point at them", () => {
    expect(actor("$crashed:1")).toBe("o0");
    expect(actor("$heir:1")).toBe("o1");
    expect(actor("$crashed:2")).toBe("o2.1"); // a coordinator two levels down
    expect(actor("$heir:2")).toBe("o2.2");
  });

  it("puts the root on the root's heir once it has taken over, and not before", () => {
    expect(actor("$root", crashes[0].at - 1000)).toBe("o0");
    expect(actor("$root", crashes[0].until + 1000)).toBe(actor("$heir:1"));
  });

  it("has every actor the scenes point at: a fake page puts any target somewhere, so this is where a missing one shows", () => {
    const view = foldEvents(events);
    const seen: string[] = [];
    for (const scene of scenes) {
      for (const target of targetsOf(scene)) {
        if (target.kind !== "actor") continue;
        const id = resolveActor(target.actor, { events, view, crashes });
        expect(id, `${scene.id} points at ${target.actor}`).not.toBeNull();
        expect(view.actors[id!], `${scene.id}: ${id} is not in the log`).toBeDefined();
        seen.push(`${scene.id} ${target.actor}`);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
  });

  it("has the two calls s4 opens, where the lens rows of the demo put them", () => {
    const calls = byId("s4-lens").calls;
    const spark = pickCall(rows, calls.spark);
    expect(spark?.purpose).toBe("work");
    expect(spark?.model).toContain("spark");
    expect(pickCall(rows, calls.wonder)).toMatchObject({ role: "root_planner", model: "muse-wonder-1.0" });
    expect([...callTimes(rows, calls).keys()].sort()).toEqual(["spark", "wonder"]);
  });
});

describe("each scene played on the demo's real log", () => {
  for (const scene of scenes) {
    it(`${scene.id}: runs every step, with nothing asked of the replay or the page that the log has not`, () => {
      const context: TimeContext = { end: endOf(events), crashes, calls: callTimes(rows, scene.calls) };
      const replay = fakeReplay(context.end);
      const take = createTake(scene, scene.stage === "arena" || scene.stage === "run" ? replay : null, fakeSurface({}, context, { x: 300, y: 200, w: 400, h: 200 }, "the hover text of the page"));
      for (let i = 0; i < take.frames; i++) take.tick();
      const state = take.state.getState();
      expect(state.warnings).toEqual([]);
      expect(state.position, `${scene.id} stopped at step ${state.position} of ${scene.steps.length}`).toBe(scene.steps.length);
      expect(state.done).toBe(true);
    });
  }
});
