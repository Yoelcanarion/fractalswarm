import { useMotionValue } from "motion/react";
import { ArrowDown } from "lucide-react";
import { useRef } from "react";

import { COPY, TAGLINE } from "../copy";
import { useStill } from "../hooks";
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

/**
 * The shape of the hero's tree, width over height. Its column is a square with one line under the figure, and the run's own picture
 * (almost 1.5 to 1) leaves a third of it empty and every glyph small: the tree is laid out narrower, which draws it larger.
 */
export const HERO_ASPECT = 1.12;

/** What the figure says it is, in the words of docs/claims.md: a recorded run, replayed. It is never called live. */
export const HERO_NOTE = { loop: "A recorded run, replayed on a loop.", still: "The end of a recorded run." } as const;

/** The text column (the page's words, from copy.ts: the tagline, one sentence, a button that glides to the click demo) and the
 * figure on its loop (W7's). Nothing here reads the scroll, and nothing hands over to the next section as it leaves. */
export function Hero() {
  const story = useStory();
  const still = useStill();
  const figure = useRef<HTMLElement>(null);

  const play = useMotionValue(still ? 1 : 0);
  const appear = useMotionValue(still ? 1 : 0);
  useLoop(figure, play, appear, HERO_LOOP, still);

  const tree = slice(story, "tree");

  return (
    <section id="hero" className="home-hero" aria-labelledby="home-title">
      <div className="home-hero__copy">
        <h1 id="home-title" className="home-hero__title">
          {TAGLINE}
        </h1>
        <p className="home-kicker">{COPY.hero.kicker}</p>
        <p className="home-hero__line">{COPY.hero.line}</p>
        <div className="home-hero__actions">
          <a className="home-button home-button--primary" href={targetHash("demo")} onClick={(event) => scrollToTarget("demo", event)}>
            {COPY.hero.kill}
            <ArrowDown size={18} aria-hidden />
          </a>
        </div>
      </div>
      <figure ref={figure} className="home-hero__object" aria-label={COPY.hero.object}>
        <Viz name="SwarmTree" data={tree} progress={play} still={still} pacing="hero" aspect={HERO_ASPECT} ambient appear={appear} />
        {tree != null && (
          <figcaption className="home-hero__note">
            <span>{still ? HERO_NOTE.still : HERO_NOTE.loop}</span>
          </figcaption>
        )}
      </figure>
    </section>
  );
}
