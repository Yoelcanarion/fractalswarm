import { describe, expect, it } from "vitest";

import { Stream } from "../lib/testing";
import { assumptionsOf, rivalSentence, secondsText, startedOf, systemKind, type SystemKind } from "./assumptions";

const started = (scenario: string, params: Record<string, unknown> = {}) =>
  startedOf(new Stream().emit("run.started", "@kernel", { seed: "1", scenario, params, clock: "sim" }).events);

describe("the assumptions caption", () => {
  it("is the brief's line for the ideal durable supervisor at its defaults", () => {
    const rival = started("fractalswarm.actors.swarm:DURABLE_MAX");
    expect(assumptionsOf(rival, started("fractalswarm.actors.swarm:SWARM")).caption).toBe(
      "Rival: ideal durable supervisor — 5 s detection · 0 s restart · workers survive · same log",
    );
  });

  it("reads the detection and the restart from the run's params, so a sweep shows its own values", () => {
    const rival = started("fractalswarm.actors.swarm:DURABLE_MAX", { recovery_ms: 2500, rival_restart_ms: 3000 });
    const a = assumptionsOf(rival, started("fractalswarm.actors.swarm:SWARM", { recovery_ms: 2500 }));
    expect(a.detectionMs).toBe(2500);
    expect(a.restartMs).toBe(3000);
    expect(a.caption).toBe("Rival: ideal durable supervisor — 2.5 s detection · 3 s restart · workers survive · same log");
  });

  it("says so when the rival is notified faster than the swarm detects (a fast external restart)", () => {
    const rival = started("fractalswarm.actors.swarm:DURABLE_MAX", { rival_recovery_ms: 500 });
    const a = assumptionsOf(rival, started("fractalswarm.actors.swarm:SWARM"));
    expect(a.detectionMs).toBe(500);
    expect(a.swarmDetectionMs).toBe(5000);
    expect(a.caption).toContain("0.5 s detection");
    expect(a.caption).toContain("swarm: 5 s detection");
  });

  it("names what a rival that is not the ideal one loses", () => {
    expect(assumptionsOf(started("fractalswarm.actors.swarm:DURABLE")).caption).toContain("in-flight plan and judge calls are lost");
    expect(assumptionsOf(started("fractalswarm.actors.swarm:CENTRAL")).caption).toContain("a crash stops its workers");
  });

  it("falls back to the defaults for a log without params, and to a plain name for a scenario it does not know", () => {
    const a = assumptionsOf(started("my.module:THING"));
    expect(a.system).toBe("other");
    expect(a.caption).toBe("Rival: supervisor — 5 s detection · 0 s restart · same log");
    expect(assumptionsOf(undefined).caption).toBe("Rival: supervisor — 5 s detection · 0 s restart · same log");
  });
});

describe("the system of a scenario", () => {
  it("reads the attribute after the colon", () => {
    expect(systemKind("fractalswarm.actors.swarm:SWARM")).toBe("swarm");
    expect(systemKind("fractalswarm.actors.swarm:DURABLE_MAX")).toBe("durable-max");
    expect(systemKind("fractalswarm.actors.swarm:PIPELINE")).toBe("pipeline");
    expect(systemKind("fractalswarm.actors.toy:TOY")).toBe("other");
    expect(systemKind(null)).toBe("other");
  });

  it("writes seconds without trailing zeros", () => {
    expect(secondsText(5000)).toBe("5 s");
    expect(secondsText(500)).toBe("0.5 s");
    expect(secondsText(2500)).toBe("2.5 s");
    expect(secondsText(0)).toBe("0 s");
    expect(secondsText(1234)).toBe("1.23 s");
  });
});

describe("what the rival is, in a sentence", () => {
  it("names each rival as docs/claims.md does, and says what a crash does to its workers", () => {
    const at = (system: SystemKind, detectionMs = 5000, restartMs = 0) => rivalSentence({ system, detectionMs, restartMs });
    expect(at("central")).toBe("The rival is an in-process supervisor: one program runs the workers, so when it crashes they stop with it.");
    expect(at("durable-max")).toBe("The rival is an ideal durable supervisor: its workers survive a crash, and it is back after 5 s.");
    expect(at("durable-max", 2500, 1000)).toContain("back after 3.5 s");
    expect(at("durable")).toBe("The rival is a durable supervisor: its workers survive a crash, but the plan it was making is lost.");
    for (const system of ["swarm", "single", "pipeline", "other"] as const) expect(at(system)).toMatch(/^The rival is /);
  });

  it("claims nothing about being simpler, cheaper, more reliable or better", () => {
    for (const system of ["central", "durable-max", "durable", "swarm", "single", "pipeline", "other"] as const) {
      const sentence = rivalSentence({ system, detectionMs: 5000, restartMs: 0 }).toLowerCase();
      for (const word of ["simpler", "cheaper", "more reliable", "better", "worse"]) expect(sentence, `${system}: ${word}`).not.toContain(word);
    }
  });
});
