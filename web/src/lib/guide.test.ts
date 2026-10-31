import { afterEach, describe, expect, it, vi } from "vitest";

import { afterGuideButton, GUIDE_KEY, GUIDE_STEPS, guideSeen, guideSteps, rememberGuide } from "./guide";

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
    for (const step of [...GUIDE_STEPS, ...guideSteps("static")]) expect(step.says.split(/\s+/).length, step.id).toBeLessThanOrEqual(40);
  });
});

describe("the guide's steps on the static showcase", () => {
  const server = guideSteps("server");
  const showcase = guideSteps("static");

  it("are the server's, but for the two sentences that are not true without a server: nothing is started, and the replay was checked at build", () => {
    expect(server).toBe(GUIDE_STEPS);
    expect(showcase.filter((step, index) => step.says !== server[index].says).map((step) => step.id)).toEqual(["kill", "verify"]);
    expect(server.find((step) => step.id === "verify")?.says).toContain("A recorded run checks itself when it opens.");
    const verify = showcase.find((step) => step.id === "verify")?.says ?? "";
    expect(verify).not.toContain("checks itself when it opens");
    expect(verify).toContain("when the site was built, not in your browser");
    const kill = showcase.find((step) => step.id === "kill")?.says ?? "";
    expect(kill).toContain("A recording cannot be changed");
    expect(kill).toContain("this site starts no run");
    expect(kill).not.toMatch(/, start a run\./);
  });

  it("keep the headings and the links, so that the short band does not change when the capabilities arrive", () => {
    expect(showcase.map(({ id, title, action }) => ({ id, title, action }))).toEqual(server.map(({ id, title, action }) => ({ id, title, action })));
  });

  it("make no claim of their own", () => {
    for (const step of showcase) expect(step.says).not.toMatch(/simpler|cheaper|more reliable|safer|faster/i);
  });
});

describe("the Guide button", () => {
  it("asks for what each step says when there is none, whether the guide is closed or short, and closes it when it shows", () => {
    expect(afterGuideButton("closed")).toBe("full");
    expect(afterGuideButton("short")).toBe("full");
    expect(afterGuideButton("full")).toBe("closed");
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
