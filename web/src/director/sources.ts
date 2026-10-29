// Which runs a scene plays. A scene never names a run: the final pair is recorded after the scenes are written, and
// the same scene must play any pair of the same shape. The runs come from `sources.json` (one place to fill in when the
// pair is chosen) or from the address, which wins (`?swarm=&rival=`), so the recorder can point a scene at a run.

import type { DirectorQuery } from "./route";
import type { Stage } from "./script";

export interface Sources {
  /** The swarm run: the left of an arena, and what a run scene plays unless `run` says otherwise. */
  swarm: string | null;
  /** The rival run on the right of an arena. */
  rival: string | null;
  run: string | null;
  /** The id of an ablation run (`GET /api/ablation/{id}`). */
  ablation: string | null;
  /** The runs were recorded with the real model. Nothing in a log says so (a practice run prices its tokens too), so it is
   * declared with the runs, and the frame says "real" only for a take that declares it. */
  real: boolean;
}

export const NO_SOURCES: Sources = { swarm: null, rival: null, run: null, ablation: null, real: false };

export function resolveSources(manifest: Partial<Sources>, query: Pick<DirectorQuery, "swarm" | "rival" | "run" | "ablation" | "real">): Sources {
  const swarm = query.swarm ?? manifest.swarm ?? null;
  return {
    swarm,
    rival: query.rival ?? manifest.rival ?? null,
    run: query.run ?? manifest.run ?? swarm,
    ablation: query.ablation ?? manifest.ablation ?? null,
    real: query.real || manifest.real === true,
  };
}

/** What a stage needs that the sources do not give, in the words of the address that would. */
export function missingSources(stage: Stage, sources: Sources): string[] {
  switch (stage) {
    case "arena":
      return [sources.swarm === null ? "swarm" : "", sources.rival === null ? "rival" : ""].filter(Boolean);
    case "run":
      return sources.run === null ? ["run"] : [];
    case "ablation":
      return sources.ablation === null ? ["ablation"] : [];
    default:
      return [];
  }
}
