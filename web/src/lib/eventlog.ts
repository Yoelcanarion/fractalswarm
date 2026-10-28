// The event list: how one event reads on a line, which group it belongs to, and the filters.
// This is the floor of the supporting panels (spec §0.2): every event of every family shows
// up here, whether or not a panel knows its fields.

import { asRecord, asString, asStrings, compact, digest } from "./generic";
import type { RunEvent } from "./types";

const NET_FAULTS = new Set(["drop", "delay", "duplicate", "reorder", "partition_drop"]);
const first = (...values: unknown[]): unknown => values.find((v) => v !== undefined && v !== null);
const usd = (value: unknown, digits = 4): string => `$${Number(value ?? 0).toFixed(digits)}`;
const work = (p: Record<string, unknown>): string =>
  p.contract_id !== undefined ? `${asString(p.goal_id)}/${asString(p.contract_id)}` : asString(p.goal_id);

/** What happened, on one line. Types the list does not know show a digest of their payload. */
export function summarize(event: RunEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "run.started":
      return `${asString(p.scenario).split(":").at(-1)} seed ${asString(p.seed)} (${asString(p.clock)})`;
    case "run.halted":
      return `${asString(p.by)}: ${asString(p.reason)}`;
    case "actor.spawned":
      return `${p.actor_id} (${p.kind})${p.parent ? ` under ${p.parent}` : ""}`;
    case "actor.stopped":
      return `${p.actor_id}${p.reason ? `: ${p.reason}` : ""}`;
    case "msg.sent":
      return `→ ${p.to} [${p.topic}]`;
    case "effect.started":
      return `${p.kind} ${p.tag ?? ""}`.trim();
    case "effect.completed": {
      const result = asRecord(p.result);
      const model = result.model ? ` ${result.model}` : "";
      return `${p.kind}${model} ${p.status}${result.cost_usd ? ` ${usd(result.cost_usd, 5)}` : ""}`;
    }
    case "effect.cancelled":
      return `${p.kind} ${p.tag ?? ""}`.trim();
    case "budget.reserved":
      return `${usd(p.usd, 5)} for ${p.effect_id}`;
    case "budget.settled":
      return `${usd(p.actual_usd, 5)} of ${usd(p.reserved_usd, 5)}`;
    case "budget.refused":
      return `${usd(p.usd, 5)} over the ${p.level} cap (${p.key})`;
    case "budget.cap_set":
    case "budget.shock":
      return `${p.level} ${p.key} → ${usd(p.usd, 2)}${p.reason ? ` (${p.reason})` : ""}`;
    case "chaos.injected": {
      const fault = asString(first(p.fault, p.kind));
      const detail = asRecord(p.detail);
      if (NET_FAULTS.has(fault)) return `${fault} ${asString(detail.from)} → ${asString(detail.to)}`;
      const targets = asStrings(first(p.target, p.targets)).join(", ");
      return `${fault}${targets ? ` ${targets}` : ""}`;
    }
    case "member.joined":
      return `${p.member} (incarnation ${p.incarnation ?? 0})`;
    case "member.suspected":
      return `${p.member} · ${p.missed ?? "?"} missed, by ${p.by ?? "?"}`;
    case "member.dead":
      return `${p.member}${p.by ? ` declared by ${p.by}` : ""}`;
    case "write.fenced":
      return `${p.type} by ${p.actor}: ${p.reason}`;
    case "tree.adopted":
      return `${p.dead ?? p.from}'s group → ${p.adopter ?? p.to ?? p.new_parent}`;
    case "ownership.assigned":
      return `${p.key} → ${p.owner}`;
    case "ownership.remapped":
      return `${p.key} ${asString(first(p.previous, p.from))} → ${asString(first(p.owner, p.to))}`;
    case "plan.proposed":
    case "plan.approved":
    case "plan.refined":
      return `${p.goal_id}${p.by ? ` by ${p.by}` : ""}${p.fallback ? " (fallback)" : ""}`;
    case "plan.rejected":
      return `${p.goal_id} attempt ${p.attempt}: ${asStrings(p.errors)[0] ?? ""}`;
    case "contract.created":
      return asString(p.work);
    case "contract.dispatched":
      return `${work(p)} #${p.attempt} → ${p.assignee}`;
    case "contract.completed":
      return `${work(p)} #${p.attempt} ${p.status} (${p.steps} steps)`;
    case "contract.verified":
      return `${work(p)} #${p.attempt}`;
    case "contract.rejected":
      return `${work(p)} #${p.attempt} at ${p.stage}: ${asStrings(p.reasons)[0] ?? ""}`;
    case "contract.failed":
      return `${work(p)} #${p.attempt}: ${asStrings(p.reasons)[0] ?? ""}`;
    case "verify.judged":
      return `${work(p)} ${p.verdict} (${Number(p.score ?? 0).toFixed(2)})`;
    case "goal.completed":
      return `${p.goal_id} ${p.status}${asStrings(p.gaps).length ? ` · ${asStrings(p.gaps).length} gaps` : ""}`;
    case "task.result": {
      const report = asRecord(p.report);
      return `${p.task} ${p.status}${report.placed !== undefined ? ` · ${report.placed}/${report.expected} placed` : ""}`;
    }
    case "fact.published":
      return `${p.key} v${p.version} (${p.squad})`;
    case "fact.promoted":
      return `${p.key} by ${p.by}`;
    case "artifact.written":
      return `${p.path} v${p.version} (${compact(Number(p.size ?? 0))} B)`;
    case "lease.booked":
      return `${p.holder} leased ${asStrings(p.keys).length} keys for ${p.goal_id}`;
    case "schedule.placed":
      return `${p.talk_id} → day ${p.day} ${p.room} ${p.slot}`;
    case "collision.detected":
      return `${asString(first(p.goal_id, p.collision_id))} by ${asString(p.holder)} · ${
        Array.isArray(p.conflicts) ? p.conflicts.length : 0
      } conflicts`;
    case "collision.resolved":
      return `${asString(first(p.goal_id, p.collision_id))} ${asString(first(p.resolution, p.arbiter))}`;
    case "breaker.opened":
      return `${p.breaker} open (trip ${p.trips}): ${p.reason}`;
    case "breaker.half_open":
    case "breaker.closed":
      return asString(p.breaker);
    case "security.scanned":
      return `${p.surface} ${p.source_id}: ${p.decision} (${Number(p.score ?? 0).toFixed(2)})`;
    case "security.quarantined":
      return `${p.surface} ${p.source_id}: ${p.reason}`;
    case "scope.violation":
      return `${p.subgoal_id}: ${asStrings(p.codes).join(", ")}`;
    case "tool.denied":
      return `${p.tool}: ${p.reason}`;
    case "run.completed":
      return `${p.events} events, ${usd(p.spent_usd)}`;
    default:
      return digest(p);
  }
}

export type Tone = "bad" | "good" | "warn" | "";

const BAD = new Set([
  "chaos.injected",
  "member.dead",
  "collision.detected",
  "contract.failed",
  "contract.rejected",
  "plan.rejected",
  "run.halted",
  "budget.refused",
  "breaker.opened",
  "write.fenced",
  "scope.violation",
  "tool.denied",
  "security.quarantined",
]);
const GOOD = new Set([
  "tree.adopted",
  "ownership.remapped",
  "collision.resolved",
  "contract.verified",
  "breaker.closed",
]);
const WARN = new Set(["member.suspected", "budget.shock", "breaker.half_open"]);

export function tone(type: string): Tone {
  if (BAD.has(type)) return "bad";
  if (GOOD.has(type)) return "good";
  if (WARN.has(type)) return "warn";
  return "";
}

/** The chip an event belongs to in the list. The three high-volume streams (heartbeats, network
 * frames, timers) and the network faults get their own groups so they can be hidden. */
export function eventGroup(event: RunEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "msg.sent": {
      const topic = asString(p.topic);
      if (topic === "member.heartbeat" || topic === "heartbeat") return "heartbeat";
      return topic.startsWith("net.") ? "net" : "msg";
    }
    case "effect.started":
    case "effect.completed":
    case "effect.cancelled":
      return asString(p.kind, "effect");
    case "chaos.injected":
      return NET_FAULTS.has(asString(first(p.fault, p.kind))) ? "net-fault" : "chaos";
    default:
      return event.type.split(".")[0];
  }
}

export const NOISE_GROUPS: ReadonlySet<string> = new Set(["heartbeat", "net", "timer", "net-fault"]);

export interface EventFilter {
  text: string;
  /** Groups to hide. */
  hidden: ReadonlySet<string>;
}

const haystacks = new WeakMap<RunEvent, string>();

function haystack(event: RunEvent): string {
  let text = haystacks.get(event);
  if (text === undefined) {
    text = `${event.seq} ${event.type} ${event.actor} ${JSON.stringify(event.payload)}`.toLowerCase();
    haystacks.set(event, text);
  }
  return text;
}

/** Every space-separated term must appear in the event's type, actor or payload. */
export function matches(event: RunEvent, filter: EventFilter): boolean {
  if (filter.hidden.has(eventGroup(event))) return false;
  const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(event);
  return terms.every((term) => text.includes(term));
}

/** The newest ``limit`` events at or before ``cursor`` that pass the filter, newest first. */
export function recent(events: RunEvent[], cursor: number, filter: EventFilter, limit: number): RunEvent[] {
  const shown: RunEvent[] = [];
  for (let i = Math.min(cursor, events.length) - 1; i >= 0 && shown.length < limit; i--) {
    if (matches(events[i], filter)) shown.push(events[i]);
  }
  return shown;
}
