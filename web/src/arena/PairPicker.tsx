import { Details } from "../components/ui";
import type { RunListing } from "../lib/types";
import type { PairListing } from "./api";
import { rivalLabel } from "./helps/labels";
import { arenaHash } from "./route";

export interface PairPickerProps {
  left: string | null;
  right: string | null;
  /** The pairs on record; null while they load. */
  pairs: PairListing[] | null;
  /** Every run the server lists, for a pair that was not made through the API. */
  runs: RunListing[];
}

const go = (left: string, right: string): void => {
  window.location.hash = arenaHash(left, right);
};

/** What a pair is called in the list: its label, and the marks that keep it from being taken for another (three of the pairs differ in nothing else).
 * One a person started here goes by what they chose and when, for the server's label would name two of them alike. */
export function pairName(pair: PairListing): string {
  const billed = pair.billed ? " · billed" : "";
  if (!pair.private) return `${pair.label}${billed}`;
  const at = pair.createdAt?.slice(11, 16);
  return `${["Your pair", rivalLabel(pair.rival), pair.chaos.replace(/-/g, " "), at && `${at} UTC`].filter(Boolean).join(" · ")}${billed}`;
}

/** Chooses the two runs the arena shows: a pair on record, or any swarm run and any rival run. */
export function PairPicker({ left, right, pairs, runs }: PairPickerProps) {
  const current = pairs?.find((p) => p.left === left && p.right === right);
  // The pairs that ship come first; the private ones (live input typed on this machine) sit apart under a divider, and keep their mark in the name,
  // because a closed select shows only the name of the pair that is chosen.
  const shipped = (pairs ?? []).filter((pair) => !pair.private);
  const privatePairs = (pairs ?? []).filter((pair) => pair.private);
  const none = pairs === null ? "Loading pairs…" : pairs.length === 0 ? "No pairs on record" : "Choose a pair…";
  return (
    <div className="picker">
      <label className="picker__field">
        <span className="picker__label">Pair</span>
        <span className="picker__control">
          <select
            value={current?.pairId ?? ""}
            onChange={(e) => {
              const pair = pairs?.find((p) => p.pairId === e.target.value);
              if (pair) go(pair.left, pair.right);
            }}
            aria-label="pair on record"
          >
            <option value="">{none}</option>
            {shipped.map((pair) => (
              <option key={pair.pairId} value={pair.pairId}>
                {pairName(pair)}
              </option>
            ))}
            {privatePairs.length > 0 && (
              <optgroup label="Private, made here">
                {privatePairs.map((pair) => (
                  <option key={pair.pairId} value={pair.pairId}>
                    {pairName(pair)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {/* a closed select cuts its text at its own width; on a phone this shows all of the name, wrapped, and the select lies over it unseen to take the tap */}
          <span className="picker__shown" aria-hidden>
            {current ? pairName(current) : none}
          </span>
        </span>
      </label>
      <Details menu id="runs" summary="Choose the two runs yourself">
        <label className="picker__field">
          <span className="picker__label">Swarm</span>
          <select value={left ?? ""} onChange={(e) => go(e.target.value, right ?? "")} aria-label="swarm run">
            <option value="">Choose a run…</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id}
              </option>
            ))}
          </select>
        </label>
        <label className="picker__field">
          <span className="picker__label">Rival</span>
          <select value={right ?? ""} onChange={(e) => go(left ?? "", e.target.value)} aria-label="rival run">
            <option value="">Choose a run…</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id}
              </option>
            ))}
          </select>
        </label>
      </Details>
    </div>
  );
}
