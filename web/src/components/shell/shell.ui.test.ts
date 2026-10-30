import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { occurrences, plainText } from "../../arena/helps/testing";
import type { Where } from "../../lib/shell";
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
    expect(labels(views)).toEqual(["Run", "Plan", "Panels", "Security", "Results", "Events"]);
    expect(views).toContain('<a class="tab tab--on" href="#/run/demo/plan" aria-current="page">Plan</a>');
    expect(views).toContain('<a class="tab" href="#/run/demo">Run</a>');
    expect(occurrences(views, "aria-current")).toBe(1);
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

describe("the announcement", () => {
  it("says which page opened, and which run for a run's view", () => {
    expect(bar(inRun)).toContain('<p class="sr-only" role="status">Plan · demo</p>');
    expect(bar({ page: "helps" })).toContain('<p class="sr-only" role="status">Where it helps</p>');
  });

  it("names the run that is open when the address names none", () => {
    expect(bar({ page: "run", runId: null, view: "overview" })).toContain('role="status">Run · demo</p>');
  });
});
