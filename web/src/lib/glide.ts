// Position tweens for the orchestrator tree, in plain numbers so they run without React.
//
// The tree's layout is a pure function of the run (lib/layout.ts). When it changes (an actor
// spawns, a subtree is adopted, siblings re-centre) each node should glide to its new place.
// The glide lives in JS, not in a CSS transition, so React Flow gets the position of every node
// every frame and recomputes the edges from it: an edge stays attached to both ends all the way.
//
//   const glide = createGlide(450, EASE_STANDARD);
//   glide.aim(targets, now);     // the layout changed: head for these places
//   glide.at(now)                // where each node is drawn at ``now``
//   glide.moving(now)            // anything still on its way?
//
// ``now`` is any increasing clock in ms (see ``Clock.motion``). A new aim starts from where each
// node is drawn right now, so a layout that changes mid-glide bends the motion instead of
// restarting it.

export interface Point {
  x: number;
  y: number;
}

interface Track {
  from: Point;
  to: Point;
  start: number;
}

export interface AimOptions {
  /** Jump: draw every node at its target at once (a seek, reduced motion, the first layout). */
  snap?: boolean;
  /** For a node that has just appeared: the node it comes out of. It starts on that node. */
  origin?: (id: string) => string | null | undefined;
}

export interface Glide {
  aim(targets: ReadonlyMap<string, Point>, now: number, options?: AimOptions): void;
  at(now: number): Map<string, Point>;
  moving(now: number): boolean;
}

const EPSILON = 0.01;
const sameSpot = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

export function createGlide(durationMs: number, ease: (t: number) => number): Glide {
  const tracks = new Map<string, Track>();

  // A clock that went backwards (the time base was switched) leaves nothing half-way: it is done.
  const progress = (track: Track, now: number): number => {
    const elapsed = now - track.start;
    return durationMs <= 0 || elapsed < 0 ? 1 : Math.min(1, elapsed / durationMs);
  };

  const drawn = (track: Track, now: number): Point => {
    const p = progress(track, now);
    if (p >= 1) return track.to;
    const e = ease(p);
    return { x: track.from.x + (track.to.x - track.from.x) * e, y: track.from.y + (track.to.y - track.from.y) * e };
  };

  return {
    aim(targets, now, { snap = false, origin } = {}) {
      for (const id of [...tracks.keys()]) if (!targets.has(id)) tracks.delete(id);
      // Targets come parents first (spawn order), so a node can start on a parent that is new too.
      for (const [id, to] of targets) {
        const track = tracks.get(id);
        if (snap || durationMs <= 0) {
          tracks.set(id, { from: to, to, start: now });
        } else if (!track) {
          const parent = origin?.(id);
          const parentTrack = parent ? tracks.get(parent) : undefined;
          tracks.set(id, { from: parentTrack ? drawn(parentTrack, now) : to, to, start: now });
        } else if (!sameSpot(track.to, to)) {
          tracks.set(id, { from: drawn(track, now), to, start: now });
        }
      }
    },

    at(now) {
      const places = new Map<string, Point>();
      for (const [id, track] of tracks) places.set(id, drawn(track, now));
      return places;
    },

    moving(now) {
      for (const track of tracks.values()) if (progress(track, now) < 1 && !sameSpot(track.from, track.to)) return true;
      return false;
    },
  };
}
