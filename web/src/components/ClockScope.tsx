import { useRef, type ReactNode } from "react";

import { useClockFrame } from "../lib/clockHooks";
import { needsNow } from "../lib/decay";

/** Carries ``--now``, the virtual time in ms, for everything inside it. The clock writes it
 * straight to the DOM every frame, and the fades in styles.css read it (see lib/decay.ts), so a
 * playing replay re-renders nothing between events. A scope that fades only now and then passes
 * ``liveUntil``, when its last fade ends, and writes only while something fades (``needsNow``);
 * without it the scope writes every frame. It makes no box of its own. */
export function ClockScope({ children, liveUntil = Infinity }: { children: ReactNode; liveUntil?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);
  useClockFrame((t) => {
    if (!root.current || !needsNow(t, liveUntil, last.current)) return;
    last.current = t;
    root.current.style.setProperty("--now", String(Math.round(t)));
  });
  return (
    <div ref={root} className="clock-scope">
      {children}
    </div>
  );
}
