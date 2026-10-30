import { useMemo } from "react";

import { COPY } from "../copy";
import { count, usd } from "../format";
import { facts, finish, runSetting, settingText, takeover, treeBeats } from "../numbers";
import { ChapterHead, Setting, StepText } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { Layer, Stage, type StageStep, type StageVisualContext } from "../scroll/Stage";
import { slice, useStory, type Story } from "../story";
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
  const setting = settingText(story, runSetting(story));

  // Each step names where the tree's progress goes while it is current and how long it takes to get there (`play`, in
  // seconds: the tree's own clock is 36 s long, so these are speed-ups of the recorded run, and the reading time is the
  // step's). The survivors' panels play on a channel of their own (`hrw`), and the hash strip, the tree and the panels
  // are layers that come and go by step.
  const steps = useMemo((): StageStep[] => {
    const s = COPY.solution.steps;
    const chain = run.rootChain.length ? `${s.again.more} ${run.rootChain.join(" → ")}.` : s.again.more;
    return [
      {
        id: "intro",
        at: 0,
        weight: 0.7,
        layers: { strip: 0, tree: 1, hrw: 0 },
        content: (
          <ChapterHead id="solution" number="02" eyebrow={COPY.solution.eyebrow} title={COPY.solution.title}>
            <p>{COPY.solution.lede(f)}</p>
          </ChapterHead>
        ),
      },
      { id: "tree", at: kf.grown, play: 1.2, content: <StepText lead={s.tree.lead} more={s.tree.more} /> },
      {
        id: "log",
        at: kf.log,
        weight: 0.6,
        play: 1.1,
        layers: { strip: 1 },
        content: (
          <>
            <Claim id="S6" className="home-claim--lead" />
            <StepText more={s.log.more} />
            <p className="home-limit">{s.log.limit}</p>
          </>
        ),
      },
      { id: "kill", at: kf.kill1, play: 1.1, content: <StepText lead={s.kill.lead} more={s.kill.more} /> },
      // The heartbeats stop, the survivors agree the root is dead and each works out the heir alone: the tree goes back and the
      // panels play on top of it, from the verdict to the heir.
      {
        id: "heir",
        at: kf.heir1,
        weight: 0.6,
        play: 2.6,
        to: { hrw: 1 },
        layers: { tree: 0.12, hrw: 1 },
        content: (
          <>
            <Claim id="S1" className="home-claim--lead" />
            <StepText more={s.heir.more} />
            <Claim id="S3" />
            <Claim id="S4" />
          </>
        ),
      },
      { id: "adopt", at: kf.adopt1, play: 1.2, layers: { tree: 1, hrw: 0 }, content: <StepText lead={s.adopt.lead} more={s.adopt.more} /> },
      // The other four kills play between the adoption and this step, in two and a half seconds.
      { id: "again", at: kf.kill5, play: 2.5, content: <StepText lead={s.again.lead} more={chain} /> },
      {
        id: "done",
        at: kf.settled,
        play: 1.8,
        weight: 0.9,
        content: (
          <>
            <StepText lead={s.done.lead} />
            <div className="home-figures">
              <Figure value={result?.talksPlaced} format={count} label={COPY.solution.finish.placed} tone="swarm" size="stat" />
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
        visual={({ progress, channels, still }) => <SolutionVisual story={story} progress={progress} channels={channels} still={still} />}
      />
    </section>
  );
}

function SolutionVisual({ story, progress, channels, still }: { story: Story | null; progress: StageVisualContext["progress"]; channels: StageVisualContext["channels"]; still: boolean }) {
  return (
    <div className="home-solution">
      <Layer name="tree" className="home-solution__tree">
        <Viz name="SwarmTree" data={slice(story, "tree")} progress={progress} still={still} pacing="story" />
      </Layer>
      {/* the survivors' panels have no place of their own in the still page: they are one of the tree's moments */}
      {!still && (
        <Layer name="hrw" className="home-solution__hrw">
          <Viz name="HrwPanels" data={slice(story, "hrw")} progress={channels.hrw} still={false} />
        </Layer>
      )}
      <Layer name="strip" className="home-solution__strip">
        <Viz name="HashStrip" data={slice(story, "hashes")} progress={progress} still={still} />
      </Layer>
    </div>
  );
}
