import { useMotionValue } from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";

import { COPY, TAGLINE } from "../copy";
import { useStill } from "../hooks";
import { captionFor, runSetting, settingText } from "../numbers";
import { Claim } from "../parts/Claim";
import { Reveal } from "../parts/Reveal";
import { targetHash } from "../route";
import { scrollToTarget } from "../scrollTo";
import { slice, useStory } from "../story";
import { Viz } from "../visuals";
import { TREE_HERO_SECONDS } from "../viz/keyframes";
import type { LoopSpec } from "../viz/loop";
import { useLoop } from "../viz/useLoop";
import "./hero.css";

/**
 * The hero plays the recorded run again and again, for as long as it is on screen: the tree grows from its root, the run plays
 * at the pace W7 gives the hero (about nine seconds), the settled tree rests, and the tree folds back into its root to grow
 * again. It is a replay, so the run clock starts over with it and never counts past the end of the run.
 */
export const HERO_LOOP: LoopSpec = { enter: 1.3, run: TREE_HERO_SECONDS, rest: 1.8, leave: 0.9 };

/** What the figure says it is, in the words of docs/claims.md: a recorded run, replayed. It is never called live. */
export const HERO_NOTE = { loop: "A recorded run, replayed on a loop.", still: "The end of a recorded run." } as const;

/** The share of the hero that must still be on screen for its text and tree to stay. */
const STAYS = 0.35;

/**
 * The hero hands over to the next chapter as a state change on a clock (a CSS transition, which the browser runs off the
 * main thread), not as a style recomputed from the scroll position on every frame, which lands late on a browser that
 * scrolls on its compositor.
 */
function useHandOver(section: RefObject<HTMLElement | null>, off: boolean): void {
  useEffect(() => {
    const element = section.current;
    if (!element || off || typeof IntersectionObserver === "undefined") return undefined;
    const watcher = new IntersectionObserver(
      (records) => {
        const latest = records[records.length - 1];
        if (latest) element.toggleAttribute("data-leaving", latest.intersectionRatio < STAYS);
      },
      { threshold: [0, STAYS] },
    );
    watcher.observe(element);
    return () => {
      watcher.disconnect();
      element.removeAttribute("data-leaving");
    };
  }, [section, off]);
}

export function Hero() {
  const story = useStory();
  const still = useStill();
  const section = useRef<HTMLElement>(null);
  const figure = useRef<HTMLElement>(null);

  const play = useMotionValue(still ? 1 : 0);
  const appear = useMotionValue(still ? 1 : 0);
  useLoop(figure, play, appear, HERO_LOOP, still);
  useHandOver(section, still);

  const setting = captionFor(story, "hero");
  const tree = slice(story, "tree");

  return (
    <section ref={section} className="home-hero" aria-labelledby="home-title">
      <div className="home-hero__copy">
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
      </div>
      <figure ref={figure} className="home-hero__object" aria-label={COPY.hero.object}>
        <Viz name="SwarmTree" data={tree} progress={play} still={still} pacing="hero" ambient appear={appear} />
        {tree != null && (
          <figcaption className="home-hero__note">
            <span>{still ? HERO_NOTE.still : HERO_NOTE.loop}</span>
            <span>{settingText(story, runSetting(story))}</span>
          </figcaption>
        )}
      </figure>
    </section>
  );
}
