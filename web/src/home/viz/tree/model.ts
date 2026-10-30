// Everything the tree draws, read once from the story: who is in it, when each brain dies and is
// declared dead, who takes over, which messages cross it and when each node is busy. Nothing
// here is typed in: the layout is derived from the log's adoptions and the rest is lookups.

import type { AdoptionData, HrwRound, Story } from "../../data/types";
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
  story: Story;
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

const cache = new WeakMap<Story, TreeModel>();

export function treeModel(story: Story): TreeModel {
  const hit = cache.get(story);
  if (hit) return hit;
  const model = build(story);
  cache.set(story, model);
  return model;
}

function build(story: Story): TreeModel {
  const { tree, takeover, traffic } = story;
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

  const epochs = buildEpochs(story);
  const memorial = memorialSlots(story, epochs);
  const buried = burialTimes(story);

  const interval = traffic.heartbeat.intervalMs;
  const beats: Record<string, Beat> = {};
  for (const [id, s] of Object.entries(traffic.heartbeat.senders)) {
    beats[id] = { firstMs: s.firstMs, lastMs: s.lastMs, intervalMs: s.ticks > 1 ? (s.lastMs - s.firstMs) / (s.ticks - 1) : interval };
  }

  const kills: KillInfo[] = takeover.kills.map((k, i) => ({
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

  const groups: RemapGroup[] = remapTimes(story).map((atMs, index) => {
    const adoptions = takeover.adoptions.filter((a) => a.atMs === atMs);
    return {
      index,
      atMs,
      epoch: index + 1,
      adoptions,
      rounds: story.hrw.rounds.filter((r) => r.atMs === atMs),
      dead: [...new Set(adoptions.map((a) => a.dead))],
      root: adoptions.some((a) => a.goal === "root"),
    };
  });

  const messages: Msg[] = traffic.messages.map(([tMs, from, to, kind]) => ({ tMs, from, to, kind: kind as Msg["kind"] }));
  const activeFromMs: Record<string, number> = { [tree.root]: 0 };
  for (const m of messages) {
    if (m.kind <= 1 && activeFromMs[m.to] === undefined) activeFromMs[m.to] = m.tMs;
  }

  const lanes = story.lanes.swarm;
  const busy: Record<string, [number, number][]> = {};
  for (const [lane, start, end] of lanes.bars) {
    const id = lanes.lanes[lane]?.id;
    if (id === undefined) continue;
    (busy[id] ??= []).push([start, end]);
  }

  return {
    story,
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
    detector: { intervalMs: interval, suspectAfter: traffic.heartbeat.suspectAfter, deadAfter: traffic.heartbeat.deadAfter },
    durationMs: takeover.durationMs,
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
