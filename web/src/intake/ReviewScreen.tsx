import type { ReactNode } from "react";

import type { ApprovedSummary, Scan } from "./api";
import { ApproveBar } from "./ApproveBar";
import { setConference } from "./edit";
import { editWords, scanSummary, shortHash, when } from "./format";
import { activeKeysOf, placeFacts, type Box, type Selection, type Texts } from "./highlight";
import type { Proposal } from "./proposal";
import { ReviewTables } from "./ReviewTables";
import { SourcePane } from "./SourcePane";
import type { Issue } from "./validate";

export interface ReviewScreenProps {
  /** Muse's reading as it first came. */
  original: Proposal;
  /** What the person has made of it. */
  working: Proposal;
  texts: Texts;
  scans: Scan[];
  selection: Selection | null;
  box: Box;
  /** Approved: nothing can be changed any more. */
  locked: boolean;
  issues: Issue[];
  edits: string[];
  approving: boolean;
  approveError: string | null;
  /** What the server holds of the approval, once approved. */
  approved: ApprovedSummary | null;
  /** What the server said about the approval it just took. */
  approvalWarnings: string[];
  /** What follows an approval: the run panel. */
  runPanel: ReactNode;
  onSelect: (selection: Selection | null) => void;
  onBox: (box: Box) => void;
  onChange: (next: Proposal) => void;
  onApprove: () => void;
}

/** What was approved, by the server's own record: when, its fingerprint, and what was changed from Muse's reading. */
export function ApprovedCard({ approved, warnings }: { approved: ApprovedSummary; warnings: string[] }) {
  return (
    <section className="approved" aria-label="Approved">
      <h3 className="approved__title">
        <span aria-hidden>✓</span> Approved
      </h3>
      <p className="approved__line">
        {when(approved.approved_at)} · fingerprint <span className="mono">{shortHash(approved.sha256)}</span>
      </p>
      <p className="approved__line">{approved.edits.length === 0 ? "No edits to Muse’s reading." : `${approved.edits.length} ${approved.edits.length === 1 ? "edit" : "edits"} to Muse’s reading: ${approved.edits.map(editWords).join("; ")}.`}</p>
      {approved.names_pseudonymized && <p className="approved__line">Speakers’ names are replaced by “Speaker NN” in what the agents read.</p>}
      {warnings.length > 0 && (
        <ul className="approved__warnings" aria-label="Notes from the server">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What Muse says it merged, split, cut or assumed to fit the text to the program, in the server's own words. */
export function MuseNotes({ warnings }: { warnings: readonly string[] }) {
  return (
    <section className="notes" aria-label="Muse’s notes on the reading">
      <h3 className="notes__title">Muse’s notes</h3>
      {warnings.length === 0 ? (
        <p className="notes__none">Muse left no notes on this reading.</p>
      ) : (
        <ul className="notes__list">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The review: the text you pasted on the left, with each sentence a row was read from marked in it, and Muse's reading as
 * tables on the right, each row with where it comes from and a way to correct it. After the approval the tables are frozen
 * and the run panel stands above them. */
export function ReviewScreen(props: ReviewScreenProps) {
  const { original, working, texts, scans, selection, box, locked, approved } = props;
  const facts = placeFacts(working, texts);
  const active = activeKeysOf(facts, selection);
  const summary = scanSummary(scans);
  // a page opened on an approved reading has Muse's rows only: the approved version is the server's
  const reopened = locked && approved !== null && approved.edits.length > 0 && props.edits.length === 0;
  return (
    <div className="review">
      <div className="review__source">
        <SourcePane texts={texts} facts={facts} selection={selection} active={active} box={box} onBox={props.onBox} onPick={props.onSelect} />
      </div>
      <div className="review__work">
        {locked && approved !== null && <ApprovedCard approved={approved} warnings={props.approvalWarnings} />}
        {locked && props.runPanel}
        <label className="review__conference">
          <span className="review__label">Conference</span>
          <input value={working.conference} disabled={locked} onChange={(event) => props.onChange(setConference(working, event.target.value))} aria-label="Conference name" />
          {working.conference !== original.conference && <small className="was">Muse read “{original.conference}”</small>}
        </label>
        {summary !== "" && <p className="review__scan">{summary}</p>}
        <MuseNotes warnings={original.warnings} />
        {reopened && <p className="review__reopened">These rows are Muse’s reading. The server keeps the version you approved, with the edits listed above.</p>}
        <ReviewTables original={original} working={working} facts={facts} selection={selection} onSelect={props.onSelect} onChange={props.onChange} locked={locked} />
        {!locked && <ApproveBar issues={props.issues} edits={props.edits} busy={props.approving} error={props.approveError} onApprove={props.onApprove} />}
      </div>
    </div>
  );
}
