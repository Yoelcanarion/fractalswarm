import { describe, expect, it } from "vitest";

import { CENTRAL_SCENARIO, kill, rivalStream, swarmStream, takeOver, crash, restart } from "../arena/testing";
import { foldEvents } from "../lib/reducer";
import type { RunEvent } from "../lib/types";
import { FRAME_H, FRAME_W, fitFrame, type Camera, type Rect } from "./camera";
import { boundsOf, createDomSurface, framePixels, type LensHandle, type RunSide } from "./surface";
import { target } from "./testing";
import type { Target } from "./targets";

describe("a rectangle of the window in the frame's pixels", () => {
  it("is relative to the frame's corner and undone from its scale", () => {
    const frame = { x: 100, y: 50, w: 960, h: 540 };
    expect(framePixels({ x: 580, y: 320, w: 100, h: 40 }, frame, 0.5)).toEqual({ x: 960, y: 540, w: 200, h: 80 });
  });

  it("is the bounds of the elements together, and an element with no box is not on the page", () => {
    const frame = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(boundsOf([{ x: 10, y: 10, w: 20, h: 20 }, { x: 100, y: 50, w: 10, h: 10 }], frame, 1)).toEqual({ x: 10, y: 10, w: 100, h: 50 });
    expect(boundsOf([{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 5, w: 10, h: 0 }], frame, 1)).toBeNull();
    expect(boundsOf([], frame, 1)).toBeNull();
  });

  it("fits the frame in a window: scale 1 for 1920 x 1080, centred and on whole pixels otherwise", () => {
    expect(fitFrame(FRAME_W, FRAME_H)).toEqual({ scale: 1, left: 0, top: 0 });
    expect(fitFrame(960, 540)).toEqual({ scale: 0.5, left: 0, top: 0 });
    expect(fitFrame(1920, 1200)).toEqual({ scale: 1, left: 0, top: 60 });
    const wide = fitFrame(2560, 1080);
    expect(wide).toEqual({ scale: 1, left: 320, top: 0 });
    const odd = fitFrame(1001, 700);
    expect(Number.isInteger(odd.left) && Number.isInteger(odd.top)).toBe(true);
    expect(odd.scale).toBeCloseTo(1001 / 1920);
  });
});

// ---- the surface over a page of fake elements ----

/** Content rectangles by the selector that finds them. An element's rectangle on the window is its content rectangle
 * through the camera that was applied, then the frame's scale and place: what getBoundingClientRect would say. */
function fakePage(content: Record<string, Rect[]>, window = { left: 0, top: 0, scale: 1 }) {
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  const asked: string[] = [];
  const onWindow = (box: Rect) => {
    const k = camera.zoom * window.scale;
    return { x: window.left + (box.x - camera.x) * k, y: window.top + (box.y - camera.y) * k, width: box.w * k, height: box.h * k };
  };
  const cameraElement = {
    style: {
      set transform(value: string) {
        const found = /^scale\(([-\d.e]+)\) translate\(([-\d.e]+)px, ([-\d.e]+)px\)$/.exec(value);
        if (!found) throw new Error(`not a camera transform: ${value}`);
        camera = { zoom: Number(found[1]), x: 0 - Number(found[2]), y: 0 - Number(found[3]) };
      },
    },
  };
  const stageElement = {
    dataset: {} as Record<string, string>,
    querySelectorAll(css: string) {
      asked.push(css);
      return (content[css] ?? []).map((box) => ({ getBoundingClientRect: () => onWindow(box) }));
    },
  };
  const frameElement = { getBoundingClientRect: () => ({ x: window.left, y: window.top, width: FRAME_W * window.scale, height: FRAME_H * window.scale }) };
  return { asked, stage: stageElement, camera: () => camera, elements: { frame: frameElement as unknown as HTMLElement, camera: cameraElement as unknown as HTMLElement, stage: stageElement as unknown as HTMLElement } };
}

const side = (events: RunEvent[], upTo = events.length): RunSide => {
  const view = foldEvents(events.slice(0, upTo));
  return { events: () => events, view: () => view };
};

const swarm = (() => {
  const s = swarmStream();
  kill(s, "o1", 10_000);
  takeOver(s, "o1", "o2", 12_000, 15_500);
  kill(s, "o0", 30_000);
  takeOver(s, "o0", "o2", 33_000, 35_500);
  s.at(60_000).emit("run.completed", "@kernel", {});
  return s.events;
})();

const BOX: Rect = { x: 200, y: 900, w: 1500, h: 120 };

function surfaceOf(page: ReturnType<typeof fakePage>, parts: { left?: RunSide | null; right?: RunSide | null; lens?: LensHandle | null; scale?: number } = {}) {
  return createDomSurface({ ...page.elements, scale: () => parts.scale ?? 1, sides: { left: parts.left ?? null, right: parts.right ?? null }, lens: parts.lens ?? null, end: () => 60_000 });
}

describe("the surface of a page", () => {
  it("measures a region in the frame's pixels whatever the window and the camera", () => {
    const page = fakePage({ ".score": [BOX] }, { left: 100, top: 50, scale: 0.5 });
    const surface = surfaceOf(page, { scale: 0.5 });
    const region = { kind: "region", region: "scoreboard" } as const;
    expect(surface.screenRect(region)).toEqual(BOX);
    expect(surface.contentRect(region)).toEqual(BOX);
    surface.apply({ x: 300, y: 100, zoom: 2 });
    expect(page.camera()).toEqual({ x: 300, y: 100, zoom: 2 });
    expect(surface.screenRect(region)).toEqual({ x: (BOX.x - 300) * 2, y: (BOX.y - 100) * 2, w: BOX.w * 2, h: BOX.h * 2 });
    expect(surface.contentRect(region)).toEqual(BOX);
  });

  it("finds a counter by its row", () => {
    const page = fakePage({ '.metric[data-row="idle"]': [{ x: 1200, y: 800, w: 200, h: 80 }] });
    const surface = surfaceOf(page);
    expect(surface.screenRect({ kind: "counter", counter: "idle" })).toEqual({ x: 1200, y: 800, w: 200, h: 80 });
    expect(surface.screenRect({ kind: "counter", counter: "dup" })).toBeNull();
  });

  it("says a target is not on the page when nothing matches", () => {
    const surface = surfaceOf(fakePage({}));
    expect(surface.screenRect({ kind: "region", region: "scoreboard" })).toBeNull();
    expect(surface.contentRect({ kind: "region", region: "scoreboard" })).toBeNull();
  });

  it("reads the hover text of a target: its title, a title under it, else the words of a hint under it", () => {
    // what the DOM gives of an element: a title of its own, a title under it, the bubble of a Hint (components/ui/Hint.tsx) under it
    const element = (own: string | null, under: { title?: string; bubble?: string } = {}) => ({
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      hasAttribute: (name: string) => name === "title" && own !== null,
      getAttribute: (name: string) => (name === "title" ? own : null),
      querySelector: (css: string) =>
        css === "[title]" && under.title !== undefined
          ? { getAttribute: () => under.title }
          : css === '[role="tooltip"]' && under.bubble !== undefined
            ? { textContent: ` ${under.bubble} ` }
            : null,
    });
    const found: Record<string, unknown[]> = {
      ".score": [element("The title", { bubble: "The bubble" })],
      ".side--swarm .side__head": [element(null, { title: "A title under it", bubble: "The bubble" })],
      ".side--swarm .side__chip": [element(null, { bubble: "The words of the hint" })],
      ".side--rival .side__chip": [element(null)],
    };
    const stage = { dataset: {}, querySelectorAll: (css: string) => found[css] ?? [] } as unknown as HTMLElement;
    const surface = createDomSurface({ ...fakePage({}).elements, stage, scale: () => 1, sides: { left: null, right: null }, lens: null, end: () => 60_000 });
    const hover = (region: "scoreboard" | "swarm-head" | "swarm-proof" | "rival-proof" | "rival-head") => surface.titleOf({ kind: "region", region });
    expect(hover("scoreboard")).toBe("The title");
    expect(hover("swarm-head")).toBe("A title under it");
    expect(hover("swarm-proof")).toBe("The words of the hint");
    expect(hover("rival-proof")).toBeNull();
    expect(hover("rival-head")).toBeNull();
  });

  it("looks for the coordinator that crashed, on the side the scene names", () => {
    const page = fakePage({ '.side--swarm [data-actor="o1"]': [{ x: 400, y: 300, w: 100, h: 40 }] });
    const surface = surfaceOf(page, { left: side(swarm), right: side(rivalStream(CENTRAL_SCENARIO, 2).events) });
    const crashed: Target = { kind: "actor", actor: "$crashed:1", side: "left", subtree: false };
    expect(surface.screenRect(crashed)).toEqual({ x: 400, y: 300, w: 100, h: 40 });
    expect(page.asked).toEqual(['.side--swarm [data-actor="o1"]']);
    expect(surface.screenRect({ kind: "actor", actor: "$heir:1", side: "left", subtree: false })).toBeNull(); // o2 is not drawn here
    expect(page.asked.at(-1)).toBe('.side--swarm [data-actor="o2"]');
  });

  it("takes a subtree as the union of its members", () => {
    const page = fakePage({
      '.side--swarm [data-actor="o1"]': [{ x: 400, y: 300, w: 100, h: 40 }],
      '.side--swarm [data-actor="o1.a1"]': [{ x: 380, y: 420, w: 20, h: 20 }],
      '.side--swarm [data-actor="o1.a2"]': [{ x: 520, y: 420, w: 20, h: 20 }],
    });
    // before the takeover: afterwards the heir has the children (the view re-parents them)
    const surface = surfaceOf(page, { left: side(swarmWithoutKills()) });
    expect(surface.screenRect({ kind: "actor", actor: "o1", side: "left", subtree: true })).toEqual({ x: 380, y: 300, w: 160, h: 140 });
    expect(page.asked).toEqual(['.side--swarm [data-actor="o1"]', '.side--swarm [data-actor="o1.a1"]', '.side--swarm [data-actor="o1.a2"]']);
  });

  it("finds the children where they are after the takeover: under the heir", () => {
    const page = fakePage({});
    surfaceOf(page, { left: side(swarm, swarm.findIndex((e) => e.ts_virtual >= 16_000)) }).screenRect({ kind: "actor", actor: "$heir:1", side: "left", subtree: true });
    expect(page.asked.filter((css) => css.includes("o1."))).toEqual(['.side--swarm [data-actor="o1.a1"]', '.side--swarm [data-actor="o1.a2"]']);
  });

  it("takes an actor with no side as the swarm's in an arena, and as a node of the tree on a run page", () => {
    const arena = fakePage({});
    surfaceOf(arena, { left: side(swarm), right: side(swarm) }).screenRect({ kind: "actor", actor: "o1", side: null, subtree: false });
    expect(arena.asked).toEqual(['.side--swarm [data-actor="o1"]']);

    const run = fakePage({ '.react-flow__node[data-id="o1"]': [{ x: 10, y: 20, w: 30, h: 40 }] });
    const surface = surfaceOf(run, { left: side(swarm) });
    expect(surface.screenRect({ kind: "actor", actor: "o1", side: null, subtree: false })).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(run.asked).toEqual(['[data-actor="o1"]', '.react-flow__node[data-id="o1"]']);
  });

  it("follows the root to whoever holds it at the moment the replay is at", () => {
    const early = fakePage({});
    surfaceOf(early, { left: side(swarm, 5) }).screenRect({ kind: "actor", actor: "$root", side: null, subtree: false });
    expect(early.asked.at(-1)).toBe('.react-flow__node[data-id="o0"]');
    const late = fakePage({});
    surfaceOf(late, { left: side(swarm) }).screenRect({ kind: "actor", actor: "$root", side: null, subtree: false });
    expect(late.asked.at(-1)).toBe('.react-flow__node[data-id="o2"]');
  });

  it("has no actor on a side the page does not have", () => {
    const page = fakePage({});
    const surface = surfaceOf(page, { left: side(swarm) });
    expect(surface.screenRect({ kind: "actor", actor: "o1", side: "right", subtree: false })).toBeNull();
    expect(page.asked).toEqual([]);
  });

  it("hides and shows panels as data on the stage, in a fixed order", () => {
    const page = fakePage({});
    const surface = surfaceOf(page);
    surface.panel("timeline", false);
    surface.panel("scoreboard", false);
    expect(page.stage.dataset.hide).toBe("scoreboard timeline");
    surface.panel("timeline", true);
    expect(page.stage.dataset.hide).toBe("scoreboard");
    surface.panel("scoreboard", true);
    expect(page.stage.dataset.hide).toBe("");
  });

  it("gives what a moment of a scene is resolved against: the outages of the swarm, else of the rival, the calls, the end", () => {
    const lens: LensHandle = { open: () => null, times: () => new Map([["spark", { start: 4000, end: 6500 }]]) };
    const own = surfaceOf(fakePage({}), { left: side(swarm), right: side(rivalStream().events), lens });
    const context = own.context();
    expect(context.end).toBe(60_000);
    expect(context.crashes.map((c) => [c.at, c.until])).toEqual([
      [10_000, 15_500],
      [30_000, 35_500],
    ]);
    expect(context.calls.get("spark")).toEqual({ start: 4000, end: 6500 });
    // the rival's own outages, whichever side `crash:N` was taken from
    expect(context.rivalCrashes).toBeDefined();

    const s = rivalStream(CENTRAL_SCENARIO, 2);
    crash(s, "o0", 20_000, 5000);
    restart(s, "o0", 25_000);
    s.at(40_000).emit("run.completed", "@kernel", {});
    const fallback = surfaceOf(fakePage({}), { left: side(swarmWithoutKills()), right: side(s.events) });
    expect(fallback.context().crashes.map((c) => [c.at, c.until])).toEqual([[20_000, 25_000]]);
    expect(fallback.context().rivalCrashes?.map((c) => [c.at, c.until])).toEqual([[20_000, 25_000]]);
    expect(own.context().rivalCrashes?.map((c) => [c.at, c.until])).toEqual([]);
    expect(surfaceOf(fakePage({})).context()).toEqual({ end: 60_000, crashes: [], rivalCrashes: [], calls: new Map() });
  });

  it("opens the lens through the page's lens, or says the stage has none", () => {
    const opened: (string | null)[] = [];
    const lens: LensHandle = { open: (name) => (opened.push(name), name === "gone" ? "call gone is not in the run" : null), times: () => new Map() };
    const surface = surfaceOf(fakePage({}), { lens });
    expect(surface.lens("spark")).toBeNull();
    expect(surface.lens("gone")).toBe("call gone is not in the run");
    expect(surface.lens(null)).toBeNull();
    expect(opened).toEqual(["spark", "gone", null]);
    expect(surfaceOf(fakePage({})).lens("spark")).toBe("this stage has no lens");
  });

  it("puts the camera on the camera element as a CSS transform", () => {
    const page = fakePage({});
    surfaceOf(page).apply({ x: 100.25, y: 0, zoom: 1.5 });
    expect(page.camera()).toEqual({ x: 100.25, y: 0, zoom: 1.5 });
  });

  it("gives a target the same content rectangle at any camera", () => {
    const page = fakePage({ ".score": [BOX] }, { left: 0, top: 0, scale: 1 });
    const surface = surfaceOf(page);
    const region = JSON.parse(target({ region: "scoreboard" })) as Target;
    for (const camera of [{ x: 0, y: 0, zoom: 1 }, { x: 123.5, y: 77.25, zoom: 3 }, { x: -50, y: 400, zoom: 0.5 }]) {
      surface.apply(camera);
      const rect = surface.contentRect(region);
      expect(rect?.x).toBeCloseTo(BOX.x, 6);
      expect(rect?.y).toBeCloseTo(BOX.y, 6);
      expect(rect?.w).toBeCloseTo(BOX.w, 6);
      expect(rect?.h).toBeCloseTo(BOX.h, 6);
    }
  });
});

function swarmWithoutKills(): RunEvent[] {
  const s = swarmStream();
  s.at(60_000).emit("run.completed", "@kernel", {});
  return s.events;
}
