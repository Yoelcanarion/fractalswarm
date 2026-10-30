import { animate, m, useMotionValue, useScroll, useTransform } from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { COPY, TAGLINE } from "../copy";
import { useStill } from "../hooks";
import { captionFor } from "../numbers";
import { Claim } from "../parts/Claim";
import { Reveal } from "../parts/Reveal";
import { targetHash } from "../route";
import { scrollToTarget } from "../scrollTo";
import { slice, useStory } from "../story";
import { Viz } from "../visuals";
import { TREE_HERO_SECONDS } from "../viz/keyframes";

// The tree plays the recorded kill sequence once, on load, at the pace W7 gives its hero (about nine seconds).
const PLAY_SECONDS = TREE_HERO_SECONDS;

export function Hero() {
  const story = useStory();
  const still = useStill();
  const section = useRef<HTMLElement>(null);

  // On scroll the hero hands over: the text lifts and fades, the tree settles back and fades.
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -64]);
  const copyOpacity = useTransform(scrollYProgress, [0.2, 0.7], [1, 0]);
  const objectScale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const objectOpacity = useTransform(scrollYProgress, [0.25, 0.9], [1, 0]);

  const play = useMotionValue(still ? 1 : 0);
  useEffect(() => {
    if (still) {
      play.set(1);
      return;
    }
    const running = animate(play, 1, { duration: PLAY_SECONDS, ease: "linear", delay: 0.5 });
    return () => running.stop();
  }, [still, play]);

  const setting = captionFor(story, "hero");

  return (
    <section ref={section} className="home-hero" aria-labelledby="home-title">
      <m.div className="home-hero__copy" style={still ? undefined : { y: copyY, opacity: copyOpacity }}>
        <Reveal as="p" className="home-kicker">
          {COPY.hero.kicker}
        </Reveal>
        <Reveal delay={60}>
          <h1 id="home-title" className="home-hero__title">
            {TAGLINE}
          </h1>
        </Reveal>
        <Reveal delay={140} className="home-hero__proof">
          {/* R6, in the words of its row, always with the way to R2 and R3 on the same page */}
          <Claim id="R6" lines className="home-hero__line" />
          <a className="home-link" href={targetHash("tie")} onClick={(event) => scrollToTarget("tie", event)}>
            {COPY.hero.conditions}
            <ArrowDown size={14} aria-hidden />
          </a>
          <p className="home-setting">
            {setting} {"·"} {COPY.rivalReason}
          </p>
        </Reveal>
        <Reveal delay={220} className="home-hero__actions">
          <a className="home-button home-button--primary" href={targetHash("problem")} onClick={(event) => scrollToTarget("problem", event)}>
            {COPY.hero.how}
            <ArrowDown size={18} aria-hidden />
          </a>
          <a className="home-button" href={targetHash("enter")} onClick={(event) => scrollToTarget("enter", event)}>
            {COPY.hero.enter}
            <ArrowRight size={18} aria-hidden />
          </a>
        </Reveal>
      </m.div>
      <m.figure className="home-hero__object" aria-label={COPY.hero.object} style={still ? undefined : { scale: objectScale, opacity: objectOpacity }}>
        <Viz name="SwarmTree" data={slice(story, "tree")} progress={play} still={still} pacing="hero" />
      </m.figure>
    </section>
  );
}
