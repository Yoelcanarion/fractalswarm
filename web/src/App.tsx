import { useEffect, useState } from "react";

import { RunStrip } from "./components/RunStrip";
import { StatusBadge, ThemeToggle } from "./components/ui";
import { SPEEDS } from "./lib/playback";
import { ChartsPage } from "./pages/ChartsPage";
import { EventsPage } from "./pages/EventsPage";
import { PanelsPage } from "./pages/PanelsPage";
import { PlanPage } from "./pages/PlanPage";
import { ResultsPage } from "./pages/ResultsPage";
import { RunPage } from "./pages/RunPage";
import { RunsPage } from "./pages/RunsPage";
import { SecurityPage } from "./pages/SecurityPage";
import { useRunStore, useRunStoreApi, type RunStoreApi } from "./store";

// `#/run/<id>[/plan|panels|security|results|events]?at=end|<event count>&speed=<1-20>&play` opens a replay at
// a given point, for shareable links and the video. Every view of a run shares the playhead.
interface Playback {
  at: string | null;
  speed: number | null;
  play: boolean;
}

const RUN_VIEWS = ["overview", "plan", "panels", "security", "results", "events"] as const;
type RunView = (typeof RUN_VIEWS)[number];
const VIEW_TITLES: Record<RunView, string> = {
  overview: "Run",
  plan: "Plan",
  panels: "Panels",
  security: "Security",
  results: "Results",
  events: "Events",
};

type Route =
  | { page: "run"; runId: string | null; view: RunView; playback: Playback }
  | { page: "charts" }
  | { page: "runs" };

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
    view: RUN_VIEWS.find((view) => view === parts[2]) ?? "overview",
    playback: { at: params.get("at"), speed: SPEEDS.includes(speed as never) ? speed : null, play: params.has("play") },
  };
}

const viewHash = (runId: string | null, view: RunView): string =>
  `#/run/${runId === null ? "" : encodeURIComponent(runId)}${view === "overview" ? "" : `/${view}`}`;

function applyPlayback(store: RunStoreApi, { at, speed, play }: Playback) {
  const s = store.getState();
  if (speed) s.setSpeed(speed);
  if (at === "end") s.seek(s.events.length);
  else if (at && Number.isFinite(Number(at))) s.seek(Number(at));
  if (play) s.setPlaying(true);
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const store = useRunStoreApi();
  const runs = useRunStore((s) => s.runs);
  const runId = useRunStore((s) => s.runId);
  const runStatus = useRunStore((s) => s.runStatus);
  const scenario = useRunStore((s) => s.view.scenario);
  const blocked = useRunStore((s) => s.view.panels.security.quarantines.length + s.view.panels.security.violations.length);
  const loadRuns = useRunStore((s) => s.loadRuns);
  const loadCapabilities = useRunStore((s) => s.loadCapabilities);
  const openRun = useRunStore((s) => s.openRun);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    void loadRuns();
    void loadCapabilities();
    return () => window.removeEventListener("hashchange", onHash);
  }, [loadRuns, loadCapabilities]);

  // Open the run named in the URL, or else the first listed one (the demo bundle first).
  useEffect(() => {
    if (route.page !== "run") return;
    const wanted = route.runId ?? runs[0]?.id ?? null;
    if (wanted && wanted !== runId) {
      void openRun(wanted).then(() => {
        const s = store.getState();
        if (s.live || s.runId !== wanted) return;
        applyPlayback(store, route.playback);
        void s.runVerify();
      });
    }
  }, [route, runs, runId, openRun, store]);

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
          {RUN_VIEWS.map((name) => (
            <a
              key={name}
              className={route.page === "run" && route.view === name ? "tab tab--on" : "tab"}
              href={viewHash(runId, name)}
            >
              {VIEW_TITLES[name]}
              {name === "security" && blocked > 0 && (
                <span className="tab__count" title="quarantined emails and blocked subgoals">
                  {blocked}
                </span>
              )}
            </a>
          ))}
          <a className={route.page === "charts" ? "tab tab--on" : "tab"} href="#/charts">
            Charts
          </a>
          <a className={route.page === "runs" ? "tab tab--on" : "tab"} href="#/runs">
            Runs
          </a>
        </nav>
        <div className="topbar__right">
          {route.page === "run" && runId && (
            <div className="topbar__run">
              <select
                value={runId}
                onChange={(e) => {
                  window.location.hash = viewHash(e.target.value, route.view);
                }}
                aria-label="run"
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.id}
                  </option>
                ))}
              </select>
              <span className="mono muted">{scenario?.split(":").at(-1) ?? ""}</span>
              <StatusBadge status={runStatus} />
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>
      {route.page === "run" && runId && <RunStrip />}
      <main className="content">
        {route.page === "run" && route.view === "overview" && <RunPage />}
        {route.page === "run" && route.view === "plan" && <PlanPage />}
        {route.page === "run" && route.view === "panels" && <PanelsPage />}
        {route.page === "run" && route.view === "security" && <SecurityPage />}
        {route.page === "run" && route.view === "results" && <ResultsPage />}
        {route.page === "run" && route.view === "events" && <EventsPage />}
        {route.page === "charts" && <ChartsPage />}
        {route.page === "runs" && <RunsPage />}
      </main>
    </div>
  );
}
