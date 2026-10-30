// The page-wide rule about easing (coordinator, Oct 30): the progress that drives a visual is linear in time, and each element of
// the visual eases itself once, over its own stretch of it. A driver that eased as well would squeeze every stretch of every
// visual into the first fifth of its time (measured: a 1.2 s wipe was done at 0.2 s, a 0.9 s door at 0.35 s).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOME } from "../testing";
import { EASE_OUT } from "../../lib/motion";
import { easeOutCubic, span } from "./shared";

const source = (path: string): string => readFileSync(`${HOME}/${path}`, "utf-8");

/** The calls of animate() that move a progress or a hover (not the count-up of a number, which has no visual in it). */
const drivers = [
  { name: "the progress of a chart or a terminal when it comes into view", path: "hooks.ts", call: /animate\(progress, 1, \{[^}]*\}\)/ },
];

describe("the drivers of the visuals' progress", () => {
  for (const { name, path, call } of drivers) {
    it(`${name} is linear`, () => {
      const found = call.exec(source(path))?.[0];
      expect(found, `${path} no longer has the call this test reads`).toBeDefined();
      expect(found).toMatch(/ease: "linear"/);
    });
  }
});

describe("a visual under a linear driver", () => {
  /** Seconds for a motion to reach `level` of its travel, over a draw of `total` seconds. */
  const timeTo = (level: number, total: number, motion: (p: number) => number, driver: (t: number) => number): number => {
    for (let i = 0; i <= 1000; i++) if (motion(driver(i / 1000)) >= level) return (i / 1000) * total;
    return Number.NaN;
  };
  const staged = (p: number): number => easeOutCubic(span(p, 0.3, 0.7));

  it("plays a staged stretch over its own part of the time, where an eased driver put it inside a tenth", () => {
    const linear = (t: number): number => t;
    const eased = (t: number): number => EASE_OUT(t);
    // the stretch is 0.3 to 0.7 of a 1.4 s draw: 0.42 s to 0.98 s
    expect(timeTo(0.1, 1.4, staged, linear)).toBeGreaterThan(0.42);
    expect(timeTo(0.9, 1.4, staged, linear)).toBeLessThan(0.98);
    expect(timeTo(0.9, 1.4, staged, linear) - timeTo(0.1, 1.4, staged, linear)).toBeGreaterThan(0.25);
    expect(timeTo(0.9, 1.4, staged, eased) - timeTo(0.1, 1.4, staged, eased)).toBeLessThan(0.1);
  });
});
