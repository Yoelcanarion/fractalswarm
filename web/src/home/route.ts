// Which hashes open the home page. Everything else belongs to the app shell, which loads on demand.

import { isChapterId, type ChapterId } from "./chapters";

const pathOf = (hash: string): string => hash.replace(/^#\/?/, "").split("?")[0].replace(/\/+$/, "");

/** `#`, `#/`, `#/?x=1` and `#/home` open the home page; `#/run`, `#/arena` and the rest do not. */
export function isHomeHash(hash: string): boolean {
  const path = pathOf(hash);
  return path === "" || path === "home";
}

export interface HomeAddress {
  /** `#/?at=solution` opens the page at that chapter. */
  chapter: ChapterId | null;
  /** `#/?still` (or `?still` before the hash) shows every beat in its final state, as reduced motion does: for captures. */
  still: boolean;
}

const queryOf = (hash: string): URLSearchParams => new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");

export function parseHomeAddress(hash: string, search = ""): HomeAddress {
  const query = queryOf(hash);
  const at = query.get("at");
  return {
    chapter: isChapterId(at) ? at : null,
    still: query.has("still") || new URLSearchParams(search).has("still"),
  };
}

/** The address the page was opened with; empty where there is no browser (the tests render the page to a string). */
export const currentHash = (): string => (typeof window === "undefined" ? "" : window.location.hash);
export const currentSearch = (): string => (typeof window === "undefined" ? "" : window.location.search);

/** The hash that opens the page at a chapter. */
export const chapterHash = (chapter: ChapterId): string => `#/?at=${chapter}`;
