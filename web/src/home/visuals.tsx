// The way in to W7's visuals (web/src/home/viz). This file is not called viz.tsx so that no import of "./viz" can be
// read as that folder. Every visual is a pure component of `{ progress, data, still }`, and `data` is the one slice of
// the story it draws (the chapter hands it over with `slice(story, "tree")`). The page owns the beats and decides what
// drives `progress`; a visual knows only that.
//
// A visual that W7 has not written yet draws as a labelled placeholder that shows its progress, so the page scrolls
// end to end before they all exist. To add one: import it here and put it in REGISTRY.

import { useMotionValueEvent, type MotionValue } from "motion/react";
import { useEffect, useRef, type ComponentType } from "react";

// From the files, not from viz/index.ts: the index also exports the lab (a page of its own, with its own styles), which
// the bundle of the home page should not carry.
import { LineDraw } from "./viz/charts/LineDraw";
import { HashStrip } from "./viz/hash/HashStrip";
import { HrwPanels } from "./viz/hrw/HrwPanels";
import { WorkLanes } from "./viz/lanes/WorkLanes";
import { SwarmTree } from "./viz/tree/SwarmTree";

export const VIZ_NAMES = [
  "SwarmTree",
  "WorkLanes",
  "HrwPanels",
  "HashStrip",
  "LineDraw",
  "DotPlot",
  "PairedBars",
  "RegimeStrip",
  "TokenBar",
  "DoorGlyph",
] as const;

export type VizName = (typeof VIZ_NAMES)[number];

interface DrawnProps {
  progress: MotionValue<number>;
  data: unknown;
  still?: boolean;
  [extra: string]: unknown;
}

// Each visual types its own slice and extra props (pacing, round, door ...); the page hands them through.
type VizComponent = ComponentType<DrawnProps>;

const REGISTRY: Partial<Record<VizName, VizComponent>> = {
  SwarmTree: SwarmTree as unknown as VizComponent,
  WorkLanes: WorkLanes as unknown as VizComponent,
  LineDraw: LineDraw as unknown as VizComponent,
  HrwPanels: HrwPanels as unknown as VizComponent,
  HashStrip: HashStrip as unknown as VizComponent,
};

/** Whether W7 has written this visual yet. */
export const isDrawn = (name: VizName): boolean => name in REGISTRY;

// What each visual shows, in the page's own words: a placeholder says what is going to be here, not the name of a component.
const LABELS: Record<VizName, string> = {
  SwarmTree: "The swarm tree",
  WorkLanes: "Work lanes of a recorded run",
  HrwPanels: "The survivors' panels",
  HashStrip: "The hash chain of the log",
  LineDraw: "Waiting and extra cost, as coordinators die",
  DotPlot: "Stall time and extra cost, one dot per seed",
  PairedBars: "Locality, against an ideal durable supervisor",
  RegimeStrip: "Where the swarm wins and where it loses",
  TokenBar: "Tokens by model",
  DoorGlyph: "A door",
};

function Placeholder({ name, note, progress }: { name: VizName; note: string; progress: MotionValue<number> }) {
  const bar = useRef<HTMLSpanElement>(null);
  const paint = (value: number) => {
    if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, Math.max(0, value))})`;
  };
  useEffect(() => paint(progress.get()), [progress]);
  useMotionValueEvent(progress, "change", paint);
  return (
    <div className={`home-placeholder home-placeholder--${name}`} role="img" aria-label={`${LABELS[name]}, not drawn yet`}>
      <span className="home-placeholder__name">{LABELS[name]}</span>
      <span className="home-placeholder__note">{note}</span>
      <span className="home-placeholder__track">
        <span ref={bar} className="home-placeholder__bar" />
      </span>
    </div>
  );
}

export type VizUse = { name: VizName; data: unknown; progress: MotionValue<number>; still?: boolean } & Record<string, unknown>;

/** A visual of W7's, or a placeholder while it is not written yet or while its slice is not in the data. */
export function Viz({ name, data, progress, still = false, ...extra }: VizUse) {
  const Drawn = REGISTRY[name];
  if (data === undefined || data === null) return <Placeholder name={name} note="no data yet" progress={progress} />;
  if (!Drawn) return <Placeholder name={name} note="drawn in the next build" progress={progress} />;
  return <Drawn {...extra} progress={progress} data={data} still={still} />;
}
