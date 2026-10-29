// The ablation's address: `#/ablation` is where a run is started or picked, `#/ablation/<run id>` a run.

export interface AblationRoute {
  runId: string | null;
}

export function parseAblationRoute(hash: string): AblationRoute | null {
  const [path] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/");
  if (parts[0] !== "ablation") return null;
  return { runId: parts[1] ? decodeURIComponent(parts[1]) : null };
}

export const ablationHash = (runId: string | null): string => (runId === null ? "#/ablation" : `#/ablation/${encodeURIComponent(runId)}`);
