import { describe, expect, it } from "vitest";

import { fraction, MARK_TONE, marksOf } from "./timeline";
import type { RunEvent } from "./types";

let seq = 0;
const ev = (type: string, ts: number, payload: Record<string, unknown> = {}, actor = "root"): RunEvent =>
  ({ seq: ++seq, ts_virtual: ts, type, actor, payload }) as unknown as RunEvent;

describe("timeline marks", () => {
  it("tells a coordinator kill from an agent kill", () => {
    const events = [
      ev("chaos.injected", 1000, { fault: "kill_agent", target: "s1" }),
      ev("chaos.injected", 2000, { fault: "kill_coordinator", target: "root" }),
    ];
    const marks = marksOf(events);
    expect(marks.map((m) => m.kind)).toEqual(["agent-kill", "coordinator-kill"]);
    expect(marks[0]).toMatchObject({ seq: events[0].seq, ts: 1000, label: "1.00 s · agent s1 killed" });
    expect(marks[1]).toMatchObject({ seq: events[1].seq, ts: 2000, label: "2.00 s · coordinator root killed" });
  });

  it("gives a supervisor's crash one marker, not two, and a crash on its own one", () => {
    const marks = marksOf([
      ev("chaos.injected", 1000, { fault: "kill_coordinator", target: "sup" }),
      ev("baseline.crashed", 1001, { coordinator: "sup" }), // the kill above, seen from the baseline
      ev("baseline.restarted", 3000, { coordinator: "sup" }),
      ev("baseline.crashed", 12_500, { coordinator: "sup" }), // no kill before it
    ]);
    expect(marks.map((m) => m.kind)).toEqual(["coordinator-kill", "restart", "coordinator-kill"]);
    expect(marks[1].label).toBe("3.00 s · sup restarted");
    expect(marks[2].label).toBe("12.5 s · coordinator sup crashed");
  });

  it("leaves the network faults off the track and marks a partition", () => {
    const faults = ["drop", "delay", "duplicate", "reorder", "partition_drop", "heal"].map((fault, i) =>
      ev("chaos.injected", i * 10, { fault }),
    );
    expect(marksOf(faults)).toEqual([]);
    const [partition] = marksOf([ev("chaos.injected", 500, { fault: "partition", targets: ["a", "b"] })]);
    expect(partition).toMatchObject({ kind: "chaos", label: "0.50 s · network partition: a, b" });
  });

  it("marks recoveries and hazards in log order", () => {
    const marks = marksOf([
      ev("tree.adopted", 100, { adopter: "o2", dead: "o1" }),
      ev("member.dead", 200, { member: "o1" }),
      ev("collision.detected", 300),
      ev("breaker.opened", 400, { name: "llm" }),
      ev("escalation.raised", 500),
      ev("budget.shock", 600),
      ev("run.halted", 700, { reason: "kill switch" }),
      ev("effect.started", 800), // not a moment worth a marker
    ]);
    expect(marks.map((m) => m.kind)).toEqual(["adopted", "death", "collision", "breaker", "escalation", "shock", "halt"]);
    expect(marks[0].label).toBe("0.10 s · o2 adopted the subtree of o1");
    expect(marks[3].label).toBe("0.40 s · breaker opened: llm");
    expect(marks[6].label).toBe("0.70 s · run halted: kill switch");
    expect(MARK_TONE[marks[0].kind]).toBe("recovery");
    expect(MARK_TONE[marks[6].kind]).toBe("kill");
  });
});

describe("where a time falls along the track", () => {
  it("is a fraction of the run, held between 0 and 1", () => {
    expect(fraction(500, 1000)).toBe(0.5);
    expect(fraction(-5, 1000)).toBe(0);
    expect(fraction(2000, 1000)).toBe(1);
    expect(fraction(10, 0)).toBe(0);
  });
});
