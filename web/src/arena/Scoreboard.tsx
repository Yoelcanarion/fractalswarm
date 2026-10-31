import { useMemo } from "react";
import { useStore } from "zustand";

import { arenaCounters } from "../lib/arena";
import { Stat, Tooltip } from "../components/ui";
import type { RunStoreApi } from "../store";
import type { Official } from "./official";
import { playedOut } from "./playedOut";
import { scoreRows, type ScoreCell, type ScoreRow, type SideNumbers } from "./rows";

/** One side's numbers at the playhead, from its own run store. */
function useSideNumbers(store: RunStoreApi, official: Official | null): SideNumbers {
  const view = useStore(store, (s) => s.view);
  const playhead = useStore(store, (s) => s.playhead);
  const end = useStore(store, (s) => s.events.at(-1)?.ts_virtual ?? 0);
  const finished = useStore(store, playedOut);
  return useMemo(() => {
    // The playhead goes on while the other run plays; a run that has ended does not grow.
    const nowMs = Math.min(playhead, end);
    return { counters: arenaCounters(view, nowMs), windows: view.arena.windows, nowMs, finished, official };
  }, [view, playhead, end, finished, official]);
}

interface MetricProps {
  row: ScoreRow;
  /** Count up to a number that changed: only when nothing is playing, so a live readout is not chased. */
  animate: boolean;
}

function Side({ cell, row, who, animate }: { cell: ScoreCell; row: ScoreRow; who: string; animate: boolean }) {
  return (
    <Stat
      label={cell.source === "official" ? `${who} ✓` : who}
      value={cell.value ?? "—"}
      decimals={row.decimals}
      prefix={row.prefix || undefined}
      unit={row.unit || undefined}
      animate={animate}
      durationMs={500}
    />
  );
}

function Metric({ row, animate }: MetricProps) {
  return (
    <div className="metric" data-row={row.id}>
      <div className="metric__head">
        <Tooltip label={row.definition}>
          <span className="metric__label">{row.label}</span>
        </Tooltip>
      </div>
      <div className="metric__faces">
        <Side cell={row.left} row={row} who="Swarm" animate={animate} />
        <Side cell={row.right} row={row} who="Rival" animate={animate} />
      </div>
      {/* Drawn to scale against the larger of the two, with no colour of a winner: one pair is one seed. */}
      <div className="metric__bars" aria-hidden>
        <span className="metric__half metric__half--left">
          <i style={{ transform: `scaleX(${row.leftShare})` }} />
        </span>
        <span className="metric__half metric__half--right">
          <i style={{ transform: `scaleX(${row.rightShare})` }} />
        </span>
      </div>
      {/* Where the scored number is more than the spend, the two parts of it, read from the run: the run page shows the spend alone. */}
      {(row.notes.left !== null || row.notes.right !== null) && (
        <div className="metric__notes">
          {row.notes.left !== null && <p className="metric__note">Swarm: {row.notes.left}</p>}
          {row.notes.right !== null && <p className="metric__note">Rival: {row.notes.right}</p>}
        </div>
      )}
    </div>
  );
}

export interface ScoreboardProps {
  left: RunStoreApi;
  right: RunStoreApi;
  official: { left: Official | null; right: Official | null };
  playing: boolean;
  /** The clock steps by hand (a director's take): numbers are shown as they are, never counted up. */
  fixedStep: boolean;
  /** The caveat that one pair is one run on one seed, with its links. Left out where the end of the pair, which says it in full, is on the page. */
  caveat?: boolean;
}

/** The face-to-face counters. They run on the fold of each log while it plays, and a run that has
 * played out ends on the numbers the metrics scored (marked ✓). */
export function Scoreboard({ left, right, official, playing, fixedStep, caveat = true }: ScoreboardProps) {
  const l = useSideNumbers(left, official.left);
  const r = useSideNumbers(right, official.right);
  const rows = useMemo(() => scoreRows(l, r), [l, r]);
  const animate = !playing && !fixedStep;
  const settled = rows.every((row) => row.left.source === "official" && row.right.source === "official");
  return (
    <section className="score" aria-label="Face to face">
      <div className="score__grid">
        {rows.map((row) => (
          <Metric key={row.id} row={row} animate={animate} />
        ))}
      </div>
      <p className="score__note">
        {settled
          ? "✓ Scored by the metrics from each run's log."
          : "Counted from each log up to the playhead; ✓ marks a number the metrics have scored, which the count ends on."}
        {caveat && (
          <>
            {" "}
            One pair is one run on one seed under one failure plan, so it shows what happened here and nothing more: <a href="#/helps">Trade-offs</a> holds the multi-seed verdicts, and <a href="#/evidence">the Evidence page</a> the numbers.
          </>
        )}
      </p>
    </section>
  );
}
