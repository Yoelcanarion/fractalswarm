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
  replays: "A table of recorded runs, each row getting a check mark once it has been verified",
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

/** A point of the drawing, in the glyph's own units. */
export type Pt = readonly [number, number];

/**
 * A glyph is drawn on a canvas of this size and fits the box the page gives it, left-aligned and never cropped. The two
 * doors the page gives two columns, the arena and the live run, also have a wide drawing on a canvas of their own, so that
 * they use the width they are given instead of leaving two thirds of it empty.
 */
export const CANVAS = { width: 220, height: 110 } as const;
export const WIDE_CANVAS = { width: 480, height: 110 } as const;
export const hasWide = (id: string): boolean => id === "arena" || id === "live";
/** The wide drawing is used once the glyph's box is this many times wider than it is tall (a door the width of two columns of the page is about 2.9, a wide one 3.4 to 4.9). */
export const WIDE_FROM = 3.2;

const ROW = { root: 18, track: 50, leaf: 82 } as const;

/** A tree of coordinators: the leaves given, `fan` of them under each coordinator, and the root over the coordinators. */
function treeOf(leafXs: readonly number[], fan: number): { root: Pt; tracks: Pt[]; leaves: Pt[] } {
  const tracks: Pt[] = [];
  for (let i = 0; i < leafXs.length; i += fan) {
    const group = leafXs.slice(i, i + fan);
    tracks.push([(group[0]! + group[group.length - 1]!) / 2, ROW.track]);
  }
  return {
    root: [(tracks[0]![0] + tracks[tracks.length - 1]![0]) / 2, ROW.root],
    tracks,
    leaves: leafXs.map((x): Pt => [x, ROW.leaf]),
  };
}

const ARENA_PLANS = {
  compact: { leaves: [17, 43, 67, 93], workers: [130, 153, 177, 200], divider: 110, deadWorker: 1 },
  wide: { leaves: [17, 55, 93, 131, 169, 207], workers: [273, 311, 349, 387, 425, 463], divider: 240, deadWorker: 2 },
} as const;

/** The arena's two systems: a swarm of coordinators on the left, a supervisor over its workers on the right, and the one of each that fails. */
function arenaOf(plan: (typeof ARENA_PLANS)[keyof typeof ARENA_PLANS]) {
  const workers = plan.workers.map((x): Pt => [x, ROW.leaf]);
  const swarm = treeOf(plan.leaves, 2);
  return {
    divider: plan.divider,
    swarm,
    deadTrack: 0,
    supervisor: [(plan.workers[0]! + plan.workers[plan.workers.length - 1]!) / 2, 24] as Pt,
    workers,
    deadWorker: plan.deadWorker,
    deadLeft: swarm.tracks[0]!,
    deadRight: workers[plan.deadWorker]!,
  };
}

const LIVE_PLANS = {
  compact: {
    box: [6, 18, 78, 74],
    lines: [[33, 65], [45, 71], [57, 47], [69, 68], [80, 55]],
    arrow: [92, 113],
    leaves: [127, 153, 177, 203],
  },
  wide: {
    box: [6, 14, 150, 82],
    lines: [[29, 128], [40, 104], [51, 140], [62, 86], [73, 122], [84, 98]],
    arrow: [172, 251],
    leaves: [285, 319, 353, 387, 421, 455],
  },
} as const;

/** A pasted text, an arrow, and the tree the run grows from it: the stream of dots follows the arrow, the crosshair lands on the last coordinator. */
function liveOf(plan: (typeof LIVE_PLANS)[keyof typeof LIVE_PLANS]) {
  const tree = treeOf(plan.leaves, 2);
  return { ...plan, tree, flow: plan.arrow[1] - plan.arrow[0] + 3, target: tree.tracks[tree.tracks.length - 1]! };
}

const ARENA = { compact: arenaOf(ARENA_PLANS.compact), wide: arenaOf(ARENA_PLANS.wide) };
const LIVE = { compact: liveOf(LIVE_PLANS.compact), wide: liveOf(LIVE_PLANS.wide) };
export const arenaShape = (wide: boolean) => (wide ? ARENA.wide : ARENA.compact);
export const liveShape = (wide: boolean) => (wide ? LIVE.wide : LIVE.compact);

/** Where the geometry the frames and the drawing share lives, so that they cannot drift apart. */
export const GEOM = {
  replays: { checkX: 190, rows: [42, 59, 76, 93] },
  // the clapper, `bar` thick and `width` long, turns about the hinge at its lower left corner; open, its far end is the highest
  // thing in any glyph, and it still lies inside the canvas (a test holds it there)
  director: { hinge: [10, 59], open: -16, width: 152, bar: 13, bottom: 106 },
  numbers: { from: 10, to: 212, marks: [54, 99, 143, 210] },
  ablation: {
    left: { from: [46, 54], via: [46, 70], to: [76, 82] },
    right: { from: [174, 54], via: [174, 70], to: [144, 82] },
  },
} as const;

export function doorFrame(id: string, p: number, wide = false): DoorFrame {
  switch (id) {
    case "arena": {
      // the same failure, at the same moment, in each of the two
      const a = ease(p, 0.12, 0.5);
      const [lx, ly] = arenaShape(wide).deadLeft;
      const [rx, ry] = arenaShape(wide).deadRight;
      return {
        "x-left": { opacity: a, transform: at(lx, ly, 0.5 + 0.5 * a) },
        "x-right": { opacity: a, transform: at(rx, ry, 0.5 + 0.5 * a) },
        "dead-left": { opacity: 1 - 0.72 * a },
        "dead-right": { opacity: 1 - 0.72 * a },
      };
    }
    case "live": {
      const { flow, target } = liveShape(wide);
      const frame: DoorFrame = {};
      for (let i = 0; i < 3; i++) {
        const u = span(p, 0.04 + 0.14 * i, 0.52 + 0.14 * i);
        frame[`stream-${i}`] = { opacity: pulse(u), transform: move(flow * u, 0) };
      }
      frame["tree-fill"] = { opacity: smoothstep(span(p, 0.4, 0.8)) };
      const b = ease(p, 0.72, 0.97);
      frame["crosshair"] = { opacity: b, transform: at(target[0], target[1], 1.6 - 0.6 * b) };
      return frame;
    }
    case "replays": {
      const frame: DoorFrame = {};
      // the rows are verified one after the other, from the top
      GEOM.replays.rows.forEach((y, i) => {
        const c = ease(p, 0.08 + 0.2 * i, 0.36 + 0.2 * i);
        frame[`check-${i}`] = { opacity: c, transform: at(GEOM.replays.checkX, y, 0.6 + 0.4 * c) };
      });
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
      const reach = to + 4;
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
