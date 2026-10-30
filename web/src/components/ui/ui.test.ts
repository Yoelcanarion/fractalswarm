import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { easeOutCubic, formatNumber, tween } from "../../lib/motion";
import { Card, Details, EmptyState, Hint, ModelBadge, modelFamily, PageHeader, Skeleton, SkeletonGroup, SkeletonText, Stat, Term, Tooltip } from "./index";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("motion helpers", () => {
  it("tweens from the start to the end along an ease-out curve", () => {
    expect(tween(0, 100, 0, 600)).toBe(0);
    expect(tween(0, 100, 600, 600)).toBe(100);
    expect(tween(0, 100, 9999, 600)).toBe(100);
    const half = tween(0, 100, 300, 600);
    expect(half).toBeGreaterThan(50); // ease-out is ahead of linear at the middle
    expect(half).toBeCloseTo(100 * easeOutCubic(0.5), 10);
  });

  it("counts down as well as up, and snaps with no duration", () => {
    expect(tween(100, 20, 600, 600)).toBe(20);
    expect(tween(100, 20, 300, 600)).toBeLessThan(60);
    expect(tween(5, 9, 0, 0)).toBe(9);
  });

  it("formats numbers in English with fixed decimals", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(0.45516, 4)).toBe("0.4552");
    expect(formatNumber(3, 2)).toBe("3.00");
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("Stat", () => {
  it("shows the label, the value with its prefix and unit, and no hint wrapper by default", () => {
    const out = html(createElement(Stat, { label: "spent", prefix: "$", value: 0.45516, decimals: 4 }));
    expect(out).toContain("stat__label");
    expect(out).toContain(">spent<");
    expect(out).toContain(">$<");
    expect(out).toContain("0.4552");
    expect(out).not.toContain("role=\"tooltip\"");
  });

  it("formats a number on the first paint and shows a string as it is", () => {
    expect(html(createElement(Stat, { label: "tokens", value: 1234567 }))).toContain("1,234,567");
    expect(html(createElement(Stat, { label: "verdict", value: "MATCH" }))).toContain("MATCH");
  });

  it("marks the tone and the hero tile, and draws a delta with an arrow and text", () => {
    const out = html(
      createElement(Stat, { label: "stall", value: 5.2, decimals: 1, unit: "s", tone: "bad", hero: true, delta: { text: "−38%", direction: "down", tone: "good" } }),
    );
    expect(out).toContain("stat--bad");
    expect(out).toContain("stat--hero");
    expect(out).toContain("stat__delta--good");
    expect(out).toContain("−38%");
    expect(out).toContain("<svg"); // the arrow
    expect(out).toContain("aria-hidden"); // and it is decorative: the text carries the change
  });

  it("wraps the tile in a tooltip when it has a hint", () => {
    const out = html(createElement(Stat, { label: "x", value: 1, hint: "What x means" }));
    expect(out).toContain("What x means");
    expect(out).toContain("role=\"tooltip\"");
  });
});

describe("ModelBadge", () => {
  it("maps Meta model ids to the four families", () => {
    expect(modelFamily("muse-wonder-1.0")).toBe("wonder");
    expect(modelFamily("muse-spark-1.3")).toBe("spark");
    expect(modelFamily("muse-spark-1.3-contributor")).toBe("contributor");
    expect(modelFamily("promptguard-2")).toBe("guard");
    expect(modelFamily("Prompt-Guard-2-22M")).toBe("guard");
    expect(modelFamily("gpt-5")).toBeNull();
  });

  it("names the model in words, so the colour is never the only cue", () => {
    const out = html(createElement(ModelBadge, { model: "muse-spark-1.3-contributor", version: true }));
    expect(out).toContain("Contributor");
    expect(out).toContain("1.3");
    expect(out).toContain("data-model=\"contributor\"");
    // the full id is a hint that opens from a pointer and is there as text for a screen reader, not a title
    expect(out).toContain('role="tooltip" class="tip__bubble">muse-spark-1.3-contributor</span>');
    expect(out).not.toContain("title=");
  });

  it("shows an unknown id as it is, in a neutral badge", () => {
    const out = html(createElement(ModelBadge, { model: "llama-4" }));
    expect(out).toContain("llama-4");
    expect(out).toContain("data-model=\"unknown\"");
  });
});

describe("Tooltip", () => {
  it("describes its trigger, starts closed, and is a tab stop only when asked", () => {
    const closed = html(createElement(Tooltip, { label: "Available on live runs", children: createElement("button", { disabled: true }, "Kill") }));
    expect(closed).toContain("role=\"tooltip\"");
    expect(closed).toContain("Available on live runs");
    expect(closed).toContain("data-open=\"false\"");
    expect(closed).toContain("aria-describedby=");
    expect(closed).not.toContain("tabindex");
    const stop = html(createElement(Tooltip, { label: "Why", focusable: true, children: createElement("button", { disabled: true }, "Go") }));
    expect(stop).toContain("tabindex=\"0\"");
  });

  it("points aria-describedby at its own bubble", () => {
    const out = html(createElement(Tooltip, { label: "Hint", children: createElement("span", null, "x") }));
    const describedBy = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(describedBy).toBeTruthy();
    expect(out).toContain(`id="${describedBy}"`);
  });
});

describe("Hint", () => {
  const word = createElement("span", null, "x");

  it("draws the children as they are when there is nothing to say", () => {
    expect(html(createElement(Hint, { children: word }))).toBe("<span>x</span>");
    expect(html(createElement(Hint, { label: null, children: word }))).toBe("<span>x</span>");
    expect(html(createElement(Hint, { label: "", children: word }))).toBe("<span>x</span>");
  });

  it("opens from a pointer, and gives a screen reader the same words as text, where nothing has focus to describe", () => {
    const out = html(createElement(Hint, { label: "What x means", children: word }));
    expect(out).toContain('role="tooltip"');
    expect(out).toContain('<span class="sr-only"> What x means</span>');
    expect(out).not.toContain("tabindex");
    expect(out).not.toContain("title=");
  });

  it("is a tab stop when asked, and then the hint is the description of what has focus, not text again", () => {
    const out = html(createElement(Hint, { label: "What x means", focusable: true, children: word }));
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('role="tooltip"');
    expect(out).not.toContain("sr-only");
  });
});

describe("Card and Skeleton", () => {
  it("draws the header only when there is something to put in it", () => {
    expect(html(createElement(Card, null, "body"))).not.toContain("panel__title");
    const out = html(createElement(Card, { title: "Orchestrator tree", hint: "✕ killed", actions: createElement("button", null, "Fit") }, "body"));
    expect(out).toContain("Orchestrator tree");
    expect(out).toContain("✕ killed");
    expect(out).toContain("card__actions");
  });

  it("tints a verdict, and lets the body run edge to edge", () => {
    const out = html(createElement(Card, { tone: "good", flush: true, as: "article" }, "ok"));
    expect(out.startsWith("<article")).toBe(true);
    expect(out).toContain("card--good");
    expect(out).toContain("card--flush");
  });

  it("announces one loading message for a group of placeholders and hides the placeholders", () => {
    const placeholders = createElement(Fragment, null, createElement(SkeletonText, { lines: 3 }), createElement(Skeleton, { circle: true, width: 24, height: 24 }));
    const out = html(createElement(SkeletonGroup, { label: "Loading run", children: placeholders }));
    expect(out).toContain("role=\"status\"");
    expect(out).toContain("aria-busy=\"true\"");
    expect(out).toContain("Loading run…");
    expect(out.match(/class="skeleton /g)).toHaveLength(4); // 3 lines and the circle
    expect(out).toContain("skeleton--circle");
    expect(out).toContain('class="skeleton-group"');
  });

  it("takes a class to space its placeholders, and keeps its own", () => {
    const out = html(createElement(SkeletonGroup, { label: "Loading", className: "skeleton-group--stack", children: createElement(Skeleton, { height: 20 }) }));
    expect(out).toContain('class="skeleton-group skeleton-group--stack"');
  });
});


describe("Term", () => {
  it("shows the glossary word with its definition, as a tab stop", () => {
    const out = html(createElement(Term, { id: "stall" }));
    expect(out).toContain('class="term"');
    expect(out).toContain(">Stall time<");
    expect(out).toContain("no agent LLM call is in flight anywhere");
    expect(out).toContain('role="tooltip"');
    expect(out).toContain('tabindex="0"');
  });

  it("can wear the page's own words for the same definition", () => {
    const out = html(createElement(Term, { id: "c3" }, "half the brains"));
    expect(out).toContain(">half the brains<");
    expect(out).toContain("Five coordinator crashes");
  });

  it("leaves the tab order for a word that repeats down a table, and still opens on hover", () => {
    const out = html(createElement(Term, { id: "c3", focusable: false }));
    expect(out).not.toContain("tabindex");
    expect(out).toContain('role="tooltip"');
    expect(out).toContain("Five coordinator crashes");
  });
});

describe("PageHeader", () => {
  it("is the page's one h1, with a lead and actions only when given", () => {
    const bare = html(createElement(PageHeader, { title: "Runs" }));
    expect(bare.match(/<h1/g)).toHaveLength(1);
    expect(bare).not.toContain("pagehead__lead");
    expect(bare).not.toContain("pagehead__actions");
    const full = html(createElement(PageHeader, { title: "Runs", lead: "Every recorded run.", actions: createElement("button", null, "New") }));
    expect(full).toContain("Every recorded run.");
    expect(full).toContain("pagehead__actions");
  });

  it("can sit on one line for a page that needs its height", () => {
    const compact = html(createElement(PageHeader, { title: "Plan", lead: "The plan the root proposed.", compact: true }));
    expect(compact).toContain("pagehead pagehead--compact");
    expect(compact.match(/<h1/g)).toHaveLength(1);
    expect(html(createElement(PageHeader, { title: "Plan" }))).not.toContain("pagehead--compact");
  });
});

describe("EmptyState", () => {
  it("says what, why and the way out", () => {
    const out = html(createElement(EmptyState, { title: "No runs yet", actions: createElement("a", { href: "#/new" }, "Start one") }, "Nothing has been recorded."));
    expect(out).toContain("No runs yet");
    expect(out).toContain("Nothing has been recorded.");
    expect(out).toContain('href="#/new"');
    expect(out).toContain('role="status"');
  });

  it("is announced at once when it is an error", () => {
    const out = html(createElement(EmptyState, { title: "Could not load", tone: "bad" }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("emptystate--bad");
    expect(out).not.toContain("emptystate__body");
  });
});

describe("Details", () => {
  it("is a closed fold that says Details, with what is inside it in the markup", () => {
    const out = html(createElement(Details, { children: createElement("p", {}, "the rest") }));
    expect(out).toContain('<details class="disclosure">');
    expect(out).toContain('<span class="disclosure__label">Details</span>');
    expect(out).toContain("the rest");
    expect(out).not.toMatch(/<details[^>]* open/);
  });

  it("says what is inside in a few words, with a quieter hint after, and carries the id the address opens it by", () => {
    const out = html(createElement(Details, { summary: "All 22 runs", hint: "with filters", id: "all", children: "x" }));
    expect(out).toContain('<details id="all" class="disclosure">');
    expect(out).toContain("All 22 runs");
    expect(out).toContain('<span class="disclosure__hint">with filters</span>');
  });

  it("opens when the page says so, and has its inline and menu forms", () => {
    expect(html(createElement(Details, { open: true, children: "x" }))).toMatch(/<details[^>]* open=""/);
    expect(html(createElement(Details, { inline: true, children: "x" }))).toContain("disclosure disclosure--inline");
    expect(html(createElement(Details, { menu: true, children: "x" }))).toContain("disclosure disclosure--menu");
  });
});
