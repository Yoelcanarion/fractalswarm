// A pinned stage: a visual that stays on screen while short steps of text scroll past it, and that
// changes as you read. The scroll is never taken over: the wheel moves the page at its normal speed, the
// stage is only `position: sticky`, and the visual's progress is a value computed from the scroll
// (scroll/timeline.ts) and smoothed by a light spring, written to the DOM by motion, with no React render.
//
// With reduced motion (or `?still`) the stage is ordinary flow: the visual in its final state, then the
// steps one after the other.

import { m, motionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useNarrow, useStill } from "../hooks";
import { buildTimeline, type StepSpec, type Timeline } from "./timeline";

export interface StageStep extends StepSpec {
  content: ReactNode;
}

export interface StageVisualContext {
  /** The visual's progress, 0 to 1: scrolled, then eased by a light spring. */
  progress: MotionValue<number>;
  /** Where the reading line is among the steps (0 on the first card, 1 on the second, 2.5 between the third and
   * the fourth), eased the same way: for layers that come and go between steps. */
  position: MotionValue<number>;
  still: boolean;
}

export interface StageProps {
  id: string;
  /** What the visual shows, for a screen reader. */
  label: string;
  steps: readonly StageStep[];
  visual: (context: StageVisualContext) => ReactNode;
  /** Which side of the steps the visual sits on a wide screen. Default right. */
  side?: "left" | "right";
}

// A light spring: the wheel's steps do not show, and the visual is still within a few frames of the page.
const SPRING = { stiffness: 240, damping: 36, mass: 0.7, restDelta: 0.0004, restSpeed: 0.001 } as const;

export function Stage(props: StageProps) {
  return useStill() ? <StillStage {...props} /> : <ScrubbedStage {...props} />;
}

function StillStage({ id, label, steps, visual, side = "right" }: StageProps) {
  const done = useMemo(() => motionValue(1), []);
  const last = useMemo(() => motionValue(steps.length - 1), [steps.length]);
  return (
    <div id={id} className={`home-stage home-stage--still home-stage--${side}`}>
      <figure className="home-stage__visual" aria-label={label}>
        <div className="home-stage__frame">{visual({ progress: done, position: last, still: true })}</div>
      </figure>
      <ol className="home-stage__steps">
        {steps.map((step, index) => (
          <li key={step.id} className="home-step" data-step={step.id}>
            <div className="home-step__card">
              <span className="home-step__count">
                {index + 1} / {steps.length}
              </span>
              {step.content}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ScrubbedStage({ id, label, steps, visual, side = "right" }: StageProps) {
  const narrow = useNarrow();
  const timeline = useMemo(() => buildTimeline(steps, { anchor: narrow ? 0.72 : 0.5 }), [steps, narrow]);
  const root = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: root, offset: ["start start", "end end"] });
  const progress = useSpring(useTransform(scrollYProgress, timeline.visualAt), SPRING);
  const position = useSpring(useTransform(scrollYProgress, timeline.positionAt), SPRING);
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = timeline.stepAt(p);
    setActive((current) => (current === next ? current : next));
  });

  return (
    <div ref={root} id={id} className={`home-stage home-stage--${side}`}>
      <figure className="home-stage__visual" aria-label={label}>
        <div className="home-stage__frame">{visual({ progress, position, still: false })}</div>
      </figure>
      <ol className="home-stage__steps">
        {steps.map((step, index) => (
          <StepBlock
            key={step.id}
            index={index}
            total={steps.length}
            step={step}
            timeline={timeline}
            scroll={scrollYProgress}
            active={index === active}
          />
        ))}
      </ol>
    </div>
  );
}

function StepBlock({
  index,
  total,
  step,
  timeline,
  scroll,
  active,
}: {
  index: number;
  total: number;
  step: StageStep;
  timeline: Timeline;
  scroll: MotionValue<number>;
  active: boolean;
}) {
  const opacity = useTransform(scroll, (p) => timeline.cardOpacity(p, index));
  return (
    <li className="home-step" data-step={step.id} data-active={active ? "" : undefined} style={{ "--w": step.weight ?? 1 } as CSSProperties}>
      <m.div className="home-step__card" style={{ opacity }}>
        <span className="home-step__count">
          {index + 1} / {total}
        </span>
        {step.content}
      </m.div>
    </li>
  );
}
