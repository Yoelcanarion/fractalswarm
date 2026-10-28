// Deterministic tree layout and ownership colors for the fractal tree graph.

import type { ViewState } from "./reducer";

// Categorical slots, dark-surface steps (validated order; see the dataviz reference palette).
// Red is reserved for death and collisions, so it is not a series color here.
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#008300"];
export const ROOT_COLOR = "#e8e6df";

export interface Placed {
  id: string;
  depth: number;
  x: number;
  y: number;
}

export const LEVEL_GAP = 150;
export const NODE_WIDTH = 150; // keep in sync with .actor in styles.css
export const LEAF_WIDTH = 112; // .actor--leaf
const GAP = 22;

export const nodeWidth = (kind: string): number => (isLeafKind(kind) ? LEAF_WIDTH : NODE_WIDTH);

export function childrenOf(state: ViewState, parent: string | null): string[] {
  return state.order.filter((id) => state.actors[id].parent === parent);
}

/** Roots first (spawn order), each subtree given the width of its widest level, parents
 * centred over their children. ``x`` is the node's left edge. Pure: the same view always
 * gives the same layout. */
export function layoutTree(state: ViewState): Placed[] {
  const kids = new Map<string, string[]>();
  const width = new Map<string, number>();
  const seen = new Set<string>();

  const measure = (id: string): number => {
    seen.add(id);
    const children = childrenOf(state, id).filter((kid) => !seen.has(kid));
    kids.set(id, children);
    const own = nodeWidth(state.actors[id].kind) + GAP;
    const total = children.reduce((sum, kid) => sum + measure(kid), 0);
    width.set(id, Math.max(own, total));
    return width.get(id)!;
  };

  const placed: Placed[] = [];
  const place = (id: string, left: number, depth: number): void => {
    const span = width.get(id)!;
    const children = kids.get(id)!;
    const total = children.reduce((sum, kid) => sum + width.get(kid)!, 0);
    let cursor = left + (span - total) / 2;
    for (const kid of children) {
      place(kid, cursor, depth + 1);
      cursor += width.get(kid)!;
    }
    const center = left + span / 2;
    placed.push({ id, depth, x: center - nodeWidth(state.actors[id].kind) / 2, y: depth * LEVEL_GAP });
  };

  // An actor whose parent is unknown (or missing from the stream) is treated as a root.
  const roots = state.order.filter((id) => {
    const parent = state.actors[id].parent;
    return parent === null || !state.actors[parent];
  });
  let left = 0;
  for (const root of roots) {
    measure(root);
    place(root, left, 0);
    left += width.get(root)! + GAP * 2;
  }
  return placed.sort((a, b) => state.order.indexOf(a.id) - state.order.indexOf(b.id));
}

export const isLeafKind = (kind: string): boolean => kind === "agent" || kind === "worker";

/** The colour key of an actor: its level-1 ancestor in the *current* tree. So when a subtree
 * is adopted, it takes its new owner's colour. Roots are neutral. */
export function ownerOf(state: ViewState, id: string): string | null {
  let current = id;
  const guard = new Set<string>();
  while (!guard.has(current)) {
    guard.add(current);
    const parent = state.actors[current]?.parent ?? null;
    if (parent === null || !state.actors[parent]) return current === id ? null : current;
    if (state.actors[parent].parent === null || !state.actors[state.actors[parent].parent!]) {
      return current;
    }
    current = parent;
  }
  return null;
}

/** Colours are assigned to level-1 actors in spawn order and never change afterwards, so an
 * orchestrator keeps its colour however the tree is re-wired. */
export function colorOf(state: ViewState, id: string): string {
  const owner = ownerOf(state, id);
  if (owner === null) return ROOT_COLOR;
  const levelOne = state.order.filter((actor) => {
    const parent = state.actors[actor].originalParent;
    return parent !== null && state.actors[parent]?.originalParent === null;
  });
  const index = levelOne.indexOf(owner);
  return SERIES[(index < 0 ? state.order.indexOf(owner) : index) % SERIES.length];
}
