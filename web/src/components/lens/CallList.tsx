import { useEffect, useMemo, useRef, useState } from "react";

import { describeCall, formatUsd, phaseAt, type Badge, type CallRow } from "../../lib/lens";
import { ModelBadge } from "../ui";

type Filter = "all" | Badge | "cancelled";

const BADGE_NAMES: Record<Badge, string> = { wonder: "Wonder", spark: "Spark", contributor: "Contributor", other: "Other" };

/** How a call stands at the playhead, in a word. */
function stateOf(call: CallRow, playhead: number): { label: string; tone: "run" | "ok" | "bad" | "warn" } {
  if (phaseAt(call, playhead) === "inflight") return { label: "running", tone: "run" };
  switch (call.status) {
    case "ok":
      return { label: "done", tone: "ok" };
    case "cancelled":
      return { label: "cancelled", tone: "bad" };
    case "error":
      return { label: "error", tone: "bad" };
    case "incomplete":
      return { label: "cut short", tone: "warn" };
    default:
      return { label: "no end", tone: "warn" };
  }
}

export interface CallListProps {
  /** The calls to list, already limited to those that had started by the playhead. */
  calls: CallRow[];
  selected: string | null;
  playhead: number;
  /** Name the actor on each row: for a list that spans actors. */
  showActor?: boolean;
  /** Offer filters by model and by cancelled: for a long list. */
  filterable?: boolean;
  onSelect(effectId: string): void;
}

/** The calls of a run or of one actor, in the order they started. */
export function CallList({ calls, selected, playhead, showActor = false, filterable = false, onSelect }: CallListProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => {
    const byBadge = new Map<Badge, number>();
    for (const call of calls) byBadge.set(call.badge, (byBadge.get(call.badge) ?? 0) + 1);
    return { byBadge, cancelled: calls.filter((c) => c.status === "cancelled").length };
  }, [calls]);
  const shown = useMemo(
    () => calls.filter((c) => filter === "all" || (filter === "cancelled" ? c.status === "cancelled" : c.badge === filter)),
    [calls, filter],
  );

  // Keep the open call in view when it changes, whether it was clicked or opened from a node.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="calls">
      {filterable && calls.length > 0 && (
        <div className="calls__filters" role="group" aria-label="Filter the calls">
          <button type="button" className={filter === "all" ? "chip chip--on" : "chip"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All <span className="mono">{calls.length}</span>
          </button>
          {[...counts.byBadge.entries()].map(([badge, n]) => (
            <button key={badge} type="button" className={filter === badge ? "chip chip--on" : "chip"} aria-pressed={filter === badge} onClick={() => setFilter(badge)}>
              {BADGE_NAMES[badge]} <span className="mono">{n}</span>
            </button>
          ))}
          {counts.cancelled > 0 && (
            <button type="button" className={filter === "cancelled" ? "chip chip--on" : "chip"} aria-pressed={filter === "cancelled"} onClick={() => setFilter("cancelled")}>
              Cancelled <span className="mono">{counts.cancelled}</span>
            </button>
          )}
        </div>
      )}
      <ul className="calls__list" ref={list} aria-label="LLM calls">
        {shown.map((call) => {
          const { title, where } = describeCall(call);
          const state = stateOf(call, playhead);
          const done = phaseAt(call, playhead) === "done";
          return (
            <li key={call.effect_id}>
              <button
                type="button"
                className="crow"
                aria-current={call.effect_id === selected ? "true" : undefined}
                data-tone={state.tone}
                onClick={() => onSelect(call.effect_id)}
              >
                <ModelBadge model={call.model ?? "unknown"} />
                <span className="crow__what">
                  <span className="crow__title">{title}</span>
                  <span className="crow__where mono">
                    {showActor && `${call.actor} · `}
                    {where}
                  </span>
                </span>
                <span className="crow__state">{state.label}</span>
                <span className="crow__cost mono">{done ? formatUsd(call.cost_usd) : "…"}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="calls__none">No calls match.</li>}
      </ul>
    </div>
  );
}
