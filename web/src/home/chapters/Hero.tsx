import { animate, m, useMotionValue, useScroll, useTransform } from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { COPY, TAGLINE } from "../copy";
import { percent, seconds } from "../format";
import { useStill } from "../hooks";
import { heroReading, heroSetting, settingText } from "../numbers";
import { Claim } from "../parts/Claim";
import { Reveal } from "../parts/Reveal";
import { scrollToChapter } from "../scrollTo";
import { slice, useStory } from "../story";
import { Viz } from "../viz";

// The tree plays its recorded sequence once, on load, in about eight seconds, then breathes (W7's visual).
const PLAY_SECONDS = 8;

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

  const rival = heroReading(story, "central");
  const swarm = heroReading(story, "swarm");
  const setting = settingText({ task: heroSetting(story).task, crashes: swarm.crashes, profile: swarm.profile, real: heroSetting(story).real, seeds: rival.seeds });

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
          <p className="home-hero__line">
            <span className="home-hero__versus">{COPY.hero.versus}:</span> {COPY.hero.stall} <strong>{seconds(swarm.stallS)}</strong> {COPY.hero.against}{" "}
            {seconds(rival.stallS)}, <strong>{percent(swarm.extraCostPct)}</strong> {COPY.hero.cost} {COPY.hero.against} {percent(rival.extraCostPct)}.
          </p>
          <p className="home-setting">
            {setting} {"·"} {COPY.rivalReason}
          </p>
          <div className="home-hero__tie">
            <Claim id="R2" className="home-hero__line" />
            <a className="home-link" href="#/?at=evidence" onClick={(event) => scrollToChapter("evidence", event)}>
              {COPY.hero.conditions}
              <ArrowDown size={14} aria-hidden />
            </a>
          </div>
        </Reveal>
        <Reveal delay={220} className="home-hero__actions">
          <a className="home-button home-button--primary" href="#/?at=problem" onClick={(event) => scrollToChapter("problem", event)}>
            {COPY.hero.how}
            <ArrowDown size={18} aria-hidden />
          </a>
          <a className="home-button" href="#/?at=enter" onClick={(event) => scrollToChapter("enter", event)}>
            {COPY.hero.enter}
            <ArrowRight size={18} aria-hidden />
          </a>
        </Reveal>
      </m.div>
      <m.figure className="home-hero__object" aria-label={COPY.hero.object} style={still ? undefined : { scale: objectScale, opacity: objectOpacity }}>
        <Viz name="SwarmTree" data={slice(story, "tree")} progress={play} still={still} />
      </m.figure>
    </section>
  );
}
