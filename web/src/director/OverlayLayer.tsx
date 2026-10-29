import { useStore } from "zustand";

import { captionOpacity } from "./overlay";
import type { Take } from "./take";

/** Room around a ring, so it frames its target and does not sit on its edge. */
const RING_GAP = 8;

/** What is drawn over the stage, in the frame's own pixels and under no camera: the rings of the highlights, the
 * captions, and the note that says the stage is a replay. Everything here is a function of the take's state, written
 * as a style (never a transition), so a frame is the same however the machine drew the one before. */
export function OverlayLayer({ take, note }: { take: Take; note: string | null }) {
  const { captions, rings, ms } = useStore(take.state);
  return (
    <div className="dir__overlay" aria-hidden>
      {rings.map(({ ring, rect, opacity }) => (
        <div
          key={ring.id}
          className="dir__ring"
          style={{ left: rect.x - RING_GAP, top: rect.y - RING_GAP, width: rect.w + 2 * RING_GAP, height: rect.h + 2 * RING_GAP, opacity }}
        />
      ))}
      {note !== null && <p className="dir__note">{note}</p>}
      {captions.map((caption) => {
        const opacity = captionOpacity(caption, ms);
        if (opacity <= 0) return null;
        const rise = `translateY(${((1 - opacity) * 14).toFixed(2)}px)`;
        return caption.style === "lower" ? (
          <div key={caption.id} className="dir__lower" style={{ opacity, transform: rise }}>
            {caption.kicker !== null && <span className="dir__kicker">{caption.kicker}</span>}
            <p className="dir__text">{caption.text}</p>
          </div>
        ) : (
          <div key={caption.id} className="dir__statement" style={{ opacity }}>
            {caption.kicker !== null && <span className="dir__kicker">{caption.kicker}</span>}
            <p className="dir__text">{caption.text}</p>
          </div>
        );
      })}
    </div>
  );
}
