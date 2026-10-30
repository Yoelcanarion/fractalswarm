// The moments of each visual's story as progress values, for the page to line its text up with.
// Read from the log through the visuals' own timelines; nothing here is typed in. Importing this
// module pulls in story.json, which the page imports anyway.

import { story } from "../data/story";
import { lerp } from "./shared";
import { CHOREO, treePlayer, type TreePlayer } from "./tree/frame";

/**
 * The moments of the tree's story under the names the page's steps use: the tree is grown (the
 * root has handed work to every track), the log (every session that works before the first kill
 * has its contract), the first kill, the verdict on it (a takeover starts: the survivors compute
 * the heir), the heir is chosen, the tree is re-wired, the fifth kill, the end.
 */
export function namedMoments(player: TreePlayer): Record<string, number> {
  const { model, timeline } = player;
  const [first] = model.groups;
  const firstKill = model.kills[0];
  const lastKill = model.kills[model.kills.length - 1];
  if (!first || !firstKill || !lastKill) throw new Error("the log holds no takeover");
  /** When the last brain of a level that works before the first kill is given its work. */
  const levelWorking = (level: number): number =>
    Math.max(
      ...Object.values(model.node)
        .filter((n) => n.kind === "brain" && n.level === level)
        .map((n) => model.activeFromMs[n.id] ?? Infinity)
        .filter((t) => t < firstKill.atMs),
    );
  const grown = timeline.pOf(levelWorking(1), "start");
  const kill1 = timeline.pOf(firstKill.atMs, "start");
  const inHold = (c: number): number => lerp(timeline.pOf(first.atMs, "start"), timeline.pOf(first.atMs, "end"), c);
  return {
    grown,
    log: timeline.pOf(levelWorking(2), "start"),
    kill1,
    verdict1: inHold(0),
    heir1: inHold(CHOREO.heir[1]),
    adopt1: inHold(CHOREO.rewire[1]),
    kill5: timeline.pOf((model.kills[4] ?? lastKill).atMs, "start"),
    settled: 1,
  };
}

const told = treePlayer(story.tree, "story");
const quick = treePlayer(story.tree, "hero");

/** The tree in a scroll-driven beat (the default pacing): kills, verdicts, takeovers, the end. */
export const TREE_KEYFRAMES: Readonly<Record<string, number>> = namedMoments(told);

/** The same moments in the hero's faster pacing (`pacing="hero"`). */
export const TREE_HERO_KEYFRAMES: Readonly<Record<string, number>> = namedMoments(quick);

/** Every moment of the tree, one by one (each kill, suspicion, verdict, takeover and result). */
export const TREE_MOMENTS = told.keyframes;

/** How long the hero's tree plays, in seconds, when driven by time at constant speed. */
export const TREE_HERO_SECONDS = quick.timeline.totalS;

/** And the story pacing's nominal length in seconds, for sizing a scroll range. */
export const TREE_STORY_SECONDS = told.timeline.totalS;
