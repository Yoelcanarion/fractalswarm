// How far the log of a run has loaded. A real log is many megabytes (the demo's is 6 MB, a longer one twice that), so
// the page says so while it loads: the shim reports the bytes it has read of the run's page files against their size
// in the manifest, and the banner draws a bar from the reports.

export const PROGRESS_EVENT = "fractalswarm:static-progress";

/** Below this a log loads before anyone could read the bar, so it is not drawn. */
export const SHOW_FROM_BYTES = 512 * 1024;

export interface LoadProgress {
  runId: string;
  loaded: number;
  total: number;
}

/** What the bar shows from the latest report of each run: the runs still loading, with their sum. Null when none is. */
export function overall(reports: ReadonlyMap<string, LoadProgress>): { loaded: number; total: number; runs: string[] } | null {
  const loading = [...reports.values()].filter((r) => r.total >= SHOW_FROM_BYTES && r.loaded < r.total);
  if (loading.length === 0) return null;
  return {
    loaded: loading.reduce((sum, r) => sum + r.loaded, 0),
    total: loading.reduce((sum, r) => sum + r.total, 0),
    runs: loading.map((r) => r.runId),
  };
}

export const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);
