import { ArrowRight } from "lucide-react";

import { COPY } from "../copy";
import { scrollToTop } from "../scrollTo";
import { ThemeSwitch } from "./ThemeSwitch";

/** The small bar at the top: the brand, the way into the app (always within reach, and it goes in, to the Arena, which is the first door), and
 * the theme. On the home page the brand glides to the top; on any other page it is a plain link back to the home page. */
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
        <a className="home-button home-button--primary home-button--small" href="#/arena">
          <span className="home-bar__long">{COPY.bar.enter}</span>
          <span className="home-bar__short">{COPY.bar.enterShort}</span>
          <ArrowRight size={16} aria-hidden />
        </a>
        <ThemeSwitch />
      </div>
    </header>
  );
}
