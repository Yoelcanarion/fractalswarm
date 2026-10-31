// The arena's components drawn on the server (react-dom/server) over synthetic runs: no browser, but
// every render path runs. The look is checked on screenshots.

import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FrameScheduler } from "../lib/clock";
import { REPO_ROOT, renderCurrent } from "../lib/testing";
import type { RunEvent, RunListing } from "../lib/types";
import { RunStoreProvider, type RunApi } from "../store";
import type { PairListing } from "./api";
import { ArenaView } from "./ArenaPage";
import { ArenaBoard } from "./ArenaBoard";
import { ArenaSide } from "./ArenaSide";
import { ArenaTimeline } from "./ArenaTimeline";
import { frameOf, sharedFrames } from "./frame";
import { readOfficial } from "./official";
import { PairPicker, runChoices } from "./PairPicker";
import { Scoreboard } from "./Scoreboard";
import { createPairSession } from "./session";
import { call, crash, kill, ready, restart, rivalStream, sent, swarmStream, takeOver } from "./testing";

const idle: FrameScheduler = { request: () => 1, cancel: () => undefined };

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** How many times ``needle`` occurs in ``html``. */
const count = (html: string, needle: string | RegExp): number => {
  const pattern = typeof needle === "string" ? new RegExp(needle, "g") : new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : `${needle.flags}g`);
  return (html.match(pattern) ?? []).length;
};

function api(logs: Record<string, RunEvent[]>): RunApi {
  return {
    listRuns: async () => [],
    loadAllEvents: async (id) => logs[id] ?? [],
    tailEvents: () => () => undefined,
    verifyRun: async () => {
      throw new Error("unused");
    },
  };
}

/** A pair opened on a clock, at ``atMs``. The swarm lost o1 (adopted by o2); the rival lost its supervisor. Each had a
 * contract ready at 9 s that only went out at 15 s. */
async function opened(atMs: number, play = false) {
  const swarm = swarmStream();
  call(swarm, "o2.a1", "e1");
  ready(swarm, "g1", "o1", 9_000);
  kill(swarm, "o1", 10_000);
  takeOver(swarm, "o1", "o2", 14_000, 15_000);
  sent(swarm, "g1", "o2", 15_000, "o2.a1");
  swarm.at(60_000).emit("run.completed", "@kernel");
  const rival = rivalStream(undefined, 4, { recovery_ms: 5000 });
  call(rival, "o0.a1", "e1");
  ready(rival, "g1", "o0", 9_000);
  crash(rival, "o0", 10_000, 5000);
  restart(rival, "o0", 15_000);
  sent(rival, "g1", "o0", 15_000, "o0.a1");
  rival.at(70_000).emit("run.completed", "@kernel");
  const session = createPairSession({ api: api({ s: swarm.events, r: rival.events }), clock: { scheduler: idle } });
  await session.open("s", "r", { atMs, speed: null, play });
  renderCurrent(session.left);
  renderCurrent(session.right);
  renderCurrent(session.clock.state); // what the clock is doing (playing, where) is seen by the components that read it
  return session;
}

const board = (store: ReturnType<typeof renderCurrent>, frame = sharedFrames(null, null)[0], rootLabel = "root") =>
  renderToStaticMarkup(createElement(RunStoreProvider, { store: store as never }, createElement(ArenaBoard, { frame, label: "a team", rootLabel })));

describe("the board", () => {
  it("draws the swarm's dead coordinator red, and its agents joining the team that took them over", async () => {
    const session = await opened(16_000);
    const html = board(session.left);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="a team"');
    expect(count(html, /class="coord coord--down/)).toBe(1); // o1
    expect(html).toContain("coord__cross");
    expect(html).toContain("board__edge--down");
    expect(count(html, /class="coord coord--up/)).toBe(2); // o0, o2
    expect(count(html, /class="dot /)).toBe(4);
    expect(count(html, /dot--adopted/)).toBe(2); // o1's two agents, now o2's
    expect(count(html, /<g class="board__team[ "]/)).toBe(1); // one team of four: o2's, o1 has none left
    expect(text(html)).toContain("root");
  });

  it("moves the root tag to the coordinator that took the root over, and lights the edge to what it adopted", async () => {
    const swarm = swarmStream();
    kill(swarm, "o0", 10_000);
    takeOver(swarm, "o0", "o1", 14_000, 15_000);
    const session = createPairSession({ api: api({ s: swarm.events, r: swarm.events }), clock: { scheduler: idle } });
    await session.open("s", "r", { atMs: 16_000, speed: null, play: false });
    renderCurrent(session.left);
    const html = board(session.left);
    expect(count(html, /class="coord coord--down/)).toBe(1); // o0
    expect(count(html, /class="coord__tag"/)).toBe(1);
    expect(html).toMatch(/<g class="coord coord--up coord--adopted"/); // o2, adopted by o1
    expect(html).toContain("board__edge--adopted");
    // The tag is drawn inside o1's chip: after o1's title, before o2's. The dead o0 has none.
    const tag = html.indexOf("coord__tag");
    expect(tag).toBeGreaterThan(html.indexOf("<title>o1 · up</title>"));
    expect(tag).toBeLessThan(html.indexOf("<title>o2 · up</title>"));
  });

  it("shows agents working, idle, and dashed while the coordinator they answer to is out", async () => {
    const session = await opened(12_000);
    const html = board(session.right, sharedFrames(null, null)[1], "supervisor");
    expect(count(html, /class="coord coord--restarting/)).toBe(1);
    expect(html).toContain("coord__restart");
    expect(count(html, /dot--working/)).toBe(1);
    expect(count(html, /dot--waiting/)).toBe(3);
    expect(text(html)).toContain("supervisor");
    expect(html).toContain("--since"); // the restart bar is driven by the clock, in CSS
  });

  it("draws every agent at rest before anything fails", async () => {
    const session = await opened(1_000);
    const html = board(session.right);
    expect(count(html, /dot--idle/) + count(html, /dot--working/)).toBe(4);
    expect(html).not.toContain("dot--waiting");
    expect(html).not.toContain("coord--down");
  });

  it("holds the same frame for both sides, so a dot is the same size in each", async () => {
    const session = await opened(0);
    const [a, b] = sharedFrames(frameOf(session.left.getState().events), frameOf(session.right.getState().events));
    expect([a.w, a.h]).toEqual([b.w, b.h]);
    expect(a.y).toBe(b.y); // the roots sit on the same line
    const html = board(session.left, a);
    expect(html).toContain(`viewBox="${a.x} ${a.y} ${a.w} ${a.h}"`);
  });
});

describe("a side", () => {
  const side = (store: ReturnType<typeof renderCurrent>, role: "swarm" | "rival", system: "swarm" | "durable-max") =>
    renderToStaticMarkup(
      createElement(ArenaSide, { store: store as never, role, title: role === "swarm" ? "FractalSwarm" : "Ideal durable supervisor", system, frame: sharedFrames(null, null)[0] }),
    );

  it("says what is down and what it costs, in the system's own terms", async () => {
    const session = await opened(12_000);
    expect(text(side(session.left, "swarm", "swarm"))).toContain("o1 down for 2.0 s · not noticed yet");
    expect(text(side(session.right, "rival", "durable-max"))).toContain("o0 down for 2.0 s · 3 agents waiting for it");
  });

  it("shows the work placed so far", async () => {
    const session = await opened(0);
    const html = side(session.right, "rival", "durable-max");
    expect(text(html)).toContain("Talks placed");
    expect(html).toContain("work__bar");
  });

  it("names the side and its run, and gives the swarm a takeover chip and the rival a recovery chip", async () => {
    const session = await opened(0);
    const swarm = side(session.left, "swarm", "swarm");
    const rival = side(session.right, "rival", "durable-max");
    expect(text(swarm)).toContain("FractalSwarm");
    expect(text(swarm)).toContain("s");
    expect(swarm).toContain("side--swarm");
    expect(rival).toContain("side--rival");
    // a finished run waits for the server's scored report: the effect that asks does not run on the server
    expect(text(rival)).toContain("Checking recovery");
  });

  it("says how its run ended once the replay has played it out, and not that nothing is down over the crosses it has drawn", async () => {
    const ended = await opened(75_000);
    expect(text(side(ended.left, "swarm", "swarm"))).toContain("Finished, lost 1 coordinator");
    expect(text(side(ended.right, "rival", "durable-max"))).toContain("Finished, supervisor crashed 1 time");
    expect(text(side(ended.left, "swarm", "swarm"))).not.toContain("No coordinator down");
    // before the end the line is still the live one
    expect(text(side((await opened(30_000)).left, "swarm", "swarm"))).toContain("No coordinator down");
  });
});

describe("the scoreboard", () => {
  const score = (session: Awaited<ReturnType<typeof opened>>, official = { left: null, right: null } as Parameters<typeof Scoreboard>[0]["official"], playing = false) =>
    renderToStaticMarkup(createElement(Scoreboard, { left: session.left, right: session.right, official, playing, fixedStep: false }));

  it("has the seven counters, swarm and rival side by side", async () => {
    const html = score(await opened(12_000));
    const t = text(html);
    for (const label of ["Idle agent-seconds", "Time to recover", "Coordinator-dependency time", "Cost", "Duplicated work", "Contracts sent again", "Hard violations"]) {
      expect(t).toContain(label);
    }
    expect(count(html, /class="metric"/)).toBe(7);
    expect(count(html, "Swarm")).toBe(7);
    expect(count(html, "Rival")).toBe(7);
  });

  it("counts the coordinator-dependency time from the log as the metrics score it, while the pair plays", async () => {
    // a wait counts when it ends: the contracts go out at 15 s, after 5 s of the coordinator being down
    expect(text(score(await opened(12_000)))).toMatch(/Coordinator-dependency time .*? 0\.0 s Swarm 0\.0 s Rival/);
    expect(text(score(await opened(16_000)))).toMatch(/Coordinator-dependency time .*? 5\.0 s Swarm 5\.0 s Rival/);
  });

  it("marks a number the metrics scored", async () => {
    const session = await opened(70_000);
    const scored = readOfficial({ run_id: "x", status: "completed", metrics: { completed: true, valid: true, detail: "placed 48/48, hard violations 0", cost_usd: 0.29 }, recovery: null });
    const html = score(session, { left: scored, right: scored });
    expect(html).toContain("Swarm ✓");
    expect(html).toContain("Rival ✓");
  });

  it("titles the cost on the pre-registered basis, and says what the scored number adds to the spend where it adds any", async () => {
    // the swarm's log spent what the metrics scored; the rival's spent less: a crash cancelled calls, which the metrics estimate
    const swarm = swarmStream();
    swarm.at(1_000).emit("budget.settled", "@kernel", { effect_id: "e1", reserved_usd: 0.7, actual_usd: 0.5 });
    swarm.at(60_000).emit("run.completed", "@kernel");
    const rival = rivalStream(undefined, 4);
    rival.at(1_000).emit("budget.settled", "@kernel", { effect_id: "e1", reserved_usd: 0.7, actual_usd: 0.6047 });
    rival.at(70_000).emit("run.completed", "@kernel");
    const session = createPairSession({ api: api({ s: swarm.events, r: rival.events }), clock: { scheduler: idle } });
    await session.open("s", "r", { atMs: 75_000, speed: null, play: false });
    renderCurrent(session.left);
    renderCurrent(session.right);
    const scored = (cost: number, cancelled: number) =>
      readOfficial({ run_id: "x", status: "completed", metrics: { completed: true, valid: true, detail: "placed 48/48, hard violations 0", cost_usd: cost, cancelled_llm_calls: cancelled }, recovery: null });
    const html = text(score(session, { left: scored(0.5, 0), right: scored(0.78461, 27) }));
    expect(html).toContain("Cost, pre-registered basis");
    expect(html).toContain("Rival: $0.605 spent, $0.180 estimated for 27 cancelled calls");
    expect(html).not.toContain("Swarm: $");
    // before the metrics are in it is the spend so far, and says nothing of an estimate
    const before = text(score(session));
    expect(before).toContain("Cost so far");
    expect(before).not.toContain("estimated for");
  });

  it("says plainly that one pair is one run on one seed, and links to where the rest is", async () => {
    const html = score(await opened(0));
    expect(text(html)).toContain("One pair is one run on one seed under one failure plan");
    expect(html).toContain('<a href="#/helps">Trade-offs</a>');
    expect(html).toContain('<a href="#/evidence">the Evidence page</a>');
  });
});

describe("the shared timeline", () => {
  const timeline = (session: Awaited<ReturnType<typeof opened>>) =>
    renderToStaticMarkup(createElement(RunStoreProvider, { store: session.left as never }, createElement(ArenaTimeline, { clock: session.clock, left: session.left, right: session.right })));

  it("has one play button, one scrubber and one speed control for both runs", async () => {
    const html = timeline(await opened(0));
    expect(count(html, /aria-label="play"/)).toBe(1);
    expect(count(html, /type="range"/)).toBe(1);
    expect(count(html, /aria-label="replay speed"/)).toBe(1);
    for (const speed of ["1×", "2×", "5×", "10×", "20×"]) expect(html).toContain(speed);
  });

  it("has each lane as one tab stop, whatever the number of its bands and marks, and the speeds as one select", async () => {
    const html = timeline(await opened(0));
    expect(count(html, /<button[^>]*class="(?:band|mark)[^"]*"[^>]*tabindex="0"/g)).toBe(2);
    expect(count(html, /<button[^>]*class="(?:band|mark)[^"]*"[^>]*tabindex="-1"/g)).toBeGreaterThan(2);
    expect(html).toContain('<select aria-label="replay speed">');
    expect(html).not.toContain("btn--seg");
  });

  it("draws a band for each side's outage and marks the crashes and the recoveries", async () => {
    const html = timeline(await opened(0));
    expect(count(html, /class="band band--chaos/)).toBe(1);
    expect(count(html, /class="band band--supervisor/)).toBe(1);
    expect(count(html, /mark--coordinator-kill/)).toBe(2);
    expect(html).toContain("mark--adopted");
    expect(html).toContain("mark--restart");
  });

  it("labels the two lanes and shares one axis", async () => {
    const html = timeline(await opened(0));
    expect(text(html)).toContain("Swarm");
    expect(text(html)).toContain("Rival");
    expect(html).toContain("--end:70000"); // the longer run
  });
});

describe("the picker", () => {
  const pair = (over: Partial<PairListing> = {}): PairListing => ({
    pairId: "demo-1",
    label: "swarm vs durable-max, half-the-brains, seed 1",
    left: "demo-1-swarm",
    right: "demo-1-durable-max",
    rival: "durable-max",
    chaos: "half-the-brains",
    actions: 5,
    seed: "1",
    state: "completed",
    private: false,
    billed: false,
    createdAt: null,
    ...over,
  });
  const run = (id: string): RunListing => ({ id, source: "runs", run_id: id, scenario: null, seed: null, clock: "sim", events: 1, duration_ms: 1, status: "completed", head: null });
  const picker = (props: Partial<Parameters<typeof PairPicker>[0]> = {}) =>
    renderToStaticMarkup(createElement(PairPicker, { left: null, right: null, pairs: [pair()], runs: [run("a"), run("b")], ...props }));

  it("lists the pairs on record, and for a pair made by hand only their runs, each on its side", () => {
    const html = picker();
    expect(html).toContain("swarm vs durable-max, half-the-brains, seed 1");
    expect(count(html, /<option value="demo-1-swarm"/)).toBe(1);
    expect(count(html, /<option value="demo-1-durable-max"/)).toBe(1);
    expect(html).not.toContain('<option value="a"');
  });

  it("never hides the run on screen, leaves a private pair's runs out of the lists, and offers every run when no pair ships", () => {
    expect(runChoices([pair()], [run("a")], "left", "a")).toEqual(["demo-1-swarm", "a"]);
    expect(runChoices([pair({ private: true })], [run("a")], "left", null)).toEqual(["a"]);
    expect(runChoices([pair(), pair({ pairId: "mine", private: true, left: "mine-swarm" })], [run("a")], "left", null)).toEqual(["demo-1-swarm"]);
    expect(runChoices([], [run("a"), run("b")], "right", null)).toEqual(["a", "b"]);
    expect(runChoices([pair()], [], "right", "demo-1-durable-max")).toEqual(["demo-1-durable-max"]);
  });

  it("selects the pair that is open", () => {
    expect(picker({ left: "demo-1-swarm", right: "demo-1-durable-max" })).toMatch(/<option value="demo-1" selected/);
  });

  it("has the pair on record in view, and the two runs of one's own choosing in a menu", () => {
    const html = picker();
    expect(html).toContain('<details id="runs" class="disclosure disclosure--menu">');
    expect(html).toContain("Choose the two runs yourself");
    expect(html.indexOf("pair on record")).toBeLessThan(html.indexOf('<details id="runs"'));
    expect(html.indexOf('aria-label="swarm run"')).toBeGreaterThan(html.indexOf('<details id="runs"'));
  });

  it("puts the private pairs, made here from live input, under a divider after the ones that ship, with the mark still in their name", () => {
    const html = picker({ pairs: [pair({ pairId: "mine", label: "my own pair", private: true }), pair({ pairId: "shipped", label: "a shipped pair" })] });
    expect(count(html, "<optgroup")).toBe(1);
    expect(html).toContain('<optgroup label="Private, made here">');
    expect(html.indexOf("a shipped pair")).toBeLessThan(html.indexOf("<optgroup"));
    expect(html.indexOf("Your pair · ")).toBeGreaterThan(html.indexOf("<optgroup"));
    expect(picker()).not.toContain("<optgroup"); // nothing private, no divider
    expect(picker({ pairs: [pair({ billed: true })] })).not.toContain("<optgroup"); // a billed pair that ships stays in the list
  });

  it("marks a private or billed pair, so it is never taken for a bundled one", () => {
    const html = picker({ pairs: [pair({ private: true }), pair({ pairId: "p2", billed: true })] });
    expect(html).toContain("Your pair · Ideal durable supervisor · half the brains");
    expect(html).toContain("· billed");
  });

  it("says when there is nothing on record, and while it loads", () => {
    expect(picker({ pairs: [] })).toContain("No pairs on record");
    expect(picker({ pairs: null })).toContain("Loading pairs…");
  });

  it("shows the whole name of the pair that is open beside the select, which a phone cuts: the marks included", () => {
    const html = picker({ left: "demo-1-swarm", right: "demo-1-durable-max", pairs: [pair({ private: true, billed: true, createdAt: "2026-10-31T13:25:58+00:00" })] });
    const at = new Date("2026-10-31T13:25:58+00:00").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(html).toContain(`<span class="picker__shown" aria-hidden="true">Your pair · Ideal durable supervisor · half the brains · ${at} · billed</span>`);
    expect(picker()).toContain('<span class="picker__shown" aria-hidden="true">Choose a pair…</span>');
  });
});

describe("the arena on a phone", () => {
  // At 390 px the first card clipped its "Replay verified" badge at its edge and the pair's select cut its name. This reads the sheet.
  const sheet = readFileSync(`${REPO_ROOT}web/src/arena/arena.css`, "utf-8").replace(/\r\n/g, "\n");
  const phone = /@media \(max-width: 760px\) \{([\s\S]*?)\n\}\n?$/.exec(sheet)?.[1] ?? "";
  const rule = (selector: string): string => new RegExp(`${selector.replace(/[.>]/g, "\\$&")} \\{([^}]*)\\}`).exec(phone)?.[1] ?? "";

  it("lets the head's badge go under the title, from the left", () => {
    expect(phone).not.toBe("");
    expect(rule(".side__top")).toContain("flex-wrap: wrap");
    expect(rule(".side__verify")).toContain("margin-left: 0");
  });

  it("gives the pair a row, with its whole name shown over the select, which takes the tap unseen", () => {
    expect(rule(".picker__shown")).toContain("display: block");
    expect(rule(".picker__control select")).toMatch(/position: absolute/);
    expect(rule(".picker__control select")).toMatch(/opacity: 0/);
    // off a phone the select is the control, as before
    expect(/\.picker__shown \{\s*display: none;/.test(sheet)).toBe(true);
  });
});

describe("the pinned timeline", () => {
  // The bar is pinned in a window that holds it and two boards above it, and is a page's last element elsewhere. This reads the sheet.
  const sheet = readFileSync(`${REPO_ROOT}web/src/arena/arena.css`, "utf-8").replace(/\r\n/g, "\n");
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const media = (query: string): string => {
    const start = sheet.indexOf(`@media ${query} {`);
    return start < 0 ? "" : sheet.slice(start, sheet.indexOf("\n}\n", start));
  };
  const rule = (css: string, selector: string): string => new RegExp(`${escape(selector)} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const laptop = media("(min-width: 1101px) and (min-height: 701px)");
  const unpinned = media("(max-width: 1100px), (max-height: 700px)");

  it("pins the bar to the bottom of the view", () => {
    expect(rule(sheet, ".tl")).toContain("position: sticky");
    expect(rule(sheet, ".tl")).toContain("bottom: 0");
  });

  it("leaves the bar at the end of the page where the boards stack and where the window is too short to hold it with the boards: the same width as the stacking", () => {
    expect(unpinned).not.toBe("");
    expect(rule(unpinned, ".tl")).toContain("position: static");
    expect(rule(media("(max-width: 1100px)"), ".arena__stage")).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("caps the boards to the room above the bar only in the window that pins it: a stacked page has them whole", () => {
    expect(laptop).not.toBe("");
    expect(rule(laptop, ".board")).toContain("max-height: max(190px, calc(var(--arena-room) - var(--arena-chrome)))");
    expect(/\n\.board \{[^}]*max-height/.test(sheet)).toBe(false);
  });

  it("hands the bar to the end of the page once the pair has played out, so that the end card is what is under the boards", () => {
    expect(rule(sheet, ".arena--played-out .tl")).toContain("position: static");
  });

  it("shows the clock beside the main action only where the bar, which has one, is not pinned", () => {
    expect(rule(laptop, ".arena:not(.arena--played-out) .arena__clock")).toContain("display: none");
  });
});

describe("the page", () => {
  const view = async (over: Partial<Parameters<typeof ArenaView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(
        RunStoreProvider,
        { store: (await opened(0)).left as never },
        createElement(ArenaView, { session: await opened(0), pairs: [], runs: [], official: { left: null, right: null }, left: null, right: null, ...over }),
      ),
    );

  it("says what it is for and what the rival is, and has one main action once a pair is open: watch the first crash, with playing both from the start beside it", async () => {
    const session = await opened(0);
    const html = await view({ session, left: "s", right: "r" });
    // the plan's crash points are points of the work, not of time: the two sides are hit at about the same point of the work, not at the same second
    expect(text(html)).toContain("FractalSwarm, on the left, and a rival, on the right, plan the same conference under the same failures, each at about the same point of the work.");
    expect(text(html)).toContain("The rival is an ideal durable supervisor: its workers survive a crash, and it is back after 5 s.");
    expect(html).toContain('<button type="button" class="btn btn--on">Watch the first crash</button>');
    expect(html).toContain('<button type="button" class="btn">Play both from the start</button>');
    expect(html).not.toContain("arena__clock"); // nothing to read before it starts
  });

  it("turns the main action into Pause with the clock beside it while the pair plays, and into Carry on when it is stopped midway", async () => {
    const playing = await view({ session: await opened(20_000, true), left: "s", right: "r" });
    expect(playing).toContain('<button type="button" class="btn btn--on">Pause</button>');
    expect(playing).toContain('class="arena__clock mono"');
    expect(text(playing)).not.toContain("Watch the first crash");
    const stopped = await view({ session: await opened(20_000), left: "s", right: "r" });
    expect(stopped).toContain('<button type="button" class="btn btn--on">Carry on</button>');
    expect(stopped).toContain('class="arena__clock mono"');
    // played out, it opens what the swarm's run produced, with playing the pair again beside that
    const over = await view({ session: await opened(75_000), left: "s", right: "r" });
    expect(over).toMatch(/<a class="btn btn--on" href="#\/run\/s\/results\?at=end">See the (program|result)<\/a>/);
    expect(over).toContain('<button type="button" class="btn">Play both from the start</button>');
    expect(text(over)).not.toContain("Watch the first crash");
  });

  it("makes playing the pair the main action where no coordinator is killed, and offers no first crash", async () => {
    const swarm = swarmStream();
    swarm.at(60_000).emit("run.completed", "@kernel");
    const rival = rivalStream(undefined, 4);
    rival.at(60_000).emit("run.completed", "@kernel");
    const session = createPairSession({ api: api({ s: swarm.events, r: rival.events }), clock: { scheduler: idle } });
    await session.open("s", "r", { atMs: 0, speed: null, play: false });
    renderCurrent(session.left);
    renderCurrent(session.right);
    const html = await view({ session, left: "s", right: "r" });
    expect(html).toContain('<button type="button" class="btn btn--on">Play both from the start</button>');
    expect(html).not.toContain("Watch the first crash");
  });

  it("says what to do next when there is no pair, instead of a bare page", async () => {
    const html = await view();
    expect(text(html)).toContain("No pair to watch yet");
    expect(html).toContain('<a class="btn btn--on" href="#/new">Start a pair</a>');
    expect(html).not.toContain("Play both from the start");
    expect(text(html)).not.toContain("POST /api/arena");
  });

  it("waits, with the page's own skeleton, for `#/arena` alone to open the first public pair", async () => {
    const html = await view({ pairs: [{ pairId: "p", left: "a", right: "b", label: "x", seed: "1", state: "completed", private: false, billed: false, createdAt: null } as never] });
    expect(html).toContain('<span class="sr-only">Loading the pair…</span>');
    expect(text(html)).not.toContain("No pair to watch yet");
  });

  it("has no header of its own in a director's frame, which is the page and nothing around it", async () => {
    const html = await view({ bare: true });
    expect(html).not.toContain("pagehead");
  });
});

describe("the end of a pair", () => {
  const page = async (atMs: number, over: Partial<Parameters<typeof ArenaView>[0]> = {}) => {
    const session = await opened(atMs);
    return renderToStaticMarkup(
      createElement(
        RunStoreProvider,
        { store: session.left as never },
        createElement(ArenaView, { session, pairs: [], runs: [], official: { left: null, right: null }, left: "s", right: "r", ...over }),
      ),
    );
  };

  it("is not there while the pair plays", async () => {
    expect(await page(30_000)).not.toContain("pairend");
  });

  it("says that both runs finished, what each did and that one pair is one run on one seed, once both have played out", async () => {
    const html = await page(75_000);
    const t = text(html);
    expect(html).toContain('<section class="pairend" role="status"');
    expect(t).toContain("Both runs finished.");
    expect(t).toContain("FractalSwarm Lost 1 coordinator and still finished");
    expect(t).toContain("Ideal durable supervisor Its supervisor crashed 1 time; its workers kept going and the board paused 5 s each time.");
    expect(t).toContain("This is one run of each, on one seed, under one failure plan");
    expect(html).toContain('<a href="#/helps">Trade-offs</a>');
    expect(html).toContain('<a href="#/evidence">the Evidence page</a>');
    // what each run produced is one click away, from the side that produced it
    expect(html).toMatch(/<a href="#\/run\/s\/results\?at=end">See its (program|result)<\/a>/);
    expect(html).toMatch(/<a href="#\/run\/r\/results\?at=end">See its (program|result)<\/a>/);
  });

  it("waits for the slower run: one side done is not the end of the pair", async () => {
    // the swarm ends at 60 s and the rival at 70 s
    expect(await page(65_000)).not.toContain("pairend");
  });

  it("says so when a run's log ends without the run completing", async () => {
    const swarm = swarmStream();
    kill(swarm, "o1", 10_000);
    swarm.at(60_000).emit("run.completed", "@kernel");
    const rival = rivalStream(undefined, 4, { recovery_ms: 5000 });
    crash(rival, "o0", 10_000, 5000);
    rival.at(70_000).emit("run.halted", "@kernel");
    // the catalog says the rival's run was interrupted: its log just stops, and it is no longer live
    const stopped: RunApi = { ...api({ s: swarm.events, r: rival.events }), listRuns: async () => [{ id: "r", status: "interrupted" } as RunListing] };
    const session = createPairSession({ api: stopped, clock: { scheduler: idle } });
    await session.open("s", "r", { atMs: 75_000, speed: null, play: false });
    renderCurrent(session.left);
    renderCurrent(session.right);
    const html = renderToStaticMarkup(
      createElement(
        RunStoreProvider,
        { store: session.left as never },
        createElement(ArenaView, { session, pairs: [], runs: [], official: { left: null, right: null }, left: "s", right: "r" }),
      ),
    );
    expect(text(html)).toContain("Only one of the two runs finished.");
    expect(text(html)).toContain("It did not finish: 0 talks placed.");
  });

  it("is not in a director's frame, which is the arena and nothing around it", async () => {
    expect(await page(75_000, { bare: true })).not.toContain("pairend");
  });

  it("marks the page as played out once both runs have, so that the replay bar leaves the bottom of the view for the end of the page, and takes the mark off when they play", async () => {
    const classes = (html: string) => /<div class="(arena[^"]*)"/.exec(html)?.[1];
    expect(classes(await page(30_000))).toBe("arena");
    expect(classes(await page(65_000))).toBe("arena"); // the swarm has ended, the rival has not
    expect(classes(await page(75_000))).toBe("arena arena--played-out");
  });

  it("says the hand-overs of the takeover check with their reason once the check is in, and not before", async () => {
    const session = await opened(75_000);
    const render = () =>
      text(
        renderToStaticMarkup(
          createElement(RunStoreProvider, { store: session.left as never }, createElement(ArenaView, { session, pairs: [], runs: [], official: { left: null, right: null }, left: "s", right: "r" })),
        ),
      );
    expect(render()).not.toContain("hand-overs");
    const report = { ok: true, violations: [], heirs: 3, reclaims: 0, adoptions: 1, kills: 1 };
    session.left.setState({ takeover: { state: "done", report } });
    expect(render()).toContain("The takeover check counts 3 hand-overs for that coordinator: one coordinator's root duties and its subtree are two hand-overs");
    session.left.setState({ takeover: { state: "done", report: { ...report, heirs: 1 } } });
    expect(render()).not.toContain("hand-overs");
  });

  it("says the one-run caveat once: the end card's, which has the setting, takes the place of the scoreboard's", async () => {
    const caveat = (html: string) => count(text(html), /under one failure plan/);
    expect(caveat(await page(30_000))).toBe(1); // while it plays, the scoreboard's
    expect(text(await page(30_000))).toContain("One pair is one run on one seed under one failure plan");
    const ended = text(await page(75_000));
    expect(caveat(ended)).toBe(1);
    expect(ended).toContain("This is one run of each, on one seed, under one failure plan");
    expect(ended).not.toContain("One pair is one run on one seed");
    expect(ended).toContain("✓ marks a number the metrics have scored"); // what the ✓ means stays
    // a director's frame has no end card, so the scoreboard keeps its caveat
    expect(text(await page(75_000, { bare: true }))).toContain("One pair is one run on one seed under one failure plan");
  });
});

describe("a pair that cannot be loaded", () => {
  it("says what went wrong and offers a way out, instead of a bare line", async () => {
    const failing: RunApi = {
      ...api({}),
      loadAllEvents: async () => {
        throw new Error("run not found");
      },
    };
    const session = createPairSession({ api: failing, clock: { scheduler: idle } });
    await session.open("s", "r", { atMs: 0, speed: null, play: false });
    renderCurrent(session.left);
    renderCurrent(session.right);
    const html = renderToStaticMarkup(
      createElement(
        RunStoreProvider,
        { store: session.left as never },
        createElement(ArenaView, { session, pairs: [], runs: [], official: { left: null, right: null }, left: "s", right: "r" }),
      ),
    );
    expect(text(html)).toContain("Could not load the pair");
    expect(text(html)).toContain("run not found");
    expect(html).toContain(">Try again</button>");
    expect(html).toContain('<a class="btn" href="#/runs">Open the runs</a>');
    expect(html).toContain('role="alert"');
  });
});
