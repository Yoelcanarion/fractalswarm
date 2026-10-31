import { ArrowRight } from "lucide-react";

import { COPY } from "../copy";
import { targetHash } from "../route";
import { scrollToTarget, scrollToTop } from "../scrollTo";
import { ThemeSwitch } from "./ThemeSwitch";

/** The small bar at the top: the brand, the way into the simulation (always within reach), and the theme. On the home page
 * the brand and the way in glide to a place on the page; on any other page they are plain links back to the home page. */
export function TopBar({ onHome = true }: { onHome?: boolean }) {
  return (
    <header className="home-bar">
      <a className="home-bar__brand" href="#/" onClick={onHome ? (event) => scrollToTop(event) : undefined}>
        <span className="home-bar__mark" aria-hidden>
          {"◆"}
        </span>
        {COPY.bar.brand}
      </a>
      <div className="home-bar__right">
        <a
          className="home-button home-button--primary home-button--small"
          href={targetHash("enter")}
          onClick={onHome ? (event) => scrollToTarget("enter", event) : undefined}
        >
          <span className="home-bar__long">{COPY.bar.enter}</span>
          <span className="home-bar__short">{COPY.bar.enterShort}</span>
          <ArrowRight size={16} aria-hidden />
        </a>
        <ThemeSwitch />
      </div>
    </header>
  );
}
