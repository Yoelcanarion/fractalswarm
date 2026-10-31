// The views of a run before and after it loads: the states, the shared head, the guide, and the hints that used to be hover-only.
// Drawn on the server (react-dom/server) from the committed toy bundle, no browser.

import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunEvent } from "../lib/types";
import { loadJsonl, REPO_ROOT, renderCurrent } from "../lib/testing";
import { EventsPage } from "../pages/EventsPage";
import { PanelsPage } from "../pages/PanelsPage";
import { PlanPage } from "../pages/PlanPage";
import { ResultsPage } from "../pages/ResultsPage";
import { RunPage } from "../pages/RunPage";
import { SecurityPage } from "../pages/SecurityPage";
import { createRunStore, RunStoreProvider, type RunApi, type RunStoreApi } from "../store";
import { Meter, PStat, Pill } from "./PanelParts";
import { RunFrame, RunGate } from "./RunFrame";
import { Guide, GuideButton, useGuide, type GuideState } from "./shell/Guide";
import { VerifyBadge } from "./VerifyBadge";

const events = (): RunEvent[] =>
  readFileSync(REPO_ROOT + "demo/toy/events.jsonl", "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunEvent);

const apiOf = (over: Partial<RunApi> = {}): RunApi => ({
  listRuns: async () => [],
  loadAllEvents: async () => events(),
  tailEvents: () => () => undefined,
  verifyRun: async () => {
    throw new Error("unused");
  },
  ...over,
});

const render = (store: RunStoreApi, element: ReactElement) => renderToStaticMarkup(createElement(RunStoreProvider, { store }, element));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** A store with the toy run opened and sitting at its start, the way a person lands on it. */
async function opened(api: Partial<RunApi> = {}): Promise<RunStoreApi> {
  const store = renderCurrent(createRunStore({ api: apiOf(api) }));
  await store.getState().openRun("toy");
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("before there is a run to show", () => {
  const gate = (state: Record<string, unknown>) => {
    const store = renderCurrent(createRunStore({ api: apiOf() }));
    store.setState(state);
    return render(store, createElement(RunGate, null, createElement("p", null, "the run")));
  };

  it("says no run is selected and where to get one, once the list has answered with none", () => {
    const out = gate({ runId: null, runs: [], runsLoaded: true });
    expect(text(out)).toContain("No run selected");
    expect(out).toContain('href="#/runs"');
    expect(text(out)).toContain("fractalswarm run");
    expect(out).not.toContain("the run<");
  });

  it("does not say no run is selected while the list of runs is on its way: it holds the page's place", () => {
    const out = gate({ runId: null, runs: [], runsLoaded: false });
    expect(text(out)).toContain("Loading the runs");
    expect(out).toContain("skeleton");
    expect(text(out)).not.toContain("No run selected");
  });

  it("holds the place of the first listed run, which a bare address is about to open", () => {
    const out = gate({ runId: null, runs: [{ id: "demo-backup" }, { id: "other" }], runsLoaded: true });
    expect(text(out)).toContain("Loading demo-backup");
    expect(text(out)).not.toContain("No run selected");
    expect(out).not.toContain("the run<");
  });

  it("is not in the way of a failed list: the run pages say what failed where they can", () => {
    expect(text(gate({ runId: null, runs: [], runsLoaded: true, runsError: "502 Bad Gateway" }))).toContain("No run selected");
  });

  it("holds the page's place with a skeleton while the log loads, and says what it waits for", () => {
    const out = gate({ runId: "demo-backup", loading: true });
    expect(out).toContain("Loading demo-backup");
    expect(out).toContain("skeleton");
    expect(out).toContain('role="status"');
  });

  it("says why a run failed to load and offers to try again or to leave", () => {
    const out = gate({ runId: "demo-backup", loading: false, loadError: "502 Bad Gateway" });
    expect(text(out)).toContain("Could not load demo-backup");
    expect(out).toContain("502 Bad Gateway");
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain("Try again");
    expect(out).toContain('href="#/runs"');
  });

  it("shows the run once it has loaded", () => {
    expect(gate({ runId: "toy", loading: false, loadError: null })).toContain("the run");
  });
});

describe("the five views of a run", () => {
  const pages = [
    ["Results", ResultsPage, /reported/i],
    ["Plan", PlanPage, /plan the root proposed/i],
    ["Panels", PanelsPage, /rate limits/i],
    ["Security", SecurityPage, /scanned/i],
    ["Events", EventsPage, /newest first/i],
  ] as const;

  for (const [title, Page, lead] of pages) {
    it(`${title} opens with its name and what it is for, as the page's one h1`, async () => {
      const store = await opened();
      const out = render(store, createElement(Page));
      expect(out.match(/<h1/g)).toHaveLength(1);
      expect(out).toMatch(new RegExp(`<h1 class="pagehead__title">${title}</h1>`));
      expect(out).toContain("pagehead--compact");
      expect(text(out)).toMatch(lead);
      expect(out).toContain('class="timeline"'); // every view carries the scrubber
    });

    it(`${title} cites no section of the spec`, async () => {
      const out = render(await opened(), createElement(Page));
      expect(text(out)).not.toMatch(/spec §|§\s?\d/);
    });
  }

  it("each lead that mentions the playhead defines it", async () => {
    for (const [, Page] of [pages[0], pages[2], pages[4]]) {
      const out = render(await opened(), createElement(Page));
      expect(out).toContain('<span class="term">playhead</span>');
      expect(out).toContain("Every view shows the run as it was at that moment");
    }
  });

  it("the panels' stat hints are the shared tooltip, and are text a screen reader gets", async () => {
    const out = render(await opened(), createElement(PanelsPage));
    expect(out).toContain('role="tooltip"');
    expect(out).not.toMatch(/class="pstat[^"]*"[^>]* title=/);
    expect(out).toContain('class="sr-only"');
  });

  it("folds the budget shock and the kill switch away on a recording, the way the plan's approval is, and shows them on a live run", async () => {
    const store = await opened();
    const recorded = render(store, createElement(PanelsPage));
    expect(recorded).toMatch(/<details id="controls" class="disclosure disclosure--inline controls__fold">/);
    expect(text(recorded)).toContain("Budget shock and kill switch only on a live run");
    // what the fold says is still in view: the page is a recording
    expect(text(recorded)).toContain("recorded run: controls available on live runs");
    store.setState({ runStatus: "running" });
    const live = render(store, createElement(PanelsPage));
    expect(live).not.toContain('id="controls"');
    expect(text(live)).toContain("Apply cap");
    expect(text(live)).toContain("Kill switch");
    expect(text(live)).toContain("live run: these act on it");
  });

  it("explains the jargon of the panels in place", async () => {
    const out = render(await opened(), createElement(PanelsPage));
    expect(out).toContain('<span class="term">Breakers</span>');
    expect(out).toContain("A circuit breaker. It opens after repeated failures");
    // and in the page's own sentence about what the view holds
    expect(out).toMatch(/<span class="term"[^>]*>breakers<\/span>/);
  });

  it("gives the events view a way to open a row from the keyboard", async () => {
    const store = await opened();
    store.getState().seek(store.getState().events.length); // a finished run opens at its start, with nothing to list yet
    const out = render(store, createElement(EventsPage));
    expect(out).toMatch(/<button type="button" class="evrow__toggle" aria-expanded="false">/);
    expect(out).toMatch(/aria-label="Move the playhead to event \d+"/);
  });
});

describe("the run page", () => {
  it("opens with the state of the run and one main action beside it, and no title or lead of its own to repeat the sub-nav", async () => {
    const out = render(await opened(), createElement(RunPage));
    expect(out).toContain('<h1 class="sr-only">Run</h1>');
    expect(out).not.toContain("pagehead");
    expect(text(out)).not.toContain("A recorded run.");
    // no coordinator is killed in this run, so there is no first crash to watch: playing it from its start is the main action
    expect(out).toContain('<div class="runstate__actions"><button type="button" class="btn btn--on">Play from the start</button></div>');
    expect(text(out)).not.toContain("Watch the first crash");
    expect(out.indexOf("runstate__line")).toBeLessThan(out.indexOf("runstate__actions"));
    expect(out.indexOf("runstate__actions")).toBeLessThan(out.indexOf("counters--headline"));
    // the guide is the app's, in the shell: the page has no second one, and no tab stop for every orchestrator to skip
    expect(out).not.toContain('id="guide"');
    expect(out).not.toContain("Skip the tree");
  });

  it("is not behind a gate that hides the page from a screen reader while it loads", async () => {
    const store = renderCurrent(createRunStore({ api: apiOf() }));
    store.setState({ runId: "toy", loading: true });
    const out = render(store, createElement(RunPage));
    expect(out).toContain("Loading toy");
    expect(out).toContain('role="status"');
  });

  it("holds its own shape, the counters and the tree, from the first paint, before the list of runs has answered", () => {
    const out = render(renderCurrent(createRunStore({ api: apiOf() })), createElement(RunPage));
    expect(out).toContain("Loading the runs");
    expect(out).toContain('class="counters counters--headline"');
    expect(out).toContain("run__tree");
    expect(text(out)).not.toContain("No run selected");
  });

  it("opens with the state of the run in a line of words and the three numbers that are its claim, the rest folded away", async () => {
    const store = await opened();
    const out = render(store, createElement(RunPage));
    expect(text(out)).toContain("At the start: nothing has happened yet.");
    expect(out).toContain('class="counters counters--headline"');
    // every other counter, the schedule, the chaos list and the event log are one click away, and the address can open them
    expect(out).toMatch(/<details id="more" class="disclosure run__more">/);
    expect(render(store, createElement(RunPage, { unfold: true }))).toMatch(/<details id="more" class="disclosure run__more" open="">/);
  });

  it("says in the hand-overs' hint why they can outnumber the crashes", async () => {
    const store = await opened();
    expect(text(render(store, createElement(RunPage)))).toMatch(/root duties and its subtree are two hand-overs, so there can be more of them than crashes/);
  });

  it("offers to watch the first crash where a coordinator is killed, in the row of the state and in the empty tree, with the whole run beside it", async () => {
    const store = await opened({ loadAllEvents: async () => loadJsonl("demo/final/events.jsonl") });
    const out = render(store, createElement(RunPage));
    expect(out).toContain(
      '<div class="runstate__actions"><button type="button" class="btn btn--on">Watch the first crash</button><button type="button" class="btn">Play from the start</button></div>',
    );
    expect(out.match(/Watch the first crash/g)).toHaveLength(2); // the empty tree says the same, so the page has one main action
    // once it is under way the action is the one it always was
    store.getState().seek(10);
    expect(render(store, createElement(RunPage))).toContain('<div class="runstate__actions"><button type="button" class="btn btn--on">Carry on</button></div>');
    store.setState({ playing: true });
    expect(render(store, createElement(RunPage))).toContain('<div class="runstate__actions"><button type="button" class="btn btn--on">Pause</button></div>');
    // at the end of the run, as at its start
    store.setState({ playing: false });
    store.getState().seek(store.getState().events.length);
    expect(render(store, createElement(RunPage))).toContain("Watch the first crash</button><button");
  });

  it("opens the Details fold into view, not behind the replay bar pinned over the foot of the page", () => {
    const run = readFileSync(REPO_ROOT + "web/src/pages/RunPage.tsx", "utf-8");
    expect(run).toMatch(/<Details id="more"[^>]*\breveal\b/);
    const fold = readFileSync(REPO_ROOT + "web/src/components/ui/Details.tsx", "utf-8");
    expect(fold).toMatch(/scrollIntoView\(\{ block: "start"/);
    // only a person's click does it: not a prop, not an address
    expect(fold).toMatch(/opening\.current = reveal && !root\.current\?\.open/);
  });

  it("does not say a finished run has no actors alive: it says the run is finished", async () => {
    const store = await opened();
    expect(text(render(store, createElement(RunPage)))).toContain("actors alive");
    store.getState().seek(store.getState().events.length);
    const t = text(render(store, createElement(RunPage)));
    expect(t).toContain("Finished: no coordinator crashed.");
    expect(t).not.toContain("actors alive");
    expect(t).toMatch(/finished actors/);
  });

  it("says what the one main action will do now: play from the start, pause while it plays, carry on from where it stopped", async () => {
    const store = await opened();
    const label = () => /<button type="button" class="btn btn--on">([^<]+)<\/button>/.exec(render(store, createElement(RunPage)))?.[1];
    expect(label()).toBe("Play from the start");
    store.getState().seek(10);
    expect(label()).toBe("Carry on");
    store.setState({ playing: true });
    expect(label()).toBe("Pause");
    expect(text(render(store, createElement(RunPage)))).toContain("Replaying: at ");
    store.setState({ playing: false });
    expect(text(render(store, createElement(RunPage)))).toContain("Paused: at ");
  });

  it("says a recorded run is at its start, where it opens, and offers to play it or to jump to its end", async () => {
    const out = render(await opened(), createElement(RunPage));
    const t = text(out);
    expect(t).toContain("The run is at its start");
    expect(t).toContain("Press play, or drag the playhead along the bar below");
    expect(t).toContain("Play from the start");
    expect(t).toContain("Jump to the end");
    expect(t).not.toContain("Waiting for the first actor");
  });

  it("keeps waiting for the first orchestrator only where the run is live", async () => {
    const store = await opened();
    store.setState({ live: true });
    const t = text(render(store, createElement(RunPage)));
    expect(t).toContain("Waiting for the first actor to spawn");
    expect(t).not.toContain("Play from the start");
  });

  it("says so, instead of waiting, when a recorded run's log ends with no orchestrator", async () => {
    const store = await opened();
    // the view stays as it opened, with nothing in it, and the playhead is at the end of the log: what a run that never spawned one looks like
    store.setState({ cursor: store.getState().events.length });
    const t = text(render(store, createElement(RunPage)));
    expect(t).toContain("This run created no orchestrator");
    expect(t).toContain("Its log ends without one");
    expect(t).not.toContain("Waiting for the first actor");
    expect(t).not.toContain("The run is at its start");
  });

  it("names the schedule with a defined T2", async () => {
    const out = render(await opened(), createElement(RunPage));
    expect(out).toContain('<span class="term">T2</span>');
  });
});

describe("the guide", () => {
  const guide = (open: boolean): GuideState => ({ open, toggle: () => undefined, dismiss: () => undefined });

  it("is nothing when closed, and the button that opens it says whether it is open", () => {
    expect(renderToStaticMarkup(createElement(Guide, { guide: guide(false) }))).toBe("");
    expect(renderToStaticMarkup(createElement(GuideButton, { guide: guide(false) }))).toContain('aria-expanded="false"');
    expect(renderToStaticMarkup(createElement(GuideButton, { guide: guide(true) }))).toContain('aria-expanded="true"');
  });

  it("opens for a browser that has not seen it, and stays closed for one that has", () => {
    const probe = () => {
      let seen: boolean | null = null;
      const Probe = () => {
        seen = useGuide().open;
        return null;
      };
      renderToStaticMarkup(createElement(Probe));
      return seen;
    };
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } });
    expect(probe()).toBe(true);
    vi.stubGlobal("window", { localStorage: { getItem: () => "1", setItem: () => undefined } });
    expect(probe()).toBe(false);
  });

  it("still opens when storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    let seen: boolean | null = null;
    const Probe = () => {
      seen = useGuide().open;
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    expect(seen).toBe(true);
  });
});

describe("a meter of a panel", () => {
  it("is a plain block of a head and a track: not the Muse meter's flex row, which left the bar no width", () => {
    const out = renderToStaticMarkup(createElement(Meter, { share: 0.4, label: "requests left", detail: "2,999 of 3,000" }));
    expect(out).not.toMatch(/class="meter"/);
    expect(out).toContain('class="meter__head"');
    expect(out).toContain('class="meter__track"');
    expect(out).toContain("width:40%");
  });
});

describe("a number with a hint", () => {
  it("shows the hint in the shared tooltip and to a screen reader, and nothing when there is none", () => {
    const hinted = renderToStaticMarkup(createElement(PStat, { label: "reserved", value: "$0.10", title: "open reservations" }));
    expect(hinted).toContain('role="tooltip"');
    expect(hinted).toContain("open reservations");
    expect(hinted).not.toContain("tabindex");
    expect(hinted).not.toMatch(/ title=/);
    const plain = renderToStaticMarkup(createElement(PStat, { label: "reserved", value: "$0.10" }));
    expect(plain).not.toContain("tooltip");
    const pill = renderToStaticMarkup(createElement(Pill, { tone: "bad", title: "what it means", children: "SCOPE" }));
    expect(pill).toContain("what it means");
    expect(pill).toContain("badge--bad");
  });
});

describe("the frame", () => {
  it("puts the title and purpose above the view and the replay bar below it", async () => {
    const out = render(await opened(), createElement(RunFrame, { title: "Plan", lead: "A sentence.", children: createElement("p", null, "body") }));
    expect(out.indexOf("Plan")).toBeLessThan(out.indexOf("body"));
    expect(out.indexOf("body")).toBeLessThan(out.indexOf('class="timeline"'));
    expect(text(out)).toContain("A sentence.");
  });
});

describe("the keyboard on the run page", () => {
  it("has no tab stop to skip: the tree is one, and the replay bar's slider has the id the keyboard goes to", async () => {
    const store = await opened();
    store.getState().seek(store.getState().events.length); // at the start of the run there is no orchestrator yet
    const out = render(store, createElement(RunPage));
    expect(out).not.toContain('class="skip"');
    expect(out).toContain('id="replay-position"');
  });

  it("makes the orchestrators one tab stop together, each the card's own: not the library's wrapper around it, and not every edge", () => {
    const source = readFileSync(REPO_ROOT + "web/src/components/TreeGraph.tsx", "utf-8");
    expect(source).toMatch(/nodesFocusable=\{false\}/);
    expect(source).toMatch(/edgesFocusable=\{false\}/);
    // the card Tab lands on is one, and the arrow keys, Home and End move between the cards
    expect(source).toMatch(/role="button"\s+tabIndex=\{tabbable \? 0 : -1\}/);
    expect(source).toMatch(/onKeyDown=\{moveBetweenCards\}/);
  });

  it("leaves a plain wheel over the tree to the page: the tree is most of it, and a stranger's first scroll lands on it", () => {
    const source = readFileSync(REPO_ROOT + "web/src/components/TreeGraph.tsx", "utf-8");
    expect(source).toMatch(/preventScrolling=\{false\}/);
  });

  it("lets a replay that is playing carry on from a mark that is clicked: the click moves the playhead and nothing else", () => {
    const source = readFileSync(REPO_ROOT + "web/src/components/Timeline.tsx", "utf-8");
    expect(source).toMatch(/onClick=\{\(\) => seekTime\(m\.ts\)\}/);
  });

  it("scrolls the run page as one page on a phone, the bars above it going up with it and only the replay bar staying", () => {
    const app = readFileSync(REPO_ROOT + "web/src/App.tsx", "utf-8");
    expect(app).toMatch(/route\.page === "run" && route\.view === "overview" \? "app app--run" : "app"/);
    const css = readFileSync(REPO_ROOT + "web/src/styles.css", "utf-8").replace(/\r\n/g, "\n");
    const phone = css.indexOf("@media (max-width: 760px) {\n  /* The run page on a phone");
    expect(phone).toBeGreaterThan(0);
    const block = css.slice(phone, css.indexOf("\n}\n", phone));
    expect(block).toMatch(/\.app--run \.content \{\s*flex: 1 0 auto;\s*overflow: visible;/);
    expect(block).toMatch(/\.app--run \.lens \{\s*position: fixed;/); // the drawer is over the window, not over a page that scrolls under it
    expect(css.slice(0, phone)).not.toContain(".app--run"); // nothing of it above a phone's width
    expect(css).toMatch(/\.run--overview > \.timeline \{\s*position: sticky;\s*bottom: 0;/);
  });

  it("has the marks of the bar as one tab stop, and the speeds as one select", async () => {
    const out = render(await opened(), createElement(RunPage));
    expect(out).toContain('<select aria-label="replay speed">');
    expect(out).not.toContain("btn--seg");
    const source = readFileSync(REPO_ROOT + "web/src/components/Timeline.tsx", "utf-8");
    expect(source).toMatch(/\{\.\.\.roving\.stop\(index, marks\.length\)\}/);
    expect(source).toMatch(/onKeyDown=\{roving\.onKeyDown\}/);
  });
});

describe("what the views of a run keep out of their first view", () => {
  it("has the approval of a recording as a fold, not a row of buttons that cannot be pressed", async () => {
    const out = render(await opened(), createElement(PlanPage));
    expect(out).toContain('<details id="approval" class="disclosure disclosure--inline plan__fold">');
    expect(text(out)).toContain("Approve or reject the plan only while a run waits for a person");
    expect(out.indexOf('<details id="approval"')).toBeLessThan(out.indexOf("Approve plan"));
  });

  it("has the events filter as one fold: the search, the noise switch and the groups", async () => {
    const out = render(await opened(), createElement(EventsPage));
    expect(out).toContain('<details id="filter" class="disclosure disclosure--inline">');
    expect(out.indexOf('<details id="filter"')).toBeLessThan(out.indexOf('aria-label="search events"'));
    expect(out.indexOf('<details id="filter"')).toBeLessThan(out.indexOf('aria-label="event groups"'));
    expect(out.indexOf('aria-label="event groups"')).toBeLessThan(out.indexOf('<ol class="evlist__rows">'));
  });

  it("says the words of a view's line with their definitions on hover, not as tab stops", async () => {
    const store = await opened();
    for (const page of [ResultsPage, EventsPage, PanelsPage]) {
      const out = render(store, createElement(page));
      expect(out).toMatch(/<span class="tip"(?![^>]*tabindex)[^>]*><span class="term">playhead<\/span>/);
    }
  });

  it("has the two proofs of the strip as text with their hint, and no tab stop", async () => {
    const out = render(await opened(), createElement(RunPage));
    expect(out).not.toMatch(/<span class="tip"[^>]*tabindex="0"[^>]*><span class="badge/);
  });
});

describe("the replay check on the run strip", () => {
  const verified = async (over: Record<string, unknown>) => {
    const store = await opened();
    const report = { ok: false, chain_ok: true, recorded_events: 14047, replayed_events: 42, recorded_head: "aa", replayed_head: "bb", first_divergence: 9, detail: "effect.started differs in payload", bundle_head: null, bundle_head_ok: false, ...over };
    store.setState({ live: false, verify: { state: "done", report } } as never);
    return render(store, createElement(VerifyBadge));
  };

  it("says an intact log that this code does not reproduce in amber, in exact words, with the server's detail as the hint", async () => {
    const out = await verified({});
    expect(out).toContain('<span class="badge badge--warn badge--big">Log intact. This code does not reproduce this recording: first difference at seq 9.</span>');
    expect(out).toContain("effect.started differs in payload");
    expect(out).not.toContain("badge--bad");
    expect(out).not.toContain("MISMATCH");
    expect(out).not.toMatch(/older|version/i);
  });

  it("keeps red for a broken chain", async () => {
    const out = await verified({ chain_ok: false });
    expect(out).toContain('<span class="badge badge--bad badge--big">✕ Replay MISMATCH at seq 9</span>');
    expect(out).not.toContain("badge--warn");
  });
});
