// The way in to W7's visuals (web/src/home/viz/index.ts). Each visual is a pure component with the same
// three props; the page owns the beats and a visual knows only `progress`.
//
// The index is picked up with a glob, so that this page builds and runs before the visuals are merged
// (every visual then draws as a labelled placeholder that shows its progress) and uses them the moment
// `viz/index.ts` exists, with no change here.

import { useMotionValueEvent, type MotionValue } from "motion/react";
import { useEffect, useRef, type ComponentType } from "react";

export interface VizProps<D = unknown> {
  /** 0 to 1: how far through its beat the visual is. A motion value, so a scroll updates it without a React render. */
  progress: MotionValue<number>;
  /** The slice of the generated data this visual draws. */
  data: D;
  /** Final state, no motion: reduced motion, or a static capture. */
  still?: boolean;
}

// Each visual types its own slice, so the page holds them with `any` data.
type VizComponent = ComponentType<VizProps<any>>;

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

type VizModule = Partial<Record<VizName, VizComponent>>;

const found = import.meta.glob("./viz/index.ts", { eager: true });
const real = (Object.values(found)[0] ?? {}) as VizModule;

/** Whether W7's visuals are merged. */
export const hasRealViz = Object.keys(real).length > 0;

/** The tree's own keyframes (`TREE_KEYFRAMES`, exported by W7 where its events sit in its progress), if it exports them. */
export const exportedTreeKeyframes: Readonly<Record<string, number>> =
  (Object.values(found)[0] as { TREE_KEYFRAMES?: Record<string, number> } | undefined)?.TREE_KEYFRAMES ?? {};

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

/** A visual of W7's, or a placeholder while it is not merged or while the slice it draws is missing. */
export function Viz({ name, data, progress, still = false }: VizProps & { name: VizName }) {
  const Drawn = real[name];
  if (data === undefined || data === null) return <Placeholder name={name} note="no data yet" progress={progress} />;
  if (!Drawn) return <Placeholder name={name} note="waiting for the visual" progress={progress} />;
  return <Drawn progress={progress} data={data} still={still} />;
}
