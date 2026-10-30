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

// The command is typed in the first part of the run, then the lines it printed appear one by one.
const TYPING = 0.4;

/** A terminal that types `command` and then prints `lines`, once, when it comes into view. The markup holds the finished
 * text; in the browser it is wound back to the start before the first paint. */
export function Terminal({ command, lines, label }: { command: string; lines: readonly string[]; label: string }) {
  const still = useStill();
  const root = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLSpanElement>(null);
  const progress = useEnterProgress(root, still, { duration: 3.4, rootMargin: "0px 0px -25% 0px" });

  const paint = (p: number) => {
    if (typed.current) typed.current.textContent = command.slice(0, Math.round(command.length * clamp01(p / TYPING)));
    const printed = clamp01((p - TYPING) / (1 - TYPING));
    root.current?.querySelectorAll<HTMLElement>("[data-line]").forEach((line, i) => {
      line.style.visibility = printed * lines.length >= i + 1 - 1e-9 ? "visible" : "hidden";
    });
  };
  useIsoLayoutEffect(() => {
    if (!still) paint(progress.get());
  }, [still, command, lines.length]);
  useMotionValueEvent(progress, "change", (p) => {
    if (!still) paint(p);
  });

  return (
    <div ref={root} className="home-terminal" role="group" aria-label={label}>
      <pre className="home-terminal__body">
        <code>
          <span className="home-terminal__prompt" aria-hidden>
            {"$ "}
          </span>
          <span ref={typed}>{command}</span>
          {"\n"}
          {lines.map((line, i) => (
            <span key={i} data-line className={`home-terminal__line home-terminal__line--${lineTone(line)}`}>
              {line}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
