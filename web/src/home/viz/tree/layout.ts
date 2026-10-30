// The tree as it stands after each takeover, and where every node sits in it.
//
// The effective tree follows the log: at each ``tree.adopted`` the adopter becomes the parent of the
// dead brain's children, and when the adopted goal is the root the adopter becomes the root. A
// brain that has died but has not been adopted from yet stays in the picture, an ember in its
// place, until its last duty is handed over; then it leaves for the memorial row.

import type { Story } from "../../data/types";
import { naturalCompare } from "../shared";

export interface Slot {
  x: number;
  y: number;
}

export interface Epoch {
  index: number;
  /** The run time at which this layout begins: 0, then each remap. */
  startMs: number;
  /** Who holds the root goal. */
  root: string;
  /** Effective parent of each node in the picture (null: the root, or a dead brain with orphans left). */
  parent: Record<string, string | null>;
  /** Nodes in the picture: the live ones, and the dead ones nobody has adopted from yet. */
  present: string[];
  pos: Record<string, Slot>;
}

/** Vertical distance between two depths, in layout units (one unit = the distance between two leaves). */
export const ROW = 2.1;
export const LEAF = 1;

/** The run time at which each dead brain's last duty is handed over (it leaves the tree then). */
export function burialTimes(story: Story): Record<string, number> {
  const buried: Record<string, number> = {};
  for (const a of story.takeover.adoptions) buried[a.dead] = Math.max(buried[a.dead] ?? 0, a.atMs);
  return buried;
}

/** The distinct times at which a takeover re-owns something, in order. */
export function remapTimes(story: Story): number[] {
  return [...new Set(story.takeover.adoptions.map((a) => a.atMs))].sort((a, b) => a - b);
}

export function buildEpochs(story: Story): Epoch[] {
  const ids = story.tree.nodes.map((n) => n.id);
  const buriedAt = burialTimes(story);
  const adoptions = [...story.takeover.adoptions].sort((a, b) => a.seq - b.seq);
  const parent: Record<string, string | null> = Object.fromEntries(story.tree.nodes.map((n) => [n.id, n.parent]));
  let root = story.tree.root;
  const epochs: Epoch[] = [];

  const snapshot = (startMs: number): Epoch => {
    const present = ids.filter((id) => (buriedAt[id] ?? Infinity) > startMs);
    const here = new Set(present);
    const effective: Record<string, string | null> = {};
    for (const id of present) {
      const p = parent[id];
      effective[id] = p !== null && p !== undefined && here.has(p) ? p : null;
    }
    return { index: epochs.length, startMs, root, parent: effective, present, pos: layoutForest(present, effective, root) };
  };

  epochs.push(snapshot(0));
  for (const at of remapTimes(story)) {
    for (const a of adoptions.filter((x) => x.atMs === at)) {
      for (const child of a.children) parent[child] = a.adopter;
      if (a.goal === "root") {
        root = a.adopter;
        parent[a.adopter] = null;
      }
    }
    epochs.push(snapshot(at));
  }
  centre(epochs);
  return epochs;
}

function layoutForest(present: string[], parent: Record<string, string | null>, root: string): Record<string, Slot> {
  const kids = new Map<string, string[]>();
  for (const id of present) {
    const p = parent[id];
    if (p) kids.set(p, [...(kids.get(p) ?? []), id]);
  }
  for (const list of kids.values()) list.sort(naturalCompare);

  const height = (id: string): number => Math.max(-1, ...(kids.get(id) ?? []).map(height)) + 1;
  const pos: Record<string, Slot> = {};
  let cursor = 0;

  const place = (id: string, depth: number): number => {
    const list = kids.get(id) ?? [];
    let x: number;
    if (list.length === 0) {
      x = cursor;
      cursor += LEAF;
    } else {
      const xs = list.map((child, i) => {
        const cx = place(child, depth + 1);
        // Subtrees breathe in proportion to how much hangs from them.
        if (i < list.length - 1) cursor += 0.45 * height(child);
        return cx;
      });
      x = ((xs[0] ?? 0) + (xs[xs.length - 1] ?? 0)) / 2;
    }
    pos[id] = { x, y: depth * ROW };
    return x;
  };

  const roots = [root, ...present.filter((id) => id !== root && parent[id] === null).sort(naturalCompare)];
  roots.forEach((id, i) => {
    // A dead brain that still has orphans hangs at the first row below the root, to the side.
    place(id, i === 0 ? 0 : 1);
    cursor += 1.6;
  });
  return pos;
}

/** Centre each epoch's picture in the widest one, so a takeover moves things, not the page. */
function centre(epochs: Epoch[]): void {
  const extent = (e: Epoch): [number, number] => {
    const xs = e.present.map((id) => e.pos[id]?.x ?? 0);
    return [Math.min(...xs), Math.max(...xs)];
  };
  const widest = Math.max(...epochs.map((e) => extent(e)[1] - extent(e)[0]));
  for (const e of epochs) {
    const [lo, hi] = extent(e);
    const shift = (widest - (hi - lo)) / 2 - lo;
    for (const id of e.present) {
      const slot = e.pos[id];
      if (slot) slot.x += shift;
    }
  }
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The memorial row: where the dead go, in the order they leave the tree, centred under it. */
export function memorialSlots(story: Story, epochs: Epoch[]): Record<string, Slot> {
  const buried = burialTimes(story);
  const order = Object.keys(buried).sort((a, b) => (buried[a] ?? 0) - (buried[b] ?? 0) || naturalCompare(a, b));
  const depth = Math.max(...epochs.flatMap((e) => e.present.map((id) => (e.pos[id]?.y ?? 0) / ROW)));
  const width = Math.max(...epochs.flatMap((e) => e.present.map((id) => e.pos[id]?.x ?? 0)));
  const step = 1.5;
  const first = width / 2 - ((order.length - 1) * step) / 2;
  return Object.fromEntries(order.map((id, i) => [id, { x: first + i * step, y: (depth + 1) * ROW + 0.5 }]));
}

export function boundsOf(epochs: Epoch[], memorial: Record<string, Slot>): Bounds {
  const slots = [...epochs.flatMap((e) => e.present.map((id) => e.pos[id])), ...Object.values(memorial)].filter(
    (s): s is Slot => s !== undefined,
  );
  const margin = 0.9;
  return {
    x0: Math.min(...slots.map((s) => s.x)) - margin,
    x1: Math.max(...slots.map((s) => s.x)) + margin,
    y0: Math.min(...slots.map((s) => s.y)) - margin - 0.3,
    y1: Math.max(...slots.map((s) => s.y)) + margin + 0.5,
  };
}
