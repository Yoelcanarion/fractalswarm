import "../home.css";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { TopBar } from "../bar/TopBar";
import { COPY } from "../copy";
import { StillContext, useIsoLayoutEffect } from "../hooks";
import { currentHash, parseEvidenceAddress } from "../route";
import { jumpToTarget } from "../scrollTo";
import { bundledStory, StoryContext, type Story } from "../story";
import { Evidence } from "./Evidence";
import { Models } from "./Models";

/** The evidence page as a picture of its story. It is a plain document: nothing on it moves, so its charts are drawn in their
 * final state (the whole page is "still") and it reads the same with or without a preference for less motion. */
export function EvidenceView({ story }: { story: Story | null }) {
  return (
    <StoryContext.Provider value={story}>
      <StillContext.Provider value>
        <div className="home home--evidence" data-still="">
          <TopBar onHome={false} />
          <main className="home-evidence">
            <header className="home-wrap home-evidence__head">
              <a className="home-link" href="#/">
                <ArrowLeft size={14} aria-hidden />
                {COPY.evidencePage.back}
              </a>
              <h1 className="home-evidence__title">{COPY.evidencePage.title}</h1>
              <p className="home-section__line">{COPY.evidencePage.lede}</p>
            </header>
            <Models />
            <Evidence />
          </main>
          <footer className="home-footer">
            <p>{COPY.footer}</p>
          </footer>
        </div>
      </StillContext.Provider>
    </StoryContext.Provider>
  );
}

const readTarget = () => parseEvidenceAddress(currentHash()).target;

/** `#/evidence`, and `#/evidence?at=tie` for a place on it. Like the home page, it makes no API call and works with no server. */
export function EvidencePage({ story = bundledStory }: { story?: Story | null }) {
  const [target, setTarget] = useState(readTarget);

  useEffect(() => {
    const onHash = () => setTarget(readTarget());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Opens at the place the address names, before the first paint, and lands there again once the fonts are in unless the
  // person has already moved the page (a wheel, a touch, a key or a click: none of them reads where the page is).
  useIsoLayoutEffect(() => {
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
  }, [target]);

  return <EvidenceView story={story} />;
}
