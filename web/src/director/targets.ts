// What a scene can point at, and the CSS that finds it on the page. A scene names a thing ("the scoreboard", "the
// coordinator that crashed first", "the idle agent-seconds counter"); the director looks it up in the DOM each frame, so
// a highlight follows a node that glides and a camera lands on a panel wherever the layout put it.

import type { Stage } from "./script";

/** A named part of a stage. A selector may match several elements: the target is then all of them together. */
interface Region {
  stages: readonly Stage[];
  css: string;
}

const region = (stages: readonly Stage[], css: string): Region => ({ stages, css });
const ARENA = ["arena"] as const;
const RUN = ["run"] as const;

export const REGIONS = {
  // the arena: a column per side, and what is shared between them
  swarm: region(ARENA, ".side--swarm"),
  rival: region(ARENA, ".side--rival"),
  "swarm-head": region(ARENA, ".side--swarm .side__head"),
  "rival-head": region(ARENA, ".side--rival .side__head"),
  // the verdict chip of each side: the takeover chip, and the supervisor's recovery chip
  "swarm-proof": region(ARENA, ".side--swarm .side__chip"),
  "rival-proof": region(ARENA, ".side--rival .side__chip"),
  heads: region(ARENA, ".side__head"),
  "swarm-board": region(ARENA, ".side--swarm .side__board"),
  "rival-board": region(ARENA, ".side--rival .side__board"),
  boards: region(ARENA, ".side__board"),
  "swarm-status": region(ARENA, ".side--swarm .status"),
  "rival-status": region(ARENA, ".side--rival .status"),
  "swarm-work": region(ARENA, ".side--swarm .work"),
  "rival-work": region(ARENA, ".side--rival .work"),
  scoreboard: region(ARENA, ".score"),
  assumptions: region(ARENA, ".arena__assumptions"),
  // the run page
  // the nodes themselves, not the panel they sit in: a camera on it fills the frame with the tree
  tree: region(RUN, ".run__tree .react-flow__node"),
  schedule: region(RUN, ".run__grid"),
  meter: region(RUN, ".meter"),
  proof: region(RUN, ".runstrip__proof"),
  lens: region(RUN, ".lens"),
  // the call open in the lens at a glance: the card of the actor that made it, then the call's model, effort and purpose, down to the first fact it
  // published with the email it came from (the figures sit between); and the sentences of that email the fact rests on
  "lens-call": region(RUN, ".run__tree .actor--lens, .lens .call__head, .lens .facts > .fact:first-child"),
  "lens-sentence": region(RUN, ".lens .facts > .fact:first-child mark.evidence"),
  counters: region(RUN, ".counters"),
  feed: region(RUN, ".run__side"),
  // both have a replay scrubber, and each calls it something else
  timeline: region(["arena", "run"], ".tl, .timeline"),
  // "where it helps"
  outcome: region(["helps"], '[data-helps="outcome"]'),
  map: region(["helps"], '[data-helps="map"]'),
  table: region(["helps"], '[data-helps="table"]'),
  process: region(["helps"], '[data-helps="process"]'),
  // three rows of the regime map, each by its row id (axis:task): the restart the supervisor needs, the gate at T2, the fast external restart
  "restart-row": region(["helps"], '[data-helps="row:rival_restart_ms:t2_conference"]'),
  "gate-row": region(["helps"], '[data-helps="row:gate:t2_conference"]'),
  "fast-restart-row": region(["helps"], '[data-helps="row:rival_recovery_ms:t2_conference"]'),
  // the ablation
  headline: region(["ablation"], ".abl__head"),
  caveats: region(["ablation"], ".abl__caveats"),
  breakdown: region(["ablation"], ".abl__break"),
  notes: region(["ablation"], ".abl__notes"),
  // the title card
  card: region(["title"], ".dir__card"),
} as const satisfies Record<string, Region>;

export type RegionName = keyof typeof REGIONS;
export const REGION_NAMES = Object.keys(REGIONS) as RegionName[];

export const isRegion = (name: string): name is RegionName => Object.prototype.hasOwnProperty.call(REGIONS, name);

export const sides = ["left", "right"] as const;
export type Side = (typeof sides)[number];

export type Target =
  | { kind: "actor"; actor: string; side: Side | null; subtree: boolean }
  | { kind: "counter"; counter: string }
  | { kind: "region"; region: RegionName };

/** A value for a double-quoted attribute selector. */
export const attr = (value: string): string => `"${value.replace(/["\\]/g, "\\$&")}"`;

/** The side's column of the arena; the swarm is always on the left. */
export const SIDE_CSS: Record<Side, string> = { left: ".side--swarm", right: ".side--rival" };

/** The selectors that find a target. ``actors`` is the actor and, for a subtree, everyone under it, already resolved to ids. On the run page the root's
 * card carries its ROOT badge above its top edge, out of the card's own box: a ring takes it in, so that it does not cut the badge. */
export function selectorsOf(target: Target, actors: readonly string[] = []): string[] {
  switch (target.kind) {
    case "region":
      return [REGIONS[target.region].css];
    case "counter":
      return [`.metric[data-row=${attr(target.counter)}]`];
    case "actor":
      return actors.flatMap((id) =>
        target.side === null
          ? [`[data-actor=${attr(id)}]`, `.react-flow__node[data-id=${attr(id)}]`, `.react-flow__node[data-id=${attr(id)}] .actor__duty`]
          : [`${SIDE_CSS[target.side]} [data-actor=${attr(id)}]`],
      );
  }
}
