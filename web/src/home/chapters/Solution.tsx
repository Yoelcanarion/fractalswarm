import { m, useTransform, type MotionValue } from "motion/react";
import { useMemo } from "react";

import { COPY } from "../copy";
import { count, usd } from "../format";
import { facts, finish, keyframes, settingText, takeover } from "../numbers";
import { ChapterHead, Setting, StepText } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { Stage, type StageStep } from "../scroll/Stage";
import { clamp01 } from "../scroll/timeline";
import { slice, useStory, type Story } from "../story";
import { exportedTreeKeyframes, Viz } from "../viz";

// Where the real kill sequence of the demo bundle sits in the tree's progress, if neither the data
// (tree.keyframes) nor the visual (TREE_KEYFRAMES) says. The text below follows these names.
const TREE_DEFAULTS = { grown: 0.12, log: 0.12, kill1: 0.32, verdict1: 0.4, heir1: 0.46, adopt1: 0.54, kill5: 0.88, settled: 1 };

export function Solution() {
  const story = useStory();
  const f = facts(story);
  const kf = keyframes(story, "tree", { ...TREE_DEFAULTS, ...exportedTreeKeyframes });
  const result = finish(story);
  const run = takeover(story);
  const setting = settingText({
    task: result.task ?? null,
    crashes: run.killed ?? null,
    profile: null,
    real: typeof result.real === "boolean" ? result.real : null,
    seeds: result.seeds ?? null,
  });

  const steps: StageStep[] = useMemo(() => {
    const s = COPY.solution.steps;
    const chain = run.rootChain?.length ? `${s.again.more} ${run.rootChain.join(" → ")}.` : s.again.more;
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
      { id: "again", at: kf.kill5, weight: 1.3, hold: 0.1, content: <StepText lead={s.again.lead} more={chain} /> },
      {
        id: "done",
        at: kf.settled,
        weight: 1.1,
        content: (
          <>
            <StepText lead={s.done.lead} />
            <div className="home-figures">
              <Figure value={result.talksPlaced} format={count} label={COPY.solution.finish.placed} tone="swarm" size="stat" />
              <Figure value={result.hardViolations} format={count} label={COPY.solution.finish.violations} tone="ok" size="stat" />
              <Figure value={result.duplicateCalls} format={count} label={COPY.solution.finish.duplicates} tone="plain" size="stat" />
              <Figure value={result.costUsd} format={(n) => usd(n)} label={COPY.solution.finish.cost} tone="plain" size="stat" />
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
        visual={({ progress, position, still }) => <SolutionVisual story={story} kf={kf} progress={progress} position={position} still={still} />}
      />
    </section>
  );
}

function SolutionVisual({
  story,
  kf,
  progress,
  position,
  still,
}: {
  story: Story | null;
  kf: Record<string, number>;
  progress: MotionValue<number>;
  position: MotionValue<number>;
  still: boolean;
}) {
  // The survivors' panels take the tree's place while they work out the heir, then give it back.
  const hrwProgress = useTransform(progress, (v) => clamp01((v - kf.verdict1) / Math.max(kf.heir1 - kf.verdict1, 1e-6)));
  const hrwOpacity = useTransform(position, [3.5, 3.95, 4.45, 4.9], [0, 1, 1, 0]);
  const treeOpacity = useTransform(position, [3.5, 3.95, 4.45, 4.9], [1, 0.12, 0.12, 1]);
  const stripOpacity = useTransform(position, [1.3, 2], [0, 1]);
  return (
    <div className="home-solution">
      <m.div className="home-solution__tree" style={{ opacity: still ? 1 : treeOpacity }}>
        <Viz name="SwarmTree" data={slice(story, "tree")} progress={progress} still={still} />
      </m.div>
      <m.div className="home-solution__hrw" style={{ opacity: still ? 0 : hrwOpacity }}>
        <Viz name="HrwPanels" data={slice(story, "hrw")} progress={hrwProgress} still={still} />
      </m.div>
      <m.div className="home-solution__strip" style={{ opacity: still ? 1 : stripOpacity }}>
        <Viz name="HashStrip" data={slice(story, "hashes")} progress={progress} still={still} />
      </m.div>
    </div>
  );
}
