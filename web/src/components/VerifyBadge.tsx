import { useRun } from "../store";

export function VerifyBadge() {
  const verify = useRun((s) => s.verify);
  const live = useRun((s) => s.live);
  const runVerify = useRun((s) => s.runVerify);

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
        <button className="badge badge--bad" onClick={runVerify} title={verify.error}>
          Verify failed: {verify.error}
        </button>
      );
    case "done": {
      const { report } = verify;
      if (report.ok && report.bundle_head_ok) {
        return (
          <span
            className="badge badge--good badge--big"
            title={`${report.replayed_events} events re-run from run.started; recorded and replayed head ${report.replayed_head}`}
          >
            Replay verified ✓ hash match <span className="mono">{report.replayed_head.slice(0, 12)}</span>
          </span>
        );
      }
      return (
        <span className="badge badge--bad badge--big" title={report.detail}>
          ✕ Replay MISMATCH at seq {report.first_divergence ?? "?"}
        </span>
      );
    }
  }
}
