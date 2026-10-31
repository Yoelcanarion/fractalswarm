import { Details } from "../components/ui";
import { editWords } from "./format";
import { canApprove, type Issue } from "./validate";

export interface ApproveBarProps {
  issues: Issue[];
  /** What the person changed from Muse's reading, as the server lists it. */
  edits: string[];
  busy: boolean;
  /** What the server said when it did not take the approval. */
  error: string | null;
  onApprove: () => void;
}

/** The end of the review: what stops an approval, what is only worth knowing, and what was changed. */
export function ApproveBar({ issues, edits, busy, error, onApprove }: ApproveBarProps) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const advice = issues.filter((issue) => issue.severity === "advice");
  return (
    <section className="approve" aria-label="Approve the reading">
      {errors.length > 0 && (
        <ul className="approve__errors" role="alert">
          {errors.map((issue) => (
            <li key={`${issue.where}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      {advice.length > 0 && (
        <Details inline summary={`${advice.length} ${advice.length === 1 ? "thing" : "things"} to know`} className="approve__advice">
          <ul>
            {advice.map((issue) => (
              <li key={`${issue.where}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </Details>
      )}
      <p className="approve__edits">
        {edits.length === 0 ? (
          "No edits: this is Muse’s reading as it stands."
        ) : (
          <>
            <b>
              {edits.length} {edits.length === 1 ? "edit" : "edits"}
            </b>{" "}
            to Muse’s reading: {edits.map(editWords).join("; ")}.
          </>
        )}
      </p>
      <div className="approve__row">
        <button type="button" className="btn btn--on" disabled={!canApprove(issues) || busy} onClick={onApprove}>
          {busy ? "Approving…" : "Approve this reading"}
        </button>
        <span className="approve__note">Approving freezes it: a run on it reads exactly what you approved.</span>
      </div>
      {error !== null && (
        <p className="approve__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
