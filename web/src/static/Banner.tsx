// The banner of the static showcase, above the app: what this site is, how to run the real thing, what it was built from,
// and how far a large log has loaded. It lives outside the app's React tree (install.tsx mounts it in its own root), so
// App.tsx does not know it exists; on the home page and the evidence page it renders nothing, so it never sits on the hero.

import { useEffect, useLayoutEffect, useState } from "react";

import { pageOf } from "../home/route";
import { REPO_URL } from "../lib/links";
import { COMMAND } from "./answers";
import type { SiteStamp } from "./manifest";
import { megabytes, overall, PROGRESS_EVENT, type LoadProgress } from "./progress";

/** The banner belongs to the app shell and nowhere else. The home page and the evidence page have a bar of their own, fixed to
 * the window, which would cover it, and the lab of the visuals is not part of the showcase. Which page an address opens is
 * W6's `pageOf` (home/route.ts), so there is one rule and no copy of it to drift. */
export const showsBanner = (hash: string): boolean => pageOf(hash) === "app";

const useHash = (): string => {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
};

/** The latest report of each run the shim is loading. */
const useReports = (): ReadonlyMap<string, LoadProgress> => {
  const [reports, setReports] = useState<ReadonlyMap<string, LoadProgress>>(new Map());
  useEffect(() => {
    const onProgress = (event: Event) => {
      const report = (event as CustomEvent<LoadProgress>).detail;
      setReports((kept) => new Map(kept).set(report.runId, report));
    };
    window.addEventListener(PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(PROGRESS_EVENT, onProgress);
  }, []);
  return reports;
};

/** What the replay badges rest on: the check was made when the site was built, not in the visitor's browser. */
export const buildNote = (site: SiteStamp): string =>
  `Replays checked at build (${site.commit_short.slice(0, 7)}${site.dirty ? "+" : ""}, ${site.built_at.slice(0, 10)}), not in your browser.`;

/** The same, with the full commit and the command to check one yourself, for the tooltip. */
export const buildDetail = (site: SiteStamp): string =>
  `Every replay shown as verified was checked when this site was built (commit ${site.commit}${site.dirty ? ", with uncommitted changes" : ""}, ${site.built_at}), not in your browser. Check one yourself: uv run fractalswarm replay RUN --verify`;

export function StaticBanner({ site }: { site: SiteStamp }) {
  const hidden = !showsBanner(useHash());
  const loading = overall(useReports());

  // The banner is not in the app's layout; while it shows, the page gives it the room (static.css). Before the first
  // paint, so the app does not jump down when the banner appears.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (hidden) delete root.dataset.staticbar;
    else root.dataset.staticbar = "on";
    return () => {
      delete root.dataset.staticbar;
    };
  }, [hidden]);

  if (hidden) return null;
  return (
    <div className={loading ? "staticbar staticbar--loading" : "staticbar"} role="note">
      <span className="staticbar__text">
        Static showcase: recorded runs only.
        <span className="staticbar__more">
          {" "}
          Run it yourself: <a href={REPO_URL}>get the code</a>, then <code>{COMMAND}</code>
        </span>
      </span>
      {loading ? (
        <span className="staticbar__side" role="status">
          Loading {loading.runs.join(", ")}: {megabytes(loading.loaded)} of {megabytes(loading.total)} MB
        </span>
      ) : (
        <span className="staticbar__side staticbar__note" title={buildDetail(site)}>
          {buildNote(site)}
        </span>
      )}
      {loading && (
        <span
          className="staticbar__bar"
          role="progressbar"
          aria-label="Loading the run"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((100 * loading.loaded) / loading.total)}
          style={{ width: `${(100 * loading.loaded) / loading.total}%` }}
        />
      )}
    </div>
  );
}
