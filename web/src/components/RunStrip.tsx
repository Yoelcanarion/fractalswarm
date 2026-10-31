import { MuseMeter } from "./lens/MuseMeter";
import { TakeoverChip } from "./TakeoverChip";
import { VerifyBadge } from "./VerifyBadge";

/** The evidence under the top bar of a run: the two proofs on the right (the run replays from its log, and every heir that took over can
 * be recomputed from it), always in view, and on the left what the models cost (the Muse meter, at the playhead) as a fold. */
export function RunStrip({ unfold = false }: { unfold?: boolean }) {
  return (
    <div className="runstrip">
      <MuseMeter fold open={unfold} />
      <div className="runstrip__proof">
        <TakeoverChip />
        <VerifyBadge />
      </div>
    </div>
  );
}
