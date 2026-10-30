import type { ReactNode } from "react";

import { resolveClaim, useStory } from "../story";

/** The ids of the claims the page quotes. R1 is not among them: it is not claimed. The guard test holds this list to docs/claims.md. */
export const CLAIM_IDS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "R2", "R3", "R4", "R5"] as const;
export type ClaimId = (typeof CLAIM_IDS)[number];

export function PendingTag({ children = "PENDING" }: { children?: ReactNode }) {
  return <span className="home-tag">{children}</span>;
}

/** A claim, in the words of its row of docs/claims.md. A row that is still pending wears a PENDING tag; a row that is
 * not claimed is never drawn. With no data yet it shows the row's id and says so. */
export function Claim({ id, className = "" }: { id: ClaimId; className?: string }) {
  const story = useStory();
  const claim = resolveClaim(story, id);
  if (claim?.state === "refused") return null;
  return (
    <p className={`home-claim ${className}`.trim()} data-claim={id} data-state={claim?.state ?? "missing"}>
      {claim ? claim.text : <span className="home-claim__missing">Claim {id}</span>}
      {claim?.state === "pending" && <PendingTag />}
      {!claim && <PendingTag>NO DATA YET</PendingTag>}
    </p>
  );
}
