import { memo, useMemo, useState, type CSSProperties } from "react";

import { fadeLife, glowVars, RESOLVED_LIFE_MS } from "../lib/decay";
import { SERIES, colorOf } from "../lib/layout";
import type { ViewState } from "../lib/reducer";
import { cellCollision, cellKey, openCollisions, rulingsEnd, type Cell, type Collision } from "../lib/schedule";
import { useRunStore } from "../store";
import { ClockScope } from "./ClockScope";

function squadColor(view: ViewState, squad: string, squads: string[]): string {
  if (view.actors[squad]) return colorOf(view, squad);
  return SERIES[squads.indexOf(squad) % SERIES.length];
}

export function ViolationsBadge({ view }: { view: ViewState }) {
  const { hardViolations } = view.schedule;
  const open = openCollisions(view.schedule);
  if (hardViolations === null) {
    return <span className="badge badge--muted">checker: pending</span>;
  }
  return (
    <span className={`badge ${hardViolations === 0 ? "badge--good" : "badge--bad"}`}>
      {hardViolations === 0 ? "✓ " : "⚠ "}
      {hardViolations} hard-constraint violation{hardViolations === 1 ? "" : "s"}
      {open > 0 ? ` · ${open} open collision${open === 1 ? "" : "s"}` : ""}
    </span>
  );
}

/** Whether a placement landed during playback, after the last jump of the view (a seek, a run
 * being opened). Only those animate; what was already there when the view jumped just shows. */
export const isFreshPlacement = (placedSeq: number, jumpedAtSeq: number): boolean => placedSeq > jumpedAtSeq;

/** The React key of a cell: a new talk in the same room and slot is a new element, which is what
 * plays the fill-in; re-rendering the same placement is not. */
export const placementKey = (slot: string, cell: Cell | undefined): string => (cell ? `${slot}@${cell.placedSeq}` : slot);

interface CellProps {
  cell: Cell | undefined;
  collision: Collision | undefined;
  color: string | undefined;
  fresh: boolean;
}

// A cell reads no clock: the ruling's mark fades in CSS from --now (see ClockScope), so a cell
// re-renders only when its own placement or collision changes, not on every event of the run.
export const GridCell = memo(function GridCell({ cell, collision, color, fresh }: CellProps) {
  const open = collision?.status === "open";
  const ruled = collision?.status === "resolved" && collision.resolvedTs !== undefined;
  const classes = [
    "cell",
    cell ? "cell--filled" : "",
    cell && fresh ? "cell--new" : "",
    open ? "cell--collision" : "",
    ruled ? "cell--ruled" : "",
  ].join(" ");
  const style = {
    ...(color ? { "--squad": color } : {}),
    ...(ruled ? glowVars(collision.resolvedTs!, fadeLife(RESOLVED_LIFE_MS)) : {}),
  } as CSSProperties;
  return (
    <td
      className={classes}
      style={style}
      title={cell ? `${cell.talkId} · ${cell.squad}${cell.speaker ? ` · ${cell.speaker}` : ""}` : ""}
    >
      {cell && <span className="cell__talk">{cell.title ?? cell.talkId}</span>}
      {open && <span className="cell__tag cell__tag--bad">collision</span>}
      {ruled && (
        <span className="cell__tag cell__tag--ruling">
          ⚖ {collision.arbiter}
          {collision.rule ? ` · ${collision.rule}` : ""}
        </span>
      )}
    </td>
  );
});

export function ScheduleGrid({ view }: { view: ViewState }) {
  const { schedule } = view;
  const epoch = useRunStore((s) => s.epoch);
  // Remember where the view last jumped. Setting state while rendering is React's way to derive
  // state from a change in props: it re-renders at once, before anything is drawn.
  const [jump, setJump] = useState({ epoch, seq: view.lastSeq });
  if (jump.epoch !== epoch) setJump({ epoch, seq: view.lastSeq });

  const squads = useMemo(() => [...new Set(Object.values(schedule.cells).map((c) => c.squad))].sort(), [schedule.cells]);
  // Only a ruling mark fades here, and rarely: the clock writes --now into the grid only while one does.
  const liveUntil = useMemo(() => rulingsEnd(schedule, fadeLife(RESOLVED_LIFE_MS)), [schedule]);
  if (schedule.rooms.length === 0 || schedule.slots.length === 0) {
    return (
      <div className="empty">
        No schedule in this run yet. The T2 grid fills in as sessions place talks (
        <code>schedule.placed</code>).
      </div>
    );
  }
  const days = schedule.days.length ? schedule.days : ["1"];
  return (
    <ClockScope liveUntil={liveUntil}>
      <div className="grid">
        {days.map((day) => (
          <div key={day} className="grid__day">
            <div className="grid__day-title">Day {day}</div>
            <table className="grid__table">
              <thead>
                <tr>
                  <th />
                  {schedule.slots.map((slot) => (
                    <th key={slot}>{slot}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.rooms.map((room) => (
                  <tr key={room}>
                    <th>{room}</th>
                    {schedule.slots.map((slot) => {
                      const key = cellKey(day, room, slot);
                      const cell = schedule.cells[key];
                      return (
                        <GridCell
                          key={placementKey(slot, cell)}
                          cell={cell}
                          collision={cellCollision(schedule, key)}
                          color={cell ? squadColor(view, cell.squad, squads) : undefined}
                          fresh={cell ? isFreshPlacement(cell.placedSeq, jump.seq) : false}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {squads.length > 0 && (
          <div className="legend">
            {squads.map((squad) => (
              <span key={squad} className="legend__item">
                <i style={{ background: squadColor(view, squad, squads) }} />
                {squad}
              </span>
            ))}
          </div>
        )}
      </div>
    </ClockScope>
  );
}
