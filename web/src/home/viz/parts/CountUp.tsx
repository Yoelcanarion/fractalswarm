import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Pen } from "../tree/paint";
import { useProgress, type VizProps } from "../shared";
import "../viz.css";
import { countSpec, countText, type CountData } from "./count";

/**
 * A number that counts up once, to the number it is. The width of the end number is kept from the first
 * frame (the digits are tabular and the end number is the widest), so nothing around it moves as it
 * counts, and a screen reader is given the end number and never the count.
 */
export function CountUp({ progress, data, still, stillAt, className }: VizProps<CountData>) {
  const count = useMemo(() => countSpec(data), [data]);
  const live = useRef<HTMLSpanElement>(null);
  const pen = useRef<Pen<HTMLSpanElement> | null>(null);
  const apply = useCallback((p: number) => pen.current?.text(countText(count, p)), [count]);
  useLayoutEffect(() => {
    pen.current = live.current ? new Pen(live.current) : null;
  }, []);
  useProgress(progress, apply, still, stillAt);

  const end = countText(count, 1);
  return (
    <span className={className ? `hv hv-count ${className}` : "hv hv-count"}>
      <span className="hv-count__end" aria-hidden>
        {end}
      </span>
      <span ref={live} className="hv-count__live" aria-hidden>
        {countText(count, still ? (stillAt ?? 1) : progress.get())}
      </span>
      <span className="hv-sr">{end}</span>
    </span>
  );
}
