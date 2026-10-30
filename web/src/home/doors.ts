// The menu at the end of the page: the doors into the simulation, and which of them lead anywhere in a
// build that has no server. The static showcase (W8) is built with Vite mode "static"; its doors that
// need the local server say so instead of leading to a dead page.

export interface Door {
  id: string;
  title: string;
  /** One line: what is behind the door. */
  purpose: string;
  href: string;
  /** True when the door needs `fractalswarm serve` behind it: launching a run, reading new text with Muse. */
  needsServer: boolean;
  /** The note shown on a door that is closed in the static showcase. */
  closedNote?: string;
}

export const DOORS: readonly Door[] = [
  {
    id: "arena",
    title: "The arena",
    purpose: "Two systems, the same failures, side by side.",
    href: "#/arena",
    needsServer: false,
  },
  {
    id: "live",
    title: "A live run",
    purpose: "Launch one and kill its coordinators yourself.",
    href: "#/new",
    needsServer: true,
    closedNote: "Needs the local server: it launches a run.",
  },
  {
    id: "replays",
    title: "Replays",
    purpose: "Every recorded run, with its verification.",
    href: "#/runs",
    needsServer: false,
  },
  {
    id: "new-task",
    title: "New task",
    purpose: "Paste your own messy text and let Muse read it.",
    href: "#/new",
    needsServer: true,
    closedNote: "Needs the local server: it calls the model.",
  },
  {
    id: "director",
    title: "Director",
    purpose: "The video's scenes, played on real logs.",
    href: "#/director",
    needsServer: false,
  },
  {
    id: "numbers",
    title: "The numbers",
    purpose: "Charts, and where it helps.",
    href: "#/charts",
    needsServer: false,
  },
  {
    id: "ablation",
    title: "Ablation",
    purpose: "A hand-written parser against Muse, on the same notes.",
    href: "#/ablation",
    needsServer: true,
    closedNote: "Needs the local server: it runs the comparison.",
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
