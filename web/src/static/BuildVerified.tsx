// The verify badge of the static showcase. A page on GitHub Pages has no server to replay a log on, so the report behind
// the badge was made by scripts/build_static_site.py when the site was built, and the badge says so: the chip says it was
// at build, and its tooltip when, at which commit, which hash, and that the check did not happen in the visitor's browser.
// Components/VerifyBadge.tsx renders this in place of its own text, in the static build only.

import { Hint } from "../components/ui/Hint";
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

/** The same truth for a place that shows a verdict as plain words (the Runs page's verify cell), in the static build only:
 * in place of "Replay verified" and "N events re-run from run.started", which would say a replay ran just now. */
export function verifiedAtBuild(report: VerifyReport): { label: string; detail: string } {
  return {
    label: "Replay verified at build",
    detail: `${whereChecked(readStamp(report))} Recorded and replayed head ${report.replayed_head.slice(0, 12)}. Check it yourself: ${COMMAND}`,
  };
}

/** What the badge's tooltip says: where the check was made (the commit and the day), that the hash matched and which it was, and how to check one
 * yourself. The badge is one short line, because the banner names the build already and the places the badge sits in (a strip, a column of
 * chips) are narrow. */
export const buildVerifiedHint = (report: VerifyReport): string =>
  `${whereChecked(readStamp(report))} ${report.replayed_events} events re-run from run.started; hash match: recorded and replayed head ${report.replayed_head}. Check it yourself: ${COMMAND}`;

export function BuildVerified({ report }: { report: VerifyReport }) {
  return (
    <Hint label={buildVerifiedHint(report)}>
      <span className="badge badge--good badge--big">Replay verified at build ✓</span>
    </Hint>
  );
}
