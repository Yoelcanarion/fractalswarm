// What W7 has not landed yet. ProblemFilm, StepDrawing, KillDemo and DoorThumb are W7's and the page imports them from their files
// (`viz/film`, `viz/steps`, `viz/demo`, `viz/doors`); the proof's bars draw here as a labelled placeholder with the same props until
// W7's rebuilt `viz/charts/ProofBars.tsx` lands. The committed first version is not used: it draws the swarm against the ideal
// durable supervisor as two mean bars, which would show a tie (R2) as a win, and it prints its labels as HTML, past the page's
// word budget. When the rebuilt one lands, `chapters/Proof.tsx` imports it and this file goes.
//
// `play` is a counter: 0 means not yet, and each increment restarts the animation from its start.

import { MISSING, percent, seconds } from "./format";
import { heroReading } from "./numbers";
import { useStory } from "./story";

// A number that would count up once `play` goes above 0; the placeholder only writes it.
function Grown({ value, format }: { value: number | null | undefined; format: (n: number) => string }) {
  return <span className="home-grow">{typeof value === "number" && Number.isFinite(value) ? format(value) : MISSING}</span>;
}

/** The bars of the swarm against the in-process supervisor, and their numbers. */
export function ProofBars({ play }: { play: number }) {
  const story = useStory();
  const swarm = heroReading(story, "swarm");
  const rival = heroReading(story, "central");
  return (
    <div
      className="home-placeholder home-slot home-slot--bars"
      role="img"
      aria-label="The swarm against the in-process supervisor, drawn in the next build"
      data-state={play > 0 ? "played" : "waiting"}
    >
      <span className="home-placeholder__name">The swarm against its rivals</span>
      <span className="home-placeholder__note">
        <Grown value={swarm.stallS} format={(n) => seconds(n)} /> {" / "}
        <Grown value={rival.stallS} format={(n) => seconds(n)} /> {" · "}
        <Grown value={swarm.extraCostPct} format={(n) => percent(n)} /> {" / "}
        <Grown value={rival.extraCostPct} format={(n) => percent(n)} />
      </span>
    </div>
  );
}
