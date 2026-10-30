import { describe, expect, it } from "vitest";

import { detailsAskedFor, opensDetails, withDetails } from "./details";

describe("the folds an address asks for", () => {
  it("are the ids in its details parameter", () => {
    expect(detailsAskedFor("#/run/x?at=end&details=lens,feed")).toEqual(["lens", "feed"]);
    expect(detailsAskedFor("#/run/x?details= a , b ,")).toEqual(["a", "b"]);
    expect(detailsAskedFor("#/run/x")).toEqual([]);
    expect(detailsAskedFor("#/run/x?details=")).toEqual([]);
  });

  it("open the fold with that id, and no other", () => {
    expect(opensDetails("#/runs?details=all", "all")).toBe(true);
    expect(opensDetails("#/runs?details=all", "other")).toBe(false);
    expect(opensDetails("#/runs?details=all", undefined)).toBe(false);
  });

  it("can be added to an address, once, keeping the rest of it", () => {
    expect(withDetails("#/run/x?at=end", "chaos")).toBe("#/run/x?at=end&details=chaos");
    expect(withDetails("#/run/x?details=lens", "chaos")).toBe("#/run/x?details=lens,chaos");
    expect(withDetails("#/run/x?details=chaos", "chaos")).toBe("#/run/x?details=chaos");
    expect(withDetails("#/runs", "all")).toBe("#/runs?details=all");
  });
});
