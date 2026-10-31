import { memo, useMemo, type CSSProperties } from "react";

import { TakeoverChip } from "../components/TakeoverChip";
import { VerifyBadge } from "../components/VerifyBadge";
import { ringVars } from "../lib/decay";
import { RunStoreProvider, useRunStore, type RunStoreApi } from "../store";
import { startedOf, type SystemKind } from "./assumptions";
import { ArenaBoard } from "./ArenaBoard";
import type { Box } from "./board";
import { playedOut } from "./playedOut";
import { RecoveryChip } from "./RecoveryChip";
import { sideStatus } from "./status";
import { talksTotal, workOf } from "./work";

function SideHead({ role, title }: { role: "swarm" | "rival"; title: string }) {
  const runId = useRunStore((s) => s.runId);
  return (
    <header className="side__head">
      <div className="side__top">
        <h2 className="side__name">
          <span className="side__swatch" aria-hidden />
          {title}
        </h2>
        <span className="side__run mono" title={runId ?? undefined}>
          {runId ?? ""}
        </span>
      </div>
      {/* The same row on both sides, so the two boards start at the same height. The chip is what the scenes point at. */}
      <div className="side__proof">
        <span className="side__chip">{role === "swarm" ? <TakeoverChip /> : <RecoveryChip />}</span>
        <span className="side__verify">
          <VerifyBadge />
        </span>
      </div>
    </header>
  );
}

/** The line under the header: who is down at the playhead, and what it is costing. */
function SideStatusLine({ system }: { system: SystemKind }) {
  const view = useRunStore((s) => s.view);
  const playhead = useRunStore((s) => s.playhead);
  const end = useRunStore((s) => s.events.at(-1)?.ts_virtual ?? 0);
  const finished = useRunStore(playedOut);
  const status = useMemo(() => sideStatus(system, view, view.arena.windows, Math.min(playhead, end), finished), [system, view, playhead, end, finished]);
  // The restart bar fills in CSS from the clock (--now), so it moves every frame without a render.
  const outage = status.restart === null ? undefined : Object.values(view.actors).find((a) => a.outage)?.outage;
  return (
    <div className={`status status--${status.tone}`} role="status">
      <span className="status__text">{status.text}</span>
      {outage && (
        <span className="status__bar" style={ringVars(outage) as CSSProperties} aria-hidden>
          <i />
        </span>
      )}
    </div>
  );
}

/** The work done so far: talks placed on the schedule. A stall is a bar that stops while the other goes on. */
function SideWork() {
  const view = useRunStore((s) => s.view);
  const events = useRunStore((s) => s.events);
  const total = useMemo(() => talksTotal(startedOf(events)), [events]);
  const work = workOf(view, total);
  return (
    <div className="work">
      <span className="work__label">Talks placed</span>
      <span className="work__bar" aria-hidden>
        <i style={{ transform: `scaleX(${work.share})` }} />
      </span>
      <span className="work__count mono">{work.total === null ? work.placed : `${work.placed} / ${work.total}`}</span>
    </div>
  );
}

export interface ArenaSideProps {
  store: RunStoreApi;
  role: "swarm" | "rival";
  title: string;
  system: SystemKind;
  frame: Box;
}

/** One side of the arena: its verdict badges, its status line, its board and its work meter. */
export const ArenaSide = memo(function ArenaSide({ store, role, title, system, frame }: ArenaSideProps) {
  return (
    <RunStoreProvider store={store}>
      <section className={`side side--${role}`} aria-label={title}>
        <SideHead role={role} title={title} />
        <SideStatusLine system={system} />
        <div className="side__board">
          <ArenaBoard frame={frame} label={`${title}: coordinators and agents`} rootLabel={role === "swarm" ? "root" : "supervisor"} />
        </div>
        <SideWork />
      </section>
    </RunStoreProvider>
  );
});
