// The moments of each visual's story as progress values, for the page to line its text up with.
// Read from the log through the visuals' own timelines; nothing here is typed in. Importing this
// module pulls in story.json, which the page imports anyway.

import { story } from "../data/story";
import { treePlayer } from "./tree/frame";

/** The tree in a scroll-driven beat: kills, suspicions, verdicts, takeovers (a hold: p to pEnd), results. */
export const TREE_KEYFRAMES = treePlayer(story, "story").keyframes;

/** The same moments in the hero's faster pacing. */
export const TREE_HERO_KEYFRAMES = treePlayer(story, "hero").keyframes;

/** How long the hero's tree plays, in seconds, when driven by time at constant speed. */
export const TREE_HERO_SECONDS = treePlayer(story, "hero").timeline.totalS;

/** And the story pacing's nominal length in seconds, for sizing a scroll range. */
export const TREE_STORY_SECONDS = treePlayer(story, "story").timeline.totalS;
