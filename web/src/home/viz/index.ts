// What the home page imports from the visuals (W7). Every visual is a pure component of
// ``{ progress, data, still? }``; the page decides what drives ``progress`` (time or scroll).

export type { VizProps } from "./shared";
export { usePlayback, type Playback } from "./playback";

export { SwarmTree, type SwarmTreeProps } from "./tree/SwarmTree";
export { treePlayer } from "./tree/frame";
export { PACING, type Pacing } from "./tree/timeline";
export type { Keyframe, KeyframeKind } from "./tree/timeline";
export { namedMoments, TREE_HERO_KEYFRAMES, TREE_HERO_SECONDS, TREE_KEYFRAMES, TREE_MOMENTS, TREE_STORY_SECONDS } from "./keyframes";

export { HomeLab, isHomeLabHash } from "./lab/HomeLab";
