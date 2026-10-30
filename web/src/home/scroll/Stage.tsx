// A pinned stage: a visual that stays on screen while short steps of text scroll past it, and that changes as you read.
// The scroll is never taken over: the wheel moves the page at its normal speed, and the stage is only `position: sticky`.
// What the scroll decides is which step is current (the one under the reading line); a clock then plays the visual to
// that step's targets (scroll/clock.ts), and the cards and the layers of the visual change by state, with a CSS
// transition. Nothing is computed from the scroll position frame by frame, so a browser that scrolls on its own thread
// shows the same motion as one that does not, and a reader who stops anywhere sees a finished beat a moment later.
//
// The page renders no React during any of it: a step change writes two attributes and one motion value.
//
// With reduced motion (or `?still`) the stage is ordinary flow: the visual in its final state, then the steps one after
// the other.

import { motionValue, useMotionValue, type MotionValue } from "motion/react";
import { createContext, useContext, useMemo, useRef, type CSSProperties, type ReactNode } from "react";

import { useIsoLayoutEffect, useNarrow, useStill } from "../hooks";
import { browserHost, createClock } from "./clock";
import { buildPlan, DEFAULT_WEIGHT, MAIN, stepAtLine, type Block, type Plan, type StepSpec } from "./timeline";

export interface StageStep extends StepSpec {
  content: ReactNode;
}

export interface StageVisualContext {
  /** The visual's progress, 0 to 1, played by the stage's clock. */
  progress: MotionValue<number>;
  /** The other channels some steps name in `to`, played with it. */
  channels: Readonly<Record<string, MotionValue<number>>>;
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

// Where the reading line sits on the viewport (0 top, 1 bottom): the middle on a wide screen, below the pinned visual
// on a phone.
const ANCHOR = { wide: 0.5, narrow: 0.72 } as const;
// How far (in screens) past a boundary the line has to go before the step changes, either way.
const MARGIN = 0.05;
// A stage within this many screens of the viewport is being looked at: further away it is only followed, not played.
const NEAR_SCREENS = 0.5;

interface LayerScope {
  plan: Plan;
  active: MotionValue<number>;
}

const LayerScopeContext = createContext<LayerScope | null>(null);

/**
 * A layer of a stage's visual, which the steps fade in and out by name (`layers` in a step). It is a plain element: the
 * stage writes its opacity when the step changes and a CSS transition does the fade. Without a stage that moves (still
 * mode) it is drawn at `still`.
 */
export function Layer({
  name,
  className = "",
  still = 1,
  decorative = false,
  children,
}: {
  name: string;
  className?: string;
  still?: number;
  /** Hidden from a screen reader: the layer repeats what the steps say. */
  decorative?: boolean;
  children: ReactNode;
}) {
  const scope = useContext(LayerScopeContext);
  const element = useRef<HTMLDivElement>(null);
  // A layout effect: the stage puts itself on its step in its own layout effect (after this one), so the first paint
  // shows the layers where that step has them.
  useIsoLayoutEffect(() => {
    if (!scope) return undefined;
    const paint = (step: number): void => {
      const layer = element.current;
      if (!layer) return;
      const shown = scope.plan.layer(step, name);
      layer.style.opacity = String(shown);
      layer.toggleAttribute("data-off", shown === 0);
    };
    paint(scope.active.get());
    return scope.active.on("change", paint);
  }, [scope, name]);
  const opacity = scope ? scope.plan.layer(scope.active.get(), name) : still;
  return (
    <div
      ref={element}
      className={`home-layer ${className}`.trim()}
      data-layer={name}
      data-off={opacity === 0 ? "" : undefined}
      aria-hidden={decorative || undefined}
      style={{ opacity }}
    >
      {children}
    </div>
  );
}

export function Stage(props: StageProps) {
  return useStill() ? <StillStage {...props} /> : <ClockStage {...props} />;
}

function Steps({ steps, still }: { steps: readonly StageStep[]; still: boolean }) {
  return (
    <>
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="home-step"
          data-step={step.id}
          data-active={!still && index === 0 ? "" : undefined}
          style={still ? undefined : ({ "--w": step.weight ?? DEFAULT_WEIGHT } as CSSProperties)}
        >
          <div className="home-step__card">
            <span className="home-step__count">
              {index + 1} / {steps.length}
            </span>
            {step.content}
          </div>
        </li>
      ))}
    </>
  );
}

function StillStage({ id, label, steps, visual, side = "right" }: StageProps) {
  const plan = useMemo(() => buildPlan(steps), [steps]);
  const done = useMemo(() => motionValue(1), []);
  const last = plan.steps.length - 1;
  const channels = useMemo(() => Object.fromEntries(plan.channels.map((name) => [name, motionValue(plan.target(last, name))])), [plan, last]);
  return (
    <div id={id} className={`home-stage home-stage--still home-stage--${side}`}>
      <figure className="home-stage__visual" aria-label={label}>
        <div className="home-stage__frame">{visual({ progress: done, channels, still: true })}</div>
      </figure>
      <ol className="home-stage__steps">
        <Steps steps={steps} still />
      </ol>
    </div>
  );
}

function ClockStage({ id, label, steps, visual, side = "right" }: StageProps) {
  const narrow = useNarrow();
  const plan = useMemo(() => buildPlan(steps), [steps]);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const progress = useMotionValue(plan.target(0, MAIN));
  const channels = useMemo(() => Object.fromEntries(plan.channels.map((name) => [name, motionValue(plan.target(0, name))])), [plan]);
  const active = useMotionValue(0);
  const scope = useMemo(() => ({ plan, active }), [plan, active]);

  useIsoLayoutEffect(() => {
    const stage = root.current;
    const column = list.current;
    if (!stage || !column) return undefined;
    const cards = Array.from(column.children) as HTMLElement[];
    const anchor = narrow ? ANCHOR.narrow : ANCHOR.wide;
    let blocks: Block[] = [];
    let current = 0;
    // True until the stage has been looked at from close by: the first look puts the visual straight on the step, with no
    // play, so a page opened half way down (or a jump from the rail) shows a finished beat, and a stage that is far away
    // is not followed at all.
    let stale = true;
    // Whether the stage is within reach of the viewport, as the browser last said: a stage that is not is not even looked at.
    let near = true;

    // The stage has one animation frame, for everything it does: it first reads where the page is (the only thing it
    // reads), decides the step, and then moves the clock, so that nothing reads after something was written.
    let frame = 0;
    let wantLook = false;
    let unsnap = false;
    let tick: (() => void) | null = null;
    const ask = (): void => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const clock = createClock(
      plan,
      { [MAIN]: progress, ...channels },
      {
        now: browserHost.now,
        request: (callback) => {
          tick = callback;
          ask();
          return 1;
        },
        cancel: () => {
          tick = null;
        },
      },
    );

    const measure = (): void => {
      const top = stage.getBoundingClientRect().top;
      blocks = cards.map((card) => {
        const box = card.getBoundingClientRect();
        return { start: box.top - top, end: box.bottom - top };
      });
    };

    const show = (step: number): void => {
      current = step;
      cards.forEach((card, index) => card.toggleAttribute("data-active", index === step));
      stage.dataset.current = plan.steps[step]?.id ?? "";
      active.set(step);
    };

    // Put the stage on a step with nothing fading or playing: the cards and layers are written with their transitions off
    // and the style is flushed that way before the transitions come back.
    const snap = (step: number): void => {
      stage.setAttribute("data-snap", "");
      show(step);
      clock.go(step, "snap");
      stage.getBoundingClientRect();
      unsnap = true;
      ask();
    };

    const look = (): void => {
      const box = stage.getBoundingClientRect();
      const screen = window.innerHeight;
      if (box.bottom < -NEAR_SCREENS * screen || box.top > (1 + NEAR_SCREENS) * screen) {
        if (!stale) {
          stale = true;
          clock.stop();
        }
        return;
      }
      const next = stepAtLine(blocks, anchor * screen - box.top, current, stale ? 0 : MARGIN * screen);
      if (stale) {
        stale = false;
        snap(next);
      } else if (next !== current) {
        show(next);
        clock.go(next, "play");
      }
    };

    const run = (): void => {
      frame = 0;
      if (unsnap) {
        unsnap = false;
        stage.removeAttribute("data-snap");
      }
      if (wantLook) {
        wantLook = false;
        look();
      }
      const move = tick;
      tick = null;
      move?.();
    };

    const onScroll = (): void => {
      if (!near) return;
      wantLook = true;
      ask();
    };
    const remeasure = (): void => {
      measure();
      wantLook = true;
      ask();
    };

    measure();
    look();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    watch?.observe(stage);
    const reach =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              near = entries[entries.length - 1]?.isIntersecting ?? true;
              wantLook = true;
              ask();
            },
            { rootMargin: `${NEAR_SCREENS * 100}% 0px` },
          );
    reach?.observe(stage);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      watch?.disconnect();
      reach?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      stage.removeAttribute("data-snap");
      clock.stop();
    };
  }, [plan, narrow, progress, channels, active]);

  return (
    <div ref={root} id={id} className={`home-stage home-stage--${side}`} data-current={plan.steps[0]?.id}>
      <figure className="home-stage__visual" aria-label={label}>
        <LayerScopeContext.Provider value={scope}>
          <div className="home-stage__frame">{visual({ progress, channels, still: false })}</div>
        </LayerScopeContext.Provider>
      </figure>
      <ol ref={list} className="home-stage__steps">
        <Steps steps={steps} still={false} />
      </ol>
    </div>
  );
}
