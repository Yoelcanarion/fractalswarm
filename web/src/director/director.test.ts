import { describe, expect, it } from "vitest";

import { DURABLE_MAX_SCENARIO, crash, kill, restart, rivalStream, swarmStream, takeOver } from "../arena/testing";
import { emptyView, foldEvents } from "../lib/reducer";
import { crashesOf, resolveActor, subtreeOf } from "./anchors";
import { FRAME_H, FRAME_W, HOME, cameraAt, contentRect, fit, lerp, lookAt, panned, speedAt, transformOf, union, zoomedTo } from "./camera";
import { FADE_MS, addCaption, captionOpacity, envelope, liveCaptions, ringOpacity } from "./overlay";
import { createProgram, type Host } from "./program";
import { parseScene, type Step } from "./script";
import { framesOf, createTake } from "./take";
import { selectorsOf } from "./targets";
import { fakeReplay, fakeSurface, sceneOf, target } from "./testing";
import { formatTime, parseTime, resolveTime, type TimeContext } from "./time";

const context: TimeContext = {
  end: 60_000,
  crashes: [
    { at: 10_000, until: 15_500 },
    { at: 30_000, until: 35_500 },
  ],
  calls: new Map([["spark", { start: 4000, end: 6500 }], ["open", { start: 8000, end: null }]]),
};
const at = (value: unknown): number | null => resolveTime(parseTime(value, "t"), context);

describe("a moment of the replay", () => {
  it("is a number of ms as it is, or an anchor with an optional offset", () => {
    expect(at(12_000)).toBe(12_000);
    expect(at("start")).toBe(0);
    expect(at("end")).toBe(60_000);
    expect(at("crash:1")).toBe(10_000);
    expect(at("crash:2-4s")).toBe(26_000);
    expect(at("recovered:1+500ms")).toBe(16_000);
    expect(at("end-2.5s")).toBe(57_500);
    expect(at("call:spark+1s")).toBe(5000);
    expect(at("call-end:spark")).toBe(6500);
  });

  it("counts crashes from the end with a negative index", () => {
    expect(at("crash:-1")).toBe(30_000);
    expect(at("crash:-2")).toBe(10_000);
    expect(at("recovered:-1")).toBe(35_500);
  });

  it("is null when the run does not have it, and never before the start", () => {
    expect(at("crash:3")).toBeNull();
    expect(at("crash:-3")).toBeNull();
    expect(at("call:nope")).toBeNull();
    expect(at("call-end:open")).toBeNull();
    expect(at("start-5s")).toBe(0);
  });

  it("refuses what is not a moment, with the reason", () => {
    for (const bad of ["crash:0", "crash:", "crash:1-4m", "soon", "-5", -5, "call:", "crash:1 - 4s", null, {}, true]) {
      expect(() => parseTime(bad, "scene.steps[0].to"), JSON.stringify(bad)).toThrow(/scene\.steps\[0\]\.to/);
    }
    expect(() => parseTime(Number.NaN, "t")).toThrow();
  });

  it("is written back the way it was read", () => {
    for (const text of ["crash:1", "crash:2-4000ms", "recovered:-1+500ms", "end", "call-end:spark+250ms", "start"]) expect(formatTime(parseTime(text, "t"))).toBe(text);
    expect(formatTime(parseTime(3000, "t"))).toBe("3000 ms");
  });
});

const arenaScene = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: "s6-test", title: "A scene", stage: "arena", duration_ms: 20_000, steps: [], ...extra });
const reason = (raw: unknown): string => {
  const read = parseScene(raw);
  if (read.ok) throw new Error("the scene was accepted");
  return read.reason;
};

describe("a scene script", () => {
  it("reads every kind of step into its normal form", () => {
    const scene = sceneOf({
      calls: undefined,
      steps: [
        { do: "seek", to: "crash:1-4s" },
        { do: "speed", x: 5, ramp_ms: 800 },
        { do: "play" },
        { do: "wait", until: "crash:1" },
        { do: "wait", ms: 1500 },
        { do: "pause" },
        { do: "camera", fit: { actor: "$crashed:1", side: "left", subtree: true }, pad: 0.2, ms: 900, ease: "out" },
        { do: "camera", home: true, ms: 0 },
        { do: "highlight", target: { counter: "idle" }, ms: 2000 },
        { do: "caption", text: "Same input", kicker: "Fair fight", ms: 3000 },
        { do: "caption", text: "heir = highest hash", ms: 2500, style: "overlay" },
        { do: "panel", name: "scoreboard", show: false },
      ],
    });
    expect(scene.steps).toEqual<Step[]>([
      { do: "seek", to: { anchor: { kind: "crash", index: 1 }, offsetMs: -4000 } },
      { do: "speed", x: 5, rampMs: 800 },
      { do: "play" },
      { do: "wait", ms: null, until: { anchor: { kind: "crash", index: 1 }, offsetMs: 0 }, timeoutMs: null },
      { do: "wait", ms: 1500, until: null, timeoutMs: null },
      { do: "pause" },
      { do: "camera", fit: { kind: "actor", actor: "$crashed:1", side: "left", subtree: true }, zoom: null, pan: null, pad: 0.2, ms: 900, ease: "out" },
      { do: "camera", fit: null, zoom: null, pan: null, pad: 0.1, ms: 0, ease: "inout" },
      { do: "highlight", target: { kind: "counter", counter: "idle" }, ms: 2000 },
      { do: "caption", text: "Same input", kicker: "Fair fight", ms: 3000, style: "lower" },
      { do: "caption", text: "heir = highest hash", kicker: null, ms: 2500, style: "overlay" },
      { do: "panel", name: "scoreboard", show: false },
    ]);
    expect(scene.replayNote).toBe(true);
  });

  it("refuses a field it does not know, a step of the wrong shape, and says where", () => {
    expect(reason({ ...arenaScene(), colour: "red" })).toMatch(/scene\.colour/);
    expect(reason(arenaScene({ steps: [{ do: "dance" }] }))).toMatch(/scene\.steps\[0\]\.do/);
    expect(reason(arenaScene({ steps: [{ do: "play" }, { do: "caption", text: "x", ms: 1000, colour: "red" }] }))).toMatch(/scene\.steps\[1\]\.colour/);
    expect(reason(arenaScene({ steps: [{ do: "speed", x: 100 }] }))).toMatch(/scene\.steps\[0\]\.x/);
    expect(reason(arenaScene({ steps: [{ do: "caption", text: "x".repeat(201), ms: 1000 }] }))).toMatch(/1 to 200 characters/);
    expect(reason(arenaScene({ steps: [{ do: "caption", text: "x", ms: 100 }] }))).toMatch(/\.ms/);
    expect(reason(arenaScene({ duration_ms: 10 }))).toMatch(/scene\.duration_ms/);
    expect(reason(arenaScene({ id: "Not A Slug" }))).toMatch(/scene\.id/);
    expect(reason("not a scene")).toMatch(/expected an object/);
  });

  it("wants a wait to say what it waits for", () => {
    expect(reason(arenaScene({ steps: [{ do: "wait" }] }))).toMatch(/one of the two/);
    expect(reason(arenaScene({ steps: [{ do: "wait", ms: 100, until: "end" }] }))).toMatch(/one of the two/);
    expect(reason(arenaScene({ steps: [{ do: "wait", ms: 100, timeout_ms: 500 }] }))).toMatch(/timeout/);
  });

  it("wants a camera step to fit a target or go home", () => {
    expect(reason(arenaScene({ steps: [{ do: "camera" }] }))).toMatch(/one of the two/);
    expect(reason(arenaScene({ steps: [{ do: "camera", home: true, fit: { region: "swarm" } }] }))).toMatch(/one of the two/);
    expect(reason(arenaScene({ steps: [{ do: "camera", home: true, zoom: 2 }] }))).toMatch(/takes no zoom/);
    expect(reason(arenaScene({ steps: [{ do: "camera", fit: { region: "swarm" }, zoom: 20 }] }))).toMatch(/zoom from 0.25 to 8/);
  });

  it("wants a target to name one thing, on a stage that has it", () => {
    expect(reason(arenaScene({ steps: [{ do: "highlight", target: { actor: "root", region: "swarm" }, ms: 1000 }] }))).toMatch(/exactly one/);
    expect(reason(arenaScene({ steps: [{ do: "highlight", target: { region: "nowhere" }, ms: 1000 }] }))).toMatch(/not a region/);
    expect(reason(arenaScene({ steps: [{ do: "highlight", target: { region: "lens" }, ms: 1000 }] }))).toMatch(/not on the arena stage/);
    expect(reason(arenaScene({ steps: [{ do: "highlight", target: { actor: "$crashed:0" }, ms: 1000 }] }))).toMatch(/not an actor id/);
    expect(reason(arenaScene({ steps: [{ do: "highlight", target: { actor: "root", side: "up" }, ms: 1000 }] }))).toMatch(/\.side/);
    expect(reason(arenaScene({ steps: [{ do: "highlight", target: { actor: "root", colour: "red" }, ms: 1000 }] }))).toMatch(/\.colour/);
    expect(reason({ ...arenaScene({ stage: "run", steps: [{ do: "highlight", target: { counter: "idle" }, ms: 1000 }] }) })).toMatch(/only the arena has counters/);
    expect(reason({ ...arenaScene({ stage: "run", steps: [{ do: "highlight", target: { actor: "root", side: "left" }, ms: 1000 }] }) })).toMatch(/only the arena has a left and a right/);
  });

  it("keeps the replay's steps to the stages that have a replay", () => {
    for (const stage of ["helps", "ablation"]) {
      expect(reason(arenaScene({ stage, steps: [{ do: "play" }] }))).toMatch(/has no replay/);
      expect(reason(arenaScene({ stage, steps: [{ do: "wait", until: "end" }] }))).toMatch(/has no replay/);
      expect(reason(arenaScene({ stage, steps: [{ do: "highlight", target: { actor: "root" }, ms: 1000 }] }))).toMatch(/has no actors/);
    }
    expect(reason(arenaScene({ stage: "title", card: { title: "T", lines: [] }, steps: [{ do: "seek", to: 0 }] }))).toMatch(/has no replay/);
  });

  it("keeps the lens to the run page and its calls to the names the scene gave them", () => {
    expect(reason(arenaScene({ calls: { spark: { model: "spark" } } }))).toMatch(/has no lens/);
  });

  it("wants the title card on the title stage and nowhere else", () => {
    expect(reason(arenaScene({ stage: "title" }))).toMatch(/shows a card/);
    expect(reason(arenaScene({ card: { title: "T", lines: [] } }))).toMatch(/only a title stage has a card/);
    const ok = parseScene(arenaScene({ stage: "title", card: { title: "FractalSwarm", lines: ["built on Muse"] } }));
    expect(ok.ok && ok.value.card).toEqual({ title: "FractalSwarm", lines: ["built on Muse"] });
    expect(ok.ok && ok.value.replayNote).toBe(false);
  });

  it("cannot hide the arena's assumptions line: it is not a panel", () => {
    expect(reason(arenaScene({ steps: [{ do: "panel", name: "assumptions", show: false }] }))).toMatch(/\.name/);
    expect(reason(arenaScene({ panels: { assumptions: false } }))).toMatch(/scene\.panels\.assumptions/);
    expect(reason(arenaScene({ steps: [{ do: "panel", name: "counters", show: false }] }))).toMatch(/has no "counters"/);
  });

  it("refuses a scene whose waits run past its end, because its last steps would never play", () => {
    expect(reason(arenaScene({ duration_ms: 5000, steps: [{ do: "wait", ms: 3000 }, { do: "wait", ms: 3000 }] }))).toMatch(/add up to 6000 ms/);
    expect(parseScene(arenaScene({ duration_ms: 6000, steps: [{ do: "wait", ms: 3000 }, { do: "wait", ms: 3000 }] })).ok).toBe(true);
  });
});

describe("a scene's calls", () => {
  const run = (extra: Record<string, unknown>) => ({ ...arenaScene({ stage: "run" }), ...extra });

  it("are named once and used by name", () => {
    const read = parseScene(
      run({
        calls: { spark: { model: "spark", actor: "o1.a1", nth: 2 } },
        steps: [{ do: "seek", to: "call:spark+1s" }, { do: "lens", open: "spark" }, { do: "lens", close: true }],
      }),
    );
    expect(read.ok && read.value.calls.spark).toEqual({ model: "spark", actor: "o1.a1", role: null, purpose: null, tag: null, nth: 2 });
    expect(read.ok && read.value.steps[2]).toEqual({ do: "lens", open: null });
  });

  it("must be named in the scene before a step or a moment uses them", () => {
    expect(reason(run({ steps: [{ do: "lens", open: "spark" }] }))).toMatch(/call "spark" is not in the scene's `calls`/);
    expect(reason(run({ steps: [{ do: "seek", to: "call:spark" }] }))).toMatch(/call "spark"/);
    expect(reason(run({ steps: [{ do: "play" }, { do: "wait", until: "call-end:spark" }] }))).toMatch(/call "spark"/);
    expect(reason(arenaScene({ steps: [{ do: "lens", close: true }] }))).toMatch(/stage `run`/);
    expect(reason(run({ calls: { x: {} } }))).toMatch(/at least one of model/);
    expect(reason(run({ steps: [{ do: "lens" }] }))).toMatch(/one of the two/);
    expect(reason(run({ calls: { "1bad": { model: "x" } } }))).toMatch(/letters, digits/);
  });
});

describe("what the director finds in a log", () => {
  const swarm = (() => {
    const s = swarmStream();
    kill(s, "o1", 10_000);
    takeOver(s, "o1", "o2", 12_000, 15_500);
    kill(s, "o0", 30_000);
    takeOver(s, "o0", "o2", 33_000, 35_500);
    s.at(60_000).emit("run.completed", "@kernel", {});
    return s.events;
  })();

  it("lists the outages in the order they began, from the failure to the end of the takeover", () => {
    const crashes = crashesOf(swarm);
    expect(crashes.map((c) => [c.coordinator, c.at, c.until])).toEqual([
      ["o1", 10_000, 15_500],
      ["o0", 30_000, 35_500],
    ]);
  });

  it("lists a supervisor's crash and restart the same way", () => {
    const s = rivalStream(DURABLE_MAX_SCENARIO, 4);
    crash(s, "o0", 20_000, 5000);
    restart(s, "o0", 25_000);
    s.at(60_000).emit("run.completed", "@kernel", {});
    expect(crashesOf(s.events).map((c) => [c.coordinator, c.at, c.until, c.source])).toEqual([["o0", 20_000, 25_000, "supervisor"]]);
  });

  it("names the coordinator that crashed, its heir, and whoever holds the root now", () => {
    const crashes = crashesOf(swarm);
    const view = (count: number) => foldEvents(swarm.slice(0, count));
    const full = { events: swarm, view: view(swarm.length), crashes };
    expect(resolveActor("$crashed:1", full)).toBe("o1");
    expect(resolveActor("$crashed:-1", full)).toBe("o0");
    expect(resolveActor("$heir:1", full)).toBe("o2");
    expect(resolveActor("$heir:2", full)).toBe("o2");
    expect(resolveActor("$crashed:3", full)).toBeNull();
    expect(resolveActor("o1.a1", full)).toBe("o1.a1");
    expect(resolveActor("$root", full)).toBe("o2");
    const early = swarm.findIndex((e) => e.ts_virtual > 1000);
    expect(resolveActor("$root", { events: swarm, view: view(early < 0 ? 1 : early), crashes })).toBe("o0");
    expect(resolveActor("$heir:1", { events: swarm.slice(0, 10), view: emptyView(), crashes })).toBeNull();
  });

  it("finds a subtree whatever order its members were spawned in", () => {
    const view = foldEvents(swarmStream().events);
    expect(subtreeOf(view, "o1")).toEqual(["o1", "o1.a1", "o1.a2"]);
    expect(subtreeOf(view, "o0")).toEqual(["o0", "o1", "o2", "o1.a1", "o1.a2", "o2.a1", "o2.a2"]);
    expect(subtreeOf(view, "o1.a1")).toEqual(["o1.a1"]);
  });
});

describe("what a target finds on the page", () => {
  it("is a region's selector, a counter's row, or an actor on the board or in the tree", () => {
    expect(selectorsOf({ kind: "region", region: "scoreboard" })).toEqual([".score"]);
    expect(selectorsOf({ kind: "counter", counter: "idle" })).toEqual(['.metric[data-row="idle"]']);
    expect(selectorsOf({ kind: "actor", actor: "o1", side: "left", subtree: false }, ["o1"])).toEqual(['.side--swarm [data-actor="o1"]']);
    expect(selectorsOf({ kind: "actor", actor: "o1", side: "right", subtree: false }, ["o1"])).toEqual(['.side--rival [data-actor="o1"]']);
    expect(selectorsOf({ kind: "actor", actor: "o1", side: null, subtree: false }, ["o1"])).toEqual(['[data-actor="o1"]', '.react-flow__node[data-id="o1"]']);
    expect(selectorsOf({ kind: "actor", actor: "o1", side: "left", subtree: true }, ["o1", "o1.a1"])).toHaveLength(2);
  });

  it("quotes an id that has a quote in it", () => {
    expect(selectorsOf({ kind: "actor", actor: 'a"b', side: "left", subtree: false }, ['a"b'])).toEqual(['.side--swarm [data-actor="a\\"b"]']);
  });
});

describe("the camera", () => {
  it("fits a rectangle in the frame with padding all round, centred", () => {
    const camera = fit({ x: 100, y: 100, w: 960, h: 540 }, 0);
    expect(camera).toEqual({ x: 100, y: 100, zoom: 2 });
    const padded = fit({ x: 100, y: 100, w: 960, h: 540 }, 0.25);
    expect(padded.zoom).toBeCloseTo(2 / 1.5);
    expect(padded.x + FRAME_W / padded.zoom / 2).toBeCloseTo(580);
    expect(padded.y + FRAME_H / padded.zoom / 2).toBeCloseTo(370);
  });

  it("does not fill the frame with a single dot, and stays within the zoom limits", () => {
    expect(fit({ x: 0, y: 0, w: 16, h: 16 }, 0).zoom).toBeLessThanOrEqual(FRAME_H / 160 + 1e-9);
    expect(fit({ x: 0, y: 0, w: 100_000, h: 100_000 }, 0).zoom).toBe(0.25);
    expect(fit({ x: 0, y: 0, w: 0.001, h: 0.001 }, 0, 0.0001).zoom).toBe(8);
  });

  it("zooms about its own centre and pans by what the viewer sees", () => {
    const base = fit({ x: 400, y: 200, w: 960, h: 540 }, 0);
    const zoomed = zoomedTo(base, 4);
    expect(zoomed.x + FRAME_W / 8).toBeCloseTo(base.x + FRAME_W / base.zoom / 2);
    expect(panned({ x: 10, y: 20, zoom: 2 }, { x: 100, y: -50 })).toEqual({ x: 60, y: -5, zoom: 2 });
  });

  it("moves its centre in a straight line and its zoom by a steady factor", () => {
    const from = HOME;
    const to = lookAt({ x: 1500, y: 800 }, 4);
    const half = lerp(from, to, 0.5);
    expect(half.zoom).toBeCloseTo(2);
    const centre = { x: half.x + FRAME_W / half.zoom / 2, y: half.y + FRAME_H / half.zoom / 2 };
    expect(centre.x).toBeCloseTo((FRAME_W / 2 + 1500) / 2);
    expect(centre.y).toBeCloseTo((FRAME_H / 2 + 800) / 2);
    expect(lerp(from, to, 0)).toBe(from);
    expect(lerp(from, to, 1)).toBe(to);
  });

  it("follows a move on the take's clock, eased, and rests where it ends", () => {
    const to = lookAt({ x: 1500, y: 800 }, 3);
    const move = { from: HOME, to, start: 1000, ms: 1000, ease: "inout" as const };
    expect(cameraAt(move, 1000)).toEqual(HOME);
    expect(cameraAt(move, 500)).toEqual(HOME);
    const mid = cameraAt(move, 1500);
    expect(mid.zoom).toBeCloseTo(Math.sqrt(3), 5);
    expect(cameraAt(move, 2000)).toEqual(to);
    expect(cameraAt(move, 9000)).toEqual(to);
    expect(cameraAt({ ...move, ms: 0 }, 1000)).toBe(to);
    const linear = cameraAt({ ...move, ease: "linear" }, 1250);
    expect(linear.zoom).toBeCloseTo(3 ** 0.25, 5);
  });

  it("gives a CSS transform that puts the camera's corner at the frame's", () => {
    expect(transformOf(HOME)).toBe("scale(1) translate(0px, 0px)");
    expect(transformOf({ x: 100, y: 50, zoom: 2 })).toBe("scale(2) translate(-100px, -50px)");
  });

  it("brings a rectangle measured on screen back to the page's own coordinates", () => {
    const camera = { x: 300, y: 120, zoom: 2.5 };
    const rect = { x: 410, y: 200, w: 80, h: 40 };
    const screen = { x: (rect.x - camera.x) * camera.zoom, y: (rect.y - camera.y) * camera.zoom, w: rect.w * camera.zoom, h: rect.h * camera.zoom };
    expect(contentRect(screen, camera)).toEqual(rect);
    expect(union([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
    expect(union([])).toBeNull();
  });

  it("eases a speed from one to the next", () => {
    const ramp = { from: 10, to: 1, start: 0, ms: 1000 };
    expect(speedAt(ramp, 0)).toBe(10);
    expect(speedAt(ramp, 500)).toBeCloseTo(5.5);
    expect(speedAt(ramp, 1000)).toBe(1);
    expect(speedAt(ramp, 5000)).toBe(1);
    expect(speedAt({ ...ramp, ms: 0 }, 0)).toBe(1);
  });
});

describe("the captions and the rings", () => {
  it("fade in, hold and fade out on the take's clock", () => {
    expect(envelope(999, 1000, 4000, 250)).toBe(0);
    expect(envelope(1000, 1000, 4000, 250)).toBe(0);
    expect(envelope(1125, 1000, 4000, 250)).toBeCloseTo(0.5);
    expect(envelope(2000, 1000, 4000, 250)).toBe(1);
    expect(envelope(3875, 1000, 4000, 250)).toBeCloseTo(0.5);
    expect(envelope(4000, 1000, 4000, 250)).toBe(0);
    // a cue shorter than two fades still peaks
    expect(envelope(1100, 1000, 1200, 250)).toBeCloseTo(1);
  });

  it("show one caption of each style at a time: a new one takes the place of the one before", () => {
    const lower = (id: number, from: number, to: number) => ({ id, text: `c${id}`, kicker: null, style: "lower" as const, from, to });
    const overlay = { id: 9, text: "o", kicker: null, style: "overlay" as const, from: 0, to: 10_000 };
    const now = addCaption(addCaption([overlay], lower(1, 0, 8000)), lower(2, 3000, 6000));
    expect(now.find((c) => c.id === 1)?.to).toBe(3000 + FADE_MS);
    expect(now.find((c) => c.id === 9)?.to).toBe(10_000);
    expect(captionOpacity(now[1], 3000 + FADE_MS)).toBe(0);
    expect(liveCaptions(now, 7000).map((c) => c.id)).toEqual([9]);
  });

  it("breathe a little, never fully off while they are up", () => {
    const ring = { id: 1, target: { kind: "region" as const, region: "swarm" as const }, from: 1000, to: 5000 };
    for (let t = 1200; t < 4800; t += 50) {
      const o = ringOpacity(ring, t);
      expect(o).toBeGreaterThan(0.6);
      expect(o).toBeLessThanOrEqual(1);
    }
    expect(ringOpacity(ring, 500)).toBe(0);
    expect(ringOpacity(ring, 5000)).toBe(0);
  });
});

/** A host that records what the program asks, with a clock the test moves. */
function fakeHost(over: Partial<Host> = {}) {
  const state = { now: 0, playhead: 0, playing: true };
  const ran: string[] = [];
  const warned: string[] = [];
  const host: Host = {
    now: () => state.now,
    playhead: () => state.playhead,
    playing: () => state.playing,
    resolve: (time) => resolveTime(time, context),
    run: (step) => void ran.push(step.do),
    warn: (message) => void warned.push(message),
    ...over,
  };
  return { host, state, ran, warned };
}

const stepsOf = (...raw: Record<string, unknown>[]): Step[] => sceneOf({ steps: raw }).steps;

describe("the program of a scene", () => {
  it("runs the steps in order, and stops at a wait for the milliseconds it says", () => {
    const { host, state, ran } = fakeHost();
    const program = createProgram(stepsOf({ do: "play" }, { do: "wait", ms: 1000 }, { do: "pause" }), host);
    program.frame();
    expect(ran).toEqual(["play"]);
    expect(program.position()).toBe(1);
    state.now = 999;
    program.frame();
    expect(ran).toEqual(["play"]);
    state.now = 1000;
    program.frame();
    expect(ran).toEqual(["play", "pause"]);
    expect(program.finished()).toBe(true);
  });

  it("runs every step that is due in the same frame, and a wait of nothing does not hold", () => {
    const { host, ran } = fakeHost();
    const program = createProgram(stepsOf({ do: "play" }, { do: "wait", ms: 0 }, { do: "pause" }, { do: "speed", x: 2 }), host);
    program.frame();
    expect(ran).toEqual(["play", "pause", "speed"]);
    expect(program.finished()).toBe(true);
  });

  it("waits for the replay to reach a moment, and goes on the frame it does", () => {
    const { host, state, ran } = fakeHost();
    const program = createProgram(stepsOf({ do: "wait", until: "crash:1" }, { do: "pause" }), host);
    program.frame();
    expect(ran).toEqual([]);
    state.playhead = 9999;
    program.frame();
    expect(ran).toEqual([]);
    state.playhead = 10_000;
    program.frame();
    expect(ran).toEqual(["pause"]);
  });

  it("does not wait for a moment the replay has passed, one the run lacks, or one it can never reach", () => {
    const passed = fakeHost();
    passed.state.playhead = 20_000;
    createProgram(stepsOf({ do: "wait", until: "crash:1" }, { do: "pause" }), passed.host).frame();
    expect(passed.ran).toEqual(["pause"]);

    const lacking = fakeHost();
    createProgram(stepsOf({ do: "wait", until: "crash:5" }, { do: "pause" }), lacking.host).frame();
    expect(lacking.ran).toEqual(["pause"]);
    expect(lacking.warned[0]).toMatch(/the run has no "crash:5"/);

    const paused = fakeHost();
    paused.state.playing = false;
    createProgram(stepsOf({ do: "wait", until: "crash:1" }, { do: "pause" }), paused.host).frame();
    expect(paused.ran).toEqual(["pause"]);
    expect(paused.warned[0]).toMatch(/replay paused/);
  });

  it("goes on when the replay stops while it waits (the end of the run), and when its timeout passes", () => {
    const stops = fakeHost();
    const a = createProgram(stepsOf({ do: "wait", until: "end" }, { do: "pause" }), stops.host);
    a.frame();
    stops.state.playing = false;
    a.frame();
    expect(stops.ran).toEqual(["pause"]);

    const slow = fakeHost();
    const b = createProgram(stepsOf({ do: "wait", until: "end", timeout_ms: 2000 }, { do: "pause" }), slow.host);
    b.frame();
    slow.state.now = 1999;
    b.frame();
    expect(slow.ran).toEqual([]);
    slow.state.now = 2000;
    b.frame();
    expect(slow.ran).toEqual(["pause"]);
    expect(slow.warned[0]).toMatch(/did not reach the moment in time/);
  });
});

const BOARD = { x: 100, y: 200, w: 800, h: 400 };
const COUNTER = { x: 1200, y: 900, w: 200, h: 80 };

function takeOf(raw: Record<string, unknown>, replay = fakeReplay(), crashes = context.crashes) {
  const surface = fakeSurface(
    { [target({ region: "swarm" })]: BOARD, [target({ counter: "idle" })]: COUNTER },
    { crashes, end: replay.end() },
  );
  const take = createTake(sceneOf(raw), replay, surface);
  return { take, replay, surface };
}

describe("a take", () => {
  it("has the frames of its length at 1/60 s, and ends on the last of them", () => {
    expect(framesOf(1000)).toBe(60);
    expect(framesOf(32_000)).toBe(1920);
    expect(framesOf(1001)).toBe(61);
    const { take } = takeOf({ duration_ms: 1000 });
    for (let i = 0; i < 59; i++) take.tick();
    expect(take.state.getState()).toMatchObject({ frame: 59, done: false });
    take.tick();
    expect(take.state.getState()).toMatchObject({ frame: 60, done: true });
    take.tick();
    expect(take.state.getState().frame).toBe(60);
  });

  it("starts the replay paused at its start and the camera home, with the panels the scene opens", () => {
    const replay = fakeReplay();
    replay.seek(5000);
    replay.setPlaying(true);
    const { take, surface } = takeOf({ panels: { scoreboard: false } }, replay);
    expect(replay.playhead()).toBe(0);
    expect(replay.playing()).toBe(false);
    expect(surface.applied).toEqual(HOME);
    expect(surface.panels).toMatchObject({ scoreboard: false, timeline: true });
    expect(take.state.getState().camera).toEqual(HOME);
  });

  it("plays the replay one fixed step a frame at the speed the scene sets, and not while it is paused", () => {
    const { take, replay } = takeOf({ steps: [{ do: "speed", x: 5 }, { do: "wait", ms: 100 }, { do: "play" }, { do: "wait", ms: 100 }, { do: "pause" }] });
    for (let i = 0; i < 6; i++) take.tick();
    expect(replay.playhead()).toBe(0);
    take.tick(); // frame 6 is 100 ms: the replay starts
    expect(replay.playing()).toBe(true);
    for (let i = 0; i < 5; i++) take.tick();
    expect(replay.playhead()).toBeCloseTo(6 * 5 * (1000 / 60), 5); // six steps at 5x
    const stopped = replay.playhead();
    for (let i = 0; i < 6; i++) take.tick();
    expect(replay.playing()).toBe(false);
    expect(replay.playhead()).toBe(stopped);
  });

  it("waits for the first crash, then does its steps in the frame the replay reaches it", () => {
    const { take, replay } = takeOf({
      duration_ms: 8000,
      steps: [{ do: "seek", to: "crash:1-1s" }, { do: "speed", x: 2 }, { do: "play" }, { do: "wait", until: "crash:1" }, { do: "pause" }, { do: "caption", text: "Down", ms: 2000 }],
    });
    for (let i = 0; i < 400 && !take.state.getState().captions.length; i++) take.tick();
    const state = take.state.getState();
    expect(state.captions.map((c) => c.text)).toEqual(["Down"]);
    expect(replay.playing()).toBe(false);
    expect(replay.playhead()).toBeGreaterThanOrEqual(10_000);
    expect(replay.playhead()).toBeLessThan(10_000 + 2 * (1000 / 60) + 1);
  });

  it("ramps the speed rather than jumping it", () => {
    const { take, replay } = takeOf({ steps: [{ do: "speed", x: 10 }, { do: "speed", x: 1, ramp_ms: 500 }] });
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      take.tick();
      seen.push(replay.speed());
    }
    expect(seen[0]).toBe(10);
    expect(seen[10]).toBeLessThan(10);
    expect(seen[10]).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(1);
    expect(seen.slice(1).every((x, i) => x <= seen[i] + 1e-9)).toBe(true);
  });

  it("moves the camera to a target over the milliseconds it says, and lands there", () => {
    const { take, surface } = takeOf({ steps: [{ do: "camera", fit: { region: "swarm" }, pad: 0, ms: 500 }] });
    take.tick();
    expect(surface.applied).toEqual(HOME);
    for (let i = 0; i < 30; i++) take.tick();
    expect(surface.applied).toEqual(fit(BOARD, 0));
    expect(take.state.getState().camera).toEqual(fit(BOARD, 0));
  });

  it("goes home, and chains a new move from where the camera is", () => {
    const { take, surface } = takeOf({ steps: [{ do: "camera", fit: { region: "swarm" }, pad: 0, ms: 600 }, { do: "wait", ms: 300 }, { do: "camera", home: true, ms: 600 }] });
    for (let i = 0; i < 18; i++) take.tick();
    const mid = surface.applied;
    expect(mid.zoom).toBeGreaterThan(1);
    expect(mid.zoom).toBeLessThan(fit(BOARD, 0).zoom);
    for (let i = 0; i < 60; i++) take.tick();
    expect(surface.applied).toEqual(HOME);
  });

  it("warns, once, of a camera or a highlight whose target is not on the page, and goes on", () => {
    const { take } = takeOf({ steps: [{ do: "camera", fit: { region: "scoreboard" } }, { do: "highlight", target: { region: "heads" }, ms: 1000 }, { do: "caption", text: "Still here", ms: 1000 }] });
    for (let i = 0; i < 30; i++) take.tick();
    const { warnings, captions } = take.state.getState();
    expect(warnings.filter((w) => /camera's target/.test(w))).toHaveLength(1);
    expect(warnings.filter((w) => /highlight's target/.test(w))).toHaveLength(1);
    expect(captions.map((c) => c.text)).toEqual(["Still here"]);
  });

  it("places a ring on its target as the camera has it now, so it follows a move", () => {
    const { take } = takeOf({ steps: [{ do: "highlight", target: { counter: "idle" }, ms: 2000 }, { do: "camera", fit: { region: "swarm" }, pad: 0, ms: 400 }] });
    take.tick();
    const first = take.state.getState().rings[0].rect;
    expect(first).toEqual(COUNTER);
    for (let i = 0; i < 30; i++) take.tick();
    const later = take.state.getState().rings[0].rect;
    expect(later.w).toBeCloseTo(COUNTER.w * fit(BOARD, 0).zoom);
    expect(take.state.getState().rings[0].opacity).toBeGreaterThan(0.6);
  });

  it("drops a caption and a ring when their time is up", () => {
    const { take } = takeOf({ steps: [{ do: "caption", text: "Brief", ms: 500 }, { do: "highlight", target: { counter: "idle" }, ms: 500 }] });
    for (let i = 0; i < 20; i++) take.tick();
    expect(take.state.getState().captions).toHaveLength(1);
    expect(take.state.getState().rings).toHaveLength(1);
    for (let i = 0; i < 20; i++) take.tick();
    expect(take.state.getState()).toMatchObject({ captions: [], rings: [] });
  });

  it("opens and closes the lens, and says why when a call is not in the run", () => {
    const { take, surface } = takeOf({ stage: "run", calls: { spark: { model: "spark" }, missing: { model: "x" } }, steps: [{ do: "lens", open: "spark" }, { do: "lens", open: "missing" }, { do: "lens", close: true }] });
    take.tick();
    expect(surface.opened).toEqual(["spark", "missing", null]);
    expect(take.state.getState().warnings).toEqual([`step 1: call "missing" is not in the run`]);
  });

  it("applies the panel steps", () => {
    const { take, surface } = takeOf({ steps: [{ do: "panel", name: "scoreboard", show: false }, { do: "wait", ms: 100 }, { do: "panel", name: "scoreboard", show: true }] });
    take.tick();
    expect(surface.panels.scoreboard).toBe(false);
    for (let i = 0; i < 7; i++) take.tick();
    expect(surface.panels.scoreboard).toBe(true);
  });

  it("starts over from the first frame", () => {
    const { take, replay, surface } = takeOf({ steps: [{ do: "play" }, { do: "camera", fit: { region: "swarm" }, ms: 0 }, { do: "caption", text: "Hi", ms: 3000 }] });
    for (let i = 0; i < 20; i++) take.tick();
    expect(replay.playhead()).toBeGreaterThan(0);
    take.restart();
    expect(take.state.getState()).toMatchObject({ frame: 0, ms: 0, done: false, captions: [], rings: [], camera: HOME });
    expect(replay.playhead()).toBe(0);
    expect(surface.applied).toEqual(HOME);
  });

  it("runs a scene with no replay: only the camera, the captions and the rings", () => {
    const surface = fakeSurface({ [target({ region: "swarm" })]: BOARD });
    const take = createTake(sceneOf({ stage: "helps", steps: [{ do: "caption", text: "Hi", ms: 1000 }] }), null, surface);
    for (let i = 0; i < 5; i++) take.tick();
    expect(take.state.getState().captions).toHaveLength(1);
  });

  it("repeats frame for frame: the same scene gives the same states however it is stepped", () => {
    const raw = {
      duration_ms: 12_000,
      steps: [
        { do: "seek", to: "crash:1-2s" },
        { do: "speed", x: 4 },
        { do: "play" },
        { do: "caption", text: "Same input", ms: 3000 },
        { do: "wait", until: "crash:1" },
        { do: "speed", x: 0.5, ramp_ms: 700 },
        { do: "camera", fit: { region: "swarm" }, pad: 0.1, ms: 900, ease: "out" },
        { do: "highlight", target: { counter: "idle" }, ms: 2500 },
        { do: "wait", ms: 3000 },
        { do: "camera", home: true, ms: 800 },
      ],
    };
    const run = () => {
      const { take, replay } = takeOf(raw);
      const states: string[] = [];
      for (let i = 0; i < take.frames; i++) {
        take.tick();
        states.push(JSON.stringify([take.state.getState(), replay.playhead(), replay.speed(), replay.playing()]));
      }
      return states;
    };
    const a = run();
    const b = run();
    expect(a).toHaveLength(720);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(100);
  });
});
