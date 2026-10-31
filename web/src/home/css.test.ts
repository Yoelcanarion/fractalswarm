// The brief's hard rules about CSS, held for every stylesheet under the home folder, W7's included: the headless Chromium
// 130 of this machine crashes on container queries, blur and backdrop filters are too slow for 50 fps in software
// rendering, and the page is offline.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOME } from "./testing";

const stylesheets = (dir: string = HOME): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });

const files = stylesheets();
const read = (path: string): string => readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the stylesheets of the home page", () => {
  it("are found", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((path) => path.endsWith("/home.css"))).toBe(true);
  });

  it("make the last screen the way in and nothing else: the section and the footer fill the window together, so that no See more of the section above peeks under the bar at the end of the scroll", () => {
    const home = read(`${HOME}/home.css`);
    const rule = (selector: string): string => new RegExp(`(?:^|\\})\\s*${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(home)?.[1] ?? "";
    expect(rule(".home-enter")).toMatch(/min-height:\s*calc\(100svh - var\(--home-footer\)\)/);
    expect(rule(".home-footer")).toMatch(/min-height:\s*var\(--home-footer\)/);
  });

  for (const path of files) {
    const name = path.slice(HOME.length + 1);

    it(`${name} uses no container query`, () => {
      expect(read(path)).not.toMatch(/@container|container-type|container-name/);
    });

    it(`${name} uses no backdrop filter and no blur`, () => {
      const css = read(path);
      expect(css).not.toMatch(/backdrop-filter/);
      expect(css).not.toMatch(/blur\(/);
    });

    it(`${name} reaches no outside address`, () => {
      expect(read(path)).not.toMatch(/https?:\/\//);
    });
  }
});
