import { useEffect, useState } from "react";

import { VerifyBadge } from "./components/VerifyBadge";
import { SPEEDS } from "./lib/playback";
import { ChartsPage } from "./pages/ChartsPage";
import { RunPage } from "./pages/RunPage";
import { RunsPage } from "./pages/RunsPage";
import { useRun } from "./store";

// `#/run/<id>?at=end|<event count>&speed=<1-20>&play` opens a replay at a given point, for
// shareable links and the video.
interface Playback {
  at: string | null;
  speed: number | null;
  play: boolean;
}

type Route = { page: "run"; runId: string | null; playback: Playback } | { page: "charts" } | { page: "runs" };

function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/");
  if (parts[0] === "charts") return { page: "charts" };
  if (parts[0] === "runs") return { page: "runs" };
  const params = new URLSearchParams(query);
  const speed = Number(params.get("speed"));
  return {
    page: "run",
    runId: parts[0] === "run" && parts[1] ? decodeURIComponent(parts[1]) : null,
    playback: { at: params.get("at"), speed: SPEEDS.includes(speed as never) ? speed : null, play: params.has("play") },
  };
}

function applyPlayback({ at, speed, play }: Playback) {
  const s = useRun.getState();
  if (speed) s.setSpeed(speed);
  if (at === "end") s.seek(s.events.length);
  else if (at && Number.isFinite(Number(at))) s.seek(Number(at));
  if (play) s.setPlaying(true);
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const { runs, runId, view, live, loadRuns, openRun } = useRun();

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    void loadRuns();
    return () => window.removeEventListener("hashchange", onHash);
  }, [loadRuns]);

  // Open the run named in the URL, or else the first listed one (the demo bundle first).
  useEffect(() => {
    if (route.page !== "run") return;
    const wanted = route.runId ?? runs[0]?.id ?? null;
    if (wanted && wanted !== runId) {
      void openRun(wanted).then(() => {
        const s = useRun.getState();
        if (s.live || s.runId !== wanted) return;
        applyPlayback(route.playback);
        void s.runVerify();
      });
    }
  }, [route, runs, runId, openRun]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand__mark" aria-hidden>
            ◆
          </span>
          FractalSwarm
        </a>
        <nav className="tabs">
          <a className={route.page === "run" ? "tab tab--on" : "tab"} href={`#/run/${runId ?? ""}`}>
            Run
          </a>
          <a className={route.page === "charts" ? "tab tab--on" : "tab"} href="#/charts">
            Charts
          </a>
          <a className={route.page === "runs" ? "tab tab--on" : "tab"} href="#/runs">
            Runs
          </a>
        </nav>
        {route.page === "run" && runId && (
          <div className="topbar__run">
            <select
              value={runId}
              onChange={(e) => {
                window.location.hash = `#/run/${encodeURIComponent(e.target.value)}`;
              }}
              aria-label="run"
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id}
                </option>
              ))}
            </select>
            <span className="mono muted">{view.scenario?.split(":").at(-1) ?? ""}</span>
            {live ? <span className="badge badge--live">● LIVE</span> : <span className="badge badge--muted">REPLAY</span>}
            <VerifyBadge />
          </div>
        )}
      </header>
      <main className="content">
        {route.page === "run" && <RunPage />}
        {route.page === "charts" && <ChartsPage />}
        {route.page === "runs" && <RunsPage />}
      </main>
    </div>
  );
}
