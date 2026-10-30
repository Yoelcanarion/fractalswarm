import "./home.css";

import { domMin, LazyMotion } from "motion/react";
import { useEffect, useState } from "react";

import { ChapterRail, useActiveChapter } from "./bar/ChapterRail";
import { TopBar } from "./bar/TopBar";
import { Enter } from "./chapters/Enter";
import { Evidence } from "./chapters/Evidence";
import { Hero } from "./chapters/Hero";
import { Models } from "./chapters/Models";
import { Problem } from "./chapters/Problem";
import { Solution } from "./chapters/Solution";
import { COPY } from "./copy";
import { StillContext, useIsoLayoutEffect, usePrefersReducedMotion } from "./hooks";
import { targetHash, currentHash, currentSearch, parseHomeAddress } from "./route";
import { jumpToTarget } from "./scrollTo";
import { bundledStory, StoryContext, type Story } from "./story";

const readAddress = () => parseHomeAddress(currentHash(), currentSearch());

/** The page as a picture of its three inputs: the story, whether everything stands still, and the chapter being read.
 * It looks at nothing in the browser, so the tests render it to a string.
 *
 * The page's `m` components (the cards of a stage, its layers, the hero) take motion values in `style`. The minimal `m`
 * has no renderer of its own: without a LazyMotion above it, it draws the value it has at the first render and never
 * subscribes to the value again, so nothing it holds would ever fade or move. `domMin` is the smallest bundle that
 * carries the renderer; `motion.test.ts` keeps this provider here for as long as a file uses `m`. */
export function HomeView({ story, still, active }: { story: Story | null; still: boolean; active: number }) {
  return (
    <LazyMotion features={domMin}>
      <StoryContext.Provider value={story}>
        <StillContext.Provider value={still}>
          <div className="home" data-still={still ? "" : undefined}>
            <a className="home-skip" href={targetHash("problem")}>
              {COPY.bar.skip}
            </a>
            <TopBar />
            <ChapterRail active={active} />
            <main>
              <Hero />
              <Problem />
              <Solution />
              <Models />
              <Evidence />
              <Enter />
            </main>
            <footer className="home-footer">
              <p>{COPY.footer}</p>
            </footer>
          </div>
        </StillContext.Provider>
      </StoryContext.Provider>
    </LazyMotion>
  );
}

/** The home page: a presentation told while you scroll, ending in a menu into the simulation. It makes no API call, so it
 * also works with no server. `story` is the generated data: the bundled file, unless a test passes its own. */
export function HomePage({ story = bundledStory }: { story?: Story | null }) {
  const reduced = usePrefersReducedMotion();
  const [address, setAddress] = useState(readAddress);
  const active = useActiveChapter();

  useEffect(() => {
    const onHash = () => setAddress(readAddress());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // `#/?at=solution` opens the page at that chapter, before the first paint. Fonts and charts shift the layout as they
  // arrive, so it lands again once they are in, unless the person has already scrolled away.
  useIsoLayoutEffect(() => {
    if (!address.target) return;
    jumpToTarget(address.target);
    const landed = window.scrollY;
    void document.fonts?.ready.then(() => {
      if (Math.abs(window.scrollY - landed) < 4 && address.target) jumpToTarget(address.target);
    });
  }, [address.target]);

  return <HomeView story={story} still={reduced || address.still} active={active} />;
}
