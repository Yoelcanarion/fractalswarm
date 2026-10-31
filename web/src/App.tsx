// The app shell is a lazy chunk (home/Root.tsx): the styles only it needs are imported here, so the
// home page's first load carries neither them nor recharts and React Flow.
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./styles/ui.css";
import "./styles/lens.css";
import "./styles/lite.css";

import { useEffect, useState } from "react";

import { ArenaPage } from "./arena/ArenaPage";
import { HelpsPage } from "./arena/helps/HelpsPage";
import { parseArenaRoute, type ArenaRoute } from "./arena/route";
import { AblationPage } from "./ablation/AblationPage";
import { parseAblationRoute, type AblationRoute } from "./ablation/route";
import { RunStrip } from "./components/RunStrip";
import { Guide, useGuide } from "./components/shell/Guide";
import { useSite } from "./components/useSite";
import { DirectorPage } from "./director/DirectorPage";
import { parseDirectorRoute, type DirectorRoute } from "./director/route";
import { IntakePage } from "./intake/IntakePage";
import { parseIntakeRoute, type IntakeRoute } from "./intake/route";
import { TopBar } from "./components/shell/TopBar";
import { defaultRunId, namedRunId, openingRun } from "./lib/address";
import { SPEEDS } from "./lib/playback";
import { pickedRunHash, RUN_VIEWS, type RunView } from "./lib/shell";
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

type Route =
  | { page: "run"; runId: string | null; view: RunView; playback: Playback }
  | { page: "arena"; arena: ArenaRoute }
  | { page: "intake"; intake: IntakeRoute }
  | { page: "ablation"; ablation: AblationRoute }
  | { page: "director"; director: DirectorRoute }
  | { page: "helps" }
  | { page: "charts" }
  | { page: "runs" };

function parseHash(hash: string): Route {
  const director = parseDirectorRoute(hash);
  if (director) return { page: "director", director };
  const arena = parseArenaRoute(hash);
  if (arena) return { page: "arena", arena };
  const intake = parseIntakeRoute(hash);
  if (intake) return { page: "intake", intake };
  const ablation = parseAblationRoute(hash);
  if (ablation) return { page: "ablation", ablation };
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/");
  if (parts[0] === "helps") return { page: "helps" };
  if (parts[0] === "charts") return { page: "charts" };
  if (parts[0] === "runs") return { page: "runs" };
  const params = new URLSearchParams(query);
  const speed = Number(params.get("speed"));
  return {
    page: "run",
    runId: namedRunId(hash),
    view: RUN_VIEWS.find((view) => view === parts[2]) ?? "overview",
    playback: { at: params.get("at"), speed: SPEEDS.includes(speed as never) ? speed : null, play: params.has("play") },
  };
}

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
  const runsLoaded = useRunStore((s) => s.runsLoaded);
  const loadError = useRunStore((s) => s.loadError);
  const runId = useRunStore((s) => s.runId);
  const runStatus = useRunStore((s) => s.runStatus);
  const scenario = useRunStore((s) => s.view.scenario);
  const blocked = useRunStore((s) => s.view.panels.security.quarantines.length + s.view.panels.security.violations.length);
  const loadRuns = useRunStore((s) => s.loadRuns);
  const loadCapabilities = useRunStore((s) => s.loadCapabilities);
  const openRun = useRunStore((s) => s.openRun);
  const guide = useGuide(route.page === "intake");
  const site = useSite();

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    void loadRuns();
    void loadCapabilities();
    return () => window.removeEventListener("hashchange", onHash);
  }, [loadRuns, loadCapabilities]);

  // Open the run named in the URL, or else the final run, at its end: a bare #/run is what a newcomer lands on, and a page of zeros is
  // not a first sight.
  useEffect(() => {
    if (route.page !== "run") return;
    const wanted = route.runId ?? defaultRunId(runs);
    if (wanted && wanted !== runId) {
      void openRun(wanted).then(() => {
        const s = store.getState();
        if (s.live || s.runId !== wanted) return;
        applyPlayback(store, route.runId === null && route.playback.at === null ? { ...route.playback, at: "end" } : route.playback);
        void s.runVerify();
      });
    }
  }, [route, runs, runId, openRun, store]);

  // A run that ends with its page open gets the check a recorded one gets on opening.
  useEffect(
    () =>
      store.subscribe((now, before) => {
        if (before.live && !now.live && before.runId === now.runId) void now.runVerify();
      }),
    [store],
  );

  // Director mode is the frame of the video: none of the app around it. After the hooks, so they run in the same order.
  if (route.page === "director") return <DirectorPage route={route.director} />;

  // a run is about to open, and the strip and the status badge hold their places until it has: with no run to open, or one that failed to
  // load, there is nothing to hold them for
  const opening = route.page === "run" && loadError === null && openingRun({ runId, named: route.runId, runs, runsLoaded }) !== null;

  return (
    // on a phone the run page and its results are scrolled as a page, with the bars above them (styles.css `.app--run`)
    <div className={route.page === "run" && (route.view === "overview" || route.view === "results") ? "app app--run" : "app"}>
      <TopBar
        where={route}
        runId={runId}
        runs={runs}
        runStatus={runStatus}
        scenario={scenario}
        blocked={blocked}
        opening={opening}
        guide={guide}
        onPickRun={(id) => {
          window.location.hash = pickedRunHash(id, route.page === "run" ? route.view : "overview");
        }}
      />
      <Guide guide={guide} site={site} />
      {/* the strip's place is held from the first paint: it is there before the run is open, and the page below does not jump down when it fills */}
      {route.page === "run" && loadError === null && (runId ? <RunStrip /> : opening && <div className="runstrip" aria-hidden />)}
      <main className="content" id="main" tabIndex={-1}>
        {route.page === "run" && route.view === "overview" && <RunPage />}
        {route.page === "run" && route.view === "plan" && <PlanPage />}
        {route.page === "run" && route.view === "panels" && <PanelsPage />}
        {route.page === "run" && route.view === "security" && <SecurityPage />}
        {route.page === "run" && route.view === "results" && <ResultsPage />}
        {route.page === "run" && route.view === "events" && <EventsPage />}
        {route.page === "arena" && <ArenaPage route={route.arena} />}
        {route.page === "intake" && <IntakePage route={route.intake} />}
        {route.page === "ablation" && <AblationPage route={route.ablation} />}
        {route.page === "helps" && <HelpsPage />}
        {route.page === "charts" && <ChartsPage />}
        {route.page === "runs" && <RunsPage />}
      </main>
    </div>
  );
}
