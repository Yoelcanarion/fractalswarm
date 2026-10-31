// The guide every page can show: three steps, in the order a person meets them. What it says about a recorded run is what a recorded
// run does: it cannot be changed, so its kills are watched, and a run of one's own starts on New task. On the static showcase, which has no
// server, two of the sentences say what is true there instead (`guideSteps`). Pure, but for the seen flag.

import type { Site } from "./controls";

export interface GuideStep {
  id: "choose" | "kill" | "verify";
  title: string;
  says: string;
  /** Where the step can be done, when it is somewhere. */
  action?: { label: string; href: string };
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: "choose",
    title: "Choose a run",
    says: "A run is one recording of the swarm at work. Pick one on the Runs page, or open the final run, the one to start with.",
    action: { label: "Open the final run", href: "#/run" },
  },
  {
    id: "kill",
    title: "Kill half the brains",
    says: "In the final run half of the coordinators were killed on purpose: press Play and watch the rest take over. A recording cannot be changed; to kill some yourself, start a run.",
    action: { label: "Start a run", href: "#/new" },
  },
  {
    id: "verify",
    title: "Verify the replay",
    says: "A run is played again from its log and must give the same hash. “Replay verified ✓” means every event matches. A recorded run checks itself when it opens.",
  },
];

/** The two sentences that differ on the static showcase: nothing is started from it, and a recording's replay was checked when the site was built,
 * not when it opened. The headings and the links are the same, so a first visit's short band does not change when the capabilities arrive. */
const STATIC_SAYS: Readonly<Partial<Record<GuideStep["id"], string>>> = {
  kill: "In the final run half of the coordinators were killed on purpose: press Play and watch the rest take over. A recording cannot be changed, and this site starts no run: to kill some, run the app yourself.",
  verify:
    "A run is played again from its log and must give the same hash. “Replay verified” means every event matches. Here that was done when the site was built, not in your browser; the badge names the commit.",
};

const STATIC_STEPS: readonly GuideStep[] = GUIDE_STEPS.map((step) => ({ ...step, says: STATIC_SAYS[step.id] ?? step.says }));

/** The steps for where the app runs. */
export const guideSteps = (site: Site): readonly GuideStep[] => (site === "static" ? STATIC_STEPS : GUIDE_STEPS);

/** How much of the guide shows: none of it; the short band a first visit gets, with a heading and where it is done for each step; or the whole
 * of it, with what each step says. */
export type GuideMode = "closed" | "short" | "full";

/** What the Guide button in the top bar does: it asks for the sentences when there are none, and closes them when they are showing. */
export const afterGuideButton = (mode: GuideMode): GuideMode => (mode === "full" ? "closed" : "full");

/** Whether this browser has been shown the guide. It is a convenience: with no storage the guide simply shows each time. */
export const GUIDE_KEY = "fractalswarm.guide.seen";

export function guideSeen(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberGuide(): void {
  try {
    window.localStorage.setItem(GUIDE_KEY, "1");
  } catch {
    // private window, blocked storage: it will be offered again, which is harmless
  }
}
