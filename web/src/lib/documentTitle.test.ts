import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTitle } from "./documentTitle";

afterEach(() => vi.unstubAllGlobals());

describe("the tab's title", () => {
  it("is the page's while the app is open, and the home page's own again once it is left", () => {
    const page = { title: "FractalSwarm · Kill half the brains. It still finishes." };
    vi.stubGlobal("document", page);
    const leave = applyTitle("Runs · FractalSwarm");
    expect(page.title).toBe("Runs · FractalSwarm");
    leave();
    expect(page.title).toBe("FractalSwarm · Kill half the brains. It still finishes.");
  });

  it("goes from one page's title to the next and back to the original, not to a page in between", () => {
    const page = { title: "home" };
    vi.stubGlobal("document", page);
    // React runs the old effect's cleanup before the new effect, whenever the title changes
    let leave = applyTitle("Runs · FractalSwarm");
    leave();
    leave = applyTitle("Plan · demo · FractalSwarm");
    expect(page.title).toBe("Plan · demo · FractalSwarm");
    leave();
    expect(page.title).toBe("home");
  });
});
