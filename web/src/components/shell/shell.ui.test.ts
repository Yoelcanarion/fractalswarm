import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { occurrences, plainText } from "../../arena/helps/testing";
import type { Where } from "../../lib/shell";
import { REPO_ROOT } from "../../lib/testing";
import { TopBar, type TopBarProps } from "./TopBar";

const base: Omit<TopBarProps, "where"> = {
  runId: "demo",
  runs: [{ id: "demo" }, { id: "other" }],
  runStatus: "completed",
  scenario: "t2:swarm-seed1",
  blocked: 0,
  onPickRun: () => undefined,
};
const bar = (where: Where, over: Partial<TopBarProps> = {}): string => renderToStaticMarkup(createElement(TopBar, { ...base, where, ...over }));
/** One of the bar's `nav` landmarks, by its name. */
const nav = (markup: string, name: string): string => new RegExp(`<nav class="tabs" aria-label="${name}">[\\s\\S]*?</nav>`).exec(markup)?.[0] ?? "";
const labels = (navMarkup: string): string[] => [...navMarkup.matchAll(/<a [^>]*>([^<]+)/g)].map((match) => match[1]);

const inRun: Where = { page: "run", runId: "demo", view: "plan" };

describe("the places", () => {
  it("are the brand, as the way home, and the four places in order", () => {
    const markup = bar({ page: "arena" });
    expect(markup).toContain('<a class="brand" href="#/" aria-label="FractalSwarm, home">');
    expect(labels(nav(markup, "Main"))).toEqual(["Arena", "Runs", "New task", "Evidence"]);
  });

  it("mark the page itself as the page, and the place a page belongs to as the place", () => {
    expect(nav(bar({ page: "runs" }), "Main")).toContain('<a class="tab tab--on" href="#/runs" aria-current="page">Runs</a>');
    expect(nav(bar({ page: "arena" }), "Main")).toContain('<a class="tab tab--on" href="#/arena" aria-current="page">Arena</a>');
    expect(nav(bar({ page: "intake" }), "Main")).toContain('<a class="tab tab--on" href="#/new" aria-current="page">New task</a>');
    // a run, and the evidence's other pages, are in a place without being the page it links to
    expect(nav(bar(inRun), "Main")).toContain('<a class="tab tab--on" href="#/runs" aria-current="true">Runs</a>');
    expect(nav(bar({ page: "helps" }), "Main")).toContain('<a class="tab tab--on" href="#/charts" aria-current="true">Evidence</a>');
    expect(nav(bar({ page: "charts" }), "Main")).toContain('aria-current="page">Evidence</a>');
  });

  it("are one current place at a time", () => {
    for (const where of [{ page: "arena" }, { page: "runs" }, { page: "intake" }, inRun, { page: "ablation" }] as Where[]) {
      expect(occurrences(nav(bar(where), "Main"), "aria-current")).toBe(1);
    }
  });

  it("have a theme switch at the end, and a way past the bars for the keyboard", () => {
    const markup = bar({ page: "arena" });
    expect(markup).toContain('class="topbar__right"');
    expect(markup).toContain("Switch to the light theme");
    expect(markup).toContain('<button type="button" class="shell__skip">Skip to the page</button>');
  });
});

describe("a run's own views", () => {
  it("are a second row inside a run: the run picked, its status and the six views, the open one marked as the page", () => {
    const markup = bar(inRun);
    expect(markup).toContain('class="subnav"');
    expect(markup).toContain('<select aria-label="Run">');
    expect(markup).toContain('<option value="demo" selected="">demo</option>');
    expect(markup).toContain('<option value="other">other</option>');
    expect(plainText(markup)).toContain("swarm-seed1");
    const views = nav(markup, "Views of this run");
    // the row keeps two views and the one the person is on; the three others are in the menu after them
    expect(labels(views)).toEqual(["Run", "Plan", "Results", "Panels", "Security", "Events"]);
    expect(views).toContain('<a class="tab tab--on" href="#/run/demo/plan" aria-current="page">Plan</a>');
    expect(views).toContain('<a class="tab" href="#/run/demo">Run</a>');
    expect(occurrences(views, "aria-current")).toBe(1);
  });

  it("show two views and a menu with the rest, which is a fold of its own, and a view that is open is shown whichever it is", () => {
    const menu = (markup: string) => /<details id="views"[\s\S]*?<\/details>/.exec(markup)?.[0] ?? "";
    const onRun = bar({ page: "run", runId: "demo", view: "overview" });
    expect(labels(menu(onRun))).toEqual(["Plan", "Panels", "Security", "Events"]);
    expect(menu(onRun)).toContain("More views");
    expect(labels(nav(onRun, "Views of this run")).slice(0, 2)).toEqual(["Run", "Results"]);
    const onEvents = bar({ page: "run", runId: "demo", view: "events" });
    expect(labels(menu(onEvents))).toEqual(["Plan", "Panels", "Security"]);
    expect(onEvents).toContain('<a class="tab tab--on" href="#/run/demo/events" aria-current="page">Events</a>');
  });

  it("have the guide's button at the end of the bar when the page has a guide, and not otherwise", () => {
    const guide = { open: true, toggle: () => undefined, dismiss: () => undefined };
    expect(bar({ page: "arena" }, { guide })).toContain('aria-controls="guide"');
    expect(bar({ page: "arena" }, { guide })).toContain('aria-expanded="true"');
    expect(bar({ page: "arena" }, { guide: { ...guide, open: false } })).toContain('aria-expanded="false"');
    expect(bar({ page: "arena" })).not.toContain("aria-controls=\"guide\"");
  });

  it("count what the run blocked on Security, with its meaning in a hint, and show nothing at zero", () => {
    const counted = nav(bar(inRun, { blocked: 3 }), "Views of this run");
    expect(counted).toContain('<span class="tab__count">3</span>');
    expect(counted).toContain("quarantined emails and blocked subgoals");
    const none = nav(bar(inRun), "Views of this run");
    expect(none).not.toContain("tab__count");
    expect(none).not.toContain("quarantined");
  });

  it("have no picker before a run is open, and still link to the views", () => {
    const markup = bar({ page: "run", runId: null, view: "overview" }, { runId: null, runs: [], runStatus: null, scenario: null });
    expect(markup).not.toContain("<select");
    expect(nav(markup, "Views of this run")).toContain('href="#/run//plan"');
  });

  it("hold the status badge's place while a run opens, and show none when there is no run to wait for", () => {
    const where: Where = { page: "run", runId: null, view: "overview" };
    const none = { runId: null, runs: [], runStatus: null, scenario: null };
    expect(bar(where, none)).not.toContain('class="badge');
    expect(bar(where, { ...none, opening: true })).toContain('class="badge');
    expect(bar(inRun)).toContain('class="badge');
  });

  it("are not in the other places", () => {
    for (const where of [{ page: "arena" }, { page: "runs" }, { page: "intake" }] as Where[]) {
      expect(bar(where)).not.toContain("subnav");
    }
  });
});

describe("the evidence's pages", () => {
  it("are a second row on each of the three, the open one marked as the page", () => {
    const markup = bar({ page: "helps" });
    expect(markup).toContain('class="subnav"');
    const pages = nav(markup, "Evidence");
    expect(labels(pages)).toEqual(["Charts", "Where it helps", "Ablation"]);
    expect(pages).toContain('<a class="tab tab--on" href="#/helps" aria-current="page">Where it helps</a>');
    expect(pages).toContain('href="#/ablation"');
    expect(occurrences(pages, "aria-current")).toBe(1);
  });

  it("are not on a run's page", () => {
    expect(bar(inRun)).not.toContain('aria-label="Evidence"');
  });
});

describe("the bars on a phone", () => {
  // The four places, the guide and the theme once ran 246 px past a 390 px screen on every page. This reads the sheet: the bars wrap there.
  const sheet = readFileSync(`${REPO_ROOT}web/src/components/shell/shell.css`, "utf-8").replace(/\r\n/g, "\n");
  const phone = /@media \(max-width: 760px\) \{([\s\S]*?)\n\}\n/.exec(sheet)?.[1] ?? "";
  const rule = (selector: string): string => new RegExp(`${selector.replace(/[.>]/g, "\\$&")} \\{([^}]*)\\}`).exec(phone)?.[1] ?? "";

  it("wrap: the top bar, the rows of tabs and the run's sub-bar", () => {
    expect(phone).not.toBe("");
    for (const selector of [".shell .topbar", ".shell .tabs", ".shell .subnav"]) expect(rule(selector), selector).toContain("flex-wrap: wrap");
  });

  it("let the four places have a row of their own, and the run picker the width of the screen", () => {
    expect(rule(".shell .topbar > .tabs")).toMatch(/flex: 1 1 100%/);
    expect(rule(".shell .subnav select")).toMatch(/width: 100%/);
  });
});

describe("the announcement", () => {
  it("says which page opened, and which run for a run's view", () => {
    expect(bar(inRun)).toContain('<p class="sr-only" role="status">Plan · demo</p>');
    expect(bar({ page: "helps" })).toContain('<p class="sr-only" role="status">Where it helps</p>');
  });

  it("names the run that is open when the address names none", () => {
    expect(bar({ page: "run", runId: null, view: "overview" })).toContain('role="status">Run · demo</p>');
  });
});
