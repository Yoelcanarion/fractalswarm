// The hero: the loop it plays, the line that says what the figure is, and what it draws before any script runs.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeView } from "../HomePage";
import { bundledStory } from "../story";
import { TREE_HERO_SECONDS } from "../viz/keyframes";
import { HERO_ASPECT, HERO_LOOP, HERO_NOTE } from "./Hero";

const render = (still: boolean): string => renderToStaticMarkup(createElement(HomeView, { story: bundledStory, still }));
const heroOf = (html: string): string => /<section[^>]*class="home-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const plain = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the hero's loop", () => {
  it("plays the run at the pace of the hero, rests a moment on the settled tree, and takes about a second to grow and to fold", () => {
    expect(HERO_LOOP.run).toBe(TREE_HERO_SECONDS);
    expect(HERO_LOOP.rest).toBeGreaterThanOrEqual(1.5);
    expect(HERO_LOOP.rest).toBeLessThanOrEqual(2.5);
    for (const seconds of [HERO_LOOP.enter, HERO_LOOP.leave]) {
      expect(seconds).toBeGreaterThanOrEqual(0.8);
      expect(seconds).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("the line under the hero's tree", () => {
  it("says a recorded run is replayed on a loop, in the words of docs/claims.md, and never calls it live", () => {
    expect(HERO_NOTE.loop).toMatch(/recorded run/);
    expect(HERO_NOTE.loop).toMatch(/replayed/);
    for (const line of Object.values(HERO_NOTE)) expect(line).not.toMatch(/\blive\b|real[- ]time|streaming/i);
  });

  it("sits under the tree, and the setting of the run is no longer printed there: the page is held to about 200 words", () => {
    const hero = plain(heroOf(render(false)));
    expect(hero).toContain(HERO_NOTE.loop);
    expect(hero).not.toContain("real model");
  });

  it("says what a still frame is instead, since nothing is replayed", () => {
    const hero = plain(heroOf(render(true)));
    expect(hero).toContain(HERO_NOTE.still);
    expect(hero).not.toContain("on a loop");
  });
});

describe("the hero's words", () => {
  const hero = plain(heroOf(render(false)));

  it("are the tagline, a line naming the two models, one sentence and one button that glides to the click demo", () => {
    expect(hero).toContain("Kill half the brains. It still finishes.");
    expect(hero).toContain("Muse Spark");
    expect(hero).toContain("Muse Wonder");
    expect(hero).toContain("AI agents led by a tree of small coordinators.");
    const html = heroOf(render(false));
    expect(html.match(/class="home-button/g)).toHaveLength(1);
    expect(html).toContain('href="#/?at=demo"');
    expect(hero).toContain("Kill one yourself");
  });

  it("do not hand over: nothing in the hero follows the scroll", () => {
    expect(heroOf(render(false))).not.toContain("data-leaving");
  });
});

describe("the hero's tree before any script runs", () => {
  const html = heroOf(render(false));

  it("is drawn with its ambient layer: a pulse slot on each node's edge, no text of its own", () => {
    expect(html.match(/data-amb-dot="/g)?.length).toBe(bundledStory.tree.nodes.length);
    const layer = /<g class="hv-amb"[^>]*>[\s\S]*?<\/g><g>/.exec(html)?.[0] ?? "";
    expect(layer).toContain('aria-hidden="true"');
    expect(layer).not.toContain("<text");
  });

  it("is drawn to the shape of its square, so that it fills its column and does not leave a third of it empty", () => {
    const box = /<svg[^>]*class="hv hv-tree[^"]*"[^>]*viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(html);
    expect(box).not.toBeNull();
    expect(Number(box?.[3]) / Number(box?.[4])).toBeCloseTo(HERO_ASPECT, 2);
    expect(HERO_ASPECT).toBeGreaterThan(1);
    expect(HERO_ASPECT).toBeLessThan(1.3);
  });

  it("has no style that follows the scroll: the hand-over is a state change, not a style the scroll position computes", () => {
    expect(html).not.toMatch(/<(div|figure)[^>]*class="home-hero__(copy|object)"[^>]*style=/);
    expect(html).not.toMatch(/<(div|figure)[^>]*style=[^>]*class="home-hero__(copy|object)"/);
  });
});
