// The hero: the loop it plays, the line that says what the figure is, and what it draws before any script runs.

import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TAGLINE } from "../copy";
import { HomeView } from "../HomePage";
import { bundledStory } from "../story";
import { HOME } from "../testing";
import { TREE_HERO_SECONDS } from "../viz/keyframes";
import { HERO_ASPECT, HERO_LOOP, HERO_NOTE, SENTENCES } from "./Hero";

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

describe("the hero's title", () => {
  const title = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(heroOf(render(false)))?.[1] ?? "";

  it("is the tagline in its two sentences, each in a block of its own, and reads as the tagline", () => {
    expect(SENTENCES).toEqual(["Kill half the brains.", "It still finishes."]);
    expect(title.match(/<span class="home-hero__sentence">/g)).toHaveLength(2);
    for (const sentence of SENTENCES) expect(title).toContain(`>${sentence}</span>`);
    expect(plain(title).replace(/\s+/g, " ").trim()).toBe(TAGLINE);
  });
});

describe("the hero's title against its column", () => {
  const css = (path: string): string => readFileSync(`${HOME}/${path}`, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
  const home = css("home.css");
  const hero = css("chapters/hero.css");
  /** The longest sentence's width in font sizes, measured in Chromium with the display face at the title's weight and tracking. */
  const LONGEST_SENTENCE_EM = 7.604;

  it("rests on the layout home.css gives the hero: two columns of 6.2fr and 5.8fr under 1480px of text, one column on a phone", () => {
    expect(home).toMatch(/grid-template-columns:\s*minmax\(0, 6\.2fr\) minmax\(0, 5\.8fr\);/);
    expect(home).toMatch(/--home-pad:\s*clamp\(20px, 5\.2vw, 104px\);/);
    expect(home).toMatch(/--home-max:\s*1480px;/);
    expect(home).toMatch(/gap:\s*clamp\(24px, 3vw, 64px\);\s*padding: calc\(var\(--home-bar\) \+ 2svh\) var\(--home-pad-end\) 6svh var\(--home-pad\);/);
    expect(home).toMatch(/@media \(max-width: 899px\) \{\s*\.home-hero \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it("is set so that the longest sentence fits its column with a few per cent to spare, at every width from a phone to a wide screen", () => {
    const rules = [...hero.matchAll(/\.home-hero \.home-hero__title \{\s*font-size: min\(([\d.]+)vw, ([\d.]+)px\);/g)].map((m) => ({ vw: Number(m[1]), cap: Number(m[2]) }));
    expect(rules).toHaveLength(2);
    const [wide, phone] = rules as [{ vw: number; cap: number }, { vw: number; cap: number }];
    const pad = (vw: number): number => Math.min(Math.max(0.052 * vw, 20), 104);
    const gap = (vw: number): number => Math.min(Math.max(0.03 * vw, 24), 64);
    const column = (vw: number): number => (vw < 900 ? vw - 2 * pad(vw) : ((Math.min(vw - 2 * pad(vw), 1480) - gap(vw)) * 6.2) / 12);
    const size = (vw: number): number => {
      const rule = vw < 900 ? phone : wide;
      return Math.min((rule.vw / 100) * vw, rule.cap);
    };
    for (const vw of [320, 360, 390, 430, 600, 768, 899, 900, 1024, 1280, 1366, 1440, 1536, 1680, 1920, 2560, 3840]) {
      expect(size(vw) * LONGEST_SENTENCE_EM, `${vw}px wide`).toBeLessThanOrEqual(column(vw) * 0.96);
    }
  });

  it("gives each sentence a block of its own", () => {
    expect(hero).toMatch(/\.home-hero__sentence \{\s*display: block;\s*\}/);
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

  it("draws the rule and the label of the memorial row from the first frame, with an empty place for each brain the run kills", () => {
    expect(html).toContain("hv-memorial-rule");
    expect(html.match(/class="hv-slot"/g)).toHaveLength(bundledStory.tree.kills.length);
  });

  it("has no style that follows the scroll: the hand-over is a state change, not a style the scroll position computes", () => {
    expect(html).not.toMatch(/<(div|figure)[^>]*class="home-hero__(copy|object)"[^>]*style=/);
    expect(html).not.toMatch(/<(div|figure)[^>]*style=[^>]*class="home-hero__(copy|object)"/);
  });
});
