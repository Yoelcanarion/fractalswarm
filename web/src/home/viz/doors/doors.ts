// What the six door glyphs do as their progress goes from 0 to 1, with no DOM in it. Progress is the
// pointer being on the door (0.9 s in, 0.4 s out), so 0 is the picture everyone sees at rest and 1 the
// one a visitor who asked for less motion gets: each is a complete picture of its own. A glyph shows
// what the door lets you do. It never shows an outcome: that is the numbers' to say, with their setting.

import { easeInOutCubic, easeOutCubic, fx, lerp, smoothstep, span } from "../shared";

export const DOOR_IDS = ["arena", "live", "replays", "director", "numbers", "ablation"] as const;
export type DoorId = (typeof DOOR_IDS)[number];

export const isDoor = (id: string): id is DoorId => (DOOR_IDS as readonly string[]).includes(id);

/** The words a screen reader gets for the glyph, when it gets it at all (the page marks it decorative). */
export const DOOR_LABELS: Record<DoorId, string> = {
  arena: "Two systems, a swarm of coordinators and a supervisor, each hit by the same failure",
  live: "A pasted text becomes a tree of coordinators, and a crosshair lands on one of them",
  replays: "A chain of recorded steps, each with a check mark once it has been verified",
  director: "A clapperboard closing on a scene",
  numbers: "A chart with two lines and a marker running along it",
  ablation: "A hand-written parser and Muse, both reading the same notes",
};

/** What a part of the glyph is doing: how visible it is, and where it is. Absent means left as drawn. */
export interface PartState {
  opacity?: number;
  transform?: string;
}
export type DoorFrame = Record<string, PartState>;

const ease = (p: number, a: number, b: number): number => easeOutCubic(span(p, a, b));
const pulse = (u: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
const at = (x: number, y: number, scale = 1): string => `translate(${fx(x)} ${fx(y)}) scale(${scale.toFixed(3)})`;
const move = (x: number, y: number): string => `translate(${fx(x)} ${fx(y)})`;

/** A point on the quadratic curve from a through c to b. */
export const quad = (t: number, a: readonly [number, number], c: readonly [number, number], b: readonly [number, number]): [number, number] => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};

/** Where the geometry the frames and the drawing share lives, so that they cannot drift apart. */
export const GEOM = {
  arena: { deadLeft: [30, 50], deadRight: [153, 82] },
  live: { flow: 24, target: [190, 50] },
  replays: { checks: [32, 84, 136, 188], checkY: 88 },
  director: { hinge: [36, 46], open: -18 },
  numbers: { from: 24, to: 206, marks: [64, 104, 144, 204] },
  ablation: {
    left: { from: [46, 54], via: [46, 70], to: [76, 82] },
    right: { from: [174, 54], via: [174, 70], to: [144, 82] },
  },
} as const;

export function doorFrame(id: string, p: number): DoorFrame {
  switch (id) {
    case "arena": {
      // the same failure, at the same moment, in each of the two
      const a = ease(p, 0.12, 0.5);
      const [lx, ly] = GEOM.arena.deadLeft;
      const [rx, ry] = GEOM.arena.deadRight;
      return {
        "x-left": { opacity: a, transform: at(lx, ly, 0.5 + 0.5 * a) },
        "x-right": { opacity: a, transform: at(rx, ry, 0.5 + 0.5 * a) },
        "dead-left": { opacity: 1 - 0.72 * a },
        "dead-right": { opacity: 1 - 0.72 * a },
      };
    }
    case "live": {
      const frame: DoorFrame = {};
      for (let i = 0; i < 3; i++) {
        const u = span(p, 0.04 + 0.14 * i, 0.52 + 0.14 * i);
        frame[`stream-${i}`] = { opacity: pulse(u), transform: move(GEOM.live.flow * u, 0) };
      }
      frame["tree-fill"] = { opacity: smoothstep(span(p, 0.4, 0.8)) };
      const b = ease(p, 0.72, 0.97);
      frame["crosshair"] = { opacity: b, transform: at(GEOM.live.target[0], GEOM.live.target[1], 1.6 - 0.6 * b) };
      return frame;
    }
    case "replays": {
      const frame: DoorFrame = {};
      GEOM.replays.checks.forEach((cx, i) => {
        const c = ease(p, 0.08 + 0.2 * i, 0.36 + 0.2 * i);
        frame[`check-${i}`] = { opacity: c, transform: at(cx, GEOM.replays.checkY, 0.6 + 0.4 * c) };
      });
      for (let i = 0; i < 3; i++) frame[`link-${i}`] = { opacity: smoothstep(span(p, 0.2 + 0.2 * i, 0.5 + 0.2 * i)) };
      return frame;
    }
    case "director": {
      const e = easeInOutCubic(span(p, 0, 0.55));
      const [hx, hy] = GEOM.director.hinge;
      return {
        clapper: { transform: `rotate(${(GEOM.director.open * (1 - e)).toFixed(2)} ${hx} ${hy})` },
        "board-lines": { opacity: 0.35 + 0.65 * smoothstep(span(p, 0.5, 0.9)) },
      };
    }
    case "numbers": {
      // a marker runs along the chart at an even pace and lights each point as it passes
      const { from, to, marks } = GEOM.numbers;
      const reach = to + 8;
      const x = lerp(from, reach, span(p, 0.04, 0.84));
      const frame: DoorFrame = {
        scrub: { opacity: smoothstep(span(p, 0, 0.06)) * (1 - smoothstep(span(p, 0.8, 0.9))), transform: move(x, 0) },
      };
      marks.forEach((m, j) => {
        const passes = 0.04 + 0.8 * ((m - from) / (reach - from));
        frame[`pt-${j}`] = { opacity: smoothstep(span(p, passes - 0.02, passes + 0.16)) };
      });
      return frame;
    }
    case "ablation": {
      // both read the same notes, at the same pace: neither gets to the notes first
      const a = ease(p, 0.1, 0.6);
      const u = span(p, 0.1, 0.85);
      const { left, right } = GEOM.ablation;
      const [lx, ly] = quad(u, left.from, left.via, left.to);
      const [rx, ry] = quad(u, right.from, right.via, right.to);
      return {
        "arrow-left": { opacity: 0.45 + 0.55 * a },
        "arrow-right": { opacity: 0.45 + 0.55 * a },
        "dot-left": { opacity: pulse(u), transform: move(lx, ly) },
        "dot-right": { opacity: pulse(u), transform: move(rx, ry) },
        "notes-glow": { opacity: smoothstep(span(p, 0.75, 1)) },
      };
    }
    default:
      return {};
  }
}
