import { describe, expect, it } from "vitest";

import { APP_NAME, titleOf } from "./title";

describe("titleOf", () => {
  it("puts the most specific part first and the app last", () => {
    expect(titleOf("Plan", "Run demo-backup")).toBe("Plan · Run demo-backup · FractalSwarm");
    expect(titleOf("Charts")).toBe("Charts · FractalSwarm");
  });

  it("leaves out what is missing, and is the app's name alone when nothing is left", () => {
    expect(titleOf(null, undefined, "", "Runs")).toBe("Runs · FractalSwarm");
    expect(titleOf()).toBe(APP_NAME);
  });
});
