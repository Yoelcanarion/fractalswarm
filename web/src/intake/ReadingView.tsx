import { Skeleton, SkeletonGroup, SkeletonText } from "../components/ui";
import type { IntakeState, Scan } from "./api";

const BOX_WORDS: Record<string, string> = { conference: "Conference", talks: "Talks", notes: "Notes" };

/** What the firewall found in each box: addresses are replaced by placeholders, and anything blocked says why. */
export function ScanList({ scans }: { scans: Scan[] }) {
  if (scans.length === 0) return null;
  return (
    <ul className="scans" aria-label="What the scan found">
      {scans.map((scan) => (
        <li key={scan.source_id} className={`scans__item${scan.decision === "allow" ? "" : " scans__item--blocked"}`}>
          <b>{BOX_WORDS[scan.source_id] ?? scan.source_id}</b> {scan.decision === "allow" ? "allowed" : scan.decision}
          {scan.findings.length > 0 && <span className="scans__found"> · {scan.findings.map((found) => (found === "email" ? "addresses replaced" : found)).join(", ")}</span>}
          {scan.decision !== "allow" && scan.reasons.length > 0 && <span className="scans__found"> · {scan.reasons.join("; ")}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Asking the server which state the reading is in (a link opened, a page reloaded): the shape of the panel that follows, so it does not jump. */
export function LoadingReading() {
  return (
    <section className="panel reading" aria-label="Loading the reading">
      <SkeletonGroup label="Loading the reading" className="skeleton-group--stack">
        <Skeleton width={240} height={22} />
        <SkeletonText lines={2} />
      </SkeletonGroup>
    </section>
  );
}

/** The reading is going: the reader is filling in the program's shape, and the scan is already known. */
export function Reading({ state }: { state: IntakeState | null }) {
  return (
    <section className="panel reading" aria-live="polite" aria-label="Reading">
      <div className="reading__head">
        <span className="spinner" aria-hidden />
        <h3 className="reading__title">Reading your text…</h3>
      </div>
      <p className="reading__lead">The reader is putting it into the program&rsquo;s shape: talks, speakers, tracks, and the sentence each fact was read from. Nothing is approved yet.</p>
      {state !== null && <ScanList scans={state.scans} />}
    </section>
  );
}

export interface StoppedProps {
  headline: string;
  details: string[];
  scans: Scan[];
  onStartOver: () => void;
  /** Ask the server again: for a reading that could not be fetched, which a refusal or a failure of the reader is not. */
  onRetry?: () => void;
}

/** The reading stopped, and why. The text is still in the form, so the person can change it and read again. */
export function Stopped({ headline, details, scans, onStartOver, onRetry }: StoppedProps) {
  return (
    <section className="panel stopped" role="alert" aria-label="Reading stopped">
      <h3 className="stopped__title">{headline}</h3>
      {details.map((line) => (
        <p key={line} className="stopped__line">
          {line}
        </p>
      ))}
      <ScanList scans={scans} />
      <div className="stopped__actions">
        {onRetry && (
          <button type="button" className="btn btn--on" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className={onRetry ? "btn" : "btn btn--on"} onClick={onStartOver}>
          Back to the form
        </button>
      </div>
    </section>
  );
}
