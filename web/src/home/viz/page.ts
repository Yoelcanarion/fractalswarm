// What the redesigned visuals ask of the page they sit in. Both answers have a fallback for where there is no page (the lab, the
// tests): the system's motion preference, and the data they are handed.

import { prefersReducedMotion } from "../../lib/motion";
import { useStill } from "../hooks";

/**
 * True when a visual shows its end state at once and runs nothing by itself: the `still` it was given, else the page's own answer
 * (`?still`, or the system's reduced motion as the page read it), or a person who has asked the system for less motion.
 */
export function useCalm(still?: boolean): boolean {
  const page = useStill();
  return (still ?? page) || prefersReducedMotion();
}
