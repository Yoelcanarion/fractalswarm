// Everything the tree draws, read once from the story: who is in it, when each brain dies and is
// declared dead, who takes over, which messages cross it and when each node is busy. Nothing
// here is typed in: the layout is derived from the log's adoptions and the rest is lookups.

import type { AdoptionData, HrwRound, TreeSlice } from "../../data/types";
import { boundsOf, buildEpochs, burialTimes, memorialSlots, remapTimes, type Bounds, type Epoch, type Slot } from "./layout";

export interface NodeInfo {
  id: string;
  kind: "brain" | "agent";
  /** 0 root, 1 track, 2 session, 3 agent: what the node was born as. */
  level: number;
  role: string;
  label: string;
  /** Radius of a brain, half the side of an agent, in layout units. */
  size: number;
}

export interface KillInfo {
  id: string;
  i: number;
  atMs: number;
  suspectedAtMs: number;
  verdictAtMs: number;
  /** The brain whose detector wrote the verdict. */
  by: string;
  /** The last heartbeat the brain sent. */
  lastBeatMs: number;
  /** When its last duty was handed over and it left the tree. */
  buriedAt: number;
  heldRoot: boolean;
}

export interface RemapGroup {
  index: number;
  atMs: number;
  /** The epoch this remap opens. */
  epoch: number;
  rounds: HrwRound[];
  adoptions: AdoptionData[];
  dead: string[];
  /** Whether the root goal moved. */
  root: boolean;
}

export interface Msg {
  tMs: number;
  from: string;
  to: string;
  kind: 0 | 1 | 2 | 3;
}

export interface Beat {
  firstMs: number;
  lastMs: number;
  intervalMs: number;
}

export interface TreeModel {
  tree: TreeSlice;
  /** Render order: brains from the root down, then agents. */
  ids: string[];
  node: Record<string, NodeInfo>;
  epochs: Epoch[];
  memorial: Record<string, Slot>;
  bounds: Bounds;
  kills: KillInfo[];
  killOf: Record<string, KillInfo>;
  groups: RemapGroup[];
  messages: Msg[];
  beats: Record<string, Beat>;
  /** First time something was sent to the node: before it, it has nothing to do. */
  activeFromMs: Record<string, number>;
  /** Spans during which the node has an LLM call in flight. */
  busy: Record<string, [number, number][]>;
  detector: { intervalMs: number; suspectAfter: number; deadAfter: number };
  durationMs: number;
}

const SIZE = [0.5, 0.42, 0.34, 0.2] as const;

const cache = new WeakMap<TreeSlice, TreeModel>();

export function treeModel(tree: TreeSlice): TreeModel {
  const hit = cache.get(tree);
  if (hit) return hit;
  const model = build(tree);
  cache.set(tree, model);
  return model;
}

/** How far the spacing of a picture is drawn in at most, as a share of its own: any closer and a label meets the one beside it. */
const NARROWEST = 0.7;

/** How wide a picture is for each unit it is tall. */
const shapeOf = (b: Bounds): number => (b.x1 - b.x0) / (b.y1 - b.y0);

/** The model with its places moved: x about `mid` by `sx`, y by `sy`. The dead keep the step of their row, which is the width of their stamps. */
function reshaped(model: TreeModel, sx: number, sy: number, mid: number): TreeModel {
  const move = (s: Slot): Slot => ({ x: mid + (s.x - mid) * sx, y: s.y * sy });
  const epochs = model.epochs.map((e) => ({ ...e, pos: Object.fromEntries(Object.entries(e.pos).map(([id, s]) => [id, move(s)])) }));
  const memorial = Object.fromEntries(Object.entries(model.memorial).map(([id, s]) => [id, { x: s.x, y: s.y * sy }]));
  return { ...model, epochs, memorial, bounds: boundsOf(epochs, memorial) };
}

/**
 * Each epoch's picture reaches down to the deepest row of all. When the tracks die the survivors spread over the room they leave,
 * where otherwise they would hang above a hole over the row of the dead.
 */
function deepened(model: TreeModel): TreeModel {
  const reach = (e: Epoch): number => Math.max(0, ...e.present.map((id) => e.pos[id]?.y ?? 0));
  const deepest = Math.max(...model.epochs.map(reach));
  const epochs = model.epochs.map((e) => {
    const r = reach(e);
    if (r <= 0 || r >= deepest) return e;
    return { ...e, pos: Object.fromEntries(Object.entries(e.pos).map(([id, s]) => [id, { x: s.x, y: (s.y * deepest) / r }])) };
  });
  return { ...model, epochs };
}

/**
 * The same tree drawn to fill a figure of the shape `aspect` (width over height). A run's picture is a wide one, sixteen leaves
 * across and five rows down, and in a square column it leaves a third of the room empty and every glyph small. It is laid out
 * narrower (down to `NARROWEST` of its spacing), which the page draws larger, and what is still too wide is made taller; and each
 * epoch reaches the row of the dead (`deepened`). A picture already as narrow as `aspect` keeps its shape. The model it is made
 * from is shared by the film and the demo, and is not touched.
 */
export function fitted(model: TreeModel, aspect: number): TreeModel {
  const deep = deepened(model);
  return aspect > 0 && shapeOf(deep.bounds) > aspect ? narrowed(deep, aspect) : deep;
}

/** The picture drawn narrower, down to `NARROWEST`, and made taller if that is not enough, to the shape of `aspect`. */
function narrowed(model: TreeModel, aspect: number): TreeModel {
  const xs = model.epochs.flatMap((e) => e.present.map((id) => e.pos[id]?.x ?? 0));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (!(hi > lo)) return model;
  const all = [...xs, ...Object.values(model.memorial).map((s) => s.x)];
  const sides = model.bounds.x1 - model.bounds.x0 - (Math.max(...all) - Math.min(...all));
  const wanted = (model.bounds.y1 - model.bounds.y0) * aspect - sides;
  const mid = (lo + hi) / 2;
  const narrow = reshaped(model, Math.min(1, Math.max(NARROWEST, wanted / (hi - lo))), 1, mid);
  const b = narrow.bounds;
  if (shapeOf(b) <= aspect + 1e-9) return narrow;

  const rows = Math.max(...narrow.epochs.flatMap((e) => Object.values(e.pos).map((s) => s.y)), ...Object.values(narrow.memorial).map((s) => s.y));
  return reshaped(narrow, 1, ((b.x1 - b.x0) / aspect - (b.y1 - b.y0 - rows)) / rows, mid);
}

function build(tree: TreeSlice): TreeModel {
  const node: Record<string, NodeInfo> = {};
  for (const n of tree.nodes) {
    node[n.id] = {
      id: n.id,
      kind: n.kind,
      level: n.level,
      role: n.role,
      label: n.label,
      size: SIZE[Math.min(n.level, 3)] ?? 0.2,
    };
  }
  const ids = tree.nodes.map((n) => n.id);

  const epochs = buildEpochs(tree);
  const memorial = memorialSlots(tree, epochs);
  const buried = burialTimes(tree);

  const interval = tree.heartbeat.intervalMs;
  const beats: Record<string, Beat> = {};
  for (const [id, s] of Object.entries(tree.heartbeat.senders)) {
    beats[id] = { firstMs: s.firstMs, lastMs: s.lastMs, intervalMs: s.ticks > 1 ? (s.lastMs - s.firstMs) / (s.ticks - 1) : interval };
  }

  const kills: KillInfo[] = tree.kills.map((k, i) => ({
    id: k.target,
    i,
    atMs: k.atMs,
    suspectedAtMs: k.suspectedAtMs ?? k.atMs,
    verdictAtMs: k.verdict?.atMs ?? k.atMs,
    by: k.verdict?.by ?? "",
    lastBeatMs: beats[k.target]?.lastMs ?? k.atMs,
    buriedAt: buried[k.target] ?? k.atMs,
    heldRoot: k.heldRoot,
  }));
  const killOf = Object.fromEntries(kills.map((k) => [k.id, k]));

  const groups: RemapGroup[] = remapTimes(tree).map((atMs, index) => {
    const adoptions = tree.adoptions.filter((a) => a.atMs === atMs);
    return {
      index,
      atMs,
      epoch: index + 1,
      adoptions,
      rounds: tree.rounds.filter((r) => r.atMs === atMs),
      dead: [...new Set(adoptions.map((a) => a.dead))],
      root: adoptions.some((a) => a.goal === "root"),
    };
  });

  const messages: Msg[] = tree.messages.map(([tMs, from, to, kind]) => ({ tMs, from, to, kind: kind as Msg["kind"] }));
  const activeFromMs: Record<string, number> = { [tree.root]: 0 };
  for (const m of messages) {
    if (m.kind <= 1 && activeFromMs[m.to] === undefined) activeFromMs[m.to] = m.tMs;
  }

  const busy: Record<string, [number, number][]> = tree.busy;

  return {
    tree,
    ids,
    node,
    epochs,
    memorial,
    bounds: boundsOf(epochs, memorial),
    kills,
    killOf,
    groups,
    messages,
    beats,
    activeFromMs,
    busy,
    detector: { intervalMs: interval, suspectAfter: tree.heartbeat.suspectAfter, deadAfter: tree.heartbeat.deadAfter },
    durationMs: tree.durationMs,
  };
}

/** Whether the node has an LLM call in flight at ``tMs``. */
export function isBusy(model: TreeModel, id: string, tMs: number): boolean {
  const spans = model.busy[id];
  if (!spans) return false;
  for (const [a, b] of spans) {
    if (tMs >= a && tMs < b) return true;
  }
  return false;
}
