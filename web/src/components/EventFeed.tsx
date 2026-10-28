import { useMemo, useState } from "react";

import { NOISE_GROUPS, recent, summarize, tone } from "../lib/eventlog";
import type { RunEvent } from "../lib/types";

const SHOWN = 60;
const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

// The tail of the log: heartbeats, network frames and timers are hidden until a filter is typed.
// The Events tab holds the full, filterable list.
export function EventFeed({ events, cursor }: { events: RunEvent[]; cursor: number }) {
  const [filter, setFilter] = useState("");
  const rows = useMemo(
    () => recent(events, cursor, { text: filter, hidden: filter ? NOTHING_HIDDEN : NOISE_GROUPS }, SHOWN),
    [events, cursor, filter],
  );
  return (
    <section className="panel feed">
      <header className="panel__title">
        Event log
        <input className="feed__filter" placeholder="filter type, actor, payload" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      <ol className="feed__list">
        {rows.map((event) => (
          <li key={event.seq} className={`feed__row ${tone(event.type) ? `feed__row--${tone(event.type)}` : ""}`}>
            <span className="mono feed__seq">{event.seq}</span>
            <span className="feed__type">{event.type}</span>
            <span className="feed__actor">{event.actor}</span>
            <span className="feed__text">{summarize(event)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
