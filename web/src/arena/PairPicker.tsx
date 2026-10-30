import { Details } from "../components/ui";
import type { RunListing } from "../lib/types";
import type { PairListing } from "./api";
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

/** Chooses the two runs the arena shows: a pair on record, or any swarm run and any rival run. */
export function PairPicker({ left, right, pairs, runs }: PairPickerProps) {
  const current = pairs?.find((p) => p.left === left && p.right === right);
  return (
    <div className="picker">
      <label className="picker__field">
        <span className="picker__label">Pair</span>
        <select
          value={current?.pairId ?? ""}
          onChange={(e) => {
            const pair = pairs?.find((p) => p.pairId === e.target.value);
            if (pair) go(pair.left, pair.right);
          }}
          aria-label="pair on record"
        >
          <option value="">{pairs === null ? "Loading pairs…" : pairs.length === 0 ? "No pairs on record" : "Choose a pair…"}</option>
          {(pairs ?? []).map((pair) => (
            <option key={pair.pairId} value={pair.pairId}>
              {pair.label}
              {pair.private ? " · private" : ""}
              {pair.billed ? " · billed" : ""}
            </option>
          ))}
        </select>
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
