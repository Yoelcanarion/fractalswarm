// The page a take plays on, in the browser: the director's frame (a 1920 x 1080 box, scaled to the window), the camera
// element inside it (one CSS transform on the whole stage) and the stage in that. Targets are looked up in the stage by
// the selectors of targets.ts and measured with getBoundingClientRect, which already includes the camera and the frame's
// scale, so the numbers handed to the take are in the frame's own pixels whatever the window.

import type { ViewState } from "../lib/reducer";
import type { RunEvent } from "../lib/types";
import { crashesOf, resolveActor, subtreeOf, type Crash } from "./anchors";
import { contentRect, transformOf, union, type Camera, type Rect } from "./camera";
import type { PanelName } from "./script";
import type { Surface } from "./take";
import { selectorsOf, type Target } from "./targets";
import type { TimeContext } from "./time";

/** A rectangle measured in the window, as frame pixels: relative to the frame's corner, and undone from the frame's scale. */
export const framePixels = (rect: Rect, frame: Rect, scale: number): Rect => ({
  x: (rect.x - frame.x) / scale,
  y: (rect.y - frame.y) / scale,
  w: rect.w / scale,
  h: rect.h / scale,
});

/** Where the elements together are in the frame. An element with no box (hidden, not laid out) is not on the page. */
export const boundsOf = (rects: readonly Rect[], frame: Rect, scale: number): Rect | null =>
  union(rects.filter((rect) => rect.w > 0 && rect.h > 0).map((rect) => framePixels(rect, frame, scale)));

const rectOf = (box: DOMRect): Rect => ({ x: box.x, y: box.y, w: box.width, h: box.height });

/** One run on the page: what a scene's actors are looked up in. */
export interface RunSide {
  events(): readonly RunEvent[];
  view(): ViewState;
}

/** The Muse lens of the run page, as the take uses it. */
export interface LensHandle {
  /** Open the call a scene named, or close the lens (null). Returns why it could not, or null. */
  open(name: string | null): string | null;
  /** When each named call started and ended in the run; a call the run does not have is left out. */
  times(): Map<string, { start: number; end: number | null }>;
}

export interface SurfaceParts {
  /** The frame: the origin of the numbers the take sees. */
  frame: HTMLElement;
  /** The element that takes the camera's transform. */
  camera: HTMLElement;
  /** The stage inside the camera, where targets are looked up and panels are hidden. */
  stage: HTMLElement;
  /** How much the window scales the frame by. */
  scale(): number;
  /** The swarm (or the one run of a run page) and, in an arena, its rival. */
  sides: { left: RunSide | null; right: RunSide | null };
  lens: LensHandle | null;
  /** The last moment of the longest run. */
  end(): number;
}

export function createDomSurface(parts: SurfaceParts): Surface {
  const { frame, camera, stage, sides } = parts;
  let applied: Camera = { x: 0, y: 0, zoom: 1 };
  const hidden = new Set<PanelName>();
  const crashMemo = new WeakMap<readonly RunEvent[], Crash[]>();

  const crashesFor = (events: readonly RunEvent[]): Crash[] => {
    let found = crashMemo.get(events);
    if (!found) crashMemo.set(events, (found = crashesOf(events)));
    return found;
  };
  const crashes = (): Crash[] => {
    const own = sides.left === null ? [] : crashesFor(sides.left.events());
    return own.length > 0 || sides.right === null ? own : crashesFor(sides.right.events());
  };

  /** The ids an actor target stands for on this page: the actor, or its subtree. Nothing when the run has no such actor. */
  function actorsOf(target: Extract<Target, { kind: "actor" }>): string[] {
    const side = target.side === "right" ? sides.right : sides.left;
    if (side === null) return [];
    const events = side.events();
    const view = side.view();
    const id = resolveActor(target.actor, { events, view, crashes: target.side === "right" ? crashesFor(events) : crashes() });
    if (id === null) return [];
    return target.subtree ? subtreeOf(view, id) : [id];
  }

  function elementsOf(target: Target): Element[] {
    // In an arena an actor with no side is the swarm's: both boards draw the same ids.
    const aimed: Target = sides.right !== null && target.kind === "actor" && target.side === null ? { ...target, side: "left" } : target;
    const found = aimed.kind === "actor" ? actorsOf(aimed) : [];
    return selectorsOf(aimed, found).flatMap((css) => [...stage.querySelectorAll(css)]);
  }

  function screenRect(target: Target): Rect | null {
    const elements = elementsOf(target);
    if (elements.length === 0) return null;
    return boundsOf(elements.map((element) => rectOf(element.getBoundingClientRect())), rectOf(frame.getBoundingClientRect()), parts.scale());
  }

  /** The hover text of the target: the first `title` on the elements or under them. It is the page's own wording. */
  function titleOf(target: Target): string | null {
    for (const element of elementsOf(target)) {
      const carrier = element.hasAttribute("title") ? element : element.querySelector("[title]");
      const words = carrier?.getAttribute("title")?.trim();
      if (words) return words;
    }
    return null;
  }

  return {
    screenRect,
    titleOf,
    // the layout size of what the camera moves (the stage and any band above it), which a transform does not change; a
    // stage that overflows its frame is as tall as its content
    bounds: () => ({ w: camera.offsetWidth, h: Math.max(camera.offsetHeight, camera.scrollHeight) }),
    contentRect(target) {
      const screen = screenRect(target);
      return screen === null ? null : contentRect(screen, applied);
    },
    apply(next) {
      applied = next;
      camera.style.transform = transformOf(next);
    },
    panel(name, show) {
      if (show) hidden.delete(name);
      else hidden.add(name);
      stage.dataset.hide = [...hidden].sort().join(" ");
    },
    lens(call) {
      return parts.lens === null ? "this stage has no lens" : parts.lens.open(call);
    },
    context(): TimeContext {
      return { end: parts.end(), crashes: crashes(), calls: parts.lens?.times() ?? new Map() };
    },
  };
}
