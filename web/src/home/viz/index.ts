// What the home page imports from the visuals (W7). Every visual is a pure component of
// ``{ progress, data, still? }``; the page decides what drives ``progress`` (time or scroll).

export type { VizProps } from "./shared";
export { usePlayback, type Playback } from "./playback";

export { SwarmTree, type SwarmTreeProps } from "./tree/SwarmTree";
export { treePlayer } from "./tree/frame";
export { PACING, type Pacing } from "./tree/timeline";
export type { Keyframe, KeyframeKind } from "./tree/timeline";
export { namedMoments, TREE_HERO_KEYFRAMES, TREE_HERO_SECONDS, TREE_KEYFRAMES, TREE_MOMENTS, TREE_STORY_SECONDS } from "./keyframes";

export { WorkLanes, type WorkLanesProps } from "./lanes/WorkLanes";
export { HrwPanels, type HrwPanelsProps } from "./hrw/HrwPanels";
export { HashStrip, type HashStripProps } from "./hash/HashStrip";

// The charts. Each prints its own setting (task, failure profile, model, seeds) unless the page prints it
// itself and passes `setting={false}`; the regime strip and the token bar are framed by the page's own words.
export { LineDraw, type LineDrawProps } from "./charts/LineDraw";
export { DotPlot, type DotPlotProps } from "./charts/DotPlot";
export { PairedBars, type PairedBarsProps } from "./charts/PairedBars";
export { RegimeStrip, type RegimeStripProps } from "./charts/RegimeStrip";
export { TokenBar } from "./charts/TokenBar";

export { CountUp } from "./parts/CountUp";
export type { CountData, CountSpec } from "./parts/count";
export { DoorGlyph } from "./doors/DoorGlyph";
export { DOOR_IDS, type DoorId } from "./doors/doors";

export { HomeLab, isHomeLabHash } from "./lab/HomeLab";

// The redesigned page (redesign.md): the click demo, with the page's one ease.
export { KillDemo, type KillDemoProps } from "./demo/KillDemo";
export { cssEase, ease, playhead, SECONDS } from "./ease";
