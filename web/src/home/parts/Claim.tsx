import type { ReactNode } from "react";

import { resolveClaim, useStory } from "../story";
import { Inline } from "./Inline";

/** The ids of the claims the page quotes. R1 is not among them: it is not claimed. The guard test holds this list to docs/claims.md. */
export const CLAIM_IDS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "R2", "R3", "R4", "R5", "R6"] as const;
export type ClaimId = (typeof CLAIM_IDS)[number];

export function PendingTag({ children = "PENDING" }: { children?: ReactNode }) {
  return <span className="home-tag">{children}</span>;
}

/** The sentences of a claim, to set a long one on several lines. Each keeps its words and its end; a decimal point is not an end. */
export const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** A claim, in the words of its row of docs/claims.md. A row that is still pending wears a PENDING tag; a row that is
 * not claimed is never drawn. With no data yet it shows the row's id and says so. `lines` sets each sentence on its own line.
 * `part` draws one sentence of it (0 is the first), unchanged: the home page opens with the first sentence of R6 and folds the second. */
export function Claim({ id, className = "", lines = false, part }: { id: ClaimId; className?: string; lines?: boolean; part?: number }) {
  const story = useStory();
  const claim = resolveClaim(story, id);
  if (claim?.state === "refused") return null;
  const all = claim ? sentences(claim.text) : [];
  const only = part === undefined ? null : (all[part] ?? null);
  if (claim && part !== undefined && only === null) return null; // the row has no such sentence: nothing, never the whole claim
  return (
    <p
      className={`home-claim ${className}`.trim()}
      data-claim={id}
      data-state={claim?.state ?? "missing"}
      data-part={part === undefined ? undefined : `${part + 1}/${all.length}`}
    >
      {claim ? (
        only !== null ? (
          <Inline text={only} />
        ) : lines ? (
          all.map((sentence, i) => (
            <span key={i} className="home-claim__line">
              <Inline text={sentence} />{" "}
            </span>
          ))
        ) : (
          <Inline text={claim.text} />
        )
      ) : (
        <span className="home-claim__missing">Claim {id}</span>
      )}
      {claim?.state === "pending" && <PendingTag />}
      {!claim && <PendingTag>NO DATA YET</PendingTag>}
    </p>
  );
}
