// Which hashes open the home page. Everything else belongs to the app shell, which loads on demand.

import { isEvidenceId, isTarget, type EvidenceId, type Target } from "./sections";

const pathOf = (hash: string): string => hash.replace(/^#\/?/, "").split("?")[0].replace(/\/+$/, "");

/** `#`, `#/`, `#/?x=1` and `#/home` open the home page; `#/run`, `#/arena` and the rest do not. */
export function isHomeHash(hash: string): boolean {
  const path = pathOf(hash);
  return path === "" || path === "home";
}

/** `#/home-lab` is W7's lab of the visuals: a page of its own, loaded on demand like the app shell, never part of the home page's bundle. */
export const isLabHash = (hash: string): boolean => pathOf(hash) === "home-lab";

/** `#/evidence` is the plain page behind the home page: the models, the fair fight, the charts, where it helps and where it does not. */
export const isEvidenceHash = (hash: string): boolean => pathOf(hash) === "evidence";

export type PageName = "home" | "evidence" | "lab" | "app";

/** Which page an address opens: the home page, the evidence page, the lab of the visuals, or the app shell (everything else). */
export const pageOf = (hash: string): PageName =>
  isLabHash(hash) ? "lab" : isEvidenceHash(hash) ? "evidence" : isHomeHash(hash) ? "home" : "app";

export interface HomeAddress {
  /** `#/?at=solution` opens the page at that section; `#/?at=demo`, at the click demo. */
  target: Target | null;
  /** `#/?still` (or `?still` before the hash) shows every animation in its final state, as reduced motion does: for captures. */
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

/** The place of the evidence page an address names (`#/evidence?at=tie`), or null for the top of it. */
export function parseEvidenceAddress(hash: string): { target: EvidenceId | null } {
  const at = queryOf(hash).get("at");
  return { target: isEvidenceId(at) ? at : null };
}

/** The address the page was opened with; empty where there is no browser (the tests render the page to a string). */
export const currentHash = (): string => (typeof window === "undefined" ? "" : window.location.hash);
export const currentSearch = (): string => (typeof window === "undefined" ? "" : window.location.search);

/** The hash that opens the home page at a section, or at the click demo. */
export const targetHash = (target: Target): string => `#/?at=${target}`;

/** The hash of the evidence page, or of a place on it. */
export const evidenceHash = (target?: EvidenceId): string => (target ? `#/evidence?at=${target}` : "#/evidence");
