import { describe, expect, it } from "vitest";

import { processView, readingText } from "./process";
import { parsedSample } from "./testing";

const lineOf = (rival: string, key: string) => {
  const view = processView(parsedSample(), rival);
  const line = view?.lines.find((l) => l.key === key);
  if (!line) throw new Error(`no ${key} against ${rival}`);
  return line;
};

describe("the per-process view", () => {
  it("reads the swarm's ten coordinators against the supervisor's one, for the task the file has it for", () => {
    const view = processView(parsedSample(), "durable-max");
    expect(view?.task).toBe("t2_conference");
    expect(view?.coordinators).toEqual([1, 3, 6]);
    expect(view?.lines.map((l) => l.key)).toEqual(["cdt_s", "idle_agent_s", "ttr_own_mean_s", "blast_agents_mean_pct"]);
  });

  it("shows the numbers of the file against the ideal durable supervisor, with their units", () => {
    expect(lineOf("durable-max", "cdt_s")).toMatchObject({ swarm: "7.71 s", rival: "8.55 s", ratio: "0.902×", reading: "comparable", tone: "muted" });
    expect(lineOf("durable-max", "idle_agent_s")).toMatchObject({ swarm: "15.4 agent·s", rival: "17.1 agent·s", ratio: "0.902×", reading: "comparable" });
    expect(lineOf("durable-max", "blast_agents_mean_pct")).toMatchObject({ swarm: "50%", rival: "50%", ratio: "1×", reading: "comparable" });
  });

  it("does not hide the one it loses: time to recover is the supervisor's, and drawn as a loss", () => {
    expect(lineOf("durable-max", "ttr_own_mean_s")).toMatchObject({ swarm: "47.3 s", rival: "5 s", ratio: "9.45×", reading: "rival lower", tone: "danger" });
    expect(lineOf("durable", "ttr_own_mean_s")).toMatchObject({ reading: "rival lower", tone: "danger" });
  });

  it("reads each line against the rival at hand, and says so when a ratio has no number", () => {
    expect(lineOf("central", "cdt_s")).toMatchObject({ rival: "30 s", ratio: "0.257×", reading: "swarm lower", tone: "ok" });
    expect(lineOf("central", "blast_agents_mean_pct")).toMatchObject({ rival: "100%", ratio: "0.5×", reading: "swarm lower", tone: "ok" });
    // a central coordinator that never idles its agents has nothing to divide by
    expect(lineOf("central", "idle_agent_s")).toMatchObject({ rival: "0 agent·s", ratio: "—", reading: "rival lower", tone: "danger" });
  });

  it("is nothing for a rival the file has no per-process numbers for", () => {
    expect(processView(parsedSample(), "nobody")).toBeNull();
    expect(processView({ ...parsedSample(), perProcess: [] }, "durable-max")).toBeNull();
  });

  it("takes a line the file gives no reading for as 'no reading', never as a win", () => {
    const h = parsedSample();
    const view = processView({ ...h, perProcess: [{ ...h.perProcess[0], reading: {} }] }, "durable-max");
    expect(view?.lines.every((l) => l.reading === "n/a" && l.tone === "muted")).toBe(true);
  });

  it("counts the coordinators by level, whatever order the file lists the levels in", () => {
    const h = parsedSample();
    const view = processView({ ...h, perProcess: [{ ...h.perProcess[0], levels: [...h.perProcess[0].levels].reverse() }] }, "durable-max");
    expect(view?.coordinators).toEqual([1, 3, 6]);
  });
});

describe("a reading in words", () => {
  it("names the rival that is lower, and nothing else", () => {
    expect(readingText("swarm lower", "Supervisor")).toBe("Swarm lower");
    expect(readingText("rival lower", "Supervisor")).toBe("Supervisor lower");
    expect(readingText("comparable", "Supervisor")).toBe("Comparable");
    expect(readingText("n/a", "Supervisor")).toBe("No reading");
  });
});
