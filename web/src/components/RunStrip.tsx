import { MuseMeter } from "./lens/MuseMeter";
import { TakeoverChip } from "./TakeoverChip";
import { VerifyBadge } from "./VerifyBadge";

/** The evidence under the top bar of a run: what the models cost (the Muse meter, at the
 * playhead) on the left, and the two proofs on the right: the run replays from its log, and every
 * heir that took over can be recomputed from it. */
export function RunStrip() {
  return (
    <div className="runstrip">
      <MuseMeter />
      <div className="runstrip__proof">
        <TakeoverChip />
        <VerifyBadge />
      </div>
    </div>
  );
}
