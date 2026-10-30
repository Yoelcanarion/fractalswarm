import { useInView } from "motion/react";
import { useRef, type CSSProperties, type ReactNode } from "react";

import { useStill } from "../hooks";

/** Fades and lifts its children in, once, when they come into view. Children of a list stagger by
 * `delay` (40 to 60 ms apart at most). With reduced motion it is simply there. */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "p" | "section" | "figure" | "span";
}) {
  const ref = useRef<HTMLElement>(null);
  const still = useStill();
  const seen = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  return (
    <Tag
      ref={ref as never}
      className={`home-reveal ${className}`.trim()}
      data-in={still || seen ? "" : undefined}
      style={{ "--d": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
