import { m, useTransform, type MotionValue } from "motion/react";
import { useMemo } from "react";

import { COPY } from "../copy";
import { percent, seconds } from "../format";
import { facts, heroReading, heroSetting, keyframes, settingText } from "../numbers";
import { ChapterHead, Closer, Setting, StepText } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { PartsDiagram } from "../parts/PartsDiagram";
import { Readout } from "../parts/Readout";
import { Stage, type StageStep } from "../scroll/Stage";
import { clamp01 } from "../scroll/timeline";
import { slice, useStory } from "../story";
import { Viz } from "../viz";

// Where the real run's events sit in the lanes' progress, if the data does not say (lanes.central.keyframes).
const LANES_DEFAULTS = { filled: 0.3, crash: 0.34, restart: 0.55, redone: 0.82, end: 1 };

/** 0 until `from`, 1 from `to`, and linear in between. */
const useRamp = (value: MotionValue<number>, from: number, to: number) => useTransform(value, (v) => clamp01((v - from) / (to - from)));

export function Problem() {
  const story = useStory();
  const f = facts(story);
  const kf = keyframes(story, "lanes.central", LANES_DEFAULTS);
  const rival = heroReading(story, "central");
  const swarm = heroReading(story, "swarm");
  const setting = settingText({ task: heroSetting(story).task, crashes: rival.crashes, profile: rival.profile, real: heroSetting(story).real, seeds: rival.seeds });
  const stallS = slice<number>(story, "lanes.central.stallS") ?? null;

  const steps: StageStep[] = useMemo(() => {
    const s = COPY.problem.steps;
    return [
      {
        id: "intro",
        at: 0,
        weight: 1,
        content: (
          <ChapterHead id="problem" number="01" eyebrow={COPY.problem.eyebrow} title={COPY.problem.title}>
            <p>{COPY.problem.example(f)}</p>
          </ChapterHead>
        ),
      },
      { id: "team", at: kf.filled, weight: 0.9, content: <StepText lead={s.team.lead} more={s.team.more} /> },
      { id: "crash", at: kf.restart, weight: 0.9, content: <StepText lead={s.crash.lead} more={s.crash.more} /> },
      { id: "twice", at: kf.redone, weight: 0.9, content: <StepText lead={s.twice.lead} more={s.twice.more} /> },
      {
        id: "numbers",
        at: kf.end,
        weight: 1.1,
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
      { id: "better", at: kf.end, weight: 1, content: <StepText lead={s.better.lead} more={s.better.more} /> },
    ];
    // The copy is constant; the sentences change only with the data.
  }, [story]);

  return (
    <section id="problem" className="home-chapter" aria-labelledby="problem-title">
      <Stage
        id="problem-stage"
        label={COPY.problem.visual}
        steps={steps}
        visual={({ progress, position, still }) => (
          <ProblemVisual progress={progress} position={position} still={still} data={slice(story, "lanes.central")} stallS={stallS} kf={kf} workers={f.agents} />
        )}
      />
      <Closer>{COPY.problem.question}</Closer>
    </section>
  );
}

function ProblemVisual({
  progress,
  position,
  still,
  data,
  stallS,
  kf,
  workers,
}: {
  progress: MotionValue<number>;
  position: MotionValue<number>;
  still: boolean;
  data: unknown;
  stallS: number | null;
  kf: Record<string, number>;
  workers: number | null;
}) {
  // The lanes give way to the diagram of parts on the last step.
  const lanesOpacity = useTransform(position, [3.6, 4.6], [1, 0.1]);
  const partsOpacity = useTransform(position, [3.9, 4.8], [0, 1]);
  // The seconds the work has waited: from the crash to the restart of the real run.
  const waited = useTransform(useRamp(progress, kf.crash, kf.restart), (r) => (stallS === null ? Number.NaN : stallS * r));
  const countOpacity = useTransform(position, [0.7, 1, 2.7, 3.2], [0, 1, 1, 0]);
  return (
    <div className="home-problem">
      <m.div className="home-problem__lanes" style={{ opacity: still ? 1 : lanesOpacity }}>
        <Viz name="WorkLanes" data={data} progress={progress} still={still} />
      </m.div>
      <m.div className="home-problem__counter" style={{ opacity: still ? 0 : countOpacity }} aria-hidden>
        <Readout value={waited} format={(n) => seconds(n)} className="home-counter__number" />
        <span className="home-counter__label">{COPY.problem.waiting}</span>
      </m.div>
      <m.div className="home-problem__parts" style={{ opacity: still ? 1 : partsOpacity }}>
        <PartsDiagram workers={workers} />
      </m.div>
    </div>
  );
}
