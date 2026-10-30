import { describe, expect, it } from "vitest";
import { story } from "../../data/story";
import { treePlayer } from "./frame";
import { MAX_DASHES } from "./paint";

describe("message dashes", () => {
  for (const pacing of ["hero", "story"] as const) {
    it(`${pacing}: never more at once than the SVG has dashes for`, () => {
      const player = treePlayer(story, pacing);
      let most = 0;
      for (let i = 0; i <= 6000; i++) most = Math.max(most, player.frame(i / 6000).dashes.length);
      expect(most).toBeGreaterThan(0);
      expect(most).toBeLessThanOrEqual(MAX_DASHES);
    });
  }
});
