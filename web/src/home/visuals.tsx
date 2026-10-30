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
import { HashStrip } from "./viz/hash/HashStrip";
import { HrwPanels } from "./viz/hrw/HrwPanels";
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
  HrwPanels: HrwPanels as unknown as VizComponent,
  HashStrip: HashStrip as unknown as VizComponent,
};

/** Whether W7 has written this visual yet. */
export const isDrawn = (name: VizName): boolean => name in REGISTRY;

function Placeholder({ name, note, progress }: { name: string; note: string; progress: MotionValue<number> }) {
  const readout = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const paint = (value: number) => {
    if (readout.current) readout.current.textContent = value.toFixed(2);
    if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, Math.max(0, value))})`;
  };
  useEffect(() => paint(progress.get()), [progress]);
  useMotionValueEvent(progress, "change", paint);
  return (
    <div className="home-placeholder" role="img" aria-label={`${name}, not drawn yet`}>
      <span className="home-placeholder__name">{name}</span>
      <span className="home-placeholder__note">{note}</span>
      <span className="home-placeholder__track">
        <span ref={bar} className="home-placeholder__bar" />
      </span>
      <span ref={readout} className="home-placeholder__value">
        0.00
      </span>
    </div>
  );
}

export type VizUse = { name: VizName; data: unknown; progress: MotionValue<number>; still?: boolean } & Record<string, unknown>;

/** A visual of W7's, or a placeholder while it is not written yet or while its slice is not in the data. */
export function Viz({ name, data, progress, still = false, ...extra }: VizUse) {
  const Drawn = REGISTRY[name];
  if (data === undefined || data === null) return <Placeholder name={name} note="no data yet" progress={progress} />;
  if (!Drawn) return <Placeholder name={name} note="waiting for the visual" progress={progress} />;
  return <Drawn {...extra} progress={progress} data={data} still={still} />;
}
