// Who plays when. The Solution's three cards play once as they arrive, one after the other: a card that arrives while another is
// playing waits until it has finished, and one that arrives later (a phone scrolling past them) waits for nobody.

/** How long a card holds the turn: its drawing plays in about nine tenths of a second, and the next card starts a beat after. */
export const STEP_PLAY_MS = 1000;

export interface Turns {
  /**
   * How long, in ms, the card `id` that asks at `now` waits for its turn. A card that asks again is given the same moment, so that
   * a render that runs twice does not push it back.
   */
  take(id: string, now: number): number;
}

export function createTurns(lengthMs: number = STEP_PLAY_MS): Turns {
  const starts = new Map<string, number>();
  let free = 0;
  return {
    take(id, now) {
      const known = starts.get(id);
      if (known !== undefined) return Math.max(0, known - now);
      const start = Math.max(now, free);
      starts.set(id, start);
      free = start + lengthMs;
      return start - now;
    },
  };
}
