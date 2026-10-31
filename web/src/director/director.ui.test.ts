// The director's views drawn on the server (react-dom/server): no browser, but every render path runs. What they look
// like is checked on screenshots; here it is that the page has what the scenes point at.

import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { plainText, occurrences } from "../arena/helps/testing";
import { call, kill, rivalStream, swarmStream, takeOver } from "../arena/testing";
import { renderCurrent } from "../lib/testing";
import type { RunEvent } from "../lib/types";
import type { RunApi } from "../store";
import { DirectorPage } from "./DirectorPage";
import { OverlayLayer, tipPosition } from "./OverlayLayer";
import { createTake } from "./take";
import { REGIONS } from "./targets";
import { createArenaStage } from "./stages";
import { ArenaStageView, TitleStageView } from "./StageViews";
import { fakeReplay, fakeSurface, sceneOf } from "./testing";

const swarmLog = (() => {
  const s = swarmStream();
  call(s, "o2.a1", "e1");
  kill(s, "o1", 10_000);
  takeOver(s, "o1", "o2", 14_000, 15_000);
  s.at(60_000).emit("run.completed", "@kernel");
  return s.events;
})();

const rivalLog = (() => {
  const s = rivalStream();
  s.at(70_000).emit("run.completed", "@kernel");
  return s.events;
})();

const api = (logs: Record<string, RunEvent[]>): RunApi => ({
  listRuns: async () => [],
  loadAllEvents: async (id) => logs[id] ?? [],
  tailEvents: () => () => undefined,
  verifyRun: async () => {
    throw new Error("unused");
  },
});

describe("the arena stage", () => {
  it("draws the pair with nothing around it but what the rival is granted, and marks every actor for a scene to find", async () => {
    const stage = createArenaStage("s", "r", { api: api({ s: swarmLog, r: rivalLog }), official: async () => null });
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    stage.replay.seek(16_000);
    for (const store of [stage.session.left, stage.session.right, stage.scored]) renderCurrent(store as never);
    const html = renderToStaticMarkup(createElement(ArenaStageView, { stage }));
    stage.dispose();

    expect(html).toContain("side--swarm");
    expect(html).toContain("side--rival");
    expect(html).toContain('class="score');
    expect(html).not.toContain("picker"); // no app chrome
    expect(html).toContain("arena__assumptions"); // never hidden: the arena shows no number without what the rival was granted
    expect(plainText(html)).toMatch(/Rival|rival/);
    // every coordinator and agent of both boards has its id where a scene's selector looks
    for (const id of ["o0", "o1", "o2", "o1.a1", "o2.a1"]) expect(occurrences(html, `data-actor="${id}"`), id).toBeGreaterThanOrEqual(1);
    expect(html).toMatch(/class="coord coord--down[^"]*" data-actor="o1"/);
  });

  it("carries the board and the regions a scene's camera and rings point at", async () => {
    const stage = createArenaStage("s", "r", { api: api({ s: swarmLog, r: rivalLog }), official: async () => null });
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    for (const store of [stage.session.left, stage.session.right, stage.scored]) renderCurrent(store as never);
    const html = renderToStaticMarkup(createElement(ArenaStageView, { stage }));
    stage.dispose();
    for (const [name, region] of Object.entries(REGIONS)) {
      if (!(region.stages as readonly string[]).includes("arena")) continue;
      // the first class or two of a selector like ".side--swarm .side__head" must all be there
      for (const css of region.css.split(",").map((part) => part.trim())) {
        for (const part of css.split(/\s+/)) {
          const cls = /^\.([\w-]+)$/.exec(part)?.[1];
          if (cls) expect(html, `region ${name}: .${cls}`).toContain(cls);
        }
      }
    }
    for (const row of ["idle", "recover", "cost", "duplicated", "reassigned"]) expect(html).toContain(`data-row="${row}"`);
  });
});

describe("the title card", () => {
  it("is the card's title and lines, centred, with nothing else", () => {
    const html = renderToStaticMarkup(createElement(TitleStageView, { card: { title: "FractalSwarm", lines: ["Built on Muse Spark", "github.com/x/y"] } }));
    expect(html).toContain('class="dir__card"');
    expect(plainText(html)).toBe("FractalSwarm Built on Muse Spark github.com/x/y");
    expect(occurrences(html, "<h1")).toBe(1);
  });
});

describe("what is drawn over the stage", () => {
  const frames = (take: ReturnType<typeof createTake>, count: number): void => {
    for (let i = 0; i < count; i++) take.tick();
  };
  const surface = () => fakeSurface({}, {}, { x: 300, y: 200, w: 400, h: 200 });

  it("is a lower third with its kicker, a ring around a target, and the note", () => {
    const take = createTake(
      sceneOf({ steps: [{ do: "caption", text: "Same input · same models", kicker: "Fair fight", ms: 3000 }, { do: "highlight", target: { region: "scoreboard" }, ms: 3000 }] }),
      fakeReplay(),
      surface(),
    );
    frames(take, 30);
    renderCurrent(take.state);
    const html = renderToStaticMarkup(createElement(OverlayLayer, { take, note: "Replay of a real recorded run · real cost $1.23" }));
    expect(html).toContain('class="dir__lower"');
    expect(plainText(html)).toContain("Fair fight Same input · same models");
    expect(html).toContain('class="dir__ring"');
    expect(html).toMatch(/left:292px;top:192px;width:416px;height:216px/); // the rectangle, and 8px of room on every side
    expect(html).toContain("Replay of a real recorded run · real cost $1.23");
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws a tooltip as a box with the words, under a target in the upper half and over one in the lower half", () => {
    const key = JSON.stringify({ kind: "region", region: "swarm-proof" });
    const take = createTake(
      sceneOf({ steps: [{ do: "tooltip", target: { region: "swarm-proof" }, ms: 3000 }] }),
      fakeReplay(),
      fakeSurface({ [key]: { x: 300, y: 200, w: 400, h: 60 } }, {}, null, { [key]: "the heir of each, recomputed from the log, is the one the run used" }),
    );
    frames(take, 40);
    renderCurrent(take.state);
    const html = renderToStaticMarkup(createElement(OverlayLayer, { take, note: null }));
    expect(html).toContain('class="dir__tip"');
    expect(plainText(html)).toBe("the heir of each, recomputed from the log, is the one the run used");
    expect(html).toMatch(/left:300px;top:270px/); // 10px under the target
    expect(tipPosition({ x: 300, y: 900, w: 400, h: 60 }, 1)).toEqual({ left: 300, bottom: 190, opacity: 1 }); // over a target in the lower half
    expect(tipPosition({ x: 1800, y: 100, w: 100, h: 40 }, 1).left).toBe(1920 - 48 - 760); // kept inside the frame
    expect(tipPosition({ x: 0, y: 100, w: 100, h: 40 }, 1).left).toBe(48);
  });

  it("is a statement for an overlay caption, which fades in from nothing", () => {
    const take = createTake(sceneOf({ steps: [{ do: "wait", ms: 500 }, { do: "caption", text: "heir = highest hash(goal, member)", style: "overlay", ms: 2000 }] }), fakeReplay(), surface());
    const drawn = (): string => {
      renderCurrent(take.state);
      return renderToStaticMarkup(createElement(OverlayLayer, { take, note: null }));
    };
    frames(take, 30); // the caption is added by the next frame, at 500 ms
    expect(drawn()).not.toContain("dir__statement");
    frames(take, 1);
    expect(drawn()).toMatch(/class="dir__statement" style="opacity:0\.0\d*"/);
    frames(take, 15); // 250 ms later: all the way in
    const html = drawn();
    expect(html).toContain('style="opacity:1"');
    expect(plainText(html)).toBe("heir = highest hash(goal, member)");
    expect(html).not.toContain("dir__note");
    frames(take, 105); // and out again: it ends 2 s after it began, at 2.5 s (frame 150)
    expect(drawn()).not.toContain("dir__statement");
  });

  it("writes the caption's strength as a style of the take's time, so a frame is the same every time it is drawn", () => {
    const make = () => createTake(sceneOf({ steps: [{ do: "caption", text: "Hello", ms: 3000 }] }), fakeReplay(), surface());
    const draw = (take: ReturnType<typeof make>): string => {
      frames(take, 8);
      renderCurrent(take.state);
      return renderToStaticMarkup(createElement(OverlayLayer, { take, note: null }));
    };
    expect(draw(make())).toBe(draw(make()));
  });
});

describe("the pages that say a scene cannot be shown", () => {
  const route = (scene: string | null, query: Partial<{ swarm: string | null; rival: string | null; run: string | null; ablation: string | null; real: boolean }> = {}) => ({
    scene,
    query: { swarm: null, rival: null, run: null, ablation: null, real: false, hold: false, hud: false, ...query },
  });
  const page = (scene: string | null, query = {}) => plainText(renderToStaticMarkup(createElement(DirectorPage, { route: route(scene, query) })));

  it("lists the scenes, and what each still needs", () => {
    const html = renderToStaticMarkup(createElement(DirectorPage, { route: route(null) }));
    expect(html).toContain('href="#/director/s1-arena-open"');
    expect(html).toContain('href="#/director/s9-close"');
    expect(plainText(html)).toContain("s1-arena-open");
    // the manifest names the first pair and the final run, so those scenes need nothing; the ablation waits for a person's own text
    expect(plainText(html)).toMatch(/s1-arena-open The arena opens.* · arena · 32 s(?! · needs)/);
    expect(plainText(html)).toMatch(/s4-lens .* · run · 18 s(?! · needs)/);
    expect(plainText(html)).toMatch(/s3-ablation .* · ablation · \d+ s · needs ablation/);
    expect(plainText(html)).toMatch(/s9-close .* · title · 10 s(?! · needs)/);
    expect(html).not.toContain("s2-intake");
  });

  it("says there is no such scene", () => {
    expect(page("s0-nothing")).toContain("No scene called s0-nothing");
  });

  it("marks its frame with the stage, so the note keeps clear of the arena's assumptions caption", () => {
    // The frame needs a window to be drawn, so what is checked is the two ends of the rule: the attribute and the CSS.
    const read = (name: string): string => readFileSync(new URL(name, import.meta.url), "utf-8");
    expect(read("./DirectorPage.tsx")).toContain('<div className="dir" data-scene={scene.id} data-stage={scene.stage}>');
    expect(read("./director.css")).toMatch(/\.dir\[data-stage="arena"\] \.dir__note \{\s*left: 24px;\s*right: auto;/);
    // the run page's strip is full: its stage starts under a band that is the note's
    expect(read("./director.css")).toMatch(/\.dir\[data-stage="run"\] \.dir__camera \{\s*padding-top: var\(--dir-band\);/);
    expect(read("./director.css")).toMatch(/\.dir\[data-stage="run"\] \.dir__stage--fit \{\s*height: calc\(1080px - var\(--dir-band\)\);\s*min-height: 0;/);
  });

  it("says which run a scene still needs, and where to give it", () => {
    const said = page("s3-ablation");
    expect(said).toContain("s3-ablation needs ablation");
    expect(said).toContain("sources.json");
    expect(said).toContain("?ablation=<run id>");
  });
});
