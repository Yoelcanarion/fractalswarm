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
  /** Every ring the take drew, with the take's clock when it began and when it goes. */
  rings: { target: Target; from: number; to: number }[];
  /** Every tooltip, the same. */
  tips: { target: Target; from: number; to: number }[];
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
  const rings = new Map<number, { target: Target; from: number; to: number }>();
  const tips = new Map<number, { target: Target; from: number; to: number }>();
  const captions = new Map<number, { text: string; from: number; to: number }>();
  for (let i = 0; i < take.frames; i++) {
    take.tick();
    const state = take.state.getState();
    frames.push({ ms: state.ms, at: replay.playhead(), playing: replay.playing() });
    for (const placed of state.rings) rings.set(placed.ring.id, { target: placed.ring.target, from: placed.ring.from, to: placed.ring.to });
    for (const placed of state.tips) tips.set(placed.tip.id, { target: placed.tip.target, from: placed.tip.from, to: placed.tip.to });
    for (const caption of state.captions) captions.set(caption.id, { text: caption.text, from: caption.from, to: caption.to });
  }
  return { state: take.state.getState(), frames, rings: [...rings.values()], tips: [...tips.values()], captions: [...captions.values()], opened: surface.opened };
}

/** Where the replay was when the take's clock reached ``ms``. */
const playheadAt = (trace: Trace, ms: number): number => trace.frames.find((frame) => frame.ms >= ms)?.at ?? Number.NaN;
/** The rings on a region, in the order they came on. */
const ringsOn = (trace: Trace, region: string): Trace["rings"] => trace.rings.filter((r) => r.target.kind === "region" && r.target.region === region);
const ringOf = (trace: Trace, region: string): Trace["rings"][number] => {
  const ring = ringsOn(trace, region)[0];
  if (!ring) throw new Error(`no ring on ${region}`);
  return ring;
};
/** The regions and actors the take pointed at, in order. */
const pointedAt = (trace: Trace): string[] => trace.rings.map((ring) => (ring.target.kind === "region" ? ring.target.region : ring.target.kind === "actor" ? ring.target.actor : ring.target.kind));
/** The take's clock at the first frame whose replay had reached ``at``, in seconds. */
const clockAt = (trace: Trace, at: number): number => trace.frames.find((frame) => frame.at >= at)!.ms / 1000;

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

    it("s1 rings the rival's board a second time while its supervisor is down, and not before the swarm's first crash has been shown", () => {
      const trace = play(byId("s1-arena-open"), context);
      const rings = ringsOn(trace, "rival-board");
      expect(rings).toHaveLength(2);
      const at = playheadAt(trace, rings[1].from);
      expect(at).toBeGreaterThanOrEqual(rivalCrashes[0].at);
      expect(at).toBeLessThan(rivalCrashes[0].until);
      expect(at).toBeGreaterThanOrEqual(crashes[0].at);
      // the swarm's first crash is on screen 22.5 s into the replay it starts from, and so 0:22.5 into the clip: on the voice's "Now we kill half the brains" (video script, s1)
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
      const lower = trace.captions.find((caption) => caption.text === "Same task · same models · same failures");
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

    it("s1 moves from its first frame: the replay runs from 22.5 s before the swarm's first crash, at 1x, with no hold and no jump, and rings the rival's board on 'on one coordinator'", () => {
      const scene = byId("s1-arena-open");
      const trace = play(scene, context);
      expect(scene.steps.slice(0, 2).map((step) => step.do)).toEqual(["seek", "play"]);
      expect(trace.frames[0].playing).toBe(true);
      expect(Math.abs(trace.frames[0].at - (crashes[0].at - 22_500))).toBeLessThan(100);
      // never faster than the clock, never back: the first frames are the run at rest, and then the run moving
      for (let i = 1; i < trace.frames.length && trace.frames[i].at < crashes[0].at + 1000; i++) {
        const step = trace.frames[i].at - trace.frames[i - 1].at;
        expect(step, `frame ${i}`).toBeGreaterThan(0);
        expect(step, `frame ${i}`).toBeLessThan(20);
      }
      // the voice says "on one coordinator" from 2.6 to 3.9 s: the ring is on from about 2 to 6.9 s, "It plans, assigns and checks the work" included
      const first = ringsOn(trace, "rival-board")[0];
      expect(Math.abs(first.from - 2000)).toBeLessThan(100);
      expect(Math.abs(first.to - 6900)).toBeLessThan(100);
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

    it("s8 reports the supervisor's recovery first and says 'heir' over the swarm's takeover chip, from 7.5 s to the end: the voice's last clause", () => {
      // voice at 140 wpm: "And you don't have to trust us" from 0 s, "replays bit for bit from a hash-chained log" to 8.1 s, "a checker recomputes every heir from it" from 8.1 to 11.6 s
      const scene = byId("s8-proof");
      const trace = play(scene, context);
      expect(pointedAt(trace)).toEqual(["rival-head", "swarm-head"]);
      expect(trace.tips.map((tip) => (tip.target.kind === "region" ? tip.target.region : ""))).toEqual(["rival-proof", "swarm-proof"]);
      const swarm = trace.tips[1];
      expect(Math.abs(swarm.from - 7500)).toBeLessThan(150);
      expect(swarm.to).toBeGreaterThan(11_500);
      expect(swarm.to).toBeLessThanOrEqual(scene.durationMs);
      expect(trace.tips[0].to).toBeLessThanOrEqual(ringOf(trace, "swarm-head").from + 100); // one tooltip at a time
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
    // and the root's second death: its heir holds the root a second before the whole outage is over, which is where s5's last ring begins
    expect(actor("$root", crashes[2].at - 500)).toBe("o1");
    expect(actor("$root", crashes[2].until - 900)).toBe(actor("$heir:3"));
    expect(actor("$heir:3")).toBe("o2");
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

  it("s4 plays the tree to the end of the call that publishes the first fact, past the first kill and the hand-over's glide, and opens Wonder's root plan, then that call, then the meter", () => {
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
    // the heir's hand-over glides for 450 ms of the replay's own time, and a tree paused inside it holds a frozen glide: the pause is after it
    expect(at).toBeGreaterThanOrEqual(crashes[0].until + 450);
    expect(trace.opened).toEqual(["wonder", "spark", null]);
    // no call is opened from the playhead's future: both have started by the pause, and the replay does not move after it
    for (const name of ["spark", "wonder"]) expect(times.get(name)!.start, name).toBeLessThanOrEqual(at);
    // what the take points at, in order: the drawer, the agent that made the second call (beside the drawer), the sentence the fact rests on, the meter
    expect(pointedAt(trace)).toEqual(["lens", "o3.1.a1", "lens-sentence", "meter"]);
  });

  it("s4 runs to the hand-over fast and through it at 1x, and the lens follows the voice from the pause, to the second", () => {
    // voice at 140 wpm: "Muse Wonder plans" to 3.0 s, "Muse Spark agents read the emails, place the talks and check the results" to 8.6 s, "Click any call ... the sentence behind the decision" from 8.6 to 15.9 s ("and the sentence behind the decision" from 13.3 s), "Zero LLM tokens spent on coordination" to 18.4 s
    const scene = byId("s4-lens");
    const trace = play(scene, context(scene));
    const paused = trace.frames.findIndex((frame, i) => i > 0 && trace.frames[i - 1].playing && !frame.playing);
    // the replay is paused at 59.3 s of its own time wherever the 25x frames fall, which is 3.0 to 3.35 s into the clip
    const pause = trace.frames[paused].ms;
    expect(pause / 1000).toBeGreaterThan(2.9);
    expect(pause / 1000).toBeLessThan(3.4);
    // fast until 500 ms before the hand-over, then the replay's own pace: the glide plays out in real time, 0.5 s of it before the pause
    expect(Math.abs(clockAt(trace, crashes[0].until - 500) - 2.34)).toBeLessThan(0.15);
    const hand = trace.frames.filter((frame) => frame.at >= crashes[0].until && frame.at <= crashes[0].until + 450);
    expect(hand.length).toBeGreaterThan(25);
    expect(hand.every((frame) => frame.playing)).toBe(true);
    const named = (ring: Trace["rings"][number]): string => (ring.target.kind === "region" ? ring.target.region : ring.target.kind === "actor" ? ring.target.actor : "");
    const [lens, agent, sentence, meter] = ["lens", "o3.1.a1", "lens-sentence", "meter"].map((name) => trace.rings.find((ring) => named(ring) === name)!);
    expect(Math.abs(lens.from - pause)).toBeLessThan(40);
    expect(Math.abs(agent.from - (pause + 2000))).toBeLessThan(40);
    expect(Math.abs(sentence.from - (pause + 10_250))).toBeLessThan(40);
    expect(Math.abs(meter.from - (pause + 12_850))).toBeLessThan(40);
    expect(meter.to).toBeLessThanOrEqual(scene.durationMs);
    expect(meter.to).toBeGreaterThan(18_000);
    // the camera fits the call once, and no ring is drawn while it holds on the call's figures
    expect(scene.steps.filter((step) => step.do === "camera" && step.fit !== null)).toHaveLength(1);
    expect(trace.rings.filter((ring) => ring.from > agent.to && ring.from < sentence.from)).toEqual([]);
  });

  it("s5 shows two outages, the one two levels down first and the root's second, each from just before it to the heir's takeover", () => {
    const scene = byId("s5-recovery");
    const trace = play(scene, context(scene));
    const first = trace.frames.find((frame) => frame.at >= crashes[1].at)!;
    expect(first.at).toBeLessThan(crashes[1].at + 200);
    const rings = trace.rings.filter((ring) => ring.target.kind === "actor").map((ring) => (ring.target.kind === "actor" ? ring.target.actor : ""));
    expect(rings).toEqual(["$crashed:2", "$crashed:3", "$heir:2", "$root"]);
    // the last ring is on the root once its heir holds it: 950 ms before the outage is over, which is when the heir takes the root
    const root = trace.rings.find((ring) => ring.target.kind === "actor" && ring.target.actor === "$root")!;
    expect(playheadAt(trace, root.from)).toBeGreaterThanOrEqual(crashes[2].until - 1000);
    expect(playheadAt(trace, root.from)).toBeLessThan(crashes[2].until);
  });

  it("s5 runs on in order, never back: slowed to the first outage, to a quarter of that speed for the heir, and back to 1x on the root's death", () => {
    // voice at 140 wpm: "When one stops sending heartbeats" from 6.0 s, "computes the same heir" from 9.0 s, "Even the root can die" from 14.1 s, "The heir adopts the work" from 16.3 s, "and every result already in the log" from 18.4 s
    const scene = byId("s5-recovery");
    const trace = play(scene, context(scene));
    for (let i = 1; i < trace.frames.length; i++) expect(trace.frames[i].at, `frame ${i}`).toBeGreaterThanOrEqual(trace.frames[i - 1].at);
    expect(scene.steps.filter((step) => step.do === "seek")).toHaveLength(1);
    expect(scene.steps.filter((step) => step.do === "camera")).toEqual([]); // a fit over the tree zooms the page's edges out of the frame
    const outage = (index: number): number => clockAt(trace, crashes[index].at);
    expect(Math.abs(outage(1) - 6.0)).toBeLessThan(0.3);
    expect(Math.abs(outage(2) - 14.1)).toBeLessThan(0.4);
    // the heir overlay comes on at "computes the same heir", while the replay creeps, and is gone before the root dies
    const overlay = trace.captions.find((caption) => caption.text.startsWith("heir ="))!;
    expect(Math.abs(overlay.from - 9500)).toBeLessThan(250);
    expect(overlay.to).toBeLessThanOrEqual(outage(2) * 1000 + 200);
    // the first heir takes over on "The heir adopts the work", the root's heir a second later, on "every result"
    expect(Math.abs(clockAt(trace, crashes[1].until) - 17.5)).toBeLessThan(0.4);
    expect(Math.abs(clockAt(trace, crashes[2].until - 950) - 18.55)).toBeLessThan(0.4);
    const heir = trace.rings.find((ring) => ring.target.kind === "actor" && ring.target.actor === "$heir:2")!;
    const root = trace.rings.find((ring) => ring.target.kind === "actor" && ring.target.actor === "$root")!;
    expect(heir.to).toBeLessThanOrEqual(root.from + 150); // one ring at a time on the takeovers
    // the replay is paused on the root's heir, and the script is over before the scene is
    expect(root.to).toBeLessThanOrEqual(scene.durationMs);
    expect(trace.frames.at(-1)!.playing).toBe(false);
    expect(trace.state.ms).toBeGreaterThanOrEqual(scene.durationMs - 100);
  });
});

describe("s7, which meets no log", () => {
  it("rings the three rows of the regime map and then the outcome as the voice reaches each, with no camera, and ends before its scene does", () => {
    // voice at 140 wpm: "It helps when a supervisor restarts slowly" to 3.0 s, "or loses its in-flight calls" to 5.1 s, "It ties the ideal one" to 7.3 s, "It loses to a fast external restart" to 10.3 s, "and its detector raises false alarms" to 12.9 s
    const scene = byId("s7-where-it-helps");
    const trace = play(scene, { end: 0, crashes: [], calls: new Map() });
    expect(trace.state.warnings).toEqual([]);
    expect(trace.state.position).toBe(scene.steps.length);
    expect(scene.steps.filter((step) => step.do === "camera")).toEqual([]);
    expect(pointedAt(trace)).toEqual(["restart-row", "gate-row", "fast-restart-row", "outcome"]);
    const [restart, gate, fast, outcome] = trace.rings;
    expect(restart.from).toBeLessThan(1000);
    expect(Math.abs(restart.to - 3000)).toBeLessThan(150);
    expect(Math.abs(gate.from - 5200)).toBeLessThan(150);
    expect(Math.abs(fast.from - 7300)).toBeLessThan(150);
    expect(Math.abs(outcome.from - 10_300)).toBeLessThan(150);
    // from the in-flight calls no row of the map is ringed: that rival is not on it, and the lower third says what was measured. After it each
    // ring ends where the next begins, and the outcome's goes to the end of the scene
    expect(Math.abs(gate.to - fast.from)).toBeLessThan(150);
    expect(Math.abs(fast.to - outcome.from)).toBeLessThan(150);
    expect(Math.abs(outcome.to - scene.durationMs)).toBeLessThan(150);
    expect(trace.state.ms).toBeLessThanOrEqual(scene.durationMs + 1);
  });

  it("seats its lower third on the right: at the left it hides the fast restart row's chips, and that row's ring comes on (7.3 s) while the third is still up (to 7.8 s)", () => {
    expect(byId("s7-where-it-helps").steps.find((step) => step.do === "caption")).toMatchObject({ style: "lower", align: "right" });
  });
});
