import { SERIES, colorOf } from "../lib/layout";
import type { ViewState } from "../lib/reducer";
import { cellCollision, cellKey, openCollisions } from "../lib/schedule";

// How long (in events) a resolved collision keeps showing its arbiter on the cell.
const RESOLVED_GLOW = 80;

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

export function ScheduleGrid({ view }: { view: ViewState }) {
  const { schedule } = view;
  if (schedule.rooms.length === 0 || schedule.slots.length === 0) {
    return (
      <div className="empty">
        No schedule in this run yet. The T2 grid fills in as sessions place talks (
        <code>schedule.placed</code>).
      </div>
    );
  }
  const squads = [...new Set(Object.values(schedule.cells).map((c) => c.squad))].sort();
  const days = schedule.days.length ? schedule.days : ["1"];
  return (
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
                    const collision = cellCollision(schedule, key);
                    const open = collision?.status === "open";
                    const showArbiter =
                      collision?.status === "resolved" && view.lastSeq - (collision.resolvedSeq ?? 0) < RESOLVED_GLOW;
                    const color = cell ? squadColor(view, cell.squad, squads) : undefined;
                    return (
                      <td
                        key={slot}
                        className={`cell ${cell ? "cell--filled" : ""} ${open ? "cell--collision" : ""} ${showArbiter ? "cell--resolved" : ""}`}
                        style={color ? { ["--squad" as string]: color } : undefined}
                        title={cell ? `${cell.talkId} · ${cell.squad}${cell.speaker ? ` · ${cell.speaker}` : ""}` : ""}
                      >
                        {cell && <span className="cell__talk">{cell.title ?? cell.talkId}</span>}
                        {open && <span className="cell__tag cell__tag--bad">collision</span>}
                        {showArbiter && (
                          <span className="cell__tag">
                            ⚖ {collision!.arbiter}
                            {collision!.rule ? ` · ${collision!.rule}` : ""}
                          </span>
                        )}
                      </td>
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
  );
}
