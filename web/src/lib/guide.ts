// The guide every page can show: three steps, in the order a person meets them. What it says about a recorded run is what a recorded
// run does: it cannot be changed, so its kills are watched, and a run of one's own starts on New task. On the static showcase, which has no
// server, two of the sentences and one link say what is true there instead (`guideSteps`). Pure, but for the seen flag.

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
    action: { label: "Verify one on Runs", href: "#/runs?details=all" },
  },
];

/** What differs on the static showcase. Nothing is started from it, so step 2 says so and points at the arena, where the kills are watched in a
 * pair of recordings; and a recording's replay was checked when the site was built, not when it opened. The headings are the same. The site
 * is known from the first paint (`siteOf`: the build's mode), so the short band, which shows the links, has the right ones when it first draws. */
const STATIC_CHANGES: Readonly<Partial<Record<GuideStep["id"], Partial<Pick<GuideStep, "says" | "action">>>>> = {
  kill: {
    says: "In the final run half of the coordinators were killed on purpose: press Play and watch the rest take over. A recording cannot be changed, and this site starts no run: to kill some, run the app yourself.",
    action: { label: "Watch it in the arena", href: "#/arena" },
  },
  verify: {
    says: "A run is played again from its log and must give the same hash. That replay ran when this site was built, not in your browser. On Runs your browser can recompute every hash of the log itself.",
    action: { label: "Recompute on Runs", href: "#/runs?details=all" },
  },
};

const STATIC_STEPS: readonly GuideStep[] = GUIDE_STEPS.map((step) => ({ ...step, ...STATIC_CHANGES[step.id] }));

/** The steps for where the app runs. */
export const guideSteps = (site: Site): readonly GuideStep[] => (site === "static" ? STATIC_STEPS : GUIDE_STEPS);

/** How much of the guide shows: none of it; the short band a first visit gets, with a heading and where it is done for each step; or the whole
 * of it, with what each step says. */
export type GuideMode = "closed" | "short" | "full";

/** Whether the guide shows. A page with numbered steps of its own does not get the short band as well, which would be two lists of 1, 2, 3 on
 * one screen; the band waits for the next page, and the Guide button still brings the whole of it. */
export const guideShows = (mode: GuideMode, stepped: boolean): boolean => (stepped ? mode === "full" : mode !== "closed");

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
