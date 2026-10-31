// The turns of the Solution's cards: one after the other as they arrive, and nobody waits for a card that is not on screen.

import { describe, expect, it } from "vitest";
import { createTurns, STEP_PLAY_MS } from "./turns";

describe("the turns of the step cards", () => {
  it("play cards that arrive together one after the other, each when the one before it has finished", () => {
    const turns = createTurns(1000);
    expect(turns.take("log", 5000)).toBe(0);
    expect(turns.take("heir", 5000)).toBe(1000);
    expect(turns.take("adopt", 5000)).toBe(2000);
  });

  it("make a card that arrives once the others have finished wait for nobody, and one that arrives during a play wait for the rest of it", () => {
    const turns = createTurns(1000);
    expect(turns.take("log", 0)).toBe(0);
    expect(turns.take("heir", 4000)).toBe(0);
    expect(turns.take("adopt", 4300)).toBe(700);
  });

  it("give a card that asks again the same moment, so that a render that runs twice does not push it back", () => {
    const turns = createTurns(1000);
    turns.take("log", 0);
    expect(turns.take("heir", 0)).toBe(1000);
    expect(turns.take("heir", 0)).toBe(1000);
    expect(turns.take("heir", 400)).toBe(600);
    expect(turns.take("heir", 2500)).toBe(0);
    expect(turns.take("adopt", 0)).toBe(2000);
  });

  it("hold the turn a beat longer than the drawing takes to play: 0.6 s, and up to four steps of 0.06 s for the parts after the first", () => {
    expect(STEP_PLAY_MS).toBeGreaterThan(600 + 4 * 60);
    expect(STEP_PLAY_MS).toBeLessThanOrEqual(1500);
    const turns = createTurns();
    turns.take("log", 0);
    expect(turns.take("heir", 0)).toBe(STEP_PLAY_MS);
  });
});
