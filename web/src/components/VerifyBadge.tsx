import { BuildVerified } from "../static/BuildVerified";
import { useRunStore } from "../store";

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
        <button className="badge badge--bad" onClick={runVerify} title={verify.error}>
          Verify failed: {verify.error}
        </button>
      );
    case "done": {
      const { report } = verify;
      if (report.ok && report.bundle_head_ok) {
        // The static showcase has no server to replay on: its report was made when the page was built.
        if (import.meta.env.MODE === "static") return <BuildVerified report={report} />;
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
