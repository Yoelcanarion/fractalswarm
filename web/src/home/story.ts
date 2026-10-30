// The data the page reads. scripts/build_home_data.py (W7) writes web/src/home/data/story.json from
// the committed results and the recorded runs; the page holds no number of its own. Until that file is
// merged it does not exist, and everything that would come from it reads "pending".
//
// Claims travel in the same file: the generator copies each row of docs/claims.md (text and status,
// verbatim) under its id, and the page renders that text, so a claim cannot drift from its row.

import { createContext, useContext } from "react";

export interface StoryClaim {
  text: string;
  status: string;
}

export interface Story {
  claims: Record<string, StoryClaim>;
  [slice: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const isStory = (value: unknown): value is Story => isRecord(value) && isRecord(value.claims);

// A glob, not an import: the file does not exist until W7's branch lands, and the build must not break before.
const files = import.meta.glob("./data/story.json", { eager: true, import: "default" });
const loaded: unknown = Object.values(files)[0];

export const bundledStory: Story | null = isStory(loaded) ? loaded : null;

export const StoryContext = createContext<Story | null>(bundledStory);
export const useStory = (): Story | null => useContext(StoryContext);

/** The value at a dotted path (`"hero.series.swarm"`), or undefined when any step is missing. */
export function slice<T = unknown>(story: Story | null, path: string): T | undefined {
  let at: unknown = story;
  for (const key of path.split(".")) {
    if (!isRecord(at) || !(key in at)) return undefined;
    at = at[key];
  }
  return at as T;
}

// ---- claims ----

/** What the page may do with a claim row, read from its status cell:
 * allowed: quote it; pending: quote it with a visible PENDING tag, the final page must not have one; refused: never quote. */
export type ClaimState = "allowed" | "pending" | "refused";

export function claimState(status: string): ClaimState {
  const plain = status.replace(/[*_`]/g, "").trim().toLowerCase();
  if (plain.startsWith("not claimed")) return "refused";
  if (plain.includes("pending")) return "pending";
  if (plain.startsWith("allowed")) return "allowed";
  return "pending"; // wording nobody has classified is never treated as allowed
}

export interface ResolvedClaim {
  id: string;
  text: string;
  state: ClaimState;
}

export function resolveClaim(story: Story | null, id: string): ResolvedClaim | null {
  const row = story?.claims[id];
  if (!row || typeof row.text !== "string") return null;
  return { id, text: row.text, state: claimState(String(row.status ?? "")) };
}
