// The plan of a pinned stage, pure so that it can be tested without a DOM.
//
// A stage is a tall section: its visual stays pinned while a column of step blocks scrolls past it. The scroll
// chooses the beat and a clock plays it:
//
//   - the step whose block is under the reading line is the current one (`stepAtLine`, with a margin so that one
//     wheel notch at a boundary cannot flip it back and forth);
//   - each step has a target for the visual's progress (`at`) and may have targets for other channels (`to`); when
//     the current step changes, the visual plays from where it is to the new targets in the step's own time
//     (`play`), on the stage's clock (scroll/clock.ts), and nothing the reader does with the wheel moves it
//     frame by frame;
//   - each step also says how visible each layer of the visual is while it is current (`layers`). The page
//     fades them on the same step change, with a CSS transition.
//
// The height of a block is not computed here: it is whatever the card needs, with `weight` (in screens) as its floor.
// The stage measures the blocks it has and gives them to `stepAtLine` in pixels.

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The name of the main channel: the progress that the visual is drawn from. */
export const MAIN = "progress";

/** The smallest block, in screens: a card of three or four lines with air round it, and the one before and after it in view. */
export const DEFAULT_WEIGHT = 0.5;

export interface StepSpec {
  id: string;
  /** The least height of the step's block, in screens (viewport heights). Default 0.5. */
  weight?: number;
  /** The visual's progress (0 to 1) while this step is current. */
  at: number;
  /** Seconds the visual takes to come here from the step before. Default: from the distance, 0.8 to 1.4. */
  play?: number;
  /** Targets of the other channels while this step is current. A channel the step does not name keeps its last
   * target (0 before any step names it). */
  to?: Readonly<Record<string, number>>;
  /** How visible (0 to 1) each named layer is while this step is current. A layer the step does not name keeps its last
   * value (1 before any step names it). */
  layers?: Readonly<Record<string, number>>;
}

export interface PlannedStep {
  id: string;
  weight: number;
  at: number;
  play: number;
  /** The target of every channel, the main one included, while this step is current. */
  targets: Readonly<Record<string, number>>;
  /** The visibility of every layer while this step is current. */
  layers: Readonly<Record<string, number>>;
}

export interface Plan {
  steps: readonly PlannedStep[];
  /** The channels besides the main one. */
  channels: readonly string[];
  layerNames: readonly string[];
  /** Where `channel` (`MAIN` or one of `channels`) is headed while step `step` is current. */
  target(step: number, channel: string): number;
  /** How visible layer `name` is while step `step` is current. */
  layer(step: number, name: string): number;
  /** Seconds the visual takes to go from step `from` to step `to`: the plays of the steps in between, shortened a
   * little for a jump over several so that nothing lags behind a fast wheel. */
  duration(from: number, to: number): number;
}

/** The slowest and the quickest a move between steps may be: a jump over several steps is held between them. */
export const MIN_SECONDS = 0.6;
export const MAX_SECONDS = 3.6;
/** A jump over several steps plays this much faster than the steps would one by one. */
const JUMP_SPEED_UP = 1 / 0.55;

/** How long a step takes to arrive when it does not say: more for a longer way, between 0.8 and 1.4 seconds. */
export const defaultPlay = (distance: number): number => Math.min(1.4, Math.max(0.8, 0.8 + 2.4 * Math.abs(distance)));

export function buildPlan(specs: readonly StepSpec[]): Plan {
  if (specs.length === 0) throw new Error("a stage needs at least one step");
  const seen = new Set<string>();
  const channels = [...new Set(specs.flatMap((s) => Object.keys(s.to ?? {})))];
  const layerNames = [...new Set(specs.flatMap((s) => Object.keys(s.layers ?? {})))];
  if (channels.includes(MAIN)) throw new Error(`"${MAIN}" is the main channel: a step names it with \`at\``);

  let before: PlannedStep | null = null;
  const steps: PlannedStep[] = specs.map((spec) => {
    if (seen.has(spec.id)) throw new Error(`step ${spec.id}: the id is used twice`);
    seen.add(spec.id);
    const weight = spec.weight ?? DEFAULT_WEIGHT;
    if (!(weight > 0)) throw new Error(`step ${spec.id}: weight must be positive`);
    if (!Number.isFinite(spec.at)) throw new Error(`step ${spec.id}: at must be a number`);
    const at = clamp01(spec.at);
    if (spec.play !== undefined && !(spec.play > 0)) throw new Error(`step ${spec.id}: play must be positive`);
    const play = spec.play ?? defaultPlay(at - (before?.at ?? at));

    const targets: Record<string, number> = { [MAIN]: at };
    for (const name of channels) targets[name] = clamp01(spec.to?.[name] ?? before?.targets[name] ?? 0);
    const layers: Record<string, number> = {};
    for (const name of layerNames) layers[name] = clamp01(spec.layers?.[name] ?? before?.layers[name] ?? 1);

    before = { id: spec.id, weight, at, play, targets, layers };
    return before;
  });

  const clampStep = (i: number): number => Math.min(steps.length - 1, Math.max(0, i));

  return {
    steps,
    channels,
    layerNames,
    target: (step, channel) => steps[clampStep(step)].targets[channel] ?? 0,
    layer: (step, name) => steps[clampStep(step)].layers[name] ?? 1,
    duration(from, to) {
      if (from === to) return 0;
      const first = Math.min(from, to) + 1;
      const last = Math.max(from, to);
      let total = 0;
      for (let i = first; i <= last; i++) total += steps[clampStep(i)].play;
      const jumped = last - first + 1 > 1;
      return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, jumped ? total / JUMP_SPEED_UP : total));
    },
  };
}

/** The top and bottom of a step's block, in pixels from the top of the stage. */
export interface Block {
  start: number;
  end: number;
}

/**
 * The step whose block holds the reading line `line` (pixels from the top of the stage), given the step that is
 * current now. The line has to pass a boundary by `margin` pixels before the step changes, in either direction, so that
 * a wheel notch that lands on a boundary and the next one that takes it back do not make the beat flicker.
 */
export function stepAtLine(blocks: readonly Block[], line: number, current: number, margin: number): number {
  if (blocks.length === 0) return 0;
  let step = Math.min(blocks.length - 1, Math.max(0, current));
  while (step < blocks.length - 1 && line > blocks[step].end + margin) step++;
  while (step > 0 && line < blocks[step].start - margin) step--;
  return step;
}
