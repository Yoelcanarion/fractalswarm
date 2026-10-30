// The whole page, rendered to a string with a made-up story: what the first load shows before any script runs, and
// the rules about claims that hold wherever they are drawn.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CHAPTERS } from "./chapters";
import { COPY, TAGLINE } from "./copy";
import { HomeView } from "./HomePage";
import type { Story } from "./story";
import { FIXTURE_STORY } from "./testing";

const render = (story: Story | null, still = false): string => renderToStaticMarkup(createElement(HomeView, { story, still, active: -1 }));
const plain = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const countOf = (html: string, needle: string): number => html.split(needle).length - 1;
const claims = (html: string): { id: string; state: string; body: string }[] =>
  [...html.matchAll(/<p class="home-claim[^"]*" data-claim="(\w+)" data-state="(\w+)">([\s\S]*?)<\/p>/g)].map((m) => ({ id: m[1], state: m[2], body: m[3] }));

describe("the home page, rendered with a story", () => {
  const html = render(FIXTURE_STORY);

  it("has the five chapters, in the order the rail lists them", () => {
    let from = 0;
    for (const chapter of CHAPTERS) {
      const at = html.indexOf(`<section id="${chapter.id}"`, from);
      expect(at, `${chapter.id} is missing or out of order`).toBeGreaterThan(from === 0 ? 0 : from - 1);
      from = at;
    }
    expect(countOf(html, 'class="home-rail__item"')).toBe(CHAPTERS.length);
  });

  it("has one h1, and it is the tagline", () => {
    const titles = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => plain(m[1]).trim());
    expect(titles).toEqual([TAGLINE]);
  });

  it("prints the numbers of the story and none of its own", () => {
    const text = plain(html);
    for (const printed of ["7.7 s", "91.1 s", "+3.3%", "+77.7%", "T2 conference", "5 coordinators crashed (C3)", "real model", "$4.56", "13.4×", "0.91", "11 of 20", "17 of 20"]) {
      expect(text, printed).toContain(printed);
    }
    expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
  });

  it("draws every claim in the words of its row, with a tag only on the pending ones", () => {
    const drawn = claims(html);
    expect(drawn.length).toBeGreaterThan(0);
    for (const claim of drawn) {
      expect(claim.body, claim.id).toContain(`Test claim ${claim.id}.`);
      const pending = FIXTURE_STORY.claims[claim.id].status.includes("pending");
      expect(claim.state, claim.id).toBe(pending ? "pending" : "allowed");
      expect(claim.body.includes("home-tag"), `${claim.id} tag`).toBe(pending);
    }
    expect(new Set(drawn.map((claim) => claim.id))).toEqual(new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "R2", "R3", "R4", "R5"].filter((id) => html.includes(`data-claim="${id}"`))));
  });

  it("never draws a claim that is not claimed", () => {
    expect(html).not.toContain('data-claim="R1"');
    expect(html).not.toContain("Test claim R1.");
  });

  it("puts R3 right under R2 in the evidence, and shows R2 in the hero only with the way to its conditions", () => {
    const tie = /<article[^>]*aria-labelledby="tie-lead"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    const r2 = tie.indexOf('data-claim="R2"');
    const r3 = tie.indexOf('data-claim="R3"');
    expect(r2).toBeGreaterThan(-1);
    expect(r3).toBeGreaterThan(r2);
    expect(r3 - r2, "something sits between R2 and R3").toBeLessThan(400);
    expect(countOf(html, 'data-claim="R3"')).toBe(1);
    expect(html).toMatch(/<div class="home-hero__tie">[\s\S]*?data-claim="R2"[\s\S]*?href="#\/\?at=evidence"/);
    expect(countOf(html, 'data-claim="R2"')).toBe(2);
  });

  it("shows R4 once, with its setting and the $0 gate beside it", () => {
    expect(countOf(html, 'data-claim="R4"')).toBe(1);
    const helps = /<article[^>]*aria-labelledby="helps-lead"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(helps).toContain('data-claim="R4"');
    const text = plain(helps);
    expect(text).toContain(COPY.evidence.helps.gate);
    expect(text).toContain("T2 conference");
    expect(text).toContain("real model");
    expect(text).toContain("3 seeds");
  });

  it("shows R5 once, with the rival named, the setting and the reason beside it", () => {
    expect(countOf(html, 'data-claim="R5"')).toBe(1);
    const card = html.slice(Math.max(0, html.indexOf('data-claim="R5"') - 2500), html.indexOf('data-claim="R5"'));
    const text = plain(card);
    expect(text).toContain(COPY.problem.steps.numbers.rival);
    expect(text).toContain("real model");
    expect(text).toContain(COPY.rivalReason);
  });

  it("says where the swarm does not help, and what replay does not prove", () => {
    const text = plain(html);
    expect(text).toContain(COPY.evidence.fails.wins);
    expect(text).toContain(COPY.solution.steps.log.limit);
    expect(text).toContain(COPY.evidence.proof.proves);
  });

  it("types the demo's real output into the terminal", () => {
    const text = plain(html);
    expect(text).toContain(COPY.evidence.proof.command);
    const lines = (FIXTURE_STORY.proof as { lines: string[] }).lines;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(text).toContain(line.replace(/\s+/g, " "));
  });

  it("opens every door that is not behind the server, with a link", () => {
    expect(countOf(html, 'class="home-door"')).toBe(7);
    expect(html).toContain('href="#/arena"');
    expect(html).toContain('href="#/charts"');
  });

  it("reaches no outside address", () => {
    // an svg names its namespace with a URI (the icons do); that is a name, not a request
    expect(html.replace(/xmlns="[^"]*"/g, "")).not.toMatch(/https?:\/\//);
  });
});

describe("the home page, with no data at all", () => {
  const html = render(null);

  it("still renders every chapter and the tagline", () => {
    for (const chapter of CHAPTERS) expect(html).toContain(`<section id="${chapter.id}"`);
    expect(plain(html)).toContain(TAGLINE);
  });

  it("shows a dash and a tag where a number or a claim would be, never a guess", () => {
    const text = plain(html);
    expect(text).toContain("—");
    expect(text).toContain("NO DATA YET");
    expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
    for (const claim of claims(html)) expect(claim.state).toBe("missing");
  });
});

describe("the home page, standing still", () => {
  const html = render(FIXTURE_STORY, true);

  it("marks the page and lays both stages out as ordinary flow", () => {
    expect(html).toContain('class="home" data-still=""');
    expect(countOf(html, "home-stage--still")).toBe(2);
  });

  it("shows the same words as the scrolling page", () => {
    const words = (page: string) => new Set(plain(page).split(" ").filter((word) => word.length > 3));
    const scrolling = words(render(FIXTURE_STORY, false));
    for (const word of words(html)) expect(scrolling.has(word), word).toBe(true);
  });
});
