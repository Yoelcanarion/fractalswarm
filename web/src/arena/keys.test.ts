import { describe, expect, it } from "vitest";

import { keyAction, STEP_MS } from "./keys";

describe("the arena's keys", () => {
  it("play and pause with space", () => {
    expect(keyAction(" ", false, 5000, 60_000)).toEqual({ toggle: true });
  });

  it("step a second with an arrow and five with shift", () => {
    expect(keyAction("ArrowRight", false, 5000, 60_000)).toEqual({ seek: 5000 + STEP_MS });
    expect(keyAction("ArrowLeft", false, 5000, 60_000)).toEqual({ seek: 5000 - STEP_MS });
    expect(keyAction("ArrowRight", true, 5000, 60_000)).toEqual({ seek: 5000 + 5 * STEP_MS });
    expect(keyAction("ArrowLeft", true, 12_000, 60_000)).toEqual({ seek: 12_000 - 5 * STEP_MS });
  });

  it("stay inside the run", () => {
    expect(keyAction("ArrowLeft", true, 2000, 60_000)).toEqual({ seek: 0 });
    expect(keyAction("ArrowRight", true, 58_000, 60_000)).toEqual({ seek: 60_000 });
  });

  it("go to the start with Home and to the end with End", () => {
    expect(keyAction("Home", false, 31_000, 60_000)).toEqual({ seek: 0 });
    expect(keyAction("End", false, 31_000, 60_000)).toEqual({ seek: 60_000 });
  });

  it("leave every other key alone", () => {
    for (const key of ["a", "Enter", "Tab", "ArrowUp", "ArrowDown", "PageDown", "Escape"]) expect(keyAction(key, false, 5000, 60_000)).toBeNull();
  });
});
