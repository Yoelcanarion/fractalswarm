import { useEffect, useRef } from "react";

import { BOXES, FIELD_WORDS, marksFor, pieces, selectionOfKey, type Box, type Fact, type Piece, type Selection, type Texts } from "./highlight";

const BOX_TITLES: Record<Box, string> = { talks: "Talks", notes: "Notes and emails", conference: "Conference" };

export interface SourcePaneProps {
  texts: Texts;
  facts: Fact[];
  /** What the person picked in the table. */
  selection: Selection | null;
  active: Set<string>;
  box: Box;
  onBox: (box: Box) => void;
  onPick: (selection: Selection) => void;
}

/** How a piece of the text is marked: the one picked, a sentence a fact was read from, or the long quote of the picked row. */
function classOf(piece: Piece, active: Set<string>, blocks: Set<string>): string {
  if (piece.keys.some((key) => active.has(key))) return "src src--active";
  return piece.keys.some((key) => !blocks.has(key)) ? "src src--sentence" : "src src--block";
}

/** The pasted text as the server kept it, with the sentences the facts were read from marked in it. A sentence is marked
 * only where it is found; the row that is picked also shows its abstract or email, and the one sentence picked stands out. */
export function SourcePane({ texts, facts, selection, active, box, onBox, onPick }: SourcePaneProps) {
  const body = texts[box] ?? "";
  const marks = marksFor(facts, box, selection === null ? null : { kind: selection.kind, id: selection.id });
  const cut = pieces(body, marks);
  const blocks = new Set(facts.filter((fact) => fact.field === "abstract" || fact.field === "note").map((fact) => fact.key));
  const scroller = useRef<HTMLDivElement>(null);

  // bring the picked sentence into view: smoothly, unless the person asked for less motion
  useEffect(() => {
    const target = scroller.current?.querySelector<HTMLElement>('mark[data-active="true"]');
    if (!target) return;
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [selection, box]);

  const picked = selection === null ? null : facts.filter((fact) => fact.kind === selection.kind && fact.id === selection.id && (selection.field === null || fact.field === selection.field));
  const missing = picked?.filter((fact) => fact.span === null) ?? [];

  return (
    <section className="srcpane" aria-label="The text you pasted">
      <div className="srcpane__tabs" role="tablist">
        {BOXES.filter((name) => (texts[name] ?? "") !== "").map((name) => (
          <button key={name} type="button" role="tab" aria-selected={name === box} className={`srcpane__tab${name === box ? " srcpane__tab--on" : ""}`} onClick={() => onBox(name)}>
            {BOX_TITLES[name]}
          </button>
        ))}
      </div>
      <p className="srcpane__hint" aria-live="polite">
        {selection === null
          ? "Pick a row, or one of its sources, to see where it was read."
          : `Showing where ${selection.kind === "talks" ? "talk" : "speaker"} ${selection.id}${selection.field ? ` · ${FIELD_WORDS[selection.field].toLowerCase()}` : ""} was read.`}
        {missing.length > 0 && <span className="srcpane__missing"> {missing.map((fact) => FIELD_WORDS[fact.field]).join(", ")}: not found in the text. Muse reworded it.</span>}
      </p>
      <div className="srcpane__text" ref={scroller} tabIndex={0} aria-label={`${BOX_TITLES[box]}, as pasted`}>
        {cut.map((piece, i) =>
          piece.keys.length === 0 ? (
            piece.text
          ) : (
            <mark
              key={i}
              className={classOf(piece, active, blocks)}
              data-active={piece.keys.some((key) => active.has(key)) ? "true" : undefined}
              onClick={() => {
                const picked = selectionOfKey(piece.keys.find((key) => active.has(key)) ?? piece.keys[0]);
                if (picked !== null) onPick(picked);
              }}
            >
              {piece.text}
            </mark>
          ),
        )}
      </div>
    </section>
  );
}
