// Which hashes open the home page. Everything else belongs to the app shell, which loads on demand.

import { isTarget, type Target } from "./chapters";

const pathOf = (hash: string): string => hash.replace(/^#\/?/, "").split("?")[0].replace(/\/+$/, "");

/** `#`, `#/`, `#/?x=1` and `#/home` open the home page; `#/run`, `#/arena` and the rest do not. */
export function isHomeHash(hash: string): boolean {
  const path = pathOf(hash);
  return path === "" || path === "home";
}

/** `#/home-lab` is W7's lab of the visuals: a page of its own, loaded on demand like the app shell, never part of the home page's bundle. */
export const isLabHash = (hash: string): boolean => pathOf(hash) === "home-lab";

export type PageName = "home" | "lab" | "app";

/** Which page an address opens: the home page, the lab of the visuals, or the app shell (everything else). */
export const pageOf = (hash: string): PageName => (isLabHash(hash) ? "lab" : isHomeHash(hash) ? "home" : "app");

export interface HomeAddress {
  /** `#/?at=solution` opens the page at that chapter; `#/?at=tie`, at that beat. */
  target: Target | null;
  /** `#/?still` (or `?still` before the hash) shows every beat in its final state, as reduced motion does: for captures. */
  still: boolean;
}

const queryOf = (hash: string): URLSearchParams => new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");

export function parseHomeAddress(hash: string, search = ""): HomeAddress {
  const query = queryOf(hash);
  const at = query.get("at");
  return {
    target: isTarget(at) ? at : null,
    still: query.has("still") || new URLSearchParams(search).has("still"),
  };
}

/** The address the page was opened with; empty where there is no browser (the tests render the page to a string). */
export const currentHash = (): string => (typeof window === "undefined" ? "" : window.location.hash);
export const currentSearch = (): string => (typeof window === "undefined" ? "" : window.location.search);

/** The hash that opens the page at a chapter, or at a beat of one. */
export const targetHash = (target: Target): string => `#/?at=${target}`;
