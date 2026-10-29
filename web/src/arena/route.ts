// The arena's address, `#/arena/<left>/<right>`: the swarm on the left, its rival on the right, any two
// run ids. The query opens the pair at a point, for shareable links and for the video:
//
//   ?t=31.5        the shared clock at 31.5 s of run time (`at=end` for the end of the longer run)
//   &speed=5       playback speed (one of SPEEDS)
//   &play          start playing
//
// `at` is in seconds here, not in events as on the run page: two logs share one clock, and an event
// count means nothing across them.

import { SPEEDS } from "../lib/playback";

export interface ArenaPlayback {
  /** Virtual ms to open at, "end" for the end of the longer run, null for the start. */
  atMs: number | "end" | null;
  speed: number | null;
  play: boolean;
}

export interface ArenaRoute {
  left: string | null;
  right: string | null;
  playback: ArenaPlayback;
}

const decode = (part: string | undefined): string | null => {
  if (!part) return null;
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** The route of a location hash, or null when the hash is not the arena's. */
export function parseArenaRoute(hash: string): ArenaRoute | null {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/");
  if (parts[0] !== "arena") return null;
  const params = new URLSearchParams(query);
  const seconds = params.get("t");
  const speed = Number(params.get("speed"));
  const at = params.get("at");
  return {
    left: decode(parts[1]),
    right: decode(parts[2]),
    playback: {
      atMs: at === "end" ? "end" : seconds !== null && seconds.trim() !== "" && Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds) * 1000) : null,
      speed: SPEEDS.includes(speed as never) ? speed : null,
      play: params.has("play"),
    },
  };
}

export const arenaHash = (left: string, right: string): string => `#/arena/${encodeURIComponent(left)}/${encodeURIComponent(right)}`;
