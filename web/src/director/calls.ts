// The calls of the Muse lens a scene refers to by name: "the first Spark extraction", "Wonder's root plan".

import type { CallRow } from "../lib/lens";
import type { CallPick } from "./script";

/** The call a scene means: of the calls that match every field it gives, the nth (from 0), in the order they started. */
export function pickCall(calls: readonly CallRow[], pick: CallPick): CallRow | null {
  const matching = calls.filter(
    (call) =>
      (pick.model === null || (call.model ?? "").toLowerCase().includes(pick.model.toLowerCase())) &&
      (pick.actor === null || call.actor === pick.actor) &&
      (pick.role === null || call.role === pick.role) &&
      (pick.purpose === null || call.purpose === pick.purpose) &&
      (pick.tag === null || (call.tag ?? "").startsWith(pick.tag)),
  );
  return matching[pick.nth] ?? null;
}

/** When each named call started and ended, for the moments a scene gives as `call:<name>`; calls the run does not have are left out. */
export function callTimes(calls: readonly CallRow[], picks: Readonly<Record<string, CallPick>>): Map<string, { start: number; end: number | null }> {
  const times = new Map<string, { start: number; end: number | null }>();
  for (const [name, pick] of Object.entries(picks)) {
    const call = pickCall(calls, pick);
    if (call) times.set(name, { start: call.started_ts, end: call.ended_ts });
  }
  return times;
}
