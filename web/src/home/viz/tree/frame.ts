// One picture of the tree for one progress value. Pure: the same progress always gives the same
// frame, so a scroll position can be scrubbed back and forth. The component only copies a frame
// onto the SVG.

import type { TreeSlice } from "../../data/types";
import { clamp01, lerp, smoothstep, span } from "../shared";
import type { Epoch, Slot } from "./layout";
import { isBusy, treeModel, type Msg, type TreeModel } from "./model";
import { buildTimeline, treeKeyframes, type Cursor, type Keyframe, type Pacing, type Timeline } from "./timeline";

/** Where in a takeover's hold (0..1) each part of the choreography plays. */
export const CHOREO = {
  stamp: [0.0, 0.12],
  scores: [0.12, 0.42],
  heir: [0.38, 0.52],
  rewire: [0.5, 0.78],
  crown: [0.5, 0.8],
  glide: [0.55, 0.95],
} as const;

export type NodeState = "alive" | "silent" | "suspected" | "dead";

export interface NodeFrame {
  id: string;
  x: number;
  y: number;
  state: NodeState;
  /** The node has not been given anything to do yet. */
  waiting: boolean;
  /** An LLM call of the node is in flight. */
  busy: boolean;
  /** Phase (0..1) of the heartbeat ring, and how visible it is. */
  pulse: number;
  pulseAmp: number;
  /** Missed-heartbeat ticks shown around a dead brain (0..deadAfter). */
  missed: number;
  /** 1 at the moment of the kill, fading to 0. */
  flash: number;
  /** 0..1: the DEAD verdict stamped on the ember. */
  stamp: number;
  /** 0..1: holds the root goal. */
  crown: number;
  /** 0..1: in the pool of a takeover being decided. */
  candidate: number;
  /** 0..1: chosen heir. */
  heir: number;
  /** The HRW score of a candidate as a fraction of the range, once revealed. */
  score: number | null;
  /** 0..1: how far the node has gone from the tree to the memorial row. */
  buried: number;
  opacity: number;
  /** The row of the picture the node sits in (0 is the top one); the memorial row comes after the last. */
  row: number;
  /** 1 once the tree is fully drawn; below it while the tree grows from its root or folds back into it (the hero's loop). */
  appear: number;
}

export interface EdgeFrame {
  child: string;
  /** The brain the edge hangs from (the new parent once the re-wiring is half done). */
  parent: string | null;
  /** The row of the child, which is 1 or more: the root has no edge. */
  row: number;
  /** The parent end, which slides from the old parent to the new one in a takeover. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 0..1: the parent end is a dead brain. */
  broken: number;
  opacity: number;
}

export interface DashFrame {
  key: number;
  x: number;
  y: number;
  /** Degrees. */
  angle: number;
  opacity: number;
  kind: Msg["kind"];
}

export interface TreeFrame {
  p: number;
  /** See NodeFrame.appear. */
  appear: number;
  tMs: number;
  hold: Cursor["hold"];
  nodes: NodeFrame[];
  edges: EdgeFrame[];
  dashes: DashFrame[];
  /** Kills that have happened by now. */
  killed: number;
  /** How visible the memorial row's rule and label are at the least (0 when absent): the click demo shows its shelf from the start. */
  shelf?: number;
}

export interface TreePlayer {
  model: TreeModel;
  timeline: Timeline;
  keyframes: Keyframe[];
  /**
   * The tree at progress ``p``. ``appear`` (1 unless given) is how much of the tree is drawn: below 1 the rows fade in from
   * the root down, and out from the memorial row up (the hero shows the run again and again, and does not cut from the
   * wounded tree to the new one). It is a second axis, so the recorded run is the same frame at any ``appear`` of 1.
   */
  frame(p: number, appear?: number): TreeFrame;
}

/** How much of ``appear`` one row's fade takes; the rows start evenly spaced in the rest, so that the last one ends at 1. */
const ROW_SPAN = 0.4;

/** How drawn a row is (0..1) at ``appear``, for the ``levels`` rows of a picture (the memorial row counts as one). */
export function rowGate(row: number, levels: number, appear: number): number {
  if (appear >= 1) return 1;
  const start = levels > 1 ? (row * (1 - ROW_SPAN)) / (levels - 1) : 0;
  return smoothstep(span(appear, start, start + ROW_SPAN));
}

interface Rows {
  /** The row of each node in the picture of an epoch. */
  of: Record<string, number>;
  /** How many rows the picture has: the memorial row is this one. */
  count: number;
}

/** The rows of an epoch's picture: nodes at the same height are in the same row, counted from the top. */
function rowsOf(epoch: Epoch): Rows {
  const key = (id: string): number => Math.round((epoch.pos[id] as Slot).y * 1000);
  const heights = [...new Set(epoch.present.map(key))].sort((a, b) => a - b);
  return { of: Object.fromEntries(epoch.present.map((id) => [id, heights.indexOf(key(id))])), count: heights.length };
}

const players = new WeakMap<TreeSlice, Partial<Record<Pacing, TreePlayer>>>();

export function treePlayer(tree: TreeSlice, pacing: Pacing): TreePlayer {
  const cached = players.get(tree) ?? {};
  players.set(tree, cached);
  return (cached[pacing] ??= createPlayer(treeModel(tree), pacing));
}

/**
 * The point ``t`` of the way from ``a`` to ``b`` along the curve that joins two nodes (the one the
 * edges are drawn with: vertical at both ends), and the direction of travel in degrees.
 */
export function curvePoint(a: Slot, b: Slot, t: number): { x: number; y: number; angle: number } {
  const top = a.y <= b.y ? a : b;
  const low = top === a ? b : a;
  const u = top === a ? t : 1 - t;
  const v = 1 - u;
  const ym = (top.y + low.y) / 2;
  const x = (v * v * v + 3 * v * v * u) * top.x + (3 * v * u * u + u * u * u) * low.x;
  const y = v * v * v * top.y + 3 * v * v * u * ym + 3 * v * u * u * ym + u * u * u * low.y;
  const dx = 6 * v * u * (low.x - top.x);
  const dy = 3 * v * v * (ym - top.y) + 3 * u * u * (low.y - ym);
  const sign = top === a ? 1 : -1;
  return { x, y, angle: (Math.atan2(dy * sign, dx * sign) * 180) / Math.PI };
}

/** The SVG path of an edge: vertical tangents at both ends, like an org chart. */
export function edgePath(x1: number, y1: number, x2: number, y2: number, places = 3): string {
  const ym = (y1 + y2) / 2;
  const f = (n: number): string => n.toFixed(places);
  return `M${f(x1)} ${f(y1)}C${f(x1)} ${f(ym)} ${f(x2)} ${f(ym)} ${f(x2)} ${f(y2)}`;
}

function createPlayer(model: TreeModel, pacing: Pacing): TreePlayer {
  const timeline = buildTimeline(model, pacing);
  const { profile } = timeline;
  const pMessage = model.messages.map((m) => timeline.pOf(m.tMs, "start"));
  const pKill = Object.fromEntries(model.kills.map((k) => [k.id, timeline.pOf(k.atMs, "start")]));
  const pHoldEnd = model.groups.map((g) => timeline.pOf(g.atMs, "end"));
  const dashLife = timeline.perS(profile.dashS);
  const flashLife = timeline.perS(profile.flashS);
  const interval = (id: string): number => model.beats[id]?.intervalMs ?? model.detector.intervalMs;
  const epochRows = model.epochs.map(rowsOf);

  const frame = (p: number, appear = 1): TreeFrame => {
    const cur = timeline.at(p);
    const { tMs, hold } = cur;
    const group = hold ? model.groups[hold.group] : undefined;
    const c = hold?.c ?? 0;
    const done = hold ? hold.group : pHoldEnd.filter((end) => end <= cur.p).length;
    const last = model.epochs.length - 1;
    const epochA = model.epochs[Math.min(done, last)];
    const epochB = model.epochs[Math.min(hold ? done + 1 : done, last)];
    if (!epochA || !epochB) throw new Error("the tree has no epochs");
    const rows = epochRows[epochA.index] as Rows;
    const rowOf = (id: string): number => rows.of[id] ?? rows.count;
    const gateOf = (id: string): number => rowGate(rowOf(id), rows.count + 1, appear);

    const glide = hold ? smoothstep(span(c, CHOREO.glide[0], CHOREO.glide[1])) : 0;
    const rewire = hold ? smoothstep(span(c, CHOREO.rewire[0], CHOREO.rewire[1])) : 0;
    const crownMove = hold ? smoothstep(span(c, CHOREO.crown[0], CHOREO.crown[1])) : 0;
    const scoresIn = hold ? smoothstep(span(c, CHOREO.scores[0], CHOREO.scores[1])) : 0;
    const heirIn = hold ? smoothstep(span(c, CHOREO.heir[0], CHOREO.heir[1])) : 0;
    const stampIn = hold ? smoothstep(span(c, CHOREO.stamp[0], CHOREO.stamp[1])) : 0;

    const posOf = (id: string): Slot => {
      const a = epochA.pos[id];
      const b = epochB.pos[id];
      const m = model.memorial[id];
      if (a && b) return { x: lerp(a.x, b.x, glide), y: lerp(a.y, b.y, glide) };
      if (a && m) return { x: lerp(a.x, m.x, glide), y: lerp(a.y, m.y, glide) };
      return b ?? m ?? { x: 0, y: 0 };
    };
    const isDead = (id: string | null | undefined): boolean => {
      const k = id ? model.killOf[id] : undefined;
      return k !== undefined && tMs >= k.atMs;
    };

    const scoreOf = new Map<string, number>();
    const heirs = new Set<string>();
    for (const round of group?.rounds ?? []) {
      // A brain in the pools of two goals shows the first goal's score; the panels show both.
      for (const s of round.scores) if (!scoreOf.has(s.member)) scoreOf.set(s.member, s.fraction);
      if (round.heir) heirs.add(round.heir);
    }

    const nodes: NodeFrame[] = model.ids.map((id) => {
      const info = model.node[id];
      const slot = posOf(id);
      const kill = model.killOf[id];
      const dead = isDead(id);
      let state: NodeState = "alive";
      if (kill && dead) state = tMs < kill.suspectedAtMs ? "silent" : tMs < kill.verdictAtMs ? "suspected" : "dead";

      // The n-th missed beat falls one interval after the one before; the 3rd is the suspicion and
      // the 5th the verdict, both of which the log timestamps.
      let missed = 0;
      if (kill && dead) {
        const { suspectAfter, deadAfter, intervalMs } = model.detector;
        for (let n = 1; n <= deadAfter; n++) {
          const at = n <= suspectAfter ? kill.suspectedAtMs - (suspectAfter - n) * intervalMs : kill.verdictAtMs - (deadAfter - n) * intervalMs;
          if (tMs >= at) missed = n;
        }
      }
      const flash = kill && dead ? clamp01(1 - (cur.p - (pKill[id] ?? 0)) / flashLife) : 0;

      const beat = model.beats[id];
      const beatOnScreenS = cur.speed > 0 ? interval(id) / 1000 / cur.speed : Infinity;
      const pulseAmp = !dead && info?.kind === "brain" ? smoothstep(span(beatOnScreenS, 0.3, 0.7)) : 0;
      const pulse = beat && !dead ? ((((cur.tVirtualMs - beat.firstMs) / interval(id)) % 1) + 1) % 1 : 0;

      const wasRoot = epochA.root === id;
      const willBeRoot = epochB.root === id;
      const crown = wasRoot === willBeRoot ? (wasRoot ? 1 : 0) : wasRoot ? 1 - crownMove : crownMove;

      const buried = !epochA.pos[id] ? 1 : !epochB.pos[id] ? glide : 0;
      const candidate = scoreOf.has(id) ? scoresIn : 0;
      const drawn = gateOf(id);
      return {
        id,
        x: slot.x,
        y: slot.y,
        state,
        waiting: info?.kind === "agent" && tMs < (model.activeFromMs[id] ?? Infinity),
        busy: !dead && isBusy(model, id, tMs),
        pulse,
        pulseAmp,
        missed,
        flash,
        stamp: group?.dead.includes(id) ? stampIn : state === "dead" ? 1 : 0,
        crown,
        candidate,
        heir: heirs.has(id) ? heirIn : 0,
        score: candidate > 0 ? (scoreOf.get(id) ?? null) : null,
        buried,
        opacity: (dead ? lerp(0.95, 0.7, buried) : 1) * drawn,
        row: rowOf(id),
        appear: drawn,
      };
    });

    const edges: EdgeFrame[] = [];
    for (const id of model.ids) {
      if (!epochA.pos[id] && !epochB.pos[id]) continue;
      const pa = epochA.parent[id];
      const pb = epochB.parent[id];
      const from = pa ? posOf(pa) : null;
      const to = pb ? posOf(pb) : null;
      const here = posOf(id);
      // A node that is leaving for the memorial takes its edge with it.
      const own = epochA.pos[id] && !epochB.pos[id] ? 1 - glide : 1;
      let anchor: Slot;
      let opacity = 1;
      let broken = 0;
      if (from && to) {
        anchor = pa === pb ? from : { x: lerp(from.x, to.x, rewire), y: lerp(from.y, to.y, rewire) };
        broken = pa === pb ? (isDead(pa) ? 1 : 0) : lerp(isDead(pa) ? 1 : 0, isDead(pb) ? 1 : 0, rewire);
      } else if (from) {
        anchor = from;
        opacity = 1 - rewire;
        broken = isDead(pa) ? 1 : 0;
      } else if (to) {
        anchor = to;
        opacity = rewire;
      } else {
        continue;
      }
      const parent = (rewire >= 0.5 ? pb : pa) ?? null;
      edges.push({ child: id, parent, row: rowOf(id), x1: anchor.x, y1: anchor.y, x2: here.x, y2: here.y, broken, opacity: opacity * own * gateOf(id) });
    }

    // A message still on its way when the run ends fades with the last of it, so the settled tree holds none in mid-air.
    const settle = 1 - smoothstep(span(cur.p, 1 - dashLife / 2, 1));
    const dashes: DashFrame[] = [];
    model.messages.forEach((m, i) => {
      const f = (cur.p - (pMessage[i] ?? 0)) / dashLife;
      if (appear < 1 || f < 0 || f > 1) return;
      const a = posOf(m.from);
      const b = posOf(m.to);
      if (a.x === b.x && a.y === b.y) return;
      const at = curvePoint(a, b, f);
      dashes.push({
        key: i,
        x: at.x,
        y: at.y,
        angle: at.angle,
        opacity: smoothstep(span(f, 0, 0.12)) * (1 - smoothstep(span(f, 0.8, 1))) * settle,
        kind: m.kind,
      });
    });

    return { p: cur.p, appear, tMs, hold, nodes, edges, dashes, killed: model.kills.filter((k) => tMs >= k.atMs).length };
  };

  return { model, timeline, keyframes: treeKeyframes(model, timeline), frame };
}
