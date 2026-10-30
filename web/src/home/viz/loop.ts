// The hero's clock: the recorded run, a short rest on the settled tree, the tree folding back into its root, and the same
// tree growing again from the root, round and round. Pure: the seconds since the start in, the picture's two axes out.
// What moves them is `useLoop`; what draws them is the tree.

export interface LoopSpec {
  /** Seconds the tree takes to grow from its root, with the run at its start. */
  enter: number;
  /** Seconds the recorded run plays, at constant speed. */
  run: number;
  /** Seconds the settled tree rests after the run. */
  rest: number;
  /** Seconds the tree takes to fold back into its root. */
  leave: number;
}

export type LoopPhase = "enter" | "run" | "rest" | "leave";

export interface LoopState {
  phase: LoopPhase;
  /** The progress of the recorded run (0..1). */
  p: number;
  /** How much of the tree is drawn (0..1): the second axis of the tree's frame. */
  appear: number;
  /** How many times the loop has come round. */
  round: number;
}

export const loopLength = (spec: LoopSpec): number => spec.enter + spec.run + spec.rest + spec.leave;

export function loopAt(seconds: number, spec: LoopSpec): LoopState {
  const length = loopLength(spec);
  const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const round = Math.floor(t / length);
  let s = t - round * length;
  // The growth and the fold are linear in time: the rows already ease one after the other, and a curve on top would crowd them into its first or last moments.
  if (s < spec.enter) return { phase: "enter", p: 0, appear: s / spec.enter, round };
  s -= spec.enter;
  if (s < spec.run) return { phase: "run", p: s / spec.run, appear: 1, round };
  s -= spec.run;
  if (s < spec.rest) return { phase: "rest", p: 1, appear: 1, round };
  s -= spec.rest;
  return { phase: "leave", p: 1, appear: Math.max(0, 1 - s / spec.leave), round };
}
