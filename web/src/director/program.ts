// The program of a scene: its steps, run one after another on the take's clock. Every step starts something and the
// program goes straight on to the next, except `wait`, which holds it for some milliseconds of the take or until the
// replay reaches a moment. The program knows nothing of the page: it asks its host (take.ts) to do each thing.

import type { Step } from "./script";
import { formatTime, type TimeExpr } from "./time";

export interface Host {
  /** The take's clock, in ms. */
  now(): number;
  playhead(): number;
  playing(): boolean;
  /** The run time of a moment, or null when the run does not have it. */
  resolve(time: TimeExpr): number | null;
  /** Do one step that does not wait. */
  run(step: Exclude<Step, { do: "wait" }>): void;
  warn(message: string): void;
}

export interface Program {
  /** Run every step that is due at this frame, up to the next `wait` that holds. Call once per frame, after the host's clock moved. */
  frame(): void;
  /** Every step has run and no wait is holding. */
  finished(): boolean;
  /** The index of the step that is running or holding. */
  position(): number;
}

type Hold = { kind: "time"; until: number } | { kind: "replay"; target: number; deadline: number | null };

export function createProgram(steps: readonly Step[], host: Host): Program {
  let index = 0;
  let hold: Hold | null = null;

  /** Whether the wait that began at this step is still holding. */
  const holding = (h: Hold): boolean => {
    if (h.kind === "time") return host.now() < h.until;
    if (h.deadline !== null && host.now() >= h.deadline) {
      host.warn(`step ${index}: the replay did not reach the moment in time, so the program went on`);
      return false;
    }
    // A replay that stopped (the end of the run, or a step that paused it) is not going to get there.
    return host.playhead() < h.target && host.playing();
  };

  const begin = (step: Extract<Step, { do: "wait" }>): Hold | null => {
    if (step.ms !== null) return step.ms > 0 ? { kind: "time", until: host.now() + step.ms } : null;
    const until = step.until as TimeExpr;
    const target = host.resolve(until);
    if (target === null) {
      host.warn(`step ${index}: the run has no "${formatTime(until)}", so the wait was skipped`);
      return null;
    }
    if (host.playhead() >= target) return null;
    if (!host.playing()) {
      host.warn(`step ${index}: waiting for "${formatTime(until)}" with the replay paused, so the wait was skipped`);
      return null;
    }
    return { kind: "replay", target, deadline: step.timeoutMs === null ? null : host.now() + step.timeoutMs };
  };

  return {
    frame() {
      while (true) {
        if (hold !== null) {
          if (holding(hold)) return;
          hold = null;
          index += 1;
        }
        if (index >= steps.length) return;
        const step = steps[index];
        if (step.do === "wait") {
          hold = begin(step);
          if (hold !== null) return;
          index += 1;
        } else {
          host.run(step);
          index += 1;
        }
      }
    },
    finished: () => hold === null && index >= steps.length,
    position: () => index,
  };
}
