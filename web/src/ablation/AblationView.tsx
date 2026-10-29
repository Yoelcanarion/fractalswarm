import type { AblationStatus, Note, Result, Tally } from "./model";
import { appliedCaveats, caveatLabel, compare, FILTER_WORDS, FILTERS, filterNotes, headlineParts, percent, scoreParts, SPLIT_WORDS, SPLITS, soFarCounts, splitCounts, statusLine, type Filter, type Split } from "./view";

const outOf = (understood: number, of: number): string => `${understood} of ${of}`;

/** ✓ or ✗ with the words for it: never only a colour. */
function Verdict({ understood }: { understood: boolean }) {
  return understood ? (
    <span className="abl__v abl__v--yes" role="img" aria-label="understood">
      ✓
    </span>
  ) : (
    <span className="abl__v abl__v--no" role="img" aria-label="not understood">
      ✗
    </span>
  );
}

/** The headline in the brief's form. With no result yet it is the notes scored so far, and says so. */
function Headline({ run }: { run: AblationStatus }) {
  const { result } = run;
  const [parser, muse] = headlineParts(result ?? soFarCounts(run.notes));
  const note = statusLine(run);
  return (
    <section className="abl__head" aria-label="Headline">
      {result === null && <p className="abl__sofar">So far</p>}
      <h2 className="abl__headline" title={result?.headline}>
        <span className="abl__parser">{parser}</span>
        <span aria-hidden> · </span>
        <span className="abl__muse">{muse}</span>
      </h2>
      {run.status === "running" && <progress className="abl__progress" value={run.progress.done} max={Math.max(run.progress.of, 1)} aria-label="Notes scored" />}
      {note !== null && (
        <p className={`abl__status${run.status === "running" ? "" : " abl__status--stopped"}`} role={run.status === "running" ? "status" : "alert"}>
          {note}
        </p>
      )}
    </section>
  );
}

/** The caveats the result says apply, right under the headline: the numbers are not read without them. */
function Caveats({ result }: { result: Result | null }) {
  if (result === null) return <p className="abl__caveats-wait">The caveats come with the result.</p>;
  const applied = appliedCaveats(result);
  if (applied.length === 0) return null;
  return (
    <section className="abl__caveats" aria-label="Caveats">
      <h3 className="abl__caveats-title">Read the numbers with these</h3>
      <ul>
        {applied.map((caveat) => (
          <li key={caveat.id}>
            <b>{caveatLabel(caveat.id)}.</b> {caveat.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

const SPLIT_CLASS: Record<Split, string> = { both: "abl__seg--both", only_muse: "abl__seg--muse", only_parser: "abl__seg--parser", neither: "abl__seg--neither" };

function Breakdown({ result }: { result: Result }) {
  const defs = result.definitions;
  const row = (label: string, parser: string, muse: string, hint?: string, sub = false) => (
    <tr key={label} className={sub ? "abl__sub" : undefined}>
      <th scope="row" title={hint}>
        {label}
      </th>
      <td>{parser}</td>
      <td>{muse}</td>
    </tr>
  );
  const emails = (side: Tally) => side.emails;
  const jaccard = (value: number | null): string => (value === null ? "—" : value.toFixed(2));
  const error = (value: number | null): string => (value === null ? "—" : percent(value));
  const p = result.parser;
  const m = result.muse;
  const agreement = result.agreement;
  return (
    <section className="abl__break" aria-label="By kind of note and by who understood">
      <table className="abl__kinds">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Kind of note</span>
            </th>
            <th scope="col">Parser</th>
            <th scope="col">Muse</th>
          </tr>
        </thead>
        <tbody>
          {row("Emails understood", outOf(emails(p).understood, emails(p).of), outOf(emails(m).understood, emails(m).of), defs.understood)}
          {row("cells exact", outOf(emails(p).cells_exact, emails(p).of), outOf(emails(m).cells_exact, emails(m).of), undefined, true)}
          {row("preference right", outOf(emails(p).preference, emails(p).of), outOf(emails(m).preference, emails(m).of), undefined, true)}
          {row("mean Jaccard", jaccard(emails(p).mean_jaccard), jaccard(emails(m).mean_jaccard), defs.jaccard, true)}
          {row("Abstracts understood", outOf(p.abstracts.understood, p.abstracts.of), outOf(m.abstracts.understood, m.abstracts.of), defs.understood)}
          {row("mean error", error(p.abstracts.mean_error_pct), error(m.abstracts.mean_error_pct), undefined, true)}
        </tbody>
      </table>
      <div className="abl__split" title={defs.agreement}>
        <p className="abl__split-title">Who understood what</p>
        <div className="abl__bar" role="img" aria-label={SPLITS.map((split) => `${SPLIT_WORDS[split]} ${agreement[split]}`).join(", ")}>
          {SPLITS.filter((split) => agreement[split] > 0).map((split) => (
            <span key={split} className={`abl__seg ${SPLIT_CLASS[split]}`} style={{ flexGrow: agreement[split] }}>
              {agreement[split]}
            </span>
          ))}
        </div>
        <ul className="abl__legend">
          {SPLITS.map((split) => (
            <li key={split}>
              <span className={`abl__key ${SPLIT_CLASS[split]}`} aria-hidden /> {SPLIT_WORDS[split]} <b>{agreement[split]}</b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** What one reader made of a note, against the approved reading: the parts it has wrong marked, the parts it lacks listed. */
function ReadingCell({ note, side }: { note: Note; side: "parser" | "muse" }) {
  const answer = note[side];
  const { parts, missing } = compare(answer.text, note.reference_text);
  const reason = side === "muse" ? note.muse.error : null;
  return (
    <td className={`abl__cell abl__cell--${answer.score.understood ? "yes" : "no"}`}>
      <div className="abl__cellhead">
        <Verdict understood={answer.score.understood} />
        <span className="abl__score">{scoreParts(note, side).join(" · ")}</span>
      </div>
      {answer.text === null ? (
        <p className="abl__none">{reason === null ? "No reading." : `No reading: ${reason}`}</p>
      ) : (
        <ul className="abl__parts">
          {parts.map((part, i) => (
            <li key={`${i}:${part.text}`} className={part.same ? undefined : "abl__off"}>
              {part.text}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && <p className="abl__missing">Missing: {missing.join("; ")}</p>}
    </td>
  );
}

export interface AblationViewProps {
  run: AblationStatus;
  filter: Filter;
  onFilter: (filter: Filter) => void;
}

/** The ablation: the same notes through the regex parser and through Muse, each reading set against the approved one. */
export function AblationView({ run, filter, onFilter }: AblationViewProps) {
  const { result } = run;
  const differing = new Set(result?.differences ?? []);
  const shown = filterNotes(run.notes, filter, differing);
  const counts = splitCounts(run.notes);
  const sizeOf = (which: Filter): number => (which === "all" ? run.notes.length : which === "differ" ? differing.size : counts[which]);
  return (
    <div className="abl">
      <Headline run={run} />
      <Caveats result={result} />
      {result !== null && <Breakdown result={result} />}
      <section className="abl__notes" aria-label="The notes">
        <div className="abl__filters" role="group" aria-label="Which notes to show">
          {FILTERS.map((which) => (
            <button key={which} type="button" className={`abl__filter${which === filter ? " abl__filter--on" : ""}`} aria-pressed={which === filter} disabled={which === "differ" && result === null} onClick={() => onFilter(which)}>
              {FILTER_WORDS[which]} <span className="abl__count">{sizeOf(which)}</span>
            </button>
          ))}
        </div>
        <table className="abl__table">
          <thead>
            <tr>
              <th scope="col">Note</th>
              <th scope="col" title="what the person approved">
                Approved reading
              </th>
              <th scope="col">Regex parser</th>
              <th scope="col">Muse</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((note) => {
              const differs = differing.has(note.note_id);
              return (
                <tr key={note.note_id} className={`abl__row${differs ? " abl__row--differs" : ""}`} id={`note-${note.note_id}`}>
                  <th scope="row" className="abl__note">
                    <span className="mono">{note.note_id}</span> <span className="abl__kind">{note.kind}</span>
                    {differs && (
                      <span className="abl__differs" title={result?.definitions.differences}>
                        readings differ
                      </span>
                    )}
                    <span className="abl__text">{note.text}</span>
                  </th>
                  <td className="abl__ref">{note.reference_text ?? <span className="abl__none">none</span>}</td>
                  <ReadingCell note={note} side="parser" />
                  <ReadingCell note={note} side="muse" />
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="abl__empty">
                  {run.notes.length === 0 ? "No note has been scored yet." : "No note matches."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
