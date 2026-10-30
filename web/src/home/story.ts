// The data the page reads. scripts/build_home_data.py (W7) writes web/src/home/data/story.json from the committed
// results and the recorded runs, and data/types.ts is its type: W7 owns both, the page holds no number of its own.
//
// Claims travel in the same file: the generator copies each row of docs/claims.md (text and status) under its id,
// and the page renders that text, so a claim cannot drift from its row.

import { createContext, useContext } from "react";

import { story as bundled } from "./data/story";
import type { Claim, Story } from "./data/types";

export type { Story };

export const bundledStory: Story = bundled;

/** The story the page reads. Null only where a test wants to see the page with no data at all. */
export const StoryContext = createContext<Story | null>(bundledStory);
export const useStory = (): Story | null => useContext(StoryContext);

/** The value at a dotted path of the story (`"lanes.central"`), or undefined at the first gap. The page hands each visual its slice. */
export function slice<T = unknown>(story: Story | null, path: string): T | undefined {
  let at: unknown = story;
  for (const key of path.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at as T | undefined;
}

/** What the page may do with a claim row:
 * allowed: quote it; pending: quote it with a visible PENDING tag, the final page must not have one; refused: never quote. */
export type ClaimState = "allowed" | "pending" | "refused";

const STATE = new Map<string, ClaimState>([
  ["allowed", "allowed"],
  ["pending", "pending"],
  ["not-claimed", "refused"],
]);

/** The state the generator gave a row; one it did not classify is never treated as allowed. */
export const claimState = (state: string): ClaimState => STATE.get(state) ?? "pending";

export interface ResolvedClaim {
  id: string;
  text: string;
  state: ClaimState;
}

export function resolveClaim(story: Story | null, id: string): ResolvedClaim | null {
  const row: Claim | undefined = story?.claims[id];
  if (!row || typeof row.text !== "string") return null;
  return { id, text: row.text, state: claimState(String(row.state)) };
}
