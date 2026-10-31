// The Solution's three cards: what they draw before any script runs. They play once as they arrive (a hook the markup cannot show),
// so the page as the server draws it has each at its first frame, and a still page has each at its end.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeView } from "../HomePage";
import { bundledStory } from "../story";

const render = (still: boolean): string => renderToStaticMarkup(createElement(HomeView, { story: bundledStory, still }));
const cardsOf = (html: string): string => /<ul class="home-steps">[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
const count = (html: string, part: string): number => html.split(part).length - 1;

describe("the Solution's cards before any script runs", () => {
  it("are three, each with a drawing", () => {
    expect(count(cardsOf(render(false)), 'class="home-step"')).toBe(3);
    expect(count(cardsOf(render(false)), 'class="hv hv-step"')).toBe(3);
  });

  it("rest at their first frame, which the first to arrive plays: a card is not at its end until its turn", () => {
    const cards = cardsOf(render(false));
    expect(count(cards, 'data-on="false"')).toBe(3);
    expect(count(cards, 'data-on="true"')).toBe(0);
  });

  it("are at their end for a page that stands still", () => {
    const cards = cardsOf(render(true));
    expect(count(cards, 'data-on="true"')).toBe(3);
    expect(count(cards, 'data-on="false"')).toBe(0);
  });
});
