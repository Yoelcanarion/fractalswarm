import { describe, expect, it } from "vitest";

import { composeAnswer, isWholePage, MAX_PAGE, pagesFor, readPaging } from "./events";
import { eventsOf, reference } from "./testing";

const query = (text: string) => new URLSearchParams(text);

describe("the paging of a request", () => {
  it("defaults to the first event and a thousand, as the API does", () => {
    expect(readPaging(query(""))).toEqual({ from: 1, limit: 1000 });
  });

  it("reads integers the way the API's int() does", () => {
    expect(readPaging(query("from_seq=7&limit=5000"))).toEqual({ from: 7, limit: 5000 });
    expect(readPaging(query("from_seq=+4&limit=%203"))).toEqual({ from: 4, limit: 3 });
  });

  it.each([
    ["from_seq=x", "from_seq must be an integer"],
    ["from_seq=1.5", "from_seq must be an integer"],
    ["from_seq=", "from_seq must be an integer"],
    ["limit=ten", "limit must be an integer"],
    ["from_seq=0", "from_seq must be in [1, ∞]"],
    ["from_seq=-3", "from_seq must be in [1, ∞]"],
    ["limit=0", `limit must be in [1, ${MAX_PAGE}]`],
    [`limit=${MAX_PAGE + 1}`, `limit must be in [1, ${MAX_PAGE}]`],
  ])("refuses %s with the API's own words", (text, error) => {
    expect(readPaging(query(text))).toEqual({ error });
  });
});

describe("the pages a request falls in", () => {
  it("names the page files from the first to the last event wanted", () => {
    expect(pagesFor({ from: 1, limit: 3 }, 3, 10)).toEqual([0]);
    expect(pagesFor({ from: 2, limit: 3 }, 3, 10)).toEqual([0, 1]);
    expect(pagesFor({ from: 4, limit: 100 }, 3, 10)).toEqual([1, 2, 3]);
  });

  it("names none for a request past the end of the log", () => {
    expect(pagesFor({ from: 11, limit: 5 }, 3, 10)).toEqual([]);
    expect(pagesFor({ from: 1, limit: 5 }, 3, 0)).toEqual([]);
  });

  it("calls a request a whole page when it starts at a page and asks for exactly one page", () => {
    expect(isWholePage({ from: 1, limit: 3 }, 3)).toBe(true);
    expect(isWholePage({ from: 7, limit: 3 }, 3)).toBe(true);
    expect(isWholePage({ from: 2, limit: 3 }, 3)).toBe(false);
    expect(isWholePage({ from: 1, limit: 2 }, 3)).toBe(false);
    expect(isWholePage({ from: 1, limit: 5000 }, 5000)).toBe(true);
  });
});

describe("an answer cut out of pages", () => {
  const SIZE = 3;

  /** The page files the exporter would write for a log, as the events each holds, by page index. */
  const pagesOfLog = (all: ReturnType<typeof eventsOf>) =>
    new Map(
      Array.from({ length: Math.ceil(all.length / SIZE) }, (_, i) => [i, all.slice(i * SIZE, (i + 1) * SIZE)] as const),
    );

  // Every (from, limit) over logs shorter than a page, exactly a page, and several pages long, with the end of the log
  // both inside and past the window: the answer is the API's, field by field.
  it.each([0, 1, 2, 3, 4, 6, 7, 10])("is the API's answer for every window of a log of %i events", (count) => {
    const all = eventsOf(count);
    const pages = pagesOfLog(all);
    for (let from = 1; from <= count + 2; from++) {
      for (let limit = 1; limit <= count + 2; limit++) {
        expect(composeAnswer({ from, limit }, SIZE, count, pages), `from ${from}, limit ${limit}`).toEqual(reference(all, from, limit));
      }
    }
  });

  it("marks the end of the log done, and an empty window past it done at the seq that was asked for", () => {
    const all = eventsOf(5);
    const pages = pagesOfLog(all);
    expect(composeAnswer({ from: 4, limit: 10 }, SIZE, 5, pages)).toMatchObject({ next_seq: 6, last_seq: 5, done: true });
    expect(composeAnswer({ from: 9, limit: 10 }, SIZE, 5, pages)).toEqual({ events: [], next_seq: 9, last_seq: 5, done: true });
    expect(composeAnswer({ from: 2, limit: 2 }, SIZE, 5, pages)).toMatchObject({ next_seq: 4, done: false });
  });
});
