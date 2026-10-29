// The board: the arena's picture of one team, drawn compactly enough to read at half a screen.
// Coordinators are chips, agents are dots grouped under the coordinator they answer to, so the
// whole story is visible at a glance: when a coordinator dies, the dots under it go hollow and wait.
//
// W4's orchestrator tree (components/TreeGraph.tsx) stays the tool for reading one run closely. It is
// too big for this job: its cards are 112-150 px wide and the camera fits with 18% padding, which at
// half of 1920 px leaves text of about 4 px, and two React Flow instances do not keep up at 20x.
//
// Everything here is pure: the layout is a function of the run's view (the same view gives the same
// board), and the classifications read the actors the reducer folded, so the board is a projection
// of the log like every other view.

import type { OutageWindow } from "../lib/arena";
import { isInfraKind, isLeafKind } from "../lib/layout";
import type { ActorNode, ViewState } from "../lib/reducer";

export const CHIP_W = 78;
export const CHIP_H = 30;
export const DOT = 16;
export const PITCH = 22; // distance between the centres of two dots
export const COL_GAP = 18; // between two subtrees
export const ROW_GAP = 78; // between a coordinator's row and its sub-coordinators'
export const LEAF_TOP = 14; // between a chip and the team of agents under it
export const TEAM_PAD = 6; // around a team, inside its outline
export const LEAF_ROW_MAX = 6; // dots per row; more wrap into a second row

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardNode extends Box {
  id: string;
  leaf: boolean;
  /** The coordinator the node hangs from (a dot: the one it answers to); null for a root. */
  parent: string | null;
}

export interface BoardLayout {
  /** Parents before children, in the run's spawn order. */
  nodes: BoardNode[];
  /** Every coordinator with agents under it, and who they are. */
  teams: { owner: string; leaves: string[] }[];
  bounds: Box | null;
  /** Changes when a node arrives, leaves or is adopted; the camera re-fits on it and on nothing else. */
  structure: string;
}

const isDot = (view: ViewState, id: string): boolean => isLeafKind(view.actors[id].kind);

interface Children {
  coordinators: string[];
  leaves: string[];
}

function childrenIndex(view: ViewState): { roots: string[]; kids: Map<string, Children> } {
  const kids = new Map<string, Children>();
  const roots: string[] = [];
  for (const id of view.order) {
    const actor = view.actors[id];
    if (isInfraKind(actor.kind)) continue;
    const parent = actor.parent;
    if (parent === null || !view.actors[parent] || isInfraKind(view.actors[parent].kind)) {
      if (!isDot(view, id)) roots.push(id);
      continue;
    }
    const entry = kids.get(parent) ?? { coordinators: [], leaves: [] };
    (isDot(view, id) ? entry.leaves : entry.coordinators).push(id);
    kids.set(parent, entry);
  }
  return { roots, kids };
}

const columns = (leaves: number): number => Math.min(leaves, LEAF_ROW_MAX);
const rowsOf = (leaves: number): number => Math.ceil(leaves / LEAF_ROW_MAX);

/** The team's block: how wide and tall it is, dots and padding included. */
export const teamSize = (leaves: number): { w: number; h: number } =>
  leaves === 0 ? { w: 0, h: 0 } : { w: columns(leaves) * PITCH + 2 * TEAM_PAD, h: rowsOf(leaves) * PITCH + 2 * TEAM_PAD };

/** Where every coordinator and agent goes. Subtrees take the width they need, parents centre over
 * their children, a team of agents sits centred under its coordinator. */
export function layoutBoard(view: ViewState): BoardLayout {
  const { roots, kids } = childrenIndex(view);
  const width = new Map<string, number>();
  const nodes = new Map<string, BoardNode>();
  const teams: { owner: string; leaves: string[] }[] = [];
  const seen = new Set<string>();

  const measure = (id: string): number => {
    seen.add(id);
    const entry = kids.get(id) ?? { coordinators: [], leaves: [] };
    const subs = entry.coordinators.filter((child) => !seen.has(child)).reduce((sum, child) => sum + measure(child), 0);
    const own = Math.max(CHIP_W + COL_GAP, teamSize(entry.leaves.length).w + COL_GAP);
    width.set(id, Math.max(own, subs));
    return width.get(id)!;
  };

  const place = (id: string, left: number, depth: number): void => {
    const entry = kids.get(id) ?? { coordinators: [], leaves: [] };
    const span = width.get(id)!;
    const subs = entry.coordinators.filter((child) => width.has(child) && !nodes.has(child));
    const total = subs.reduce((sum, child) => sum + width.get(child)!, 0);
    const centre = left + span / 2;
    const y = depth * ROW_GAP;
    nodes.set(id, { id, leaf: false, parent: view.actors[id].parent, x: centre - CHIP_W / 2, y, w: CHIP_W, h: CHIP_H });

    let cursor = left + (span - total) / 2;
    for (const child of subs) {
      place(child, cursor, depth + 1);
      cursor += width.get(child)!;
    }

    const n = entry.leaves.length;
    if (n > 0) {
      teams.push({ owner: id, leaves: entry.leaves });
      const top = y + CHIP_H + LEAF_TOP + TEAM_PAD;
      entry.leaves.forEach((leaf, index) => {
        const row = Math.floor(index / LEAF_ROW_MAX);
        const inRow = Math.min(LEAF_ROW_MAX, n - row * LEAF_ROW_MAX);
        const col = index % LEAF_ROW_MAX;
        const x = centre - (inRow * PITCH) / 2 + col * PITCH + (PITCH - DOT) / 2;
        nodes.set(leaf, { id: leaf, leaf: true, parent: id, x, y: top + row * PITCH + (PITCH - DOT) / 2, w: DOT, h: DOT });
      });
    }
  };

  let left = 0;
  for (const root of roots) {
    if (seen.has(root)) continue;
    measure(root);
    place(root, left, 0);
    left += width.get(root)! + COL_GAP * 2;
  }

  // The first root stays on x = 0 however the tree grows around it, so a tree that gains children
  // spreads outward from its root instead of the root drifting to the middle of them.
  const first = roots.length > 0 ? nodes.get(roots[0]) : undefined;
  const anchor = first ? first.x + first.w / 2 : 0;
  const ordered = view.order.flatMap((id) => {
    const node = nodes.get(id);
    return node ? [{ ...node, x: node.x - anchor }] : [];
  });
  return {
    nodes: ordered,
    teams,
    bounds: boundsOfNodes(ordered),
    structure: ordered.map((n) => `${n.id}>${n.parent ?? ""}`).join("|"),
  };
}

export function boundsOfNodes(nodes: readonly Box[]): Box | null {
  if (nodes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const n of nodes) {
    left = Math.min(left, n.x);
    top = Math.min(top, n.y);
    right = Math.max(right, n.x + n.w);
    bottom = Math.max(bottom, n.y + n.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** `box` grown by ``pad`` on every side. */
export const pad = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by });

// ---- what a node is doing ----

export type ChipState = "up" | "suspected" | "restarting" | "down" | "finished";
export type DotState = "working" | "idle" | "waiting" | "down" | "finished";

export function chipState(actor: ActorNode): ChipState {
  switch (actor.status) {
    case "killed":
    case "dead":
      return "down";
    case "restarting":
      return "restarting";
    case "stopped":
      return "finished";
    default:
      return actor.suspected ? "suspected" : "up";
  }
}

// A coordinator that is really out: killed, or crashed and on its way back. One the detector declared
// dead with no kill (a false death) may still be working, so its agents are not waiting on it
// (the same rule as lib/arena.ts).
const isOut = (actor: ActorNode | undefined): boolean => actor !== undefined && (actor.status === "killed" || actor.status === "restarting");

/** The agents with a call in flight. */
export const busyAgents = (view: ViewState): Set<string> => new Set(Object.values(view.inflight).map((call) => call.actor));

/** What an agent is doing: working (a call in flight), idle, or waiting (idle, and the coordinator it
 * answers to is out). An agent that is out itself, or finished, is neither. */
export function dotState(view: ViewState, id: string, busy: ReadonlySet<string> = busyAgents(view)): DotState {
  const actor = view.actors[id];
  if (actor.status === "killed" || actor.status === "dead") return "down";
  if (actor.status === "stopped") return "finished";
  if (busy.has(id)) return "working";
  const owner = actor.parent === null ? undefined : view.actors[actor.parent];
  return isOut(owner) && owner !== undefined && !isLeafKind(owner.kind) ? "waiting" : "idle";
}

export interface OutageNow {
  coordinator: string;
  since: number;
  /** Agents still running that answer to it right now, and how many of those are idle. */
  agents: number;
  idle: number;
  /** Agents its crash stopped (an in-process supervisor takes its workers down with it). */
  stopped: number;
  /** A supervisor on its way back: how long the restart takes, from `baseline.crashed`. */
  restartInMs: number | null;
}

/** The agents of one coordinator: running, idle among them, and stopped by its crash. */
export function agentsOf(view: ViewState, coordinator: string): { agents: number; idle: number; stopped: number } {
  const busy = busyAgents(view);
  let agents = 0;
  let idle = 0;
  let stopped = 0;
  for (const id of view.order) {
    const actor = view.actors[id];
    if (actor.parent !== coordinator || !isLeafKind(actor.kind)) continue;
    if (actor.status === "killed" && actor.stopReason === "crash") {
      stopped += 1;
      continue;
    }
    if (actor.status === "killed" || actor.status === "dead" || actor.status === "stopped") continue;
    agents += 1;
    if (!busy.has(id)) idle += 1;
  }
  return { agents, idle, stopped };
}

/** What each outage in ``windows`` is costing at this moment of the view. */
export function outagesNow(view: ViewState, windows: readonly OutageWindow[]): OutageNow[] {
  return windows.map((w) => {
    const outage = view.actors[w.coordinator]?.outage;
    return { coordinator: w.coordinator, since: w.since, ...agentsOf(view, w.coordinator), restartInMs: outage ? outage.restartInMs : null };
  });
}

/** How many coordinators and agents are up right now (the actors of the run, not its infrastructure;
 * one that was killed, declared dead or is restarting is not counted). */
export function headcount(view: ViewState): { coordinators: number; agents: number } {
  let coordinators = 0;
  let agents = 0;
  for (const id of view.order) {
    const actor = view.actors[id];
    if (isInfraKind(actor.kind) || actor.status !== "alive") continue;
    if (isLeafKind(actor.kind)) agents += 1;
    else coordinators += 1;
  }
  return { coordinators, agents };
}
