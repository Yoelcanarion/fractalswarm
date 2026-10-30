import { RotateCcw } from "lucide-react";

import { COPY } from "../copy";
import { useStill } from "../hooks";

/** Plays an animation again from its start. Where everything stands still there is nothing to play, so there is no button. */
export function Repeat({ onClick }: { onClick: () => void }) {
  const still = useStill();
  if (still) return null;
  return (
    <button type="button" className="home-repeat" onClick={onClick}>
      <RotateCcw size={15} aria-hidden />
      <span>{COPY.repeat}</span>
    </button>
  );
}
