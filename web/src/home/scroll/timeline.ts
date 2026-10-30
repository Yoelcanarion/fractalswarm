// The scroll maths of a pinned stage, pure so that it can be tested without a DOM.
//
// A stage is a tall section, `height` viewport heights (vh) high, whose visual stays pinned while a
// column of step blocks scrolls past it. A step's card sits in the middle of its block. The reading
// line is the line of the viewport on which a card counts as current: the middle on a wide screen.
// Everything below is in vh, measured from the top of the section:
//
//   - the visual is pinned while the page scrolls `height - 1` vh, so a scroll progress p (0 to 1)
//     puts the reading line at `anchor + p * (height - 1)`;
//   - each step has a keyframe `at`: the progress of the visual while the step's card is on the
//     reading line. The visual holds still around it for `hold` of the block, so the text can be read;
//   - between two keyframes the visual moves linearly with the scroll, so the wheel always moves it
//     by the amount it moves the page.

export interface StepSpec {
  id: string;
  /** Height of the step's block, in vh. Default 1. */
  weight?: number;
  /** The visual's progress (0 to 1) while this step's card is on the reading line. */
  at: number;
  /** The share (0 to 1) of the block, around its centre, in which the visual holds still. Default 0.4. */
  hold?: number;
}

export interface Block {
  id: string;
  /** Top, centre and bottom of the block, in vh from the top of the section. */
  start: number;
  centre: number;
  end: number;
  weight: number;
  at: number;
  hold: number;
}

export interface TimelineOptions {
  /** Where on the viewport (0 top, 1 bottom) the reading line sits. Default 0.5. */
  anchor?: number;
  /** Distance, in vh, from the reading line within which a card is fully opaque. Default 0.16. */
  fullAt?: number;
  /** Distance, in vh, from the reading line at which a card has faded out. Default 0.46. */
  goneAt?: number;
}

export interface Timeline {
  blocks: readonly Block[];
  /** The section's height in vh. */
  height: number;
  anchor: number;
  /** The reading line, in vh from the top of the section, at scroll progress `progress` (0 to 1). */
  readingLine(progress: number): number;
  /** Index of the block under the reading line. */
  stepAt(progress: number): number;
  /** The visual's progress (0 to 1) at scroll progress `progress`. */
  visualAt(progress: number): number;
  /** Where the reading line is among the steps: 0 on the first card, 1 on the second, 2.5 half-way between
   * the third and the fourth. For fading a layer in and out between steps. */
  positionAt(progress: number): number;
  /** Opacity (0 to 1) of block `index`'s card at scroll progress `progress`. */
  cardOpacity(progress: number, index: number): number;
  /** The scroll progress at which block `index`'s card is on the reading line (clamped to 0..1). */
  progressAtStep(index: number): number;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Linear interpolation through `points` (sorted by x), held flat before the first and after the last. */
export function interpolate(points: readonly (readonly [x: number, y: number])[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

export function buildTimeline(steps: readonly StepSpec[], options: TimelineOptions = {}): Timeline {
  if (steps.length === 0) throw new Error("a stage needs at least one step");
  const anchor = options.anchor ?? 0.5;
  const fullAt = options.fullAt ?? 0.16;
  const goneAt = options.goneAt ?? 0.46;

  let cursor = 0;
  const blocks: Block[] = steps.map((step) => {
    const weight = step.weight ?? 1;
    if (!(weight > 0)) throw new Error(`step ${step.id}: weight must be positive`);
    const hold = clamp01(step.hold ?? 0.4);
    const block: Block = { id: step.id, start: cursor, centre: cursor + weight / 2, end: cursor + weight, weight, at: clamp01(step.at), hold };
    cursor += weight;
    return block;
  });
  const height = cursor;
  const pinned = Math.max(height - 1, 0);

  // Each keyframe is a flat stretch of the visual's progress around the card's centre.
  const keyframes: [number, number][] = blocks.flatMap((b): [number, number][] => [
    [b.centre - (b.hold * b.weight) / 2, b.at],
    [b.centre + (b.hold * b.weight) / 2, b.at],
  ]);

  const centres: [number, number][] = blocks.map((b, i) => [b.centre, i]);

  const readingLine = (progress: number): number => anchor + clamp01(progress) * pinned;

  const stepAtLine = (y: number): number => {
    for (let i = 0; i < blocks.length; i++) if (y < blocks[i].end) return i;
    return blocks.length - 1;
  };

  return {
    blocks,
    height,
    anchor,
    readingLine,
    stepAt: (progress) => stepAtLine(readingLine(progress)),
    visualAt: (progress) => interpolate(keyframes, readingLine(progress)),
    positionAt: (progress) => interpolate(centres, readingLine(progress)),
    cardOpacity: (progress, index) => {
      const distance = Math.abs(readingLine(progress) - blocks[index].centre);
      return 1 - smoothstep((distance - fullAt) / (goneAt - fullAt));
    },
    progressAtStep: (index) => (pinned === 0 ? 0 : clamp01((blocks[index].centre - anchor) / pinned)),
  };
}
