// The whole page, rendered to a string with a made-up story: what the first load shows before any script runs, and
// the rules about claims that hold wherever they are drawn.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CHAPTERS } from "./chapters";
import { COPY, TAGLINE } from "./copy";
import { DOORS } from "./doors";
import { HomeView } from "./HomePage";
import type { Story } from "./data/types";
import { bundledStory } from "./story";
import { fixtureClaimText, FIXTURE_STORY, UNIVERSAL } from "./testing";

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
    const printedByThePage = [
      "7.7 s",
      "91.1 s",
      "+3.3%",
      "+77.7%",
      "T2 conference planning · 5 coordinators crashed (C3) · real model · 7 seeds",
      "T2 conference planning · 5 coordinators crashed (C3) · real model · 5 seeds",
      "T1 extraction · 4 coordinators crashed · fake model · 1 seed",
      "31 talks, four tracks, three days",
      "nine coordinators",
      "o0 → o7 → o8",
      "$4.56",
      "13.4×",
      "5.9×",
      "0.91",
      "1.3",
      "2.3",
      "2.5",
      "coordination tokens 7",
      "recovery tokens 9",
    ];
    for (const printed of printedByThePage) {
      expect(text, printed).toContain(printed);
    }
    expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
  });

  it("opens the pre-registered gate's sentence with the crash counts of its profiles, from the data", () => {
    expect(plain(render(FIXTURE_STORY))).toContain("this measure tied at three and five crashes");
    expect(plain(render(null))).toContain("this measure tied at — crashes");
  });

  it("draws every claim in the words of its row, with a tag only on the pending ones", () => {
    const drawn = claims(html);
    expect(drawn.length).toBeGreaterThan(0);
    for (const claim of drawn) {
      expect(plain(claim.body), claim.id).toContain(fixtureClaimText(claim.id).replace(/`/g, ""));
      const pending = FIXTURE_STORY.claims[claim.id].state === "pending";
      expect(claim.state, claim.id).toBe(pending ? "pending" : "allowed");
      expect(claim.body.includes("home-tag"), `${claim.id} tag`).toBe(pending);
    }
  });

  it("draws the claims the story is about and no other", () => {
    expect(new Set(claims(html).map((claim) => claim.id))).toEqual(new Set(["S1", "S2", "S3", "S4", "S5", "S6", "R2", "R3", "R4", "R5", "R6"]));
  });

  it("never draws a claim that is not claimed", () => {
    expect(html).not.toContain('data-claim="R1"');
    expect(html).not.toContain("Test claim R1.");
  });

  it("draws the code in a claim as code", () => {
    expect(html).toContain('<code class="home-code">durable-max</code>');
    expect(html).not.toContain("`");
  });

  it("puts R3 right under R2, and only there", () => {
    const tie = /<article id="tie"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    const r2 = tie.indexOf('data-claim="R2"');
    const r3 = tie.indexOf('data-claim="R3"');
    expect(r2).toBeGreaterThan(-1);
    expect(r3).toBeGreaterThan(r2);
    expect(r3 - r2, "something sits between R2 and R3").toBeLessThan(400);
    expect(countOf(html, 'data-claim="R2"')).toBe(1);
    expect(countOf(html, 'data-claim="R3"')).toBe(1);
  });

  it("sets R6 under the tagline, one sentence to a line, with a visible link to the beat where R2 and R3 are", () => {
    const hero = /<section[^>]*class="home-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(hero).toContain('data-claim="R6"');
    expect(countOf(hero, 'class="home-claim__line"')).toBe(2);
    expect(plain(hero)).toContain(fixtureClaimText("R6"));
    expect(hero).not.toContain('data-claim="R2"');
    const proof = /<div class="[^"]*home-hero__proof[^"]*"[^>]*>[\s\S]*?<\/div>/.exec(hero)?.[0] ?? "";
    const claimAt = proof.indexOf('data-claim="R6"');
    const linkAt = proof.indexOf('href="#/?at=tie"');
    expect(claimAt).toBeGreaterThan(-1);
    expect(linkAt, "the link follows the claim").toBeGreaterThan(claimAt);
    expect(plain(proof)).toContain(COPY.hero.conditions);
    expect(countOf(html, 'data-claim="R6"')).toBe(1);
  });

  it("shows R4 once, with its setting and the $0 gate beside it", () => {
    expect(countOf(html, 'data-claim="R4"')).toBe(1);
    const helps = /<article[^>]*aria-labelledby="helps-lead"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(helps).toContain('data-claim="R4"');
    const text = plain(helps);
    expect(text).toContain(COPY.evidence.helps.gate("three and five"));
    expect(text).toContain("T2 conference");
    expect(text).toContain("real model");
    expect(text).toContain("5 seeds");
    expect(text).toContain(COPY.evidence.helps.cost);
    expect(text).toContain("2.5");
  });

  it("keeps the false deaths of the real runs out of R3's figures", () => {
    const fails = /<article[^>]*aria-labelledby="fails-lead"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(plain(fails)).toContain("1.3");
    expect(plain(fails)).toContain("2.3");
    expect(plain(fails)).not.toContain("2.5");
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
    const { command, lines, takeover } = FIXTURE_STORY.proof;
    for (const printed of [command, ...lines, takeover.command, takeover.line]) {
      expect(printed).toBeTruthy();
      expect(text).toContain(String(printed).replace(/\s+/g, " "));
    }
  });

  it("opens every door that is not behind the server, with a link", () => {
    expect(countOf(html, 'class="home-door"')).toBe(DOORS.length);
    expect(countOf(html, 'class="home-door"')).toBe(6);
    expect(html).toContain('href="#/arena"');
    expect(html).toContain('href="#/charts"');
  });

  it("reaches no outside address", () => {
    // an svg names its namespace with a URI (the icons do); that is a name, not a request
    expect(html.replace(/xmlns="[^"]*"/g, "")).not.toMatch(/https?:\/\//);
  });
});

describe("the home page, rendered with the real story", () => {
  const html = render(bundledStory);
  const outsideClaims = plain(html.replace(/<p class="home-claim[^"]*"[^>]*>[\s\S]*?<\/p>/g, " "));

  it("prints no gap where the data has none", () => {
    expect(plain(html)).not.toMatch(/undefined|NaN|\bnull\b/);
  });

  it("says nothing of its own that reads as every run being valid", () => {
    for (const [pattern, name] of UNIVERSAL) expect(pattern.test(outsideClaims), `"${name}" outside a claim`).toBe(false);
  });

  it("lets only R6 say it, in the row's words, with the setting and the link to R2 and R3 beside it", () => {
    for (const claim of claims(html)) {
      if (UNIVERSAL.some(([pattern]) => pattern.test(plain(claim.body)))) expect(claim.id, "a claim that says every run").toBe("R6");
    }
    const hero = /<section[^>]*class="home-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(plain(hero)).toContain("(C3) · real model");
    expect(hero).toContain('href="#/?at=tie"');
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
    const missing = [...words(html)].filter((word) => !scrolling.has(word));
    expect(missing).toEqual([]);
  });
});
