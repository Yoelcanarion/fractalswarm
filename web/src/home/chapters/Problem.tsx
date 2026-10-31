import { useRef, useState } from "react";

import { COPY } from "../copy";
import { percent, seconds } from "../format";
import { useArrival } from "../hooks";
import { captionFor, facts, heroReading } from "../numbers";
import { SectionHead, Setting } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { PartsDiagram } from "../parts/PartsDiagram";
import { Repeat } from "../parts/Repeat";
import { FoldRow, SeeMore } from "../parts/SeeMore";
import { useStory } from "../story";
import { ProblemFilm } from "../viz/film/ProblemFilm";
import { captionsFor } from "../viz/lanes/WorkLanes";

/**
 * The problem, as a short film of the real work lanes of an in-process supervisor. It starts by itself when the film is
 * about 40% on screen and then runs on its own clock; the Repeat button plays it again from the start. The numbers, the
 * better supervisor and the rival's reason are folded under it.
 */
export function Problem() {
  const story = useStory();
  const f = facts(story);
  const rival = heroReading(story, "central");
  const swarm = heroReading(story, "swarm");

  const film = useRef<HTMLElement>(null);
  const arrived = useArrival(film);
  const [again, setAgain] = useState(0);
  const play = arrived ? 1 + again : 0;
  const s = COPY.problem.more;
  // the film draws no setting of its own (its captions need the room): the run it plays is named here, longest form first
  const filmSetting = story?.lanes?.central ? captionsFor(story.lanes.central)[0] : undefined;

  return (
    <section id="problem" className="home-section home-problem" aria-labelledby="problem-title">
      <div className="home-wrap">
        <SectionHead id="problem" title={COPY.problem.title}>
          <p className="home-section__line">{COPY.problem.line}</p>
        </SectionHead>
        <figure ref={film} className="home-film" aria-label={COPY.problem.film}>
          <ProblemFilm play={play} />
        </figure>
        <div className="home-section__tools home-section__tools--key">
          <Repeat onClick={() => setAgain((n) => n + 1)} />
          <p className="home-film__key">{COPY.problem.key}</p>
        </div>
        <SeeMore>
          <FoldRow
            side={
              <div className="home-pair">
                <div className="home-pair__side">
                  <p className="home-pair__who">{s.rival}</p>
                  <Figure value={rival.stallS} format={(n) => seconds(n)} label={COPY.labels.stalled} tone="rival" />
                  <Figure value={rival.extraCostPct} format={(n) => percent(n)} label={COPY.labels.extraCostBasis} tone="paid-twice" />
                </div>
                <div className="home-pair__side">
                  <p className="home-pair__who">{s.swarm}</p>
                  <Figure value={swarm.stallS} format={(n) => seconds(n)} label={COPY.labels.stalled} tone="swarm" />
                  <Figure value={swarm.extraCostPct} format={(n) => percent(n)} label={COPY.labels.extraCostBasis} tone="swarm" />
                </div>
              </div>
            }
            after={
              <>
                <Setting>
                  {captionFor(story, "hero")} {"·"} {COPY.rivalReason}
                </Setting>
                <Claim id="R5" className="home-claim--small" />
              </>
            }
          >
            {filmSetting && (
              <Setting>
                {s.film} {filmSetting}
              </Setting>
            )}
            <p className="home-fold__text">{s.example(f)}</p>
            <p className="home-fold__text">{s.numbers}</p>
          </FoldRow>
          <FoldRow
            middle
            side={
              <>
                <figure className="home-fold__figure">
                  <PartsDiagram workers={f.agents} />
                </figure>
                <Claim id="S3" className="home-fold__under" />
              </>
            }
          >
            <p className="home-fold__text home-fold__text--lead">{s.better}</p>
          </FoldRow>
        </SeeMore>
      </div>
    </section>
  );
}
