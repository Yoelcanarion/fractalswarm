// The ablation's calls. Only the practice backend is launched from the page: `POST api/ablation` answers 501 to a real
// one (the coordinator starts that from the CLI, with the cost check there), and the page reads such a run by its id.

import { caller, type Fetcher } from "../intake/api";
import { readAblation, readStarted } from "./model";

export interface AblationRequest {
  /** The generator's notes. Notes a person typed are not posted here: the route does not keep live input private. */
  source?: "generator";
  seed?: number;
  /** How many notes of each kind (0 to 200 each, not both 0). */
  emails?: number;
  abstracts?: number;
}

export function createAblationApi(fetcher?: Fetcher) {
  const call = caller(fetcher);
  return {
    start: (request: AblationRequest) => call("POST", "api/ablation", { source: "generator", backend: "fake", ...request }, readStarted),
    status: (runId: string) => call("GET", `api/ablation/${encodeURIComponent(runId)}`, undefined, readAblation),
  };
}

export type AblationApi = ReturnType<typeof createAblationApi>;
