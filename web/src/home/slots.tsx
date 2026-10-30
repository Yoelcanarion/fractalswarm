// W7's six components of the redesign, as the page uses them (`.plans/arena/redesign.md`). Until each one is written it draws
// here as a labelled placeholder with the same props, so the page is whole and its words, height and claims can be held.
// When W7's lands, the line of this file that draws it is replaced by an import from W7's file (not from viz/index.ts, which
// also exports the lab) and the placeholder goes.
//
// `play` is a counter: 0 means not yet, and each increment restarts the animation from its start.

import { useMotionValue } from "motion/react";
import type { ReactNode } from "react";

import { MISSING, percent, seconds } from "./format";
import { heroReading } from "./numbers";
import { useStory } from "./story";
import { Viz } from "./visuals";

export type StepId = "log" | "heir" | "adopt";

const STEP_NAMES: Record<StepId, string> = { log: "The log", heir: "The heir", adopt: "The adoption" };

// A placeholder says what is going to be here and nothing else: no number, no state in words, so the page's words do not change
// with what a visitor does to it. Its state is an attribute.
function Slot({ name, className = "", state, children }: { name: string; className?: string; state?: string; children?: ReactNode }) {
  return (
    <div
      className={`home-placeholder home-slot ${className}`.trim()}
      role="img"
      aria-label={`${name}, drawn in the next build`}
      data-state={state}
    >
      <span className="home-placeholder__name">{name}</span>
      {children}
    </div>
  );
}

/** The short film of the work lanes of the in-process supervisor: the crash lands, the bars stop, the redone calls appear. */
export function ProblemFilm({ play }: { play: number }) {
  return (
    <Slot name="The work lanes of an in-process supervisor" className="home-slot--film" state={play > 0 ? "played" : "waiting"} />
  );
}

/** One of the three drawings of the solution; it plays while `active` and rests at the end otherwise. */
export function StepDrawing({ step, active }: { step: StepId; active: boolean }) {
  return (
    <Slot name={STEP_NAMES[step]} className="home-slot--step" state={active ? "active" : "rest"} />
  );
}

/** The click demo: the tree, its buttons and its live line. Self-contained. */
export function KillDemo() {
  return <Slot name="The click demo: kill a coordinator and watch the rest take over" className="home-slot--demo" />;
}

/** A number that counts up to its value once, when `play` goes above 0. */
export function GrowNumber({ value, format, play }: { value: number | null | undefined; format: (n: number) => string; play: number }) {
  void play;
  return <span className="home-grow">{typeof value === "number" && Number.isFinite(value) ? format(value) : MISSING}</span>;
}

/** The bars of the swarm against both rivals, and their numbers. */
export function ProofBars({ play }: { play: number }) {
  const story = useStory();
  const swarm = heroReading(story, "swarm");
  const rival = heroReading(story, "central");
  return (
    <Slot name="The swarm against two rivals" className="home-slot--bars" state={play > 0 ? "played" : "waiting"}>
      <span className="home-placeholder__note">
        <GrowNumber value={swarm.stallS} format={(n) => seconds(n)} play={play} /> {" / "}
        <GrowNumber value={rival.stallS} format={(n) => seconds(n)} play={play} /> {" · "}
        <GrowNumber value={swarm.extraCostPct} format={(n) => percent(n)} play={play} /> {" / "}
        <GrowNumber value={rival.extraCostPct} format={(n) => percent(n)} play={play} />
      </span>
    </Slot>
  );
}

/** The thumbnail of a door: a small drawing that loops softly while it is on screen. */
export function DoorThumb({ door }: { door: string }) {
  const rest = useMotionValue(1);
  return <Viz name="DoorGlyph" data={door} progress={rest} still />;
}
