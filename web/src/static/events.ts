// `GET api/runs/{id}/events?from_seq=&limit=` from page files. The client asks for `limit=5000` from `from_seq=1`
// and then from the `next_seq` of each answer, so with files of 5000 events each request is a whole file. Any other
// (from_seq, limit) is cut out of the pages it falls in, with the same `next_seq`, `last_seq` and `done` the API
// works out (api/app.py `events_page`, api/catalog.py `page`).

export const MAX_PAGE = 5000;

export interface EventsAnswer {
  events: unknown[];
  next_seq: number;
  last_seq: number;
  done: boolean;
}

export interface Paging {
  from: number;
  limit: number;
}

/** An integer the way Python's `int()` reads it (the API's `_int_param`): optional sign, digits, spaces around. */
function integer(raw: string | null, fallback: number, name: string): number | string {
  if (raw === null) return fallback;
  if (!/^\s*[+-]?\d+\s*$/.test(raw)) return `${name} must be an integer`;
  return Number(raw);
}

/** The paging of a request, or the API's own 422 reason. */
export function readPaging(query: URLSearchParams): Paging | { error: string } {
  const from = integer(query.get("from_seq"), 1, "from_seq");
  if (typeof from === "string") return { error: from };
  if (from < 1) return { error: "from_seq must be in [1, ∞]" };
  const limit = integer(query.get("limit"), 1000, "limit");
  if (typeof limit === "string") return { error: limit };
  if (limit < 1 || limit > MAX_PAGE) return { error: `limit must be in [1, ${MAX_PAGE}]` };
  return { from, limit };
}

/** The page files (0-based) that hold seq `from` through `from + limit - 1`, clipped to a log of `lastSeq` events. */
export function pagesFor({ from, limit }: Paging, size: number, lastSeq: number): number[] {
  if (from > lastSeq) return [];
  const first = Math.floor((from - 1) / size);
  const last = Math.floor((Math.min(from + limit - 1, lastSeq) - 1) / size);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** Whether a request is exactly the page file `index`, which can then be sent as it is. */
export const isWholePage = ({ from, limit }: Paging, size: number): boolean => limit === size && (from - 1) % size === 0;

/** The answer for `paging`, from the events of the pages `pagesFor` named (`pages` maps a page index to its events). */
export function composeAnswer(paging: Paging, size: number, lastSeq: number, pages: ReadonlyMap<number, readonly unknown[]>): EventsAnswer {
  const events: unknown[] = [];
  for (const index of pagesFor(paging, size, lastSeq)) {
    const page = pages.get(index) ?? [];
    const start = Math.max(paging.from - (index * size + 1), 0);
    events.push(...page.slice(start, start + paging.limit - events.length));
  }
  const last = events.at(-1) as { seq: number } | undefined;
  const next = last === undefined ? paging.from : last.seq + 1;
  return { events, next_seq: next, last_seq: lastSeq, done: next > lastSeq };
}
