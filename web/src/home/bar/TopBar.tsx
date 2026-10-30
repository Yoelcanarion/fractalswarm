import { ArrowRight } from "lucide-react";

import { targetHash } from "../route";
import { COPY } from "../copy";
import { scrollToTarget, scrollToTop } from "../scrollTo";
import { ThemeSwitch } from "./ThemeSwitch";

/** The small fixed bar: the brand, the way into the simulation (always within reach), and the theme. */
export function TopBar() {
  return (
    <header className="home-bar">
      <a className="home-bar__brand" href="#/" onClick={(event) => scrollToTop(event)}>
        <span className="home-bar__mark" aria-hidden>
          {"◆"}
        </span>
        {COPY.bar.brand}
      </a>
      <div className="home-bar__right">
        <a className="home-button home-button--primary home-button--small" href={targetHash("enter")} onClick={(event) => scrollToTarget("enter", event)}>
          {COPY.bar.enter}
          <ArrowRight size={16} aria-hidden />
        </a>
        <ThemeSwitch />
      </div>
    </header>
  );
}
