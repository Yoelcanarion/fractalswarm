// The guide every page can show: three steps, in the order a person meets them. What it says about a recorded run is what a recorded
// run does: it cannot be changed, so its kills are watched, and a run of one's own starts on New task. Pure, but for the seen flag.

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
