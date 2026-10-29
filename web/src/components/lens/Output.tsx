// What a call said, as something a person can read: the facts it published next to the sentences of
// the source email they came from, the plan it made, the placements, the judge's verdict, what it
// wrote. The reading of the answer is lib/lens.ts `readOutput`; this file only draws it.
//
// The sources are emails and abstracts: untrusted text from outside. They are drawn as text and
// nothing else, never as markup.

import { Quote } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import {
  highlight,
  isBlurb,
  readOutput,
  sentenceLabel,
  type CallDetail,
  type Fact,
  type Readable,
  type Source,
} from "../../lib/lens";

const FACTS_SHOWN = 6;

function SourceText({ source, evidence }: { source: Source; evidence: Fact["evidence"] }) {
  const own = useMemo(() => evidence.filter((e) => e.source_id === source.id), [evidence, source.id]);
  const segments = useMemo(() => highlight(source.text, own), [source.text, own]);
  const from = source.from ?? source.title ?? source.speaker_id ?? "";
  return (
    <figure className="source">
      <figcaption className="source__head">
        <span className="source__id mono">{source.id}</span>
        <span className="source__kind">{source.kind}</span>
        {from && <span className="source__from">{from}</span>}
      </figcaption>
      <p className="source__text">
        {segments.map((segment, i) =>
          segment.marks.length > 0 ? (
            <mark key={i} className="evidence" title={`supports: ${segment.marks.map((m) => own[m].field).join(", ")}`}>
              <span className="evidence__field">{[...new Set(segment.marks.map((m) => own[m].field))].join(" · ")}</span>
              {segment.text}
            </mark>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </p>
    </figure>
  );
}

function FactCard({ fact, sources }: { fact: Fact; sources: Record<string, Source> }) {
  const value = useMemo(() => JSON.stringify(fact.value), [fact.value]);
  return (
    <li className="fact">
      <div className="fact__claim">
        <div className="fact__key mono">{fact.key}</div>
        <div className="fact__reading">{fact.reading ?? value}</div>
        <div className="fact__meta">
          {fact.via === "answer" ? "in the final answer" : "published to the board"}
          {fact.reused && " · read from the board, not from this call's sources"}
        </div>
        {fact.reading && value && (
          <code className="fact__value" title={value}>
            {value.length > 120 ? `${value.slice(0, 119)}…` : value}
          </code>
        )}
        {fact.unmatched.length > 0 && <div className="fact__gap">No source sentence found for {fact.unmatched.join(", ")}.</div>}
      </div>
      <div className="fact__sources">
        {fact.sources.length === 0 && <div className="muted">No source: the value came from the board.</div>}
        {fact.sources.map((id) =>
          sources[id] ? <SourceText key={id} source={sources[id]} evidence={fact.evidence} /> : <div key={id} className="muted">Source {id} is not in the log.</div>,
        )}
      </div>
    </li>
  );
}

function Facts({ detail }: { detail: CallDetail }) {
  const facts = detail.facts ?? [];
  const [all, setAll] = useState(false);
  const shown = all ? facts : facts.slice(0, FACTS_SHOWN);
  return (
    <section className="lens-block" aria-label="Facts published">
      <h4 className="lens-h">
        Facts, next to the sentence they came from <span className="lens-count">{facts.length}</span>
      </h4>
      <ol className="facts">
        {shown.map((fact, i) => (
          <FactCard key={`${fact.key}:${i}`} fact={fact} sources={detail.sources ?? {}} />
        ))}
      </ol>
      {facts.length > shown.length && (
        <button type="button" className="btn lens-more" onClick={() => setAll(true)}>
          Show all {facts.length} facts
        </button>
      )}
    </section>
  );
}

const risk = (value: number | null): string => (value === null ? "—" : value.toFixed(value < 1 && value > 0 ? 2 : 0));

function Piece({ piece, detail }: { piece: Readable; detail: CallDetail }) {
  switch (piece.kind) {
    case "facts":
      return <Facts detail={detail} />;
    case "tracks":
      return (
        <section className="lens-block" aria-label="Plan">
          <h4 className="lens-h">
            Plan: tracks <span className="lens-count">{piece.tracks.length}</span>
          </h4>
          <table className="lens-table">
            <thead>
              <tr>
                <th scope="col">Track</th>
                <th scope="col">Home room</th>
                <th scope="col" className="num">
                  Talks
                </th>
                <th scope="col" className="num">
                  Priority
                </th>
                <th scope="col" className="num">
                  Risk
                </th>
              </tr>
            </thead>
            <tbody>
              {piece.tracks.map((track) => (
                <tr key={track.id}>
                  <th scope="row" className="mono">
                    {track.id}
                  </th>
                  <td>{track.room}</td>
                  <td className="num">{track.talks}</td>
                  <td className="num">{track.priority ?? "—"}</td>
                  <td className="num">{risk(track.risk)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {piece.tracks.some((track) => track.acceptance) && (
            <dl className="words">
              {piece.tracks
                .filter((track) => track.acceptance)
                .map((track) => (
                  <div key={track.id} className="words__row">
                    <dt className="mono">{track.id}</dt>
                    <dd>{track.acceptance}</dd>
                  </div>
                ))}
            </dl>
          )}
        </section>
      );
    case "contracts":
      return (
        <section className="lens-block" aria-label="Plan">
          <h4 className="lens-h">
            Plan: contracts <span className="lens-count">{piece.contracts.length}</span>
          </h4>
          <ol className="contracts">
            {piece.contracts.map((contract) => (
              <li key={contract.id} className="contract">
                <span className="contract__id mono">{contract.id}</span>
                <span className="contract__kind">{contract.kind}</span>
                <span className="contract__objective">{contract.objective}</span>
                {contract.dependsOn.length > 0 && <span className="contract__after">after {contract.dependsOn.join(", ")}</span>}
              </li>
            ))}
          </ol>
        </section>
      );
    case "placements":
      return (
        <section className="lens-block" aria-label="Placements">
          <h4 className="lens-h">
            Placements <span className="lens-count">{piece.placements.length}</span>
          </h4>
          <table className="lens-table">
            <thead>
              <tr>
                <th scope="col">Talk</th>
                <th scope="col" className="num">
                  Day
                </th>
                <th scope="col" className="num">
                  Slot
                </th>
                <th scope="col">Room</th>
              </tr>
            </thead>
            <tbody>
              {piece.placements.map((placement) => (
                <tr key={`${placement.talk}:${placement.day}:${placement.slot}`}>
                  <th scope="row" className="mono">
                    {placement.talk}
                  </th>
                  <td className="num">{placement.day ?? "—"}</td>
                  <td className="num">{placement.slot ?? "—"}</td>
                  <td>{placement.room}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
    case "verdict": {
      const pass = /^(pass|ok|accept)/i.test(piece.verdict);
      return (
        <section className="lens-block" aria-label="Verdict">
          <h4 className="lens-h">Verdict</h4>
          <p className="verdict">
            <span className={`badge ${pass ? "badge--good" : "badge--bad"}`}>{piece.verdict}</span>
            {piece.score !== null && <span className="verdict__score">score {piece.score}</span>}
          </p>
        </section>
      );
    }
    case "ruling":
      return (
        <section className="lens-block" aria-label="Ruling">
          <h4 className="lens-h">Ruling</h4>
          <p className="verdict">
            <span className="badge badge--good mono">{piece.winner}</span>
            {piece.confidence !== null && <span className="verdict__score">confidence {Math.round(piece.confidence * 100)}%</span>}
          </p>
          {piece.reason && <p className="lens-text">{piece.reason}</p>}
          {piece.evidence.length > 0 && <p className="muted">Evidence: {piece.evidence.join(", ")}</p>}
        </section>
      );
    case "write":
      return (
        <section className="lens-block" aria-label="Written file">
          <h4 className="lens-h">
            Wrote <span className="mono lens-path">{piece.path}</span>
          </h4>
          <blockquote className="lens-quote">
            <Quote size={16} aria-hidden />
            <p>{piece.content.trim()}</p>
          </blockquote>
        </section>
      );
    case "search":
      return (
        <p className="lens-search">
          Searched the board for <code>{piece.query}</code>
          {piece.scope && <span className="muted"> ({piece.scope.split(":")[0]})</span>}
        </p>
      );
    case "message":
      return <p className="lens-text">{piece.text}</p>;
    case "fields":
      return (
        <section className="lens-block" aria-label="Answer">
          <h4 className="lens-h">Answer</h4>
          <dl className="words">
            {piece.fields.map((field) => (
              <div key={field.name} className="words__row">
                <dt>{field.name}</dt>
                <dd>{isBlurb(field.name) ? <blockquote className="lens-quote"><Quote size={16} aria-hidden /><p>{field.text.trim()}</p></blockquote> : field.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "json":
      return (
        <details className="lens-fold">
          <summary>{piece.label}</summary>
          <pre className="lens-pre mono">{JSON.stringify(piece.value, null, 2)}</pre>
        </details>
      );
  }
}

/** The model's own sentences: its reasons, notes and limitations, labelled by the field they came from. */
function Words({ detail }: { detail: CallDetail }) {
  const sentences = detail.decision.sentences;
  if (sentences.length === 0) return null;
  return (
    <section className="lens-block" aria-label="In the model's own words">
      <h4 className="lens-h">In the model's own words</h4>
      <dl className="words">
        {sentences.map((sentence, i) => (
          <div key={`${sentence.field}:${i}`} className="words__row">
            <dt>{sentenceLabel(sentence.field)}</dt>
            <dd>{sentence.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Output({ detail }: { detail: CallDetail }): ReactNode {
  const pieces = useMemo(() => readOutput(detail), [detail]);
  return (
    <>
      {pieces.map((piece, i) => (
        <Piece key={`${piece.kind}:${i}`} piece={piece} detail={detail} />
      ))}
      <Words detail={detail} />
    </>
  );
}
