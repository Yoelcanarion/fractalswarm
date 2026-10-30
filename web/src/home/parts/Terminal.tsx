import { useMotionValueEvent } from "motion/react";
import { useRef } from "react";

import { useEnterProgress, useIsoLayoutEffect, useStill } from "../hooks";
import { clamp01 } from "../scroll/timeline";

export type LineTone = "ok" | "bad" | "plain";

/** Green for a line that says the check passed, red for one that says it did not. */
export function lineTone(line: string): LineTone {
  if (/^(MISMATCH|PROBLEM|AUDIT FAILED)/.test(line)) return "bad";
  if (/^(MATCH|TAKEOVER OK|AUDIT OK)/.test(line)) return "ok";
  return "plain";
}

export interface TerminalStep {
  command: string;
  /** What the real run printed for it. */
  lines: readonly string[];
}

// A printed line takes as long to appear as this many typed characters.
const LINE_COST = 16;

/** How far each step has got at progress `p`: the characters of its command typed, and the lines of its output printed. */
export function terminalState(steps: readonly TerminalStep[], p: number): { typed: number; printed: number; started: boolean }[] {
  const total = steps.reduce((sum, step) => sum + step.command.length + LINE_COST * step.lines.length, 0);
  let units = clamp01(p) * total;
  return steps.map((step) => {
    const typed = Math.min(step.command.length, Math.max(0, Math.round(units)));
    const started = units > 0 || p >= 1;
    units -= step.command.length;
    const printed = Math.min(step.lines.length, Math.max(0, Math.floor((units + 1e-9) / LINE_COST)));
    units -= LINE_COST * step.lines.length;
    return { typed, printed, started };
  });
}

/** A terminal that types each command and prints the lines it gave, once, when it comes into view. The markup holds the
 * finished text; in the browser it is wound back to the start before the first paint. */
export function Terminal({ steps, label }: { steps: readonly TerminalStep[]; label: string }) {
  const still = useStill();
  const root = useRef<HTMLDivElement>(null);
  const progress = useEnterProgress(root, still, { duration: 3.4, rootMargin: "0px 0px -25% 0px" });

  const paint = (p: number) => {
    const element = root.current;
    if (!element) return;
    const state = terminalState(steps, p);
    element.querySelectorAll<HTMLElement>("[data-step]").forEach((stepElement, i) => {
      const at = state[i];
      if (!at) return;
      stepElement.style.visibility = at.started ? "visible" : "hidden";
      const typed = stepElement.querySelector<HTMLElement>("[data-typed]");
      if (typed) typed.textContent = steps[i].command.slice(0, at.typed);
      stepElement.querySelectorAll<HTMLElement>("[data-line]").forEach((line, j) => {
        line.style.visibility = j < at.printed ? "visible" : "hidden";
      });
    });
  };
  useIsoLayoutEffect(() => {
    if (!still) paint(progress.get());
  }, [still, steps]);
  useMotionValueEvent(progress, "change", (p) => {
    if (!still) paint(p);
  });

  return (
    <div ref={root} className="home-terminal" role="group" aria-label={label}>
      <pre className="home-terminal__body">
        <code>
          {steps.map((step, i) => (
            <span key={i} data-step>
              <span className="home-terminal__prompt" aria-hidden>
                {"$ "}
              </span>
              <span data-typed>{step.command}</span>
              {"\n"}
              {step.lines.map((line, j) => (
                <span key={j} data-line className={`home-terminal__line home-terminal__line--${lineTone(line)}`}>
                  {line}
                  {"\n"}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
