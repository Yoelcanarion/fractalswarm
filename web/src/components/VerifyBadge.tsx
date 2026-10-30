import { useRunStore } from "../store";
import { Hint } from "./ui";

export function VerifyBadge() {
  const verify = useRunStore((s) => s.verify);
  const live = useRunStore((s) => s.live);
  const runVerify = useRunStore((s) => s.runVerify);

  if (live) return <span className="badge badge--muted">verify after the run ends</span>;
  switch (verify.state) {
    case "idle":
      return (
        <button className="badge badge--button" onClick={runVerify}>
          Verify replay
        </button>
      );
    case "pending":
      return <span className="badge badge--muted">Replaying from the log…</span>;
    case "error":
      return (
        <button className="badge badge--bad" onClick={runVerify}>
          Verify failed: {verify.error}
        </button>
      );
    case "done": {
      const { report } = verify;
      if (report.ok && report.bundle_head_ok) {
        return (
          <Hint focusable label={`${report.replayed_events} events re-run from run.started; recorded and replayed head ${report.replayed_head}`}>
            <span className="badge badge--good badge--big">
              Replay verified ✓ hash match <span className="mono verify__head">{report.replayed_head.slice(0, 12)}</span>
            </span>
          </Hint>
        );
      }
      return (
        <Hint focusable label={report.detail}>
          <span className="badge badge--bad badge--big">✕ Replay MISMATCH at seq {report.first_divergence ?? "?"}</span>
        </Hint>
      );
    }
  }
}
