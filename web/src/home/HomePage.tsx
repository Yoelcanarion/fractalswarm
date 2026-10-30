import "./home.css";

import { useEffect, useState } from "react";

import { TopBar } from "./bar/TopBar";
import { Enter } from "./chapters/Enter";
import { Hero } from "./chapters/Hero";
import { Problem } from "./chapters/Problem";
import { Proof } from "./chapters/Proof";
import { Solution } from "./chapters/Solution";
import { COPY } from "./copy";
import { StillContext, useIsoLayoutEffect, usePrefersReducedMotion } from "./hooks";
import { targetHash, currentHash, currentSearch, parseHomeAddress } from "./route";
import { jumpToTarget } from "./scrollTo";
import { bundledStory, StoryContext, type Story } from "./story";

const readAddress = () => parseHomeAddress(currentHash(), currentSearch());

/** The page as a picture of its two inputs: the story, and whether everything stands still. It looks at nothing in the
 * browser, so the tests render it to a string.
 *
 * Five sections, none pinned, none that follows the scroll: scrolling only starts an animation (`useArrival`), and the
 * animation then runs on its own clock. Nothing draws with an `m` component: the minimal `m` has no renderer without a
 * LazyMotion above it (it draws the value it had at the first render and never subscribes again), so if one comes back the
 * provider has to come back with it: `motion.test.ts` holds that either way. */
export function HomeView({ story, still }: { story: Story | null; still: boolean }) {
  return (
    <StoryContext.Provider value={story}>
      <StillContext.Provider value={still}>
        <div className="home" data-still={still ? "" : undefined}>
          <a className="home-skip" href={targetHash("problem")}>
            {COPY.bar.skip}
          </a>
          <TopBar />
          <main>
            <Hero />
            <Problem />
            <Solution />
            <Proof />
            <Enter />
          </main>
          <footer className="home-footer">
            <p>{COPY.footer}</p>
          </footer>
        </div>
      </StillContext.Provider>
    </StoryContext.Provider>
  );
}

/** The home page: five short sections, ending in a menu into the simulation. It makes no API call, so it also works with
 * no server. `story` is the generated data: the bundled file, unless a test passes its own. */
export function HomePage({ story = bundledStory }: { story?: Story | null }) {
  const reduced = usePrefersReducedMotion();
  const [address, setAddress] = useState(readAddress);

  useEffect(() => {
    const onHash = () => setAddress(readAddress());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // `#/?at=solution` opens the page at that section, before the first paint. Fonts shift the layout a little as they
  // arrive, so it lands again once they are in, unless the person has already moved the page (a wheel, a touch, a key or a
  // click: none of them reads where the page is scrolled to).
  useIsoLayoutEffect(() => {
    const target = address.target;
    if (!target) return undefined;
    jumpToTarget(target);
    let moved = false;
    const stop = () => {
      moved = true;
    };
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const name of events) window.addEventListener(name, stop, { passive: true, once: true });
    void document.fonts?.ready.then(() => {
      if (!moved) jumpToTarget(target);
    });
    return () => {
      for (const name of events) window.removeEventListener(name, stop);
    };
  }, [address.target]);

  return <HomeView story={story} still={reduced || address.still} />;
}
