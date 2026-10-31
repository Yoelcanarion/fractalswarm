// What each stage draws. The stages reuse the app's own pages, without the top bar and the pickers: the arena's two
// columns, the run page with its evidence strip, "where it helps", the ablation, and a title card.

import { useMemo } from "react";
import { useStore } from "zustand";

import { AblationFlow } from "../ablation/AblationPage";
import { createAblationApi } from "../ablation/api";
import { ArenaView } from "../arena/ArenaPage";
import { HelpsPage } from "../arena/helps/HelpsPage";
import { ClockScope } from "../components/ClockScope";
import { RunStrip } from "../components/RunStrip";
import { listRuns } from "../lib/api";
import { RunPage } from "../pages/RunPage";
import { RunStoreProvider } from "../store";
import type { Card } from "./script";
import type { ArenaStage, RunStage } from "./stages";

export function ArenaStageView({ stage }: { stage: ArenaStage }) {
  const scored = useStore(stage.scored);
  return (
    <RunStoreProvider store={stage.session.left}>
      <ClockScope>
        <main className="content">
          <ArenaView session={stage.session} pairs={null} runs={[]} official={scored} left={stage.left} right={stage.right} bare />
        </main>
      </ClockScope>
    </RunStoreProvider>
  );
}

/** `meterOpen`: the Muse meter is a fold of the strip ("What the models cost"), closed on the page; a scene that points at it opens it. */
export function RunStageView({ stage, meterOpen = false }: { stage: RunStage; meterOpen?: boolean }) {
  return (
    <RunStoreProvider store={stage.store}>
      <ClockScope>
        <RunStrip unfold={meterOpen} />
        <main className="content">
          <RunPage />
        </main>
      </ClockScope>
    </RunStoreProvider>
  );
}

export function HelpsStageView() {
  return (
    <main className="content">
      <HelpsPage />
    </main>
  );
}

export function AblationStageView({ runId }: { runId: string }) {
  const api = useMemo(() => createAblationApi(), []);
  return (
    <main className="content">
      <AblationFlow api={api} runId={runId} loadRuns={listRuns} />
    </main>
  );
}

export function TitleStageView({ card }: { card: Card }) {
  return (
    <main className="content dir__title">
      <div className="dir__card">
        <h1 className="dir__card-title">{card.title}</h1>
        {card.lines.map((line, i) => (
          <p key={i} className="dir__card-line">
            {line}
          </p>
        ))}
      </div>
    </main>
  );
}
