// The page is short on purpose (Yoel, Oct 30; .plans/arena/redesign.md): about 200 words with every "See more" closed, and at most 230.
// This holds the number on the page as it renders, W7's drawings included. The height (at most 7,000 px at 1920x1080) needs a
// browser: layout.test.ts holds it when it is given one, and the structure that bounds it is held here.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeView } from "./HomePage";
import { bundledStory } from "./story";
import { HOME, sectionOf, visibleText, visibleWords } from "./testing";

const MAX_WORDS = 230;
const render = (still = false): string => renderToStaticMarkup(createElement(HomeView, { story: bundledStory, still }));
const html = render();

describe("the words of the home page", () => {
  it("are at most 230 with every See more closed, and not so few that a section is empty", () => {
    const words = visibleWords(html);
    expect(words.length, `the page shows ${words.length} words:\n${words.join(" ")}`).toBeLessThanOrEqual(MAX_WORDS);
    expect(words.length).toBeGreaterThanOrEqual(120);
  });

  it("are the same, standing still, but for the Repeat button and the hero's line about its loop", () => {
    const moving = visibleWords(html);
    const still = visibleWords(render(true));
    expect(moving).toContain("Repeat");
    expect(still).not.toContain("Repeat");
    expect(Math.abs(moving.length - still.length)).toBeLessThanOrEqual(3);
  });

  it("keep the nuance in the page, folded: opening every fold only adds words", () => {
    const folds = [...html.matchAll(/<details/g)].length;
    expect(folds).toBeGreaterThanOrEqual(3);
    const open = visibleWords(html.replace(/<details/g, "<div").replace(/<\/details>/g, "</div>").replace(/<summary/g, "<p").replace(/<\/summary>/g, "</p>"));
    expect(open.length).toBeGreaterThan(visibleWords(html).length + 100);
  });

  it("has a title and one sentence to a section, the click demo's label on the demo, and a See more on the sections that fold", () => {
    for (const id of ["problem", "solution", "proof", "enter"]) {
      expect(sectionOf(html, id), id).toContain(`<h2 id="${id}-title"`);
    }
    const demo = /<div id="demo"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(visibleText(demo)).toContain("An illustration in your browser, not a real run.");
    for (const id of ["problem", "solution", "proof"]) {
      expect(sectionOf(html, id), `${id} folds its nuance`).toContain('<details class="home-fold"');
    }
  });
});

describe("the counter of visible words", () => {
  const count = (markup: string): string => visibleWords(markup).join(" ");

  it("leaves out what sits in a closed fold but keeps its summary", () => {
    expect(count("<p>one</p><details><summary>See more</summary><p>two three</p></details><p>four</p>")).toBe("one See more four");
  });

  it("leaves out what is hidden from the eye: aria-hidden, hidden, screen-reader text, the skip link, scripts and placeholders", () => {
    const markup =
      '<a class="home-skip">skip</a><p class="home-sr">reader</p><span aria-hidden="true">icon</span><p hidden="">gone</p>' +
      '<div class="home-placeholder"><span>later</span></div><script>var a = 1</script><b>seen</b>';
    expect(count(markup)).toBe("seen");
  });

  it("leaves out the labels drawn inside an svg, which come and go with the animation, and takes a dot or an arrow for no word", () => {
    expect(count('<p>seen</p><svg><g><text x="1">o0 root</text></g></svg><span>·</span><span>→</span>')).toBe("seen");
  });

  it("decodes what the renderer escapes", () => {
    expect(visibleText("<p>it&#x27;s &quot;fine&quot; &amp; done</p>")).toBe("it's \"fine\" & done");
  });
});

describe("the structure that bounds the height", () => {
  it("is five sections, three cards, six doors, and a fold in the sections that have nuance", () => {
    expect([...html.matchAll(/<section id="(\w+)"/g)].map((m) => m[1])).toEqual(["hero", "problem", "solution", "proof", "enter"]);
    expect([...html.matchAll(/<li class="home-step"/g)]).toHaveLength(3);
    expect([...html.matchAll(/class="home-door"/g)]).toHaveLength(6);
    expect([...html.matchAll(/<details/g)].length).toBeLessThanOrEqual(4);
  });

  it("gives no block of the stylesheet more than a screen of minimum height", () => {
    const css = readFileSync(`${HOME}/home.css`, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/min-height:\s*(\d+(?:\.\d+)?)(svh|vh|dvh)/g)) {
      expect(Number(match[1]), match[0]).toBeLessThanOrEqual(100);
    }
  });
});
