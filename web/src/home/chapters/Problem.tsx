import { useTransform, type MotionValue } from "motion/react";
import { useMemo } from "react";

import type { LanesSlice } from "../data/types";
import { COPY } from "../copy";
import { percent, seconds } from "../format";
import { useStill } from "../hooks";
import { captionFor, facts, heroReading, lanesBeats, waitedSeconds, type LanesBeats } from "../numbers";
import { ChapterHead, Closer, Setting, StepText } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { PartsDiagram } from "../parts/PartsDiagram";
import { Readout } from "../parts/Readout";
import { Layer, Stage, type StageStep } from "../scroll/Stage";
import { slice, useStory } from "../story";
import { Viz } from "../visuals";

export function Problem() {
  const story = useStory();
  const still = useStill();
  const f = facts(story);
  const lanes = slice<LanesSlice>(story, "lanes.central") ?? null;
  const kf = lanesBeats(story);
  const rival = heroReading(story, "central");
  const swarm = heroReading(story, "swarm");
  const setting = captionFor(story, "hero");

  // Each step names where the lanes' progress goes while it is current, and the seconds it takes to get there (`play`):
  // the stage plays it on its own clock when the step comes under the reading line. The stall counter and the diagram of
  // parts are layers that come and go by step.
  const steps = useMemo((): StageStep[] => {
    const s = COPY.problem.steps;
    return [
      {
        id: "intro",
        at: 0,
        weight: 0.7,
        layers: { counter: 0, parts: 0 },
        content: (
          <ChapterHead id="problem" number="01" eyebrow={COPY.problem.eyebrow} title={COPY.problem.title}>
            <p>{COPY.problem.example(f)}</p>
          </ChapterHead>
        ),
      },
      { id: "team", at: kf.filled, play: 1.6, content: <StepText lead={s.team.lead} more={s.team.more} /> },
      // The crash and the waiting are one step: the lanes run from the crash to the restart and the counter counts the
      // seconds in between (the recorded run's 101.8 s), in about three.
      { id: "crash", at: kf.restart, play: 3.2, layers: { counter: 1 }, content: <StepText lead={s.crash.lead} more={s.crash.more} /> },
      { id: "twice", at: kf.redone, play: 1.8, layers: { counter: 0 }, content: <StepText lead={s.twice.lead} more={s.twice.more} /> },
      {
        id: "numbers",
        at: kf.end,
        play: 1.4,
        weight: 0.7,
        content: (
          <>
            <StepText lead={s.numbers.lead} />
            <div className="home-pair">
              <div className="home-pair__side">
                <p className="home-pair__who">{s.numbers.rival}</p>
                <Figure value={rival.stallS} format={(n) => seconds(n)} label={COPY.labels.stalled} tone="rival" />
                <Figure value={rival.extraCostPct} format={(n) => percent(n)} label={COPY.labels.extraCost} tone="paid-twice" />
              </div>
              <div className="home-pair__side">
                <p className="home-pair__who">{s.numbers.swarm}</p>
                <Figure value={swarm.stallS} format={(n) => seconds(n)} label={COPY.labels.stalled} tone="swarm" />
                <Figure value={swarm.extraCostPct} format={(n) => percent(n)} label={COPY.labels.extraCost} tone="swarm" />
              </div>
            </div>
            <Setting>
              {setting} {"·"} {COPY.rivalReason}
            </Setting>
            <Claim id="R5" className="home-claim--small" />
          </>
        ),
      },
      {
        id: "better",
        at: kf.end,
        layers: { lanes: 0.1, parts: 1 },
        content: (
          <>
            <StepText lead={s.better.lead} more={s.better.more} />
            {/* with no moving visual the diagram sits with the step it belongs to */}
            {still && (
              <figure className="home-step__figure">
                <PartsDiagram workers={f.agents} />
              </figure>
            )}
          </>
        ),
      },
    ];
    // The copy is constant; the sentences change only with the data.
  }, [story, still]);

  return (
    <section id="problem" className="home-chapter" aria-labelledby="problem-title">
      <Stage
        id="problem-stage"
        label={COPY.problem.visual}
        steps={steps}
        visual={({ progress, still }) => <ProblemVisual progress={progress} still={still} lanes={lanes} kf={kf} workers={f.agents} />}
      />
      <Closer>{COPY.problem.question}</Closer>
    </section>
  );
}

function ProblemVisual({
  progress,
  still,
  lanes,
  kf,
  workers,
}: {
  progress: MotionValue<number>;
  still: boolean;
  lanes: LanesSlice | null;
  kf: LanesBeats;
  workers: number | null;
}) {
  // The seconds the work has stood still in this recorded run: counted up from the crash to the restart of the lanes' progress.
  const stallS = lanes?.stallS ?? null;
  const waited = useTransform(progress, (p) => waitedSeconds(stallS, kf, p));
  return (
    <div className="home-problem">
      <Layer name="lanes" className="home-problem__lanes">
        <Viz name="WorkLanes" data={lanes} progress={progress} still={still} />
      </Layer>
      {!still && (
        <>
          <Layer name="counter" className="home-problem__counter" decorative>
            <Readout value={waited} format={(n) => seconds(n)} className="home-counter__number" />
            <span className="home-counter__label">{COPY.problem.waiting}</span>
          </Layer>
          <Layer name="parts" className="home-problem__parts">
            <PartsDiagram workers={workers} />
          </Layer>
        </>
      )}
    </div>
  );
}
