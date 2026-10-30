// The rules of the click demo, with no drawing in them: who owns which goal, who is alive, and what happens when a coordinator is
// crashed. It is the run's own rule run again in the browser (coord/hrw.py in ../hrw/rule.ts), so what a visitor sees is what the
// recorded run did: sim.test.ts crashes five coordinators in the order the run lost them and gets its seven rounds back, pool,
// scores and heir, and the re-wiring it logged.
//
// The model is the log's: every goal has an owner, and a node reports to the owner of its parent goal, so when an owner dies and its
// goals pass to heirs, whatever hung from it moves with them. The drawing lives in stage.ts.

import type { TreeSlice } from "../../data/types";
import { fractionOf, rank, remap, scoreHex } from "../hrw/rule";
import { naturalCompare } from "../shared";

export interface DemoTree {
  /** The goal that started with the root coordinator. */
  rootGoal: string;
  /** The coordinators, from the root down (the tree's own order), and the agents. */
  brains: string[];
  agents: string[];
  /** The goal a node was born with; an agent reports for its session's goal. */
  birthGoal: Record<string, string>;
  /** The goal whose owner a node reports to (none for the root goal). */
  upGoal: Record<string, string | null>;
  /** The parent of each goal. */
  parentGoal: Record<string, string | null>;
  /** Every goal, shallowest first, then by id. */
  goals: string[];
  /** The coordinator a coordinator was born under: its group, whose live members are its heirs. */
  group: Record<string, string | null>;
  initialOwner: Record<string, string>;
}

export function demoTree(tree: TreeSlice): DemoTree {
  const level: Record<string, number> = Object.fromEntries(tree.goals.map((g) => [g.id, g.level]));
  const goals = tree.goals.map((g) => g.id).sort((a, b) => (level[a] ?? 0) - (level[b] ?? 0) || naturalCompare(a, b));
  const parentGoal: Record<string, string | null> = Object.fromEntries(tree.goals.map((g) => [g.id, g.parent]));
  const brains = tree.nodes.filter((n) => n.kind === "brain").map((n) => n.id);
  const agents = tree.nodes.filter((n) => n.kind === "agent").map((n) => n.id);
  const birthGoal: Record<string, string> = {};
  for (const n of tree.nodes) if (n.kind === "brain" && n.goal) birthGoal[n.id] = n.goal;
  for (const n of tree.nodes) {
    const session = n.parent ? birthGoal[n.parent] : undefined;
    if (n.kind === "agent" && session) birthGoal[n.id] = session;
  }
  const upGoal: Record<string, string | null> = {};
  for (const n of tree.nodes) {
    const g = birthGoal[n.id];
    upGoal[n.id] = g === undefined ? null : n.kind === "agent" ? g : (parentGoal[g] ?? null);
  }
  const group: Record<string, string | null> = Object.fromEntries(tree.nodes.filter((n) => n.kind === "brain").map((n) => [n.id, n.parent]));
  return {
    rootGoal: tree.goals.find((g) => g.parent === null)?.id ?? "root",
    brains,
    agents,
    birthGoal,
    upGoal,
    parentGoal,
    goals,
    group,
    initialOwner: Object.fromEntries(tree.goals.map((g) => [g.id, g.owner])),
  };
}

export interface DemoState {
  /** The coordinators still running. Agents are not crashed in the demo: they work for whoever owns their session's goal. */
  alive: ReadonlySet<string>;
  owner: Readonly<Record<string, string>>;
}

export const initialState = (t: DemoTree): DemoState => ({ alive: new Set(t.brains), owner: t.initialOwner });

/** One goal that changed hands when a coordinator died. */
export interface Round {
  goal: string;
  previous: string;
  /** The live coordinators that could take the goal. */
  pool: string[];
  /** The pool, best score first, with each score as a share of the range (the length of a bar). */
  ranked: { member: string; score: string; fraction: number }[];
  /** None when nobody is left to take it. */
  heir: string | null;
}

export interface Outcome {
  dead: string;
  rounds: Round[];
  after: DemoState;
}

/** The live members of the dead coordinator's group (the coordinators born under the same parent); for the root, its children. */
function kin(t: DemoTree, dead: string, alive: ReadonlySet<string>): string[] {
  const group = t.group[dead];
  return [...alive].filter((m) => t.group[m] === (group ?? dead)).sort(naturalCompare);
}

/**
 * Who may take over from `dead`, as the run decides it: its kin, and for the root, which has no group, any coordinator that is
 * left when none of its children is. An empty answer means the whole group died.
 */
export function candidates(t: DemoTree, dead: string, alive: ReadonlySet<string>): string[] {
  const same = kin(t, dead, alive);
  return same.length > 0 || t.group[dead] ? same : [...alive].sort(naturalCompare);
}

/**
 * Crashes `dead`. Each goal it owned goes to the heir the rule picks among its kin, shallowest first, so a track hands over its
 * root duty before its own. Where all of the kin are gone (both sessions of a track, say) the run starts a new member; the demo does
 * not draw one, so the owner of the parent goal takes everything the dead one held, or, when the root itself falls with nobody
 * below it, the one coordinator the rule picks for the root.
 */
export function kill(t: DemoTree, s: DemoState, dead: string): Outcome | null {
  if (!s.alive.has(dead)) return null;
  const alive = new Set(s.alive);
  alive.delete(dead);
  const owner: Record<string, string> = { ...s.owner };
  const rounds: Round[] = [];
  let stand: string | null = null;
  for (const goal of t.goals.filter((g) => s.owner[g] === dead)) {
    let pool = kin(t, dead, alive);
    const fallback = pool.length === 0;
    if (fallback) {
      const up = t.parentGoal[goal];
      const holder = up ? owner[up] : undefined;
      if (stand !== null) pool = [stand];
      else pool = holder !== undefined && alive.has(holder) ? [holder] : [...alive].sort(naturalCompare);
    }
    if (pool.length === 0) {
      rounds.push({ goal, previous: dead, pool: [], ranked: [], heir: null });
      continue;
    }
    const up = t.parentGoal[goal];
    const siblings = up ? t.goals.filter((g) => t.parentGoal[g] === up) : [goal];
    const owners = Object.fromEntries(siblings.map((g) => [g, g === goal ? dead : (owner[g] ?? dead)]));
    const heir = remap(owners, pool)[goal] ?? null;
    if (heir !== null) owner[goal] = heir;
    if (fallback) stand = heir;
    const ranked = rank(goal, pool).map((member) => {
      const score = scoreHex(goal, member);
      return { member, score, fraction: fractionOf(score) };
    });
    rounds.push({ goal, previous: dead, pool, ranked, heir });
  }
  return { dead, rounds, after: { alive, owner } };
}

/** The tree the state draws: who reports to whom. */
export interface Shape {
  /** The coordinator that holds the root goal; null when none is left. */
  root: string | null;
  /** The coordinators alive, and every agent. */
  present: string[];
  parent: Record<string, string | null>;
}

export function shapeOf(t: DemoTree, s: DemoState): Shape {
  const present = [...t.brains.filter((b) => s.alive.has(b)), ...t.agents];
  const held = s.owner[t.rootGoal];
  const root = held !== undefined && s.alive.has(held) ? held : null;
  const parent: Record<string, string | null> = {};
  for (const id of present) {
    const up = t.upGoal[id];
    const p = up ? s.owner[up] : undefined;
    parent[id] = p !== undefined && p !== id && s.alive.has(p) ? p : null;
  }
  // A loop would hang a node from its own descendant; such a node is cut loose and drawn as a root of its own.
  for (const id of [...present].sort(naturalCompare)) {
    let at: string | null | undefined = id;
    for (let steps = 0; at && steps <= present.length; steps++) at = parent[at];
    if (at) parent[id] = null;
  }
  return { root, present, parent };
}

/** The nodes that have nobody to report to, apart from the root: orphans nobody could take in. */
export function strays(shape: Shape): string[] {
  return shape.present.filter((id) => id !== shape.root && shape.parent[id] === null);
}
