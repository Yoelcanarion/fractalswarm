import { useEffect, useRef, useState } from "react";

import { COPY } from "../copy";
import { useArrival, useCanHover, useStill } from "../hooks";
import { SectionHead } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { SeeMore } from "../parts/SeeMore";
import { KillDemo } from "../viz/demo/KillDemo";
import { StepDrawing, type StepId } from "../viz/steps/StepDrawing";
import { createTurns, type Turns } from "../viz/steps/turns";

const STEPS: readonly StepId[] = ["log", "heir", "adopt"];

/**
 * Three cards, each a few words and a drawing. Each plays once as it arrives, one after the other, and rests on its last frame; a
 * pointer on it, a key on it or a tap plays it again from its first frame. Under them, the click demo. The terms of the design are
 * folded.
 */
export function Solution() {
  const [turns] = useState(createTurns);
  return (
    <section id="solution" className="home-section home-solution" aria-labelledby="solution-title">
      <div className="home-wrap">
        <SectionHead id="solution" title={COPY.solution.title}>
          <p className="home-section__line">{COPY.solution.line}</p>
        </SectionHead>
        <ul className="home-steps">
          {STEPS.map((step) => (
            <StepCard key={step} step={step} turns={turns} />
          ))}
        </ul>
        <div id="demo" className="home-demo">
          <h3 className="home-sr">{COPY.solution.demo.title}</h3>
          <p className="home-demo__label">{COPY.solution.demo.label}</p>
          <KillDemo />
        </div>
        <SeeMore>
          <p className="home-fold__text">{COPY.solution.more.terms}</p>
          <Claim id="S1" className="home-claim--lead" />
          <Claim id="S3" />
          <Claim id="S6" className="home-claim--small" />
          <p className="home-limit">{COPY.solution.more.limit}</p>
        </SeeMore>
      </div>
    </section>
  );
}

function StepCard({ step, turns }: { step: StepId; turns: Turns }) {
  const still = useStill();
  const canHover = useCanHover();
  const card = useRef<HTMLLIElement>(null);
  const arrived = useArrival(card);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [played, setPlayed] = useState(false);
  const [replay, setReplay] = useState(0);
  const text = COPY.solution.cards[step];

  // On arrival the card waits for the cards before it, plays once, and rests on its last frame.
  useEffect(() => {
    if (!arrived || played) return undefined;
    const wait = window.setTimeout(() => setPlayed(true), turns.take(step, performance.now()));
    return () => window.clearTimeout(wait);
  }, [arrived, played, step, turns]);

  /** Plays the card again from its first frame, or for the first time at once if it has not had its turn. */
  const again = () => {
    setPlayed(true);
    if (played) setReplay((n) => n + 1);
  };

  const active = still || (canHover ? hover || focus : played);

  return (
    <li
      ref={card}
      className="home-step"
      data-active={active ? "" : undefined}
      tabIndex={0}
      onPointerEnter={() => {
        setHover(true);
        if (canHover) again();
      }}
      onPointerLeave={() => setHover(false)}
      onFocus={(event) => {
        setFocus(true);
        if (event.currentTarget.matches(":focus-visible")) again();
      }}
      onBlur={() => setFocus(false)}
      onClick={() => !canHover && again()}
    >
      <div className="home-step__drawing" aria-hidden>
        <StepDrawing step={step} active={still || played} replay={replay} />
      </div>
      <h3 className="home-step__title">{text.title}</h3>
      <p className="home-sr">{text.drawing}</p>
    </li>
  );
}
