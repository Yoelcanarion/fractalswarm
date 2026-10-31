// The scenes on real logs: the two pairs that ship in demo/ (the swarm against the ideal durable supervisor, and against the
// in-process one) and the final kill-half run with the lens rows the server made of it. The other tests of the director play
// logs they made up, and the scenes' moments and actors were written against those; this is what they meet in logs the
// system wrote: adoptions two levels down, the root handed over by an ownership remap, a rival whose first outage comes after
// the swarm's (the durable pair) or just before it (the in-process pair), and a rival run that is half again as long.

import { describe, expect, it } from "vitest";

import { readCalls } from "../lib/lens";
import { foldEvents } from "../lib/reducer";
import { loadFixture, loadJsonl } from "../lib/testing";
import type { RunEvent } from "../lib/types";
import { crashesOf, endOf, resolveActor, type Crash } from "./anchors";
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
const byId = (id: string): Scene => scenes.find((scene) => scene.id === id)!;
const seconds = (crashes: readonly { at: number }[]): number[] => crashes.map((crash) => Math.round(crash.at / 100) / 10);

/** Everything a scene points the camera, a ring or a tooltip at. */
const targetsOf = (scene: Scene): Target[] =>
  scene.steps.flatMap((step) => (step.do === "highlight" || step.do === "tooltip" ? [step.target] : step.do === "camera" && step.fit !== null ? [step.fit] : []));

/** What the page gives a moment of a scene in an arena: the outages of the swarm (else of the rival), the rival's own, the longest end. */
function arenaContext(left: readonly RunEvent[], right: readonly RunEvent[]): TimeContext {
  const own = crashesOf(left);
  const rival = crashesOf(right);
  return { end: Math.max(endOf(left), endOf(right)), crashes: own.length > 0 ? own : rival, rivalCrashes: rival, calls: new Map() };
}

interface Trace {
  state: ReturnType<ReturnType<typeof createTake>["state"]["getState"]>;
  /** The take's clock, the replay's playhead and whether it ran, at each frame. */
  frames: { ms: number; at: number; playing: boolean }[];
  /** Every ring the take drew, with the take's clock when it began. */
  rings: { target: Target; from: number }[];
  /** Every lower third, with the take's clock when it came on and when it goes. */
  captions: { text: string; from: number; to: number }[];
  opened: (string | null)[];
}

/** A scene played to its end on a fake page and a fake replay of the given length, with what it did along the way. */
function play(scene: Scene, context: TimeContext): Trace {
  const replay = fakeReplay(context.end);
  const surface = fakeSurface({}, context, { x: 300, y: 200, w: 400, h: 200 }, "the hover text of the page");
  const take = createTake(scene, scene.stage === "arena" || scene.stage === "run" ? replay : null, surface);
  const frames: Trace["frames"] = [];
  const rings = new Map<number, { target: Target; from: number }>();
  const captions = new Map<number, { text: string; from: number; to: number }>();
  for (let i = 0; i < take.frames; i++) {
    take.tick();
    const state = take.state.getState();
    frames.push({ ms: state.ms, at: replay.playhead(), playing: replay.playing() });
    for (const placed of state.rings) rings.set(placed.ring.id, { target: placed.ring.target, from: placed.ring.from });
    for (const caption of state.captions) captions.set(caption.id, { text: caption.text, from: caption.from, to: caption.to });
  }
  return { state: take.state.getState(), frames, rings: [...rings.values()], captions: [...captions.values()], opened: surface.opened };
}

/** Where the replay was when the take's clock reached ``ms``. */
const playheadAt = (trace: Trace, ms: number): number => trace.frames.find((frame) => frame.ms >= ms)?.at ?? Number.NaN;
const ringOf = (trace: Trace, region: string): { target: Target; from: number } => {
  const ring = trace.rings.find((r) => r.target.kind === "region" && r.target.region === region);
  if (!ring) throw new Error(`no ring on ${region}`);
  return ring;
};

const PAIRS = [
  {
    name: "against the ideal durable supervisor",
    left: loadJsonl("demo/pair-durable-max-swarm/events.jsonl"),
    right: loadJsonl("demo/pair-durable-max-rival/events.jsonl"),
    crashed: ["o0", "o3.1", "o2.1", "o3.2", "o3.3"],
    swarmAt: [40.7, 50.2, 51.5, 56.9, 64.7],
    rivalAt: [46.3, 51.5, 57.6, 64.5, 77.0],
    end: 111.8,
  },
  {
    name: "against the in-process supervisor",
    left: loadJsonl("demo/pair-central-swarm/events.jsonl"),
    right: loadJsonl("demo/pair-central-rival/events.jsonl"),
    crashed: ["o0", "o3.1", "o1.1", "o3.2", "o1.2"],
    swarmAt: [46.8, 57.5, 58.5, 64.7, 75.0],
    rivalAt: [45.9, 62.1, 78.5, 96.0, 114.3],
    end: 154.1,
  },
];
const ARENA_SCENES = ["s1-arena-open", "s6-fair-fight", "s8-proof"];

for (const pair of PAIRS) {
  describe(`the pair ${pair.name}, as the scenes meet it`, () => {
    const context = arenaContext(pair.left, pair.right);
    const crashes = context.crashes as Crash[];
    const rivalCrashes = context.rivalCrashes as Crash[];

    it("has the outages the scenes' moments are tuned to: five of the swarm's, five of the rival's, and the rival's run the longer", () => {
      expect(crashes.map((crash) => crash.coordinator)).toEqual(pair.crashed);
      expect(seconds(crashes)).toEqual(pair.swarmAt);
      expect(seconds(rivalCrashes)).toEqual(pair.rivalAt);
      expect(Math.round(context.end / 100) / 10).toBe(pair.end);
      expect(endOf(pair.right)).toBeGreaterThan(endOf(pair.left));
      for (const crash of [...crashes, ...rivalCrashes]) expect(crash.until).toBeGreaterThan(crash.at);
    });

    it("names the coordinator that crashed first and the heir that took over, on the swarm's side, as s1, s6 and s8 point at them", () => {
      const view = foldEvents(pair.left);
      expect(resolveActor("$crashed:1", { events: pair.left, view, crashes })).toBe("o0");
      expect(resolveActor("$heir:1", { events: pair.left, view, crashes })).toBe("o1");
      expect(resolveActor("$root", { events: pair.left, view: foldEvents(pair.left.filter((e) => e.ts_virtual <= crashes[0].until + 1000)), crashes })).toBe("o1");
    });

    it("has every actor the arena scenes point at, on the side they point at", () => {
      const seen: string[] = [];
      for (const id of ARENA_SCENES) {
        for (const target of targetsOf(byId(id))) {
          if (target.kind !== "actor") continue;
          const events = target.side === "right" ? pair.right : pair.left;
          const view = foldEvents(events);
          const actor = resolveActor(target.actor, { events, view, crashes: target.side === "right" ? rivalCrashes : crashes });
          expect(actor, `${id} points at ${target.actor}`).not.toBeNull();
          expect(view.actors[actor!], `${id}: ${actor} is not in the log`).toBeDefined();
          seen.push(`${id} ${target.actor}`);
        }
      }
      expect(seen.length).toBeGreaterThan(0);
    });

    for (const id of ARENA_SCENES) {
      it(`${id}: runs every step inside its duration, with nothing asked of the replay or the page that the logs have not`, () => {
        const trace = play(byId(id), context);
        expect(trace.state.warnings).toEqual([]);
        expect(trace.state.position, `${id} stopped at step ${trace.state.position} of ${byId(id).steps.length}`).toBe(byId(id).steps.length);
        expect(trace.state.done).toBe(true);
      });
    }

    it("s1 rings the rival's board while its supervisor is down, and not before the swarm's first crash has been shown", () => {
      const trace = play(byId("s1-arena-open"), context);
      const at = playheadAt(trace, ringOf(trace, "rival-board").from);
      expect(at).toBeGreaterThanOrEqual(rivalCrashes[0].at);
      expect(at).toBeLessThan(rivalCrashes[0].until);
      expect(at).toBeGreaterThanOrEqual(crashes[0].at);
      // the swarm's first crash is on screen 14 s into the replay it starts from, about 0:22.5 into the clip: on the voice's "Now we kill half the brains" (video script, s1)
      const crashed = trace.frames.find((frame) => frame.at >= crashes[0].at)!;
      expect(crashed.ms / 1000).toBeGreaterThan(22);
      expect(crashed.ms / 1000).toBeLessThan(23);
      // and the left's re-wire (its heir holds the work) is on screen before the clip ends
      const rewired = trace.frames.find((frame) => frame.at >= crashes[0].until);
      expect(rewired, "the heir takes over before the clip ends").toBeDefined();
      expect(rewired!.ms).toBeLessThan(byId("s1-arena-open").durationMs);
    });

    it("s1 puts its rings and its lower third on the voice's moments: the right, the left, 'same failures', then the first crash (video script, s1)", () => {
      const trace = play(byId("s1-arena-open"), context);
      const right = ringOf(trace, "rival-head").from / 1000;
      const left = ringOf(trace, "swarm-head").from / 1000;
      const lower = trace.captions.find((caption) => caption.text === "Same input · same models · same failures");
      const crashed = trace.frames.find((frame) => frame.at >= crashes[0].at)!.ms;
      // the voice reads the problem to about 0:11 over the arena at rest, then "On the right" and "On the left", then "Same task, same models, same failures"
      expect(right).toBeGreaterThan(11);
      expect(right).toBeLessThan(12);
      expect(left).toBeGreaterThan(right + 3);
      expect(left).toBeLessThan(16);
      expect(lower, "the lower third is shown").toBeDefined();
      expect(lower!.from / 1000).toBeGreaterThan(18);
      expect(lower!.from / 1000).toBeLessThan(19.5);
      // and it is still on when "Now we kill half the brains" lands the first crash, and gone soon after
      expect(lower!.to).toBeGreaterThan(crashed);
      expect(lower!.to - crashed).toBeLessThan(2000);
    });

    it("s6 rings the rival's status at its first outage, then runs both logs to their end and shows the counters", () => {
      const trace = play(byId("s6-fair-fight"), context);
      const status = playheadAt(trace, ringOf(trace, "rival-status").from);
      expect(status).toBeGreaterThanOrEqual(rivalCrashes[0].at);
      expect(status).toBeLessThan(rivalCrashes[0].at + 500);
      // the scoreboard is shown with both runs played out: the counters it points at are the final ones
      expect(playheadAt(trace, ringOf(trace, "scoreboard").from)).toBe(context.end);
    });

    it("s6 rings the whole board and no card of it (one seed would win a row the script does not claim), and draws no camera fit over a shrunken page", () => {
      const scene = byId("s6-fair-fight");
      expect(targetsOf(scene).filter((target) => target.kind === "counter")).toEqual([]);
      expect(scene.steps.filter((step) => step.do === "camera")).toEqual([]);
    });

    it("s6 puts the voice's lower third over the end of the board, once both runs have played out, and the script still ends inside the scene", () => {
      const scene = byId("s6-fair-fight");
      const caption = scene.steps.find((step) => step.do === "caption");
      expect(caption).toMatchObject({ text: "Ten seeds: tied on stall time and extra cost" });
      const trace = play(scene, context);
      expect(trace.state.warnings).toEqual([]);
      const ended = trace.frames.find((frame) => frame.at >= context.end)!;
      expect(ended.ms).toBeLessThan(scene.durationMs - 3000); // room for the lower third to be read before the clip ends
    });

    it("s6 watches the rival's first outage and the takeovers after it at 1x for 11 s, then goes to the end at 10x, and the end of the clip is still for at most 6.5 s, on either pair", () => {
      const scene = byId("s6-fair-fight");
      const trace = play(scene, context);
      // the clip goes 5 s to the outage and 11 s on at 1x: the replay is not 11.5 s past the outage until the clip's clock has passed 15.5 s
      const late = trace.frames.find((frame) => frame.at > rivalCrashes[0].at + 11_500)!;
      expect(late.ms).toBeGreaterThan(15_500);
      // the scoreboard's ring is the last thing that moves: what follows it is the board and the lower third, still
      const ended = trace.frames.find((frame) => frame.at >= context.end)!;
      const ring = scene.steps.flatMap((step) => (step.do === "highlight" && step.target.kind === "region" && step.target.region === "scoreboard" ? [step.ms] : []));
      expect(ring).toHaveLength(1);
      const still = scene.durationMs - (ended.ms + ring[0]);
      expect(still).toBeGreaterThanOrEqual(0);
      expect(still).toBeLessThanOrEqual(6500);
    });

    it("s8 shows the proofs with both runs played out", () => {
      const trace = play(byId("s8-proof"), context);
      expect(playheadAt(trace, ringOf(trace, "swarm-head").from)).toBe(context.end);
    });
  });
}

describe("the final run, as s4 and s5 meet it", () => {
  const events = loadJsonl("demo/final/events.jsonl");
  const crashes = crashesOf(events);
  const rows = readCalls(loadFixture<{ calls: unknown }>("lens-demo-final.json").calls).calls;
  const actor = (ref: string, at = endOf(events)): string | null => resolveActor(ref, { events, view: foldEvents(events.filter((event) => event.ts_virtual <= at)), crashes });
  const context = (scene: Scene): TimeContext => ({ end: endOf(events), crashes, calls: callTimes(rows, scene.calls) });

  it("finds its five outages, the root's first, and the root dying three times", () => {
    expect(crashes.map((crash) => crash.coordinator)).toEqual(["o0", "o2.1", "o1", "o3.2", "o2"]);
    expect(seconds(crashes)).toEqual([53.3, 63.5, 65.5, 74.2, 90.4]);
    expect(Math.round(endOf(events) / 100) / 10).toBe(121.2);
    for (const crash of crashes) expect(crash.until).toBeGreaterThan(crash.at);
  });

  it("names the coordinator that crashed and the heir that took over, as s5 points at them", () => {
    expect(actor("$crashed:1")).toBe("o0");
    expect(actor("$heir:1")).toBe("o1");
    expect(actor("$crashed:2")).toBe("o2.1"); // a coordinator two levels down
    expect(actor("$heir:2")).toBe("o2.2");
  });

  it("puts the root on the root's heir once it has taken over, and not before", () => {
    expect(actor("$root", crashes[0].at - 1000)).toBe("o0");
    expect(actor("$root", crashes[0].until + 1000)).toBe(actor("$heir:1"));
  });

  it("has every actor the run scenes point at", () => {
    const view = foldEvents(events);
    const seen: string[] = [];
    for (const scene of scenes.filter((s) => s.stage === "run")) {
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

  it("has the two calls s4 opens, where the lens rows of the final run put them: the second call of o3.1.a1, the first of the run to publish a fact, and Wonder's root plan", () => {
    const calls = byId("s4-lens").calls;
    const spark = pickCall(rows, calls.spark);
    expect(spark?.purpose).toBe("work");
    expect(spark?.model).toContain("spark");
    expect(spark).toMatchObject({ actor: "o3.1.a1", effect_id: "eff-4696.0" });
    expect(pickCall(rows, calls.wonder)).toMatchObject({ role: "root_planner", model: "muse-wonder-1.0" });
    const times = callTimes(rows, calls);
    expect([...times.keys()].sort()).toEqual(["spark", "wonder"]);
    expect(Math.round(times.get("spark")!.start / 100) / 10).toBe(52.5);
    expect(Math.round(times.get("spark")!.end! / 100) / 10).toBe(59);
    // the sentence behind the decision: no fact is published before this call ends, so the call before it (the one s4 used to open) has no
    // fact or sentence to show, and the lens of this one opens with the fact next to the sentence of the email it came from
    const facts = events.filter((event) => event.type === "fact.published");
    expect(facts[0]).toMatchObject({ ts_virtual: times.get("spark")!.end, payload: { agent: "o3.1.a1", key: "speaker:S01:availability" } });
    // it ends after the first outage began and before the second does: the root is dead and its heir holds it, and the take shows the kill
    expect(times.get("spark")!.end!).toBeGreaterThan(crashes[0].at);
    expect(times.get("spark")!.end!).toBeLessThan(crashes[1].at);
    // Wonder's root plan is done long before: the lens opens a finished call
    expect(times.get("wonder")!.end!).toBeLessThan(times.get("spark")!.start);
  });

  for (const scene of scenes.filter((s) => s.stage === "run")) {
    it(`${scene.id}: runs every step inside its duration, with nothing asked of the replay or the page that the log has not`, () => {
      const trace = play(scene, context(scene));
      expect(trace.state.warnings).toEqual([]);
      expect(trace.state.position, `${scene.id} stopped at step ${trace.state.position} of ${scene.steps.length}`).toBe(scene.steps.length);
      expect(trace.state.done).toBe(true);
    });
  }

  it("s4 plays the tree to the end of the call that publishes the first fact, past the first kill, and opens Wonder's root plan, then that call, then the meter", () => {
    const scene = byId("s4-lens");
    const times = callTimes(rows, scene.calls);
    const trace = play(scene, context(scene));
    const paused = trace.frames.findIndex((frame, i) => i > 0 && trace.frames[i - 1].playing && !frame.playing);
    expect(paused).toBeGreaterThan(0);
    const at = trace.frames[paused].at;
    expect(at).toBeGreaterThanOrEqual(times.get("spark")!.end!);
    // the kill is in the take: the root is dead when the lens opens, and the second outage has not begun
    expect(at).toBeGreaterThan(crashes[0].at);
    expect(at).toBeLessThan(crashes[1].at);
    expect(trace.opened).toEqual(["wonder", "spark", null]);
    // no call is opened from the playhead's future: both have started by the pause, and the replay does not move after it
    for (const name of ["spark", "wonder"]) expect(times.get(name)!.start, name).toBeLessThanOrEqual(at);
    // what the take points at, in order: the drawer, the agent that made the second call (beside the drawer), the sentence the fact rests on, the meter
    const rings = trace.rings.map((ring) => (ring.target.kind === "region" ? ring.target.region : ring.target.kind === "actor" ? ring.target.actor : ring.target.kind));
    expect(rings).toEqual(["lens", "o3.1.a1", "lens-sentence", "meter"]);
  });

  it("s5 shows two outages, the one two levels down first and the root's second, each from just before it to the heir's takeover", () => {
    const scene = byId("s5-recovery");
    const trace = play(scene, context(scene));
    const first = trace.frames.find((frame) => frame.at >= crashes[1].at)!;
    expect(first.at).toBeLessThan(crashes[1].at + 200);
    const rings = trace.rings.filter((ring) => ring.target.kind === "actor").map((ring) => (ring.target.kind === "actor" ? ring.target.actor : ""));
    expect(rings).toEqual(["$crashed:2", "$heir:2", "$crashed:1", "$root"]);
    // the last ring is on the root once its heir holds it
    const root = trace.rings.find((ring) => ring.target.kind === "actor" && ring.target.actor === "$root")!;
    expect(playheadAt(trace, root.from)).toBeGreaterThanOrEqual(crashes[0].until);
  });

  it("s5 runs the tree slowed until the first outage, which lands where the voice says the heartbeats stop, and gives the root's heir the last seconds", () => {
    // voice at 140 wpm: "When one stops sending heartbeats" from 6.0 s, "each survivor computes the same heir" to 12.0 s, "Even the root can die" from 21.4 s
    const scene = byId("s5-recovery");
    const trace = play(scene, context(scene));
    const first = trace.frames.find((frame) => frame.at >= crashes[1].at)!;
    expect(first.ms).toBeGreaterThan(5500);
    expect(first.ms).toBeLessThan(6500);
    // the heir overlay is on when the first heir takes over, 5.4 s later, still at 1x
    const overlay = trace.captions.find((caption) => caption.text.startsWith("heir ="))!;
    expect(overlay.from).toBeGreaterThan(first.ms + 5000);
    expect(overlay.from).toBeLessThan(first.ms + 6000);
    // the root's heir takes over in the last two seconds, and the script is over before the scene is
    const root = trace.rings.find((ring) => ring.target.kind === "actor" && ring.target.actor === "$root")!;
    expect(root.from).toBeGreaterThan(scene.durationMs - 2500);
    expect(trace.state.ms).toBeGreaterThanOrEqual(scene.durationMs - 100);
  });
});

describe("s7, which meets no log", () => {
  it("rings the map, the table, the per-process line and the outcome as the voice reaches each, and ends before its scene does", () => {
    // voice at 140 wpm: "helps" from 0 s, "ties" from 4.7 s, "loses to a fast external restart" from 6.9 s, "false alarms" from 9.9 s
    const scene = byId("s7-where-it-helps");
    const trace = play(scene, { end: 0, crashes: [], calls: new Map() });
    expect(trace.state.warnings).toEqual([]);
    expect(trace.state.position).toBe(scene.steps.length);
    const rings = trace.rings.map((ring) => (ring.target.kind === "region" ? ring.target.region : ring.target.kind));
    expect(rings).toEqual(["map", "table", "process", "outcome"]);
    const at = (region: string): number => ringOf(trace, region).from;
    expect(at("map")).toBeLessThan(1000);
    expect(Math.abs(at("table") - 4700)).toBeLessThan(150);
    expect(Math.abs(at("process") - 6900)).toBeLessThan(150);
    expect(Math.abs(at("outcome") - 9900)).toBeLessThan(150);
    expect(at("outcome") + 2000).toBeLessThanOrEqual(scene.durationMs);
  });
});
