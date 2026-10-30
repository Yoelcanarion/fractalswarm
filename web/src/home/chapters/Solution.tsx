import { m, useTransform, type MotionValue } from "motion/react";
import { useMemo } from "react";

import { COPY } from "../copy";
import { count, usd } from "../format";
import { bundleSetting, facts, finish, settingText, takeover, treeBeats } from "../numbers";
import { ChapterHead, Setting, StepText } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { Stage, type StageStep } from "../scroll/Stage";
import { clamp01 } from "../scroll/timeline";
import { useStory } from "../story";
import { Viz } from "../visuals";
import { TREE_KEYFRAMES } from "../viz/keyframes";

// Where the kill sequence of the demo bundle sits in the tree's progress, read from the log by W7's timeline.
// The text below follows these names.
const BEATS = treeBeats(TREE_KEYFRAMES);

export function Solution() {
  const story = useStory();
  const f = facts(story);
  const kf = BEATS;
  const result = finish(story);
  const run = takeover(story);
  const setting = settingText(story, bundleSetting(story));

  const steps: StageStep[] = useMemo(() => {
    const s = COPY.solution.steps;
    const chain = run.rootChain.length ? `${s.again.more} ${run.rootChain.join(" → ")}.` : s.again.more;
    return [
      {
        id: "intro",
        at: 0,
        weight: 0.9,
        content: (
          <ChapterHead id="solution" number="02" eyebrow={COPY.solution.eyebrow} title={COPY.solution.title}>
            <p>{COPY.solution.lede(f)}</p>
          </ChapterHead>
        ),
      },
      { id: "tree", at: kf.grown, weight: 0.8, content: <StepText lead={s.tree.lead} more={s.tree.more} /> },
      {
        id: "log",
        at: kf.log,
        weight: 0.8,
        content: (
          <>
            <Claim id="S6" className="home-claim--lead" />
            <StepText more={s.log.more} />
            <p className="home-limit">{s.log.limit}</p>
          </>
        ),
      },
      { id: "kill", at: kf.verdict1, weight: 0.9, content: <StepText lead={s.kill.lead} more={s.kill.more} /> },
      {
        id: "heir",
        at: kf.heir1,
        weight: 1.2,
        hold: 0.7,
        content: (
          <>
            <Claim id="S1" className="home-claim--lead" />
            <StepText more={s.heir.more} />
            <Claim id="S3" />
            <Claim id="S4" />
          </>
        ),
      },
      { id: "adopt", at: kf.adopt1, weight: 0.8, content: <StepText lead={s.adopt.lead} more={s.adopt.more} /> },
      { id: "again", at: kf.killLast, weight: 1.3, hold: 0.1, content: <StepText lead={s.again.lead} more={chain} /> },
      {
        id: "done",
        at: kf.settled,
        weight: 1.1,
        content: (
          <>
            <StepText lead={s.done.lead} />
            <div className="home-figures">
              <Figure value={result?.placed} format={count} label={COPY.solution.finish.placed} tone="swarm" size="stat" />
              <Figure value={result?.hardViolations} format={count} label={COPY.solution.finish.violations} tone="ok" size="stat" />
              <Figure value={result?.duplicateCalls} format={count} label={COPY.solution.finish.duplicates} tone="plain" size="stat" />
              <Figure value={result?.costUsd} format={(n) => usd(n)} label={COPY.solution.finish.cost} tone="plain" size="stat" />
            </div>
            <Setting>{setting}</Setting>
            <Claim id="S2" className="home-claim--small" />
          </>
        ),
      },
    ];
    // The copy is constant; the sentences change only with the data.
  }, [story]);

  return (
    <section id="solution" className="home-chapter" aria-labelledby="solution-title">
      <Stage
        id="solution-stage"
        label={COPY.solution.visual}
        steps={steps}
        visual={({ progress, position, still }) => <SolutionVisual progress={progress} position={position} still={still} />}
      />
    </section>
  );
}

function SolutionVisual({
  progress,
  position,
  still,
}: {
  progress: MotionValue<number>;
  position: MotionValue<number>;
  still: boolean;
}) {
  // The survivors' panels take the tree's place while they work out the heir, then give it back.
  const hrwProgress = useTransform(progress, (v) => clamp01((v - BEATS.verdict1) / Math.max(BEATS.adopt1 - BEATS.verdict1, 1e-6)));
  const hrwOpacity = useTransform(position, [3.5, 3.95, 4.45, 4.9], [0, 1, 1, 0]);
  const treeOpacity = useTransform(position, [3.5, 3.95, 4.45, 4.9], [1, 0.12, 0.12, 1]);
  const stripOpacity = useTransform(position, [1.3, 2], [0, 1]);
  return (
    <div className="home-solution">
      <m.div className="home-solution__tree" style={{ opacity: still ? 1 : treeOpacity }}>
        <Viz name="SwarmTree" progress={progress} still={still} pacing="story" />
      </m.div>
      <m.div className="home-solution__hrw" style={{ opacity: still ? 0 : hrwOpacity }}>
        <Viz name="HrwPanels" progress={hrwProgress} still={still} />
      </m.div>
      <m.div className="home-solution__strip" style={{ opacity: still ? 1 : stripOpacity }}>
        <Viz name="HashStrip" progress={progress} still={still} />
      </m.div>
    </div>
  );
}
