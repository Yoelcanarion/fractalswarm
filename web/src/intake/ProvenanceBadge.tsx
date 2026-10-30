import { Hint } from "../components/ui";
import { PROVENANCE_WORDS, type Provenance } from "./provenance";

/** Where a row comes from: Muse's reading as it stood, or what the person changed. An edited row names the fields. */
export function ProvenanceBadge({ provenance, fields }: { provenance: Provenance; fields: string[] }) {
  const hint = provenance === "edited" ? `You changed: ${fields.map((field) => field.replace(/_/g, " ")).join(", ")}` : provenance === "added" ? "A row you added: Muse did not read it" : "Read by Muse, left as it was";
  return (
    <Hint label={hint}>
      <span className={`prov prov--${provenance}`}>{PROVENANCE_WORDS[provenance]}</span>
    </Hint>
  );
}
