// The menu at the end of the page: the doors into the app, and which of them lead anywhere in a
// build that has no server. The static showcase (W8) is built with Vite mode "static"; its doors that
// need the local server say so instead of leading to a dead page.

import type { DoorId } from "./viz/doors/doors";

export interface Door {
  id: DoorId;
  title: string;
  /** One line: what is behind the door. */
  purpose: string;
  href: string;
  /** True when the door needs `fractalswarm serve` behind it: launching a run, reading new text with Muse. */
  needsServer: boolean;
  /** The note shown on a door that is closed in the static showcase. */
  closedNote?: string;
}

// The purposes are a few words: the card has a drawing and a title, and the page is held to about 200 words (words.test.ts).
//
// Four doors, and each opens a page that stands on its own. Two are not on the menu, and their routes stay: the Director's
// (`#/director`, a page of scenes for the video, with no way back and most scenes needing a run in the address) and the ablation's
// (`#/ablation`, which says that none has been recorded; its door comes back when one is). Their thumbnails stay in `viz/doors`.
export const DOORS: readonly Door[] = [
  {
    id: "arena",
    title: "The arena",
    purpose: "Rival systems, compared.",
    href: "#/arena",
    needsServer: false,
  },
  {
    // One door: the page behind "#/new" is where you paste your own text and launch the run on it.
    id: "live",
    title: "A live run",
    purpose: "Your own text.",
    href: "#/new",
    needsServer: true,
    closedNote: "Needs the local server: it launches a run and calls the model.",
  },
  {
    id: "replays",
    title: "Replays",
    purpose: "Every recorded run.",
    href: "#/runs",
    needsServer: false,
  },
  {
    // The evidence page: the charts, the fair fight, where it ties and where it does worse.
    id: "numbers",
    title: "The numbers",
    purpose: "All the evidence.",
    href: "#/evidence",
    needsServer: false,
  },
];

/** True in the build made for GitHub Pages (`vite build --mode static`, W8). */
export const isStaticShowcase = (mode: string = import.meta.env.MODE): boolean => mode === "static";

export interface DoorState {
  open: boolean;
  /** Why the door is closed, or null. */
  note: string | null;
}

export function doorState(door: Door, staticShowcase: boolean): DoorState {
  if (staticShowcase && door.needsServer) return { open: false, note: door.closedNote ?? "Needs the local server." };
  return { open: true, note: null };
}
