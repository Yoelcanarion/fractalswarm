import { describe, expect, it } from "vitest";

import { crashesText } from "./labels";
import { crashModel, MODELS } from "./models";
import { regimeRows } from "./regime";
import { parsedSample } from "./testing";

describe("the failure models", () => {
  it("name the two models of bench/PREREG.md §6", () => {
    expect(MODELS.crash.name).toBe("Per crash");
    expect(MODELS.process.name).toBe("Per process");
  });

  it("say the crash plans the way the map counts them", () => {
    expect(["C1", "C2", "C3"].map(crashesText)).toEqual(["1 crash", "3 crashes", "5 crashes"]);
    expect(MODELS.crash.says).toContain("1, 3 and 5 crashes");
  });

  it("tell a row's crashes when its settings share one plan, and otherwise only the model", () => {
    expect(crashModel(["C3", "C3", "C3"])).toBe("Per crash · 5 crashes (C3)");
    expect(crashModel(["C1"])).toBe("Per crash · 1 crash (C1)");
    expect(crashModel(["C1", "C2", "C3"])).toBe("Per crash");
    expect(crashModel([])).toBe("Per crash");
    expect(crashModel(["X9"])).toBe("Per crash");
  });

  it("are named by every row of the map: the gate runs 1, 3 and 5 crashes, each sweep runs at 5", () => {
    const rows = regimeRows(parsedSample(), "durable-max");
    expect(rows.every((r) => r.model.startsWith("Per crash"))).toBe(true);
    expect(rows.filter((r) => r.title.startsWith("Gate")).map((r) => r.model)).toEqual(["Per crash", "Per crash"]);
    expect(rows.filter((r) => !r.title.startsWith("Gate")).map((r) => r.model)).toEqual(Array(5).fill("Per crash · 5 crashes (C3)"));
  });
});
