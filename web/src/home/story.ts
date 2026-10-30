// The data the page reads. scripts/build_home_data.py (W7) writes web/src/home/data/story.json from the committed
// results and the recorded runs, and data/types.ts is its type: W7 owns both, the page holds no number of its own.
//
// Claims travel in the same file: the generator copies each row of docs/claims.md (text and status) under its id,
// and the page renders that text, so a claim cannot drift from its row.

import { createContext, useContext } from "react";

import { story as bundled } from "./data/story";
import type { Claim, ClaimStatus, Story } from "./data/types";

export type { Story };

export const bundledStory: Story = bundled;

/** The story the page reads. Null only where a test wants to see the page with no data at all. */
export const StoryContext = createContext<Story | null>(bundledStory);
export const useStory = (): Story | null => useContext(StoryContext);

/** What the page may do with a claim row:
 * allowed: quote it; pending: quote it with a visible PENDING tag, the final page must not have one; refused: never quote. */
export type ClaimState = "allowed" | "pending" | "refused";

const STATE: Record<ClaimStatus, ClaimState> = { allowed: "allowed", pending: "pending", "not-claimed": "refused" };

/** A status the generator did not classify is never treated as allowed. */
export const claimState = (status: string): ClaimState => STATE[status as ClaimStatus] ?? "pending";

export interface ResolvedClaim {
  id: string;
  text: string;
  state: ClaimState;
}

export function resolveClaim(story: Story | null, id: string): ResolvedClaim | null {
  const row: Claim | undefined = story?.claims[id];
  if (!row || typeof row.text !== "string") return null;
  return { id, text: row.text, state: claimState(String(row.status)) };
}
