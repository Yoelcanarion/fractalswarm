// The evidence page (#/evidence), rendered to a string: the plain document behind the home page. It holds what the home page
// leaves out (the models, the fair fight, the charts, where it ties and where it does worse, the proof, the tokens), with the
// rules about claims that hold wherever they are drawn.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { REPO_URL } from "../../lib/links";
import { COPY } from "../copy";
import type { Story } from "../data/types";
import { figure } from "../format";
import { assumptions, realFalseDeaths } from "../numbers";
import { EVIDENCE_IDS } from "../sections";
import { bundledStory } from "../story";
import { countOf, drawnClaims, fixtureClaimText, FIXTURE_STORY, plain, UNIVERSAL } from "../testing";
import { EvidenceView } from "./EvidencePage";

const render = (story: Story | null): string => renderToStaticMarkup(createElement(EvidenceView, { story }));

describe("the evidence page, rendered with a story", () => {
  const html = render(FIXTURE_STORY);

  it("is a plain document: one h1, a way back, and nothing that moves", () => {
    const titles = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => plain(m[1]).trim());
    expect(titles).toEqual([COPY.evidencePage.title]);
    expect(html).toContain('class="home home--evidence" data-still=""');
    expect(html).toContain('href="#/"');
    expect(html).not.toContain("home-repeat");
    expect(html).not.toContain("<details");
  });

  it("has every place a link can name, in the order of the page", () => {
    let from = 0;
    for (const id of EVIDENCE_IDS) {
      const at = html.indexOf(`id="${id}"`, from);
      expect(at, `${id} is missing or out of order`).toBeGreaterThan(-1);
      from = at;
    }
  });

  it("brings the top bar's way in back to the home page with a plain link", () => {
    expect(html).toContain('href="#/arena"');
  });

  it("prints the numbers of the story and none of its own", () => {
    const text = plain(html);
    const printedByThePage = [
      "T2 conference planning · 5 coordinators crashed (C3) · real model · 7 seeds",
      "T2 conference planning · 5 coordinators crashed (C3) · real model · 5 seeds",
      "T1 extraction · 4 coordinators crashed · fake model · 1 seed",
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
    for (const printed of printedByThePage) expect(text, printed).toContain(printed);
    expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
  });

  it("opens the pre-registered gate's sentence with the crash counts of its profiles, from the data", () => {
    expect(plain(render(FIXTURE_STORY))).toContain("this measure tied at three and five crashes");
    expect(plain(render(null))).toContain("this measure tied at — crashes");
  });

  it("draws every claim in the words of its row, with a tag only on the pending ones", () => {
    const drawn = drawnClaims(html);
    expect(drawn.length).toBeGreaterThan(0);
    for (const claim of drawn) {
      expect(claim.part, `${claim.id} is drawn whole here`).toBeNull();
      expect(plain(claim.body), claim.id).toContain(fixtureClaimText(claim.id).replace(/`/g, ""));
      const pending = FIXTURE_STORY.claims[claim.id].state === "pending";
      expect(claim.state, claim.id).toBe(pending ? "pending" : "allowed");
      expect(claim.body.includes("home-tag"), `${claim.id} tag`).toBe(pending);
    }
  });

  it("draws the claims the evidence is about, once each", () => {
    expect(new Set(drawnClaims(html).map((claim) => claim.id))).toEqual(new Set(["S2", "S4", "S5", "S6", "R2", "R3", "R4", "R5", "R7"]));
    for (const id of ["S2", "S4", "S5", "S6", "R2", "R3", "R4", "R5", "R7"]) expect(countOf(html, `data-claim="${id}"`), id).toBe(1);
    expect(html).not.toContain('data-claim="R1"');
  });

  it("puts R5 under the chart whose extra cost it names the bases of, with its setting and the in-process reason before it", () => {
    const hero = /<article id="hero-chart"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    const at = hero.indexOf('data-claim="R5"');
    expect(at).toBeGreaterThan(-1);
    const before = plain(hero.slice(0, at));
    expect(before).toContain("real model");
    expect(before).toContain(COPY.rivalReason);
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
  });

  it("shows R4 once, with its setting and the $0 gate beside it", () => {
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
    // The figures are the page's own, before the regime strip: the strip names settings of its own ("both detect in 2.5 s").
    const article = /<article[^>]*aria-labelledby="fails-lead"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    const figures = article.split('class="home-chart')[0] ?? "";
    expect(figures, "the strip follows the figures").not.toBe(article);
    expect(plain(figures)).toContain("1.3");
    expect(plain(figures)).toContain("2.3");
    expect(plain(figures)).not.toContain("2.5");
  });

  it("says where the swarm does not help, and what replay does not prove", () => {
    const text = plain(html);
    expect(text).toContain(COPY.evidence.fails.wins);
    expect(text).toContain(COPY.solution.more.limit);
    expect(text).toContain(COPY.proof.more.proves);
  });

  it("shows the run the home page replays: what it placed and what it cost, with S2 beside it", () => {
    const run = /<article id="run"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(plain(run)).toContain("$4.56");
    expect(run).toContain('data-claim="S2"');
    expect(plain(run)).toContain("T1 extraction · 4 coordinators crashed · fake model · 1 seed");
  });

  it("types the demo's real output into the terminal", () => {
    const text = plain(html);
    const { command, lines, takeover } = FIXTURE_STORY.proof;
    for (const printed of [command, ...lines, takeover.command, takeover.line]) {
      expect(printed).toBeTruthy();
      expect(text).toContain(String(printed).replace(/\s+/g, " "));
    }
  });

  it("reaches no outside address but the link to the code", () => {
    expect(html.replace(/xmlns="[^"]*"/g, "").replace(`href="${REPO_URL}"`, "")).not.toMatch(/https?:\/\//);
  });
});

describe("the evidence page, rendered with the real story", () => {
  const html = render(bundledStory);
  const outsideClaims = plain(html.replace(/<p class="home-claim[^"]*"[^>]*>[\s\S]*?<\/p>/g, " "));

  it("prints no gap where the data has none", () => {
    expect(plain(html)).not.toMatch(/undefined|NaN|\bnull\b/);
  });

  it("says nothing of its own that reads as every run being valid", () => {
    for (const [pattern, name] of UNIVERSAL) expect(pattern.test(outsideClaims), `"${name}" outside a claim`).toBe(false);
  });

  it("writes the real false deaths beside R4 at two decimals, the way R2's row and R4's evidence write them (1.90 at ten seeds)", () => {
    const cost = realFalseDeaths(bundledStory);
    expect(cost, "the real story has the false deaths of the headline rows").not.toBeNull();
    const helps = /<article[^>]*aria-labelledby="helps-lead"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(plain(helps)).toContain(`${figure(cost!.perRun, 2)} ${COPY.evidence.helps.perRun}`);
    expect(figure(cost!.perRun, 2)).toBe("1.90");
  });

  it("shows the first four terms granted to the rival and keeps every other one in the page, behind a control", () => {
    const terms = assumptions(bundledStory);
    expect(terms.length, "the real story has terms to fold").toBeGreaterThan(4);
    const fair = /<article id="fair"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    const rows = [...fair.matchAll(/<tr( hidden="")?><th scope="row">/g)];
    expect(rows.map((row) => row[1] !== undefined)).toEqual(terms.map((_, index) => index >= 4));
    // the control names the table it opens and says how many terms there are
    expect(fair).toContain('<table id="fair-terms"');
    expect(fair).toMatch(/<button type="button" class="home-more" aria-expanded="false" aria-controls="fair-terms">/);
    expect(plain(fair)).toContain(COPY.evidence.fair.showAll(terms.length));
    // every term is in the page to be read, in view or not
    for (const term of terms) expect(plain(fair), term.id).toContain(term.label.replace(/`/g, ""));
  });
});

describe("the evidence page, with no data at all", () => {
  const html = render(null);

  it("still renders every place and shows a dash and a tag, never a guess", () => {
    for (const id of EVIDENCE_IDS) expect(html, id).toContain(`id="${id}"`);
    const text = plain(html);
    expect(text).toContain("—");
    expect(text).toContain("NO DATA YET");
    expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
    for (const claim of drawnClaims(html)) expect(claim.state).toBe("missing");
  });
});
