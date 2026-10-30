import { afterEach, describe, expect, it, vi } from "vitest";

import { GUIDE_KEY, GUIDE_STEPS, guideSeen, rememberGuide } from "./guide";

afterEach(() => vi.unstubAllGlobals());

describe("the guide's steps", () => {
  it("are three, in the order a person meets them: choose a run, kill half the brains, verify the replay", () => {
    expect(GUIDE_STEPS.map((step) => step.id)).toEqual(["choose", "kill", "verify"]);
    expect(GUIDE_STEPS.map((step) => step.title)).toEqual(["Choose a run", "Kill half the brains", "Verify the replay"]);
  });

  it("say what a recorded run cannot do: it cannot be changed, so a run of one's own starts on New task", () => {
    const kill = GUIDE_STEPS.find((step) => step.id === "kill");
    expect(kill?.says).toContain("A recording cannot be changed");
    expect(kill?.action?.href).toBe("#/new");
    expect(GUIDE_STEPS.find((step) => step.id === "choose")?.action?.href).toBe("#/run");
  });

  it("are short: about forty words each at most", () => {
    for (const step of GUIDE_STEPS) expect(step.says.split(/\s+/).length).toBeLessThanOrEqual(40);
  });
});

describe("whether the guide was seen", () => {
  it("is read from the browser's storage, and remembered there", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
    expect(guideSeen()).toBe(false);
    rememberGuide();
    expect(store.get(GUIDE_KEY)).toBe("1");
    expect(guideSeen()).toBe(true);
  });

  it("is not seen, and breaks nothing, when storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(guideSeen()).toBe(false);
    expect(() => rememberGuide()).not.toThrow();
  });
});
