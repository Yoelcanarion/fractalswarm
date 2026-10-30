import { useMotionValueEvent, type MotionValue } from "motion/react";
import { useRef } from "react";

import { useIsoLayoutEffect } from "../hooks";

/** A number that follows a motion value, written straight into the text node: a counter that runs
 * while the page scrolls costs no React render. */
export function Readout({ value, format, className = "" }: { value: MotionValue<number>; format: (n: number) => string; className?: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const write = useRef(format);
  write.current = format;
  const paint = (v: number) => {
    if (element.current) element.current.textContent = write.current(v);
  };
  useIsoLayoutEffect(() => paint(value.get()), [value]);
  useMotionValueEvent(value, "change", paint);
  return (
    <span ref={element} className={className}>
      {format(value.get())}
    </span>
  );
}
