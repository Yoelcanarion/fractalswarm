import { useMemo, useState } from "react";

import type { RunEvent } from "../lib/types";

const SHOWN = 60;

export function summarize(event: RunEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "actor.spawned":
      return `${p.actor_id} (${p.kind})${p.parent ? ` under ${p.parent}` : ""}`;
    case "actor.stopped":
      return `${p.actor_id}${p.reason ? `: ${p.reason}` : ""}`;
    case "msg.sent":
      return `→ ${p.to} [${p.topic}]`;
    case "effect.started":
      return `${p.kind} ${p.tag ?? ""}`.trim();
    case "effect.completed":
      return `${p.kind} ${p.status}${p.result?.cost_usd ? ` $${Number(p.result.cost_usd).toFixed(5)}` : ""}`;
    case "budget.settled":
      return `$${Number(p.actual_usd).toFixed(5)} of $${Number(p.reserved_usd).toFixed(5)}`;
    case "chaos.injected":
      return `${p.kind} ${p.target ?? (p.targets ?? []).join(", ")}`;
    case "member.dead":
    case "member.suspected":
      return String(p.member);
    case "tree.adopted":
      return `${p.dead ?? p.from}'s group → ${p.adopter ?? p.to ?? p.new_parent}`;
    case "schedule.placed":
      return `${p.talk_id} → day ${p.day} ${p.room} ${p.slot}`;
    case "collision.resolved":
      return `${p.collision_id} by ${p.arbiter}`;
    case "run.completed":
      return `${p.events} events, $${Number(p.spent_usd).toFixed(4)}`;
    default:
      return "";
  }
}

const tone = (type: string): string => {
  if (type === "chaos.injected" || type === "member.dead" || type === "collision.detected") return "feed__row--bad";
  if (type === "tree.adopted" || type === "ownership.remapped" || type === "collision.resolved") return "feed__row--good";
  return "";
};

export function EventFeed({ events, cursor }: { events: RunEvent[]; cursor: number }) {
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const shown: RunEvent[] = [];
    for (let i = cursor - 1; i >= 0 && shown.length < SHOWN; i--) {
      const event = events[i];
      if (!filter || event.type.includes(filter) || event.actor.includes(filter)) shown.push(event);
    }
    return shown;
  }, [events, cursor, filter]);
  return (
    <section className="panel feed">
      <header className="panel__title">
        Event log
        <input className="feed__filter" placeholder="filter type or actor" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      <ol className="feed__list">
        {rows.map((event) => (
          <li key={event.seq} className={`feed__row ${tone(event.type)}`}>
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
