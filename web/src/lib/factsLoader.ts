// Reads the facts of runs on demand: two small requests per run (its first and its last event), a few at a time, and each
// finished run only once, because a finished log never changes. A live run is read for its first event only.

import { readFacts, type RunFacts } from "./catalogue";
import type { RunEvent, RunListing } from "./types";

export type FetchEventAt = (runId: string, seq: number) => Promise<RunEvent | null>;

export interface FactsLoader {
  load: (listing: RunListing) => Promise<RunFacts>;
}

export function createFactsLoader(fetchAt: FetchEventAt, concurrency = 4): FactsLoader {
  const known = new Map<string, Promise<RunFacts>>();
  let active = 0;
  const waiting: (() => void)[] = [];

  // A finished slot goes straight to the next in line, so the limit holds even when a new request arrives in between.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (active < concurrency) active += 1;
    else await new Promise<void>((resume) => waiting.push(resume));
    try {
      return await job();
    } finally {
      release();
    }
  };

  return {
    load(listing) {
      const live = listing.status === "running";
      // A live log grows, but its first event does not change; a finished one is the same for good.
      const key = live ? `${listing.id}|live` : [listing.id, listing.status, listing.events, listing.head].join("|");
      const cached = known.get(key);
      if (cached) return cached;
      const job = slot(async () => {
        const first = listing.events > 0 ? await fetchAt(listing.id, 1) : null;
        const last = !live && listing.events > 1 ? await fetchAt(listing.id, listing.events) : null;
        return readFacts(first, last);
      });
      known.set(key, job);
      // A read that failed is tried again the next time, not remembered.
      job.catch(() => known.delete(key));
      return job;
    },
  };
}
