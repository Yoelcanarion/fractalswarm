// The verify badge of the static showcase. A page on GitHub Pages has no server to replay a log on, so the report behind
// the badge was made by scripts/build_static_site.py when the site was built, and the badge says so: when, at which
// commit, and that the check did not happen in the visitor's browser. Components/VerifyBadge.tsx renders this in place
// of its own text, in the static build only.

import type { VerifyReport } from "../lib/types";
import { COMMAND } from "./answers";

/** What the build adds to the report it stores (`static`): the commit it ran at, and when. */
export interface BuildStamp {
  commit_short: string;
  built_at: string;
}

export function readStamp(report: object): BuildStamp | null {
  const stamp = (report as { static?: Partial<Record<keyof BuildStamp, unknown>> }).static;
  if (typeof stamp?.commit_short !== "string" || typeof stamp.built_at !== "string") return null;
  return { commit_short: stamp.commit_short, built_at: stamp.built_at };
}

/** Where the check ran, in words: the tooltip of the badge and the line under it. */
export function whereChecked(stamp: BuildStamp | null): string {
  if (stamp === null) return "Checked when this page was built, not in your browser.";
  return `Checked when this page was built, at commit ${stamp.commit_short.slice(0, 7)} on ${stamp.built_at.slice(0, 10)}, not in your browser.`;
}

export function BuildVerified({ report }: { report: VerifyReport }) {
  const stamp = readStamp(report);
  return (
    <span
      className="badge badge--good badge--big"
      title={`${whereChecked(stamp)} ${report.replayed_events} events re-run from run.started; recorded and replayed head ${report.replayed_head}. Check it yourself: ${COMMAND}`}
    >
      Replay verified at build{stamp === null ? "" : `, commit ${stamp.commit_short.slice(0, 7)}`} ✓ hash match{" "}
      <span className="mono">{report.replayed_head.slice(0, 12)}</span>
    </span>
  );
}
