// Deterministic tree layout and ownership colors for the fractal tree graph.

import { rootHolder, type ViewState } from "./reducer";

// Ownership palette: ten colour-blind-safe hues defined once in styles/tokens.css (--own-1 to
// --own-10, stepped separately for the dark and the light theme). Red is reserved for death and
// collisions, so it is not one of them.
export const OWNERSHIP_SLOTS = 10;
export const SERIES = Array.from({ length: OWNERSHIP_SLOTS }, (_, i) => `var(--own-${i + 1})`);
export const ROOT_COLOR = "var(--own-root)";

export interface Placed {
  id: string;
  depth: number;
  x: number;
  y: number;
  /** What it hangs from in the picture: the nearest ancestor still standing in the tree (see ``forestOf``), or null for a root and for the fallen. */
  parent: string | null;
  /** A dead brain that handed over everything it held: it has left the tree for the row of the fallen under it. */
  fallen: boolean;
  /** The box of the card as it is drawn (the camera frames these): the layout's own, which the card's size in styles.css has to match. */
  width: number;
  height: number;
}

// A card is its id and, where it applies, one short line. Keep the three widths in sync with .actor in styles.css. The whole tree has to
// fit a page with its labels at a size a person can read, so the cards are small and the camera (components/useTreeMotion.ts) zooms in.
export const LEVEL_GAP = 80;
export const NODE_WIDTH = 100;
export const LEAF_WIDTH = 84; // .actor--leaf
export const FALLEN_WIDTH = 76; // .actor--fallen
const GAP = 16;

export const nodeWidth = (kind: string): number => (isLeafKind(kind) ? LEAF_WIDTH : NODE_WIDTH);
/** The width a card has where it is drawn: the fallen are narrower than the brains still standing. */
export const placedWidth = (_state: ViewState, placed: Placed): number => placed.width;

/** The tree turned on its side, for a phone: the levels are columns and the siblings are stacked, so the whole of it is drawn at a scale of one,
 * in screen pixels, and its ids are as large as the type scale's floor. A row of a dozen agents is wider than the screen at any size a person can
 * read, and a column of them is only taller (the page scrolls). Keep the widths in sync with `.actor--across` in styles.css. */
export const ACROSS = {
  node: 54,
  leaf: 62,
  fallen: 58,
  height: 27,
  /** between the cards of a column, and between two columns (where the lines run) */
  gap: 4,
  level: 12,
  /** the camera's margin round the tree, in pixels */
  pad: 8,
} as const;

// Roughly the height of a card; the camera only needs the extent of the tree to within a few
// pixels, and fits it with padding.
export const NODE_HEIGHT = 44;

// The blackboard, the chaos network and the chaos monkey are actors of the run, not of its
// orchestrator tree. Laid out as roots they sit far to either side and shrink the tree to fit.
export const INFRA_KINDS: ReadonlySet<string> = new Set(["board", "net", "chaos"]);
export const isInfraKind = (kind: string): boolean => INFRA_KINDS.has(kind);

export function childrenOf(state: ViewState, parent: string | null): string[] {
  return state.order.filter((id) => state.actors[id].parent === parent);
}

export interface Forest {
  /** The dead brains that have nothing left to hand over, in the order they died. */
  fallen: string[];
  /** Every actor of the tree and what it hangs from: the nearest ancestor that has not fallen, or null. */
  parent: Map<string, string | null>;
}

/** The tree as it is drawn. A brain that has died stays where it was, with its children hanging from it, for as long as it still holds
 * something (the log's ownership says so, until a takeover moves the last key): that is the picture of a death. When its last duty is
 * handed over it leaves for the row of the fallen, and what hung from it hangs from whoever took it over; so after the root has died
 * three times the tree is not three rows deeper, and its root is the brain that holds the root duty. A run that logs no ownership
 * (a baseline) has nothing to hand over: its dead stay where they fell. Pure: the same view always gives the same picture. */
export function forestOf(state: ViewState): Forest {
  const known = forests.get(state);
  if (known) return known;
  const forest = buildForest(state);
  forests.set(state, forest);
  return forest;
}

const forests = new WeakMap<ViewState, Forest>();

function buildForest(state: ViewState): Forest {
  const holders = new Set(Object.values(state.ownership));
  // A real log names no owner of the root key before its first takeover: until then the root actor holds it.
  const root = rootHolder(state);
  const inTree = state.order.filter((id) => !isInfraKind(state.actors[id].kind));
  const fallen = (id: string): boolean => {
    const actor = state.actors[id];
    return holders.size > 0 && !isLeafKind(actor.kind) && (actor.status === "killed" || actor.status === "dead") && !holders.has(id) && id !== root;
  };
  const gone = inTree.filter(fallen);
  const down = new Set(gone);
  const parent = new Map<string, string | null>();
  for (const id of inTree) {
    if (down.has(id)) {
      parent.set(id, null);
      continue;
    }
    let up = state.actors[id].parent;
    for (const seen = new Set<string>(); up !== null && state.actors[up] !== undefined && down.has(up) && !seen.has(up); ) {
      seen.add(up);
      up = state.actors[up].parent;
    }
    parent.set(id, up !== null && state.actors[up] !== undefined && !isInfraKind(state.actors[up].kind) ? up : null);
  }
  const diedAt = (id: string): number => state.actors[id].statusSeq ?? state.actors[id].spawnedSeq;
  gone.sort((a, b) => diedAt(a) - diedAt(b) || state.order.indexOf(a) - state.order.indexOf(b));
  return { fallen: gone, parent };
}

/** Roots first (spawn order), each subtree given the width of its widest level, parents
 * centred over their children. ``x`` is the node's left edge. The fallen (``forestOf``) are a row of their own under the tree, in
 * the order they died, centred under it. ``across`` turns it on its side (``ACROSS``): the levels are columns left to right, the fallen the
 * last of them, and the same things are centred on each other. Pure: the same view always gives the same layout. */
export function layoutTree(state: ViewState, across = false): Placed[] {
  const forest = forestOf(state);
  const down = new Set(forest.fallen);
  const standing = state.order.filter((id) => forest.parent.has(id) && !down.has(id));
  const kids = new Map<string, string[]>();
  const width = new Map<string, number>(); // along the line the siblings are spaced on: a row, or across, a column
  const seen = new Set<string>();
  const widest: number[] = []; // across: how wide the cards of each level are, which is how far apart the columns are

  const box = (kind: string): { w: number; h: number } =>
    across ? { w: isLeafKind(kind) ? ACROSS.leaf : ACROSS.node, h: ACROSS.height } : { w: nodeWidth(kind), h: NODE_HEIGHT };
  const column = (depth: number): number => widest.slice(0, depth).reduce((left, w) => left + w + ACROSS.level, 0);

  const measure = (id: string, depth: number): number => {
    seen.add(id);
    const children = standing.filter((kid) => forest.parent.get(kid) === id && !seen.has(kid));
    kids.set(id, children);
    const { w, h } = box(state.actors[id].kind);
    widest[depth] = Math.max(widest[depth] ?? 0, w);
    const own = across ? h + ACROSS.gap : w + GAP;
    const total = children.reduce((sum, kid) => sum + measure(kid, depth + 1), 0);
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
    const { w, h } = box(state.actors[id].kind);
    const parent = forest.parent.get(id) ?? null;
    placed.push(
      across
        ? { id, depth, x: column(depth), y: center - h / 2, parent, fallen: false, width: w, height: h }
        : { id, depth, x: center - w / 2, y: depth * LEVEL_GAP, parent, fallen: false, width: w, height: h },
    );
  };

  // An actor whose parent is unknown (or missing from the stream) is treated as a root. Every root is measured before any is placed: the
  // columns of a tree on its side are as wide as the widest card of their level in all of them.
  const roots = standing.filter((id) => forest.parent.get(id) === null);
  for (const root of roots) measure(root, 0);
  let left = 0;
  for (const root of roots) {
    place(root, left, 0);
    left += width.get(root)! + (across ? ACROSS.gap : GAP) * 2;
  }

  // The fallen, one level under the deepest, centred on what stands: a row under it, or across, a column after it.
  if (forest.fallen.length > 0) {
    const depth = placed.reduce((deepest, p) => Math.max(deepest, p.depth + 1), 0);
    const { w, h } = across ? { w: ACROSS.fallen, h: ACROSS.height } : { w: FALLEN_WIDTH, h: NODE_HEIGHT };
    const gap = across ? ACROSS.gap : GAP;
    const along = across ? h : w;
    const run = forest.fallen.length * (along + gap) - gap;
    const [from, to] = across ? [(p: Placed) => p.y, (p: Placed) => p.y + p.height] : [(p: Placed) => p.x, (p: Placed) => p.x + p.width];
    const middle = placed.length === 0 ? 0 : (Math.min(...placed.map(from)) + Math.max(...placed.map(to))) / 2;
    let cursor = middle - run / 2;
    for (const id of forest.fallen) {
      placed.push(
        across
          ? { id, depth, x: column(depth), y: cursor, parent: null, fallen: true, width: w, height: h }
          : { id, depth, x: cursor, y: depth * LEVEL_GAP, parent: null, fallen: true, width: w, height: h },
      );
      cursor += along + gap;
    }
  }
  return placed.sort((a, b) => state.order.indexOf(a.id) - state.order.indexOf(b.id));
}

export const isLeafKind = (kind: string): boolean => kind === "agent" || kind === "worker";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box that holds every placed node, or null for an empty tree. */
export function boundsOf(_state: ViewState, placed: Placed[]): Bounds | null {
  if (placed.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of placed) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x + p.width);
    bottom = Math.max(bottom, p.y + p.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** What the camera should re-fit on: which nodes exist, who each hangs from and who has fallen. Statuses, calls
 * and messages are not part of it, and neither is where the layout puts a node, so a node dying
 * or siblings re-centring does not move the camera, while a node arriving, leaving, being
 * adopted or falling does. */
export function structureKey(_state: ViewState, placed: Placed[]): string {
  return placed.map(({ id, parent, fallen }) => `${id}>${parent ?? ""}${fallen ? "!" : ""}`).join("|");
}

/** The colour key of an actor: its level-1 ancestor in the *current* tree (the one drawn, ``forestOf``). So when a subtree
 * is adopted, it takes its new owner's colour. Roots are neutral. */
export function ownerOf(state: ViewState, id: string): string | null {
  // the tree as drawn: a root that died and handed over is not the root of what it handed over
  const up = (actor: string): string | null => forestOf(state).parent.get(actor) ?? null;
  let current = id;
  const guard = new Set<string>();
  while (!guard.has(current)) {
    guard.add(current);
    const parent = up(current);
    if (parent === null) return current === id ? null : current;
    if (up(parent) === null) return current;
    current = parent;
  }
  return null;
}

/** Colours are assigned to level-1 actors in spawn order and never change afterwards, so an
 * orchestrator keeps its colour however the tree is re-wired. A brain that moved up to level 1 because its parent took the
 * root keeps the colour of the subtree it came from. */
export function colorOf(state: ViewState, id: string): string {
  const owner = ownerOf(state, id);
  if (owner === null) return ROOT_COLOR;
  const levelOne = state.order.filter((actor) => {
    const parent = state.actors[actor].originalParent;
    return parent !== null && state.actors[parent]?.originalParent === null;
  });
  let first = owner;
  for (const seen = new Set<string>(); !levelOne.includes(first) && !seen.has(first); ) {
    seen.add(first);
    first = state.actors[first]?.originalParent ?? first;
  }
  const index = levelOne.indexOf(first);
  return SERIES[(index < 0 ? state.order.indexOf(owner) : index) % SERIES.length];
}
