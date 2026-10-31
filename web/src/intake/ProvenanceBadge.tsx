import { Hint } from "../components/ui";
import type { Backend } from "./launch";
import { PROVENANCE_WORDS, readerWords, type Provenance } from "./provenance";

/** Where a row comes from: the reading as it stood, or what the person changed. An edited row names the fields. */
export function ProvenanceBadge({ provenance, fields, reader }: { provenance: Provenance; fields: string[]; reader: Backend | null | undefined }) {
  const words = readerWords(reader);
  const hint = provenance === "edited" ? `You changed: ${fields.map((field) => field.replace(/_/g, " ")).join(", ")}` : provenance === "added" ? "A row you added: it was not read from the text" : words.row;
  return (
    <Hint label={hint}>
      <span className={`prov prov--${provenance}`}>{provenance === "muse" ? words.badge : PROVENANCE_WORDS[provenance]}</span>
    </Hint>
  );
}
