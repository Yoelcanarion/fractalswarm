import { useMemo, useState } from "react";

import { NOISE_GROUPS, recent, summarize, tone, type EventFilter } from "../lib/eventlog";
import type { RunEvent } from "../lib/types";
import { useRunStore } from "../store";
import { LensButton } from "./lens/LensButton";
import { Tooltip } from "./ui";

const PAGE = 300;

interface Props {
  events: RunEvent[];
  cursor: number;
  groups: Record<string, number>;
}

/** Every event of the run up to the playhead, filterable by group and text. This is the floor
 * of the supporting panels: whatever no panel reads yet is still here. */
export function EventList({ events, cursor, groups }: Props) {
  const [text, setText] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(NOISE_GROUPS));
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const seek = useRunStore((s) => s.seek);

  const filter: EventFilter = useMemo(() => ({ text, hidden }), [text, hidden]);
  const rows = useMemo(() => recent(events, cursor, filter, limit), [events, cursor, filter, limit]);
  // Readable groups first (biggest first), the high-volume streams after them.
  const names = Object.keys(groups).sort(
    (a, b) => Number(NOISE_GROUPS.has(a)) - Number(NOISE_GROUPS.has(b)) || groups[b] - groups[a] || a.localeCompare(b),
  );
  const toggle = (name: string) => {
    const next = new Set(hidden);
    if (!next.delete(name)) next.add(name);
    setHidden(next);
    setLimit(PAGE);
  };
  const noiseHidden = [...NOISE_GROUPS].every((name) => hidden.has(name));

  return (
    <section className="panel evlist">
      <header className="panel__title">
        Event log
        <span className="panel__hint">
          {cursor.toLocaleString("en")} events so far · newest first
        </span>
      </header>
      <div className="evlist__bar">
        <input
          className="evlist__search"
          placeholder="search type, actor or payload — every word must match"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="search events"
        />
        <Tooltip label="Heartbeats, network frames, timers and network faults: the events that fill the log without saying what the run did." placement="bottom">
          <button className="btn" onClick={() => setHidden(noiseHidden ? new Set() : new Set(NOISE_GROUPS))}>
            {noiseHidden ? "Show the noise" : "Hide the noise"}
          </button>
        </Tooltip>
      </div>
      <div className="evlist__chips" role="group" aria-label="event groups">
        {names.map((name) => (
          <button
            key={name}
            className={`chip ${hidden.has(name) ? "" : "chip--on"} ${NOISE_GROUPS.has(name) ? "chip--noise" : ""}`}
            onClick={() => toggle(name)}
            aria-pressed={!hidden.has(name)}
          >
            {name} <span className="mono">{groups[name].toLocaleString("en")}</span>
          </button>
        ))}
      </div>
      <ol className="evlist__rows">
        {rows.map((event) => (
          <li key={event.seq} className={`evrow ${tone(event.type) ? `evrow--${tone(event.type)}` : ""}`}>
            <div className="evrow__line" onClick={() => setOpen(open === event.seq ? null : event.seq)}>
              <button
                className="evrow__seq mono"
                onClick={(e) => {
                  e.stopPropagation();
                  seek(event.seq);
                }}
                title="Move the playhead to this event"
                aria-label={`Move the playhead to event ${event.seq}`}
              >
                {event.seq}
              </button>
              <span className="evrow__t mono">{(event.ts_virtual / 1000).toFixed(2)}s</span>
              <span className="evrow__type">
                <button
                  type="button"
                  className="evrow__toggle"
                  aria-expanded={open === event.seq}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(open === event.seq ? null : event.seq);
                  }}
                >
                  {event.type}
                </button>
                <LensButton effectId={event.payload?.effect_id} />
              </span>
              <span className="evrow__actor">{event.actor}</span>
              <span className="evrow__text">{summarize(event)}</span>
            </div>
            {open === event.seq && (
              <pre className="evrow__json mono">
                {JSON.stringify(
                  {
                    lamport: event.lamport,
                    member_epoch: event.member_epoch,
                    market_epoch: event.market_epoch,
                    idem_key: event.idem_key,
                    hash: event.hash,
                    payload: event.payload,
                  },
                  null,
                  2,
                )}
              </pre>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="nothing">No event matches. {noiseHidden ? "The noise groups are hidden." : ""}</li>}
      </ol>
      {rows.length >= limit && (
        <button className="btn evlist__more" onClick={() => setLimit(limit + PAGE)}>
          Show {PAGE} more
        </button>
      )}
    </section>
  );
}
