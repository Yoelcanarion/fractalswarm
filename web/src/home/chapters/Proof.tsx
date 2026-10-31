import { ArrowRight } from "lucide-react";
import { useRef } from "react";

import { COPY } from "../copy";
import { StillContext, useArrival } from "../hooks";
import { captionFor, proofSteps } from "../numbers";
import { SectionHead, Setting } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { FoldDrawing } from "../parts/FoldDrawing";
import { FoldRow, SeeMore } from "../parts/SeeMore";
import { Terminal } from "../parts/Terminal";
import { evidenceHash } from "../route";
import { useStory } from "../story";
import { ProofBars } from "../viz/charts/ProofBars";
import { SECONDS } from "../viz/ease";
import { HashStrip } from "../viz/hash/HashStrip";

/** How much of the hash chain goes by as it runs to its head: about eight cards, at a pace the eye can follow. */
const CHAIN_TRAVEL = 2000;

/** The command that checks a recorded run, without the `uv run` of the repository's own setup. */
const bare = (command: string): string => command.replace(/^uv run\s+/, "");

/**
 * The proof, in the words of R6: the setting and that every run finished, then bars and numbers that grow by themselves
 * when they come into view. The way to R2 and R3 stays on the section, outside the fold, because R6 is only ever shown
 * with it. The second sentence of R6, the setting, replay's limit and the way to the evidence page are folded, beside the log's
 * hash chain, which runs to its head and the replay's verdict.
 */
export function Proof() {
  const story = useStory();
  const steps = proofSteps(story);
  const chart = useRef<HTMLDivElement>(null);
  const play = useArrival(chart) ? 1 : 0;
  const command = steps[0]?.command;

  return (
    <section id="proof" className="home-section home-proof" aria-labelledby="proof-title">
      <div className="home-wrap">
        <SectionHead id="proof" title={COPY.proof.title}>
          <Claim id="R6" part={0} className="home-section__line" />
        </SectionHead>
        <div ref={chart} className="home-proof__chart" role="group" aria-label={COPY.proof.bars}>
          <ProofBars play={play} />
        </div>
        <div className="home-proof__under">
          <p className="home-setting home-proof__reason">
            {COPY.rivalReason} {COPY.durableReason}
          </p>
          <div className="home-proof__after">
            <p className="home-proof__links">
              <a className="home-link" href={evidenceHash("tie")}>
                {COPY.proof.conditions}
                <ArrowRight size={14} aria-hidden />
              </a>
            </p>
            {command && (
              <p className="home-check">
                <span>{COPY.proof.check}</span> <code className="home-code">{bare(command)}</code>
              </p>
            )}
          </div>
        </div>
        <SeeMore>
          <FoldRow
            side={
              <>
                <Claim id="S5" className="home-claim--lead" />
                <p className="home-limit home-limit--wide">{COPY.proof.more.proves}</p>
                {story && (
                  <FoldDrawing seconds={SECONDS.foldChain} className="home-fold__hash">
                    {(progress, still) => <HashStrip progress={progress} data={story.hashes} still={still} travel={CHAIN_TRAVEL} />}
                  </FoldDrawing>
                )}
                {/* folded, it shows the finished output: it has been asked for, so it does not type itself out */}
                <StillContext.Provider value>
                  <Terminal steps={steps} label={COPY.proof.more.terminal} />
                </StillContext.Provider>
              </>
            }
            after={
              <>
                <p className="home-fold__text">{COPY.proof.more.lead}</p>
                <a className="home-button" href={evidenceHash()}>
                  {COPY.proof.more.link}
                  <ArrowRight size={18} aria-hidden />
                </a>
                <p className="home-limit home-limit--wide">{COPY.proof.more.provenance}</p>
              </>
            }
          >
            <Claim id="R6" part={1} />
            <Setting>
              {captionFor(story, "hero")} {"·"} {COPY.rivalReason}
            </Setting>
            <Claim id="R5" className="home-claim--small" />
            <Claim id="R7" className="home-claim--small" />
          </FoldRow>
        </SeeMore>
      </div>
    </section>
  );
}
