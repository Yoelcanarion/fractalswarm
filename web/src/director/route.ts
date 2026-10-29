// The director's address: `#/director` lists the scenes, `#/director/<scene id>` plays one at 1920 x 1080 with no app chrome.
//
//   ?swarm=<run>&rival=<run>   the pair an arena scene plays (otherwise sources.json)
//   &run=<run>                 the run a run scene plays (otherwise the swarm)
//   &ablation=<run id>         the ablation an ablation scene shows
//   &real                      the runs were recorded with the real model: only then does the frame say "real"
//   &hold                      wait for `window.__director.go()` instead of starting by itself (the recorder does)
//   &hud                       the author's readout: take time, frame, warnings, the crashes of the run

export interface DirectorQuery {
  swarm: string | null;
  rival: string | null;
  run: string | null;
  ablation: string | null;
  real: boolean;
  hold: boolean;
  hud: boolean;
}

export interface DirectorRoute {
  /** Null: the list of scenes. */
  scene: string | null;
  query: DirectorQuery;
}

const decode = (part: string | undefined | null): string | null => {
  if (!part) return null;
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

export function parseDirectorRoute(hash: string): DirectorRoute | null {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/");
  if (parts[0] !== "director") return null;
  const params = new URLSearchParams(query);
  return {
    scene: decode(parts[1]),
    query: {
      swarm: params.get("swarm") || null,
      rival: params.get("rival") || null,
      run: params.get("run") || null,
      ablation: params.get("ablation") || null,
      real: params.has("real"),
      hold: params.has("hold"),
      hud: params.has("hud"),
    },
  };
}

export const directorHash = (scene: string | null): string => (scene === null ? "#/director" : `#/director/${encodeURIComponent(scene)}`);
