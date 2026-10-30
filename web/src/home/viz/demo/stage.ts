// The click demo's picture over time. sim.ts decides what happens when a coordinator is crashed; this draws it, in the hero's own
// language (the same TreeFrame the tree's painter copies onto the SVG): the coordinator goes dark, its neighbours notice (the
// missed-heartbeat dots fill), the pool of heirs lights with a bar for each score, the heir rings and takes the crown if the dead
// one held the root, the orphans' edges slide to it and the tree settles into its new shape while the dead one drops to the row
// of the killed.
//
// Time is one playhead per takeover, run through the page's one ease (../ease.ts); every part of the picture takes a stretch of
// that playhead (PLAY) and none has an ease of its own. Takeovers may overlap, because a visitor may click again at once: a part
// that moves again starts from where it is on screen, so nothing jumps. The frame is a pure function of the clock.

import type { TreeSlice } from "../../data/types";
import { playhead, SECONDS } from "../ease";
import { lerp, span } from "../shared";
import type { EdgeFrame, NodeFrame, NodeState, TreeFrame } from "../tree/frame";
import { layoutForest, ROW, type Slot } from "../tree/layout";
import { treeModel, type TreeModel } from "../tree/model";
import { demoTree, initialState, kill, shapeOf, type DemoState, type DemoTree, type Outcome, type Round, type Shape } from "./sim";

/** Where in a takeover's playhead (0..1) each part of the picture plays. */
export const PLAY = {
  flash: [0, 0.12],
  /** The missed-heartbeat dots fill: the neighbours notice. */
  notice: [0.06, 0.46],
  suspect: 0.26,
  verdict: 0.46,
  stamp: [0.44, 0.54],
  /** The goals the dead one held are decided in turn, from here to the end of the takeover. */
  decide: [0.46, 1],
  rewire: [0.64, 0.94],
  crown: [0.68, 0.94],
  glide: [0.7, 1],
} as const;

/** The dots a coordinator that went quiet shows: the detector's five missed beats. */
const DOTS = 5;
const WHOLE = [0, 1] as const;
/** The slots of the row of the killed: ten coordinators at most, a step apart. */
const GRAVE_STEP = 1.5;
const GRAVE_SLOTS = 10;

interface Move {
  t0: number;
  dur: number;
  s: readonly [number, number];
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** The move ends in the row of the killed. */
  grave: boolean;
}

interface Anchor {
  t0: number;
  dur: number;
  s: readonly [number, number];
  /** Where the parent end of the edge was when it set off. */
  ax: number;
  ay: number;
  from: string | null;
  to: string | null;
  /** The parent it leaves is dead: the edge is broken until it has half arrived. */
  cut: boolean;
}

interface Crown {
  t0: number;
  dur: number;
  s: readonly [number, number];
  from: string | null;
  to: string | null;
}

interface Hold {
  t0: number;
  dur: number;
  dead: string;
  rounds: Round[];
}

export interface Stage {
  readonly model: TreeModel;
  readonly tree: DemoTree;
  /** The coordinators still running, and the ones crashed (in the order they went). */
  alive(): string[];
  crashed(): string[];
  /** Who holds the root goal now (the answer of the rules, not yet the picture). */
  holder(): string | null;
  /** Crashes a coordinator at clock time `now` (ms). Null when it cannot be crashed. */
  kill(id: string, now: number): Outcome | null;
  /** Brings everything back, from wherever it is on screen. */
  reset(now: number): void;
  /** The picture at `now`: the same object each time, changed in place. */
  at(now: number): TreeFrame;
  /** Whether a takeover or a reset is still playing at `now`. */
  playing(now: number): boolean;
  /** Where on the page's coordinates (layout units) a node sits at `now`. */
  place(id: string, now: number): Slot;
  /** The playhead (0..1) of the latest takeover at `now`, or 1 when none is playing. */
  progress(now: number): number;
}

const NONE = -Infinity;

/** `lerp` that lands exactly on both ends, so a settled picture is the same numbers every frame and nothing is rewritten. */
const mix = (a: number, b: number, g: number): number => (g >= 1 ? b : g <= 0 ? a : a + (b - a) * g);

/** `duration` is the length of a takeover in seconds: 0 for a person who asked for less motion, so a change is instant. */
export function createStage(tree: TreeSlice, duration: number = SECONDS.takeover): Stage {
  const model = treeModel(tree);
  const rules = demoTree(tree);
  const home = model.epochs[0]?.pos ?? {};
  const xs = Object.values(home).map((s) => s.x);
  const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  const graveY = Math.max(...Object.values(model.memorial).map((s) => s.y));
  const graveSlot = (i: number): Slot => ({ x: centre + (i - (GRAVE_SLOTS - 1) / 2) * GRAVE_STEP, y: graveY });
  const resetSeconds = duration === 0 ? 0 : SECONDS.grow;

  let state: DemoState = initialState(rules);
  let shape: Shape = shapeOf(rules, state);
  const order: string[] = [];
  const diedAt: Record<string, number | undefined> = {};
  const revivedAt: Record<string, number | undefined> = {};
  const moves: Record<string, Move> = {};
  const anchors: Record<string, Anchor> = {};
  const rows: Record<string, number> = {};
  let crowns: Crown[] = [{ t0: NONE, dur: 0, s: WHOLE, from: null, to: state.owner[rules.rootGoal] ?? null }];
  let holds: Hold[] = [];
  let lastStart = NONE;
  let lastEnd = NONE;

  const slotOf = (id: string): Slot => home[id] ?? { x: centre, y: 0 };
  const rowsOf = (pos: Record<string, Slot>, present: string[]): void => {
    for (const id of present) rows[id] = Math.round((pos[id]?.y ?? 0) / ROW);
  };
  for (const id of model.ids) {
    const at = slotOf(id);
    moves[id] = { t0: NONE, dur: 0, s: WHOLE, ax: at.x, ay: at.y, bx: at.x, by: at.y, grave: false };
    const parent = shape.parent[id] ?? null;
    const p = parent ? slotOf(parent) : at;
    anchors[id] = { t0: NONE, dur: 0, s: WHOLE, ax: p.x, ay: p.y, from: parent, to: parent, cut: false };
  }
  rowsOf(home, shape.present);

  const prog = (m: { t0: number; dur: number; s: readonly [number, number] }, now: number): number =>
    span(playhead((now - m.t0) / 1000, m.dur), m.s[0], m.s[1]);

  const posOf = (id: string, now: number): Slot => {
    const m = moves[id];
    if (!m) return slotOf(id);
    const g = prog(m, now);
    return { x: mix(m.ax, m.bx, g), y: mix(m.ay, m.by, g) };
  };

  /** Lays the tree out for a shape, centred where the first picture was centred. */
  const layoutOf = (next: Shape): Record<string, Slot> => {
    if (next.root === null) return {};
    const pos = layoutForest(next.present, next.parent, next.root);
    const at = Object.values(pos).map((s) => s.x);
    const shift = centre - (Math.min(...at) + Math.max(...at)) / 2;
    return Object.fromEntries(Object.entries(pos).map(([id, s]) => [id, { x: s.x + shift, y: s.y }]));
  };

  /** Sets every node whose place changes on its way, from where it is on screen now. */
  const relocate = (now: number, dur: number, s: readonly [number, number], target: Record<string, Slot>, grave: Record<string, Slot>): void => {
    for (const id of model.ids) {
      const m = moves[id] as Move;
      const goal = grave[id] ?? target[id];
      if (!goal) continue;
      if (Math.abs(goal.x - m.bx) < 1e-6 && Math.abs(goal.y - m.by) < 1e-6) continue;
      const here = posOf(id, now);
      moves[id] = { t0: now, dur, s, ax: here.x, ay: here.y, bx: goal.x, by: goal.y, grave: grave[id] !== undefined };
    }
  };

  /** Points every edge whose parent changes at its new parent, the parent end setting off from where it is on screen now. */
  const rewire = (now: number, dur: number, s: readonly [number, number], next: Shape, died: string | null): void => {
    for (const id of model.ids) {
      const a = anchors[id] as Anchor;
      const to = id === died ? null : (next.parent[id] ?? null);
      if (a.to === to) continue;
      const end = edgeEnd(id, now);
      anchors[id] = { t0: now, dur, s, ax: end.x, ay: end.y, from: a.to, to, cut: a.to !== null && a.to === died };
    }
  };

  const edgeEnd = (id: string, now: number): Slot => {
    const a = anchors[id] as Anchor;
    if (a.to === null) return { x: a.ax, y: a.ay };
    const g = prog(a, now);
    const to = posOf(a.to, now);
    return { x: mix(a.ax, to.x, g), y: mix(a.ay, to.y, g) };
  };

  const crownAt = (now: number): Map<string, number> => {
    const out = new Map<string, number>();
    for (const c of crowns) {
      const g = c.t0 === NONE ? 1 : prog(c, now);
      if (c.from !== null) out.set(c.from, (out.get(c.from) ?? 1) * (1 - g));
      if (c.to !== null) out.set(c.to, Math.max(out.get(c.to) ?? 0, g));
    }
    return out;
  };

  const nodes: NodeFrame[] = model.ids.map((id) => ({
    id,
    x: 0,
    y: 0,
    state: "alive",
    waiting: false,
    busy: model.node[id]?.kind === "agent",
    pulse: 0,
    pulseAmp: 0,
    missed: 0,
    flash: 0,
    stamp: 0,
    crown: 0,
    candidate: 0,
    heir: 0,
    score: null,
    buried: 0,
    opacity: 1,
    row: 0,
    appear: 1,
  }));
  const edges: EdgeFrame[] = model.ids.map((id) => ({ child: id, parent: null, row: 1, x1: 0, y1: 0, x2: 0, y2: 0, broken: 0, opacity: 0 }));
  const frame: TreeFrame = { p: 1, appear: 1, tMs: 0, hold: null, nodes, edges, dashes: [], killed: 0 };

  const frameAt = (now: number): TreeFrame => {
    holds = holds.filter((h) => now < h.t0 + h.dur * 1000 + 1);
    const crown = crownAt(now);
    const candidate = new Map<string, { value: number; score: number }>();
    const heirOf = new Map<string, number>();
    for (const h of holds) {
      const u = playhead((now - h.t0) / 1000, h.dur);
      const R = h.rounds.length;
      h.rounds.forEach((round, i) => {
        const v = span(u, lerp(PLAY.decide[0], PLAY.decide[1], i / R), lerp(PLAY.decide[0], PLAY.decide[1], (i + 1) / R));
        if (v <= 0 || v >= 1) return;
        const fade = 1 - span(v, 0.8, 1);
        const lit = span(v, 0, 0.25) * fade;
        for (const r of round.ranked) {
          const seen = candidate.get(r.member);
          if (!seen || lit > seen.value) candidate.set(r.member, { value: lit, score: r.fraction });
        }
        if (round.heir !== null) heirOf.set(round.heir, Math.max(heirOf.get(round.heir) ?? 0, span(v, 0.3, 0.5) * fade));
      });
    }

    nodes.forEach((n) => {
      const id = n.id;
      const at = posOf(id, now);
      n.x = at.x;
      n.y = at.y;
      n.row = rows[id] ?? 0;
      const move = moves[id] as Move;
      n.buried = move.grave ? prog(move, now) : 0;
      const died = diedAt[id];
      const back = revivedAt[id];
      let u = -1;
      let state: NodeState = "alive";
      if (died !== undefined && !(back !== undefined && back >= died)) {
        u = playhead((now - died) / 1000, duration);
        state = u < PLAY.suspect ? "silent" : u < PLAY.verdict ? "suspected" : "dead";
      } else if (back !== undefined && playhead((now - back) / 1000, resetSeconds) < 0.3 && diedAt[id] !== undefined) {
        state = "dead";
        u = 1;
      }
      n.state = state;
      n.missed = state === "alive" ? 0 : Math.round(DOTS * span(u, PLAY.notice[0], PLAY.notice[1]));
      n.flash = state === "alive" ? 0 : 1 - span(u, PLAY.flash[0], PLAY.flash[1]);
      n.stamp = state === "alive" ? 0 : span(u, PLAY.stamp[0], PLAY.stamp[1]);
      n.opacity = state === "alive" ? 1 : lerp(0.95, 0.7, n.buried);
      n.crown = crown.get(id) ?? 0;
      const c = candidate.get(id);
      n.candidate = c ? c.value : 0;
      n.score = c && c.value > 0 ? c.score : null;
      n.heir = heirOf.get(id) ?? 0;
    });

    edges.forEach((e, i) => {
      const id = e.child;
      const a = anchors[id] as Anchor;
      const g = prog(a, now);
      const here = nodes[i] as NodeFrame;
      const end = edgeEnd(id, now);
      e.x1 = end.x;
      e.y1 = end.y;
      e.x2 = here.x;
      e.y2 = here.y;
      e.row = Math.max(1, rows[id] ?? 1);
      e.parent = (a.to !== null && g >= 0.5 ? a.to : a.from) ?? null;
      e.broken = a.cut && now >= a.t0 && g < 0.5 ? 1 : 0;
      e.opacity = a.from !== null && a.to !== null ? 1 : a.from !== null ? 1 - g : a.to !== null ? g : 0;
    });

    frame.tMs = now;
    frame.killed = order.length;
    return frame;
  };

  const settle = (now: number): void => {
    lastEnd = Math.max(lastEnd, now);
  };

  return {
    model,
    tree: rules,
    alive: () => [...state.alive],
    crashed: () => [...order],
    holder: () => shape.root,
    kill(id, now) {
      const out = kill(rules, state, id);
      if (!out) return null;
      const before = state;
      state = out.after;
      shape = shapeOf(rules, state);
      diedAt[id] = now;
      order.push(id);
      holds.push({ t0: now, dur: duration, dead: id, rounds: out.rounds });
      lastStart = now;
      settle(now + duration * 1000);

      const target = layoutOf(shape);
      rowsOf(target, shape.present);
      relocate(now, duration, PLAY.glide, target, { [id]: graveSlot(order.length - 1) });
      rewire(now, duration, PLAY.rewire, shape, id);

      const was = before.owner[rules.rootGoal] ?? null;
      const will = shape.root;
      if (was !== will) crowns.push({ t0: now, dur: duration, s: PLAY.crown, from: was, to: will });
      return out;
    },
    reset(now) {
      state = initialState(rules);
      const was = shape.root;
      shape = shapeOf(rules, state);
      for (const id of order) revivedAt[id] = now;
      order.length = 0;
      holds = [];
      rowsOf(home, shape.present);
      relocate(now, resetSeconds, WHOLE, home, {});
      rewire(now, resetSeconds, WHOLE, shape, null);
      const will = state.owner[rules.rootGoal] ?? null;
      crowns = [...crowns, { t0: now, dur: resetSeconds, s: WHOLE, from: was, to: will }];
      lastStart = now;
      settle(now + resetSeconds * 1000);
    },
    at: frameAt,
    playing: (now) => now < lastEnd,
    place: (id, now) => posOf(id, now),
    progress: (now) => (lastStart === NONE || now >= lastEnd ? 1 : span(now, lastStart, lastEnd)),
  };
}
