// The whole home page, rendered to a string with a made-up story: what the first load shows before any script runs, and
// the rules about claims that hold wherever they are drawn. The evidence page has its own file (evidence/EvidenceView.test.ts).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Story } from "./data/types";
import { REPO_URL } from "../lib/links";
import { COPY, TAGLINE } from "./copy";
import { DOORS } from "./doors";
import { HomeView } from "./HomePage";
import { sentences } from "./parts/Claim";
import { bundledStory } from "./story";
import { countOf, drawnClaims, fixtureClaimText, FIXTURE_STORY, plain, sectionOf, UNIVERSAL } from "./testing";
import { captionsFor } from "./viz/lanes/WorkLanes";

const render = (story: Story | null, still = false): string => renderToStaticMarkup(createElement(HomeView, { story, still }));
const foldOf = (html: string): string => /<details[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
const outsideFolds = (html: string): string => html.replace(/<details[\s\S]*?<\/details>/g, "");

describe("the home page, rendered with a story", () => {
  const html = render(FIXTURE_STORY);

  it("has the five sections, in order, and the click demo inside the solution", () => {
    let from = 0;
    for (const id of ["hero", "problem", "solution", "proof", "enter"]) {
      const at = html.indexOf(`<section id="${id}"`, from);
      expect(at, `${id} is missing or out of order`).toBeGreaterThanOrEqual(from);
      expect(at, `${id} is missing`).toBeGreaterThan(-1);
      from = at;
    }
    expect(sectionOf(html, "solution")).toContain('<div id="demo"');
  });

  it("has no rail, no pinned stage and no chapter number: the page is five short sections", () => {
    expect(html).not.toContain("home-rail");
    expect(html).not.toContain("home-stage");
    expect(html).not.toContain("home-eyebrow");
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
      "31 talks, four tracks, three days",
    ];
    for (const printed of printedByThePage) expect(text, printed).toContain(printed);
    expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
  });

  it("draws every claim in the words of its row, whole or by sentence, with a tag only on the pending ones", () => {
    const drawn = drawnClaims(html);
    expect(drawn.length).toBeGreaterThan(0);
    for (const claim of drawn) {
      const words = fixtureClaimText(claim.id).replace(/`/g, "");
      const body = plain(claim.body).trim();
      if (claim.part === null) expect(body, claim.id).toContain(words);
      else {
        const [index, of] = claim.part.split("/").map(Number);
        const all = sentences(words);
        expect(of, `${claim.id} parts`).toBe(all.length);
        expect(body, `${claim.id} part ${claim.part}`).toContain(all[index - 1]);
      }
      const pending = FIXTURE_STORY.claims[claim.id].state === "pending";
      expect(claim.state, claim.id).toBe(pending ? "pending" : "allowed");
      expect(claim.body.includes("home-tag"), `${claim.id} tag`).toBe(pending);
    }
  });

  it("draws the claims the home page is about and no other: the rest are on the evidence page", () => {
    expect(new Set(drawnClaims(html).map((claim) => claim.id))).toEqual(new Set(["S1", "S3", "S5", "S6", "R5", "R6", "R7"]));
  });

  it("never draws a claim that is not claimed", () => {
    expect(html).not.toContain('data-claim="R1"');
    expect(html).not.toContain("Test claim R1.");
  });

  it("sets R6 in the proof: its first sentence open, its second folded, and a visible link to the beat where R2 and R3 are", () => {
    const proof = sectionOf(html, "proof");
    const open = outsideFolds(proof);
    const folded = foldOf(proof);
    const [first, second] = sentences(fixtureClaimText("R6"));
    expect(open).toContain('data-claim="R6" data-state="allowed" data-part="1/2"');
    expect(plain(open)).toContain(first);
    expect(plain(open)).not.toContain(second);
    expect(folded).toContain('data-claim="R6" data-state="allowed" data-part="2/2"');
    expect(plain(folded)).toContain(second);
    expect(countOf(html, 'data-claim="R6"')).toBe(2);
    // the way to R2 and R3 is on the section, outside any fold, and follows the claim
    const claimAt = open.indexOf('data-claim="R6"');
    const linkAt = open.indexOf('href="#/evidence?at=tie"');
    expect(claimAt).toBeGreaterThan(-1);
    expect(linkAt, "the link follows the claim").toBeGreaterThan(claimAt);
    expect(plain(open)).toContain(COPY.proof.conditions);
    expect(html).not.toContain('data-claim="R2"');
    expect(html).not.toContain('data-claim="R3"');
  });

  it("keeps the in-process supervisor's reason beside the numbers it explains, in both folds and beside the bars", () => {
    expect(plain(outsideFolds(sectionOf(html, "proof")))).toContain(COPY.rivalReason);
    // R5 is in the fold of the problem and in the fold of the proof, each with its setting and the reason before it
    expect(countOf(html, 'data-claim="R5"')).toBe(2);
    for (const id of ["problem", "proof"]) {
      const fold = foldOf(sectionOf(html, id));
      const at = fold.indexOf('data-claim="R5"');
      expect(at, `R5 is not in the fold of the ${id}`).toBeGreaterThan(-1);
      const text = plain(fold.slice(Math.max(0, at - 2500), at));
      expect(text, id).toContain("real model");
      expect(text, id).toContain(COPY.rivalReason);
    }
    expect(plain(foldOf(sectionOf(html, "problem")))).toContain(COPY.problem.more.rival);
  });

  it("names the basis of each extra-cost figure of the problem's fold: R5 has two, and these are the pre-registered one", () => {
    const labels = [...foldOf(sectionOf(html, "problem")).matchAll(/class="home-figure__label">([^<]*)</g)].map((m) => m[1]);
    const cost = labels.filter((label) => /extra cost/.test(label));
    expect(cost).toEqual([COPY.labels.extraCostBasis, COPY.labels.extraCostBasis]);
    expect(COPY.labels.extraCostBasis).toMatch(/pre-registered basis/);
  });

  it("says of the better supervisor what the rival is, and of the swarm only what S3 says", () => {
    const fold = foldOf(sectionOf(html, "problem"));
    expect(plain(fold)).toContain(COPY.problem.more.better);
    // S3 stands under the diagram of the better supervisor's parts, in the words of its row
    expect(fold.indexOf('data-claim="S3"')).toBeGreaterThan(fold.indexOf("home-fold__figure"));
    expect(plain(fold)).not.toMatch(/something to watch|has to stop to recover|ideal one/);
  });

  it("folds the numbers of the problem and the better supervisor, and keeps the film and the repeat button open", () => {
    const problem = sectionOf(html, "problem");
    expect(outsideFolds(problem)).toContain("home-film");
    expect(outsideFolds(problem)).toContain('class="home-repeat"');
    expect(plain(outsideFolds(problem))).not.toContain(COPY.problem.more.better);
    expect(plain(foldOf(problem))).toContain(COPY.problem.more.better);
    expect(foldOf(problem)).toContain('class="home-pair"');
  });

  it("says what the log is not, and what replay does not prove", () => {
    const text = plain(html);
    expect(text).toContain(COPY.solution.more.limit);
    expect(text).toContain(COPY.proof.more.proves);
  });

  it("offers the browser's own check under the proof on the static site, folded, and only there, where the button is", () => {
    expect(html).not.toContain(COPY.proof.more.recompute.replace(/'/g, "&#x27;"));
    vi.stubEnv("MODE", "static");
    const fold = foldOf(sectionOf(render(FIXTURE_STORY), "proof"));
    vi.unstubAllEnvs();
    expect(fold).toContain('href="#/runs?details=all"');
    expect(fold).toContain(COPY.proof.more.recompute.replace(/'/g, "&#x27;"));
  });

  it("types the demo's real output into the terminal, folded under the proof", () => {
    const text = plain(foldOf(sectionOf(html, "proof")));
    const { command, lines, takeover } = FIXTURE_STORY.proof;
    for (const printed of [command, ...lines, takeover.command, takeover.line]) {
      expect(printed).toBeTruthy();
      expect(text).toContain(String(printed).replace(/\s+/g, " "));
    }
    // the open line is the command that checks a run, without the repository's `uv run`
    expect(plain(outsideFolds(sectionOf(html, "proof")))).toContain(`${COPY.proof.check} fractalswarm demo --verify`);
  });

  it("glides from the hero to the click demo, which says it is an illustration", () => {
    const hero = sectionOf(html, "hero");
    expect(hero).toContain('href="#/?at=demo"');
    expect(plain(hero)).toContain(COPY.hero.kill);
    const demo = /<div id="demo"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(plain(demo)).toContain(COPY.solution.demo.label);
    expect(COPY.solution.demo.label).toBe("An illustration, not a real run.");
  });

  it("opens every door that is not behind the server, with a link, and sends the numbers to the evidence page", () => {
    expect(countOf(html, 'class="home-door"')).toBe(DOORS.length);
    expect(countOf(html, 'class="home-door"')).toBe(4);
    expect(html).toContain('href="#/arena"');
    expect(html).toContain('href="#/evidence"');
  });

  it("reaches no outside address but the link to the code", () => {
    expect(html).toContain(`href="${REPO_URL}"`);
    // an svg names its namespace with a URI (the icons do); that is a name, not a request
    expect(html.replace(/xmlns="[^"]*"/g, "").replace(`href="${REPO_URL}"`, "")).not.toMatch(/https?:\/\//);
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

  it("names, in the problem's fold, the one run the film plays: the film prints no setting of its own", () => {
    const run = captionsFor(bundledStory.lanes.central)[0];
    expect(run, "the real story has the film's setting").toMatch(/seed \d+/);
    expect(plain(foldOf(sectionOf(html, "problem")))).toContain(`${COPY.problem.more.film} ${run}`);
    expect(plain(outsideFolds(sectionOf(html, "problem")))).not.toContain(run);
  });

  it("lets only R6 say it, in the row's words, and the setting stands in the claim", () => {
    for (const claim of drawnClaims(html)) {
      if (UNIVERSAL.some(([pattern]) => pattern.test(plain(claim.body)))) expect(claim.id, "a claim that says every run").toBe("R6");
    }
    const first = drawnClaims(outsideFolds(sectionOf(html, "proof"))).find((claim) => claim.id === "R6");
    expect(first, "R6 is open in the proof").toBeDefined();
    expect(plain(first!.body)).toMatch(/real model/);
    expect(plain(first!.body)).toMatch(/five of its ten coordinators crashed/);
  });
});

describe("the home page, with no data at all", () => {
  const html = render(null);

  it("still renders every section and the tagline", () => {
    for (const id of ["hero", "problem", "solution", "proof", "enter"]) expect(html).toContain(`<section id="${id}"`);
    expect(plain(html)).toContain(TAGLINE);
  });

  it("shows a dash and a tag where a number or a claim would be, never a guess", () => {
    const text = plain(html);
    expect(text).toContain("—");
    expect(text).toContain("NO DATA YET");
    expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
    for (const claim of drawnClaims(html)) expect(claim.state).toBe("missing");
  });
});

describe("the home page, standing still", () => {
  const html = render(FIXTURE_STORY, true);

  it("marks the page, and has no button to play anything again", () => {
    expect(html).toContain('class="home" data-still=""');
    expect(html).not.toContain("home-repeat");
    expect(render(FIXTURE_STORY, false)).toContain("home-repeat");
  });

  it("shows the same words as the animated page", () => {
    // the words, not the figures: a number that grows reads as zero in the markup of the page that plays it
    const words = (page: string) => new Set(plain(page).split(" ").filter((word) => word.length > 3 && /\p{L}/u.test(word)));
    const moving = words(render(FIXTURE_STORY, false));
    const missing = [...words(html)].filter((word) => !moving.has(word));
    expect(missing).toEqual([]);
  });

  it("draws the three cards at their end", () => {
    expect(countOf(html, '<li class="home-step" data-active=""')).toBe(3);
    expect(countOf(render(FIXTURE_STORY, false), 'class="home-step" data-active=""')).toBe(0);
  });
});
