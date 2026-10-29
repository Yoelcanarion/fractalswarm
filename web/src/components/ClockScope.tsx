import { useRef, type ReactNode } from "react";

import { useClockFrame } from "../lib/clockHooks";

/** Carries ``--now``, the virtual time in ms, for everything inside it. The clock writes it
 * straight to the DOM every frame, and the fades in styles.css read it (see lib/decay.ts), so a
 * playing replay re-renders nothing between events. It makes no box of its own. */
export function ClockScope({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useClockFrame((t) => root.current?.style.setProperty("--now", String(Math.round(t))));
  return (
    <div ref={root} className="clock-scope">
      {children}
    </div>
  );
}
