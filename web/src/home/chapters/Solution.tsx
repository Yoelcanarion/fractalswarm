import { useRef, useState } from "react";

import { COPY } from "../copy";
import { useArrival, useCanHover, useStill } from "../hooks";
import { SectionHead } from "../parts/Chapter";
import { Claim } from "../parts/Claim";
import { SeeMore } from "../parts/SeeMore";
import { KillDemo, StepDrawing, type StepId } from "../slots";

const STEPS: readonly StepId[] = ["log", "heir", "adopt"];

/**
 * Three cards, each a few words and a drawing that plays while the pointer rests on it or the keyboard is on it, and rests at
 * its end otherwise. A screen that cannot hover plays each card once, when it arrives; a tap plays it again or lets it rest.
 * Under them, the click demo. The terms of the design are folded.
 */
export function Solution() {
  return (
    <section id="solution" className="home-section home-solution" aria-labelledby="solution-title">
      <div className="home-wrap">
        <SectionHead id="solution" title={COPY.solution.title}>
          <p className="home-section__line">{COPY.solution.line}</p>
        </SectionHead>
        <ul className="home-steps">
          {STEPS.map((step) => (
            <StepCard key={step} step={step} />
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

function StepCard({ step }: { step: StepId }) {
  const still = useStill();
  const canHover = useCanHover();
  const card = useRef<HTMLLIElement>(null);
  const arrived = useArrival(card);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [tapped, setTapped] = useState(false);
  const text = COPY.solution.cards[step];

  const active = still || (canHover ? hover || focus : arrived !== tapped);

  return (
    <li
      ref={card}
      className="home-step"
      data-active={active ? "" : undefined}
      tabIndex={0}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onClick={() => !canHover && setTapped((was) => !was)}
    >
      <div className="home-step__drawing" aria-hidden>
        <StepDrawing step={step} active={active} />
      </div>
      <h3 className="home-step__title">{text.title}</h3>
      <p className="home-sr">{text.drawing}</p>
    </li>
  );
}
