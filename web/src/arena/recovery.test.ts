// The supervisor's recovery chip over W1's scored report. The fixtures are the report the server gives
// (verify/recovery.py, fb7df39) for a fake durable-max run with five supervisor crashes and for a fake swarm
// run: real output, not a hand-written shape.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { foldEvents } from "../lib/reducer";
import { RecoveryBadge } from "./RecoveryChip";
import { describeServerRecovery, readRecoveryReport, recoveryChipOf, type ServerRecovery } from "./recovery";
import { crash, restart, rivalStream } from "./testing";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = (name: string): Raw => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8"));
const supervisor = (): Raw => fixture("recovery.supervisor.json");
const read = (raw: unknown): ServerRecovery => {
  const report = readRecoveryReport(raw);
  if (report === null) throw new Error("expected a readable report");
  return report;
};

/** A supervisor that crashed once and came back. */
const restarted = () => foldEvents(restart(crash(rivalStream(), "o0", 10_000, 5000), "o0", 15_000).events);

describe("reading the server's recovery report", () => {
  it("reads the report of a supervisor run: five crashes, five restarts, five rules that all apply and hold", () => {
    const report = read(supervisor());
    expect(report).toMatchObject({ ok: true, supervised: true, system: "durable-max", restarts: 5 });
    expect(report.checks.map((c) => [c.name, c.applies, c.ok, c.violations])).toEqual([
      ["restarted", true, true, 0],
      ["quiet", true, true, 0],
      ["consumed", true, true, 0],
      ["own_calls", true, true, 0],
      ["no_repeat", true, true, 0],
    ]);
  });

  it("reads the report of a swarm run: no supervisor crash, only the rule about repeated work applies", () => {
    const report = read(fixture("recovery.swarm.json"));
    expect(report).toMatchObject({ ok: true, supervised: false, system: "swarm", restarts: 0 });
    expect(report.checks.filter((c) => c.applies).map((c) => c.name)).toEqual(["no_repeat"]);
  });

  it("does not trust a body that is not a report", () => {
    expect(readRecoveryReport(null)).toBeNull();
    expect(readRecoveryReport({})).toBeNull();
    expect(readRecoveryReport({ detail: "not found" })).toBeNull();
    const noVerdict = supervisor();
    delete noVerdict.ok;
    expect(readRecoveryReport(noVerdict)).toBeNull();
    const noChecks = supervisor();
    delete noChecks.checks;
    expect(readRecoveryReport(noChecks)).toBeNull();
    const badCheck = supervisor();
    delete badCheck.checks[2].applies;
    expect(readRecoveryReport(badCheck)).toBeNull();
  });

  it("does not trust a verdict that its own checks do not add up to", () => {
    const optimistic = supervisor();
    optimistic.checks[1].ok = false;
    expect(readRecoveryReport(optimistic)).toBeNull();
    const pessimistic = supervisor();
    pessimistic.ok = false;
    expect(readRecoveryReport(pessimistic)).toBeNull();
  });
});

describe("what the chip says of the server's report", () => {
  it("says Recovery OK with the restarts, and lists each rule it read in the server's words", () => {
    const chip = describeServerRecovery(read(supervisor()));
    expect(chip.tone).toBe("good");
    expect(chip.text).toBe("Recovery OK ✓ 5 restarts");
    expect(chip.detail).toContain("Checked on the finished log:");
    expect(chip.detail).toContain("✓ every crash has its restart: 5 crash(es), 5 restarted");
    expect(chip.detail.split("\n")).toHaveLength(6);
  });

  it("names the rule that failed, never says OK, and counts the violations", () => {
    const broken = supervisor();
    broken.checks[4].violations = [{ check: "no_repeat", kind: "attempt_twice", seq: 410, detail: "a1 was dispatched twice" }];
    broken.checks[4].ok = false;
    broken.ok = false;
    const chip = describeServerRecovery(read(broken));
    expect(chip.tone).toBe("bad");
    expect(chip.text).toBe("Recovery check failed: no_repeat");
    expect(chip.text).not.toContain("OK");
    expect(chip.detail.split("\n")[0]).toBe("1 violation on the finished log:");
    expect(chip.detail).toContain("✗ no attempt is dispatched twice and no call is paid twice");
  });

  it("does not call it OK for a run that never crashed its supervisor: that would claim a proof it never exercised", () => {
    const chip = describeServerRecovery(read(fixture("recovery.swarm.json")));
    expect(chip.tone).toBe("muted");
    expect(chip.text).toBe("No supervisor crash to recover from");
  });
});

describe("what the chip shows", () => {
  it("waits for the server, and then has its report, or the log's own count when it has none", () => {
    const view = restarted();
    expect(recoveryChipOf(undefined, view)).toBe("checking");
    const scored = recoveryChipOf(read(supervisor()), view);
    expect(scored).toMatchObject({ tone: "good", text: "Recovery OK ✓ 5 restarts" });
    const counted = recoveryChipOf(null, view);
    expect(counted).toMatchObject({ tone: "good" });
    expect(typeof counted !== "string" && counted.text).toBe("Recovery: 1 crash, 1 restarted");
    expect(typeof counted !== "string" && counted.detail).toContain("Counted from this run's log");
  });

  it("draws each state as a badge with the verdict in words, and the rules behind it in the hint", () => {
    const html = (chip: Parameters<typeof RecoveryBadge>[0]["chip"]) => renderToStaticMarkup(createElement(RecoveryBadge, { chip }));
    expect(html("checking")).toContain("Checking recovery…");
    const ok = html(describeServerRecovery(read(supervisor())));
    expect(ok).toContain("badge--good");
    expect(ok).toContain("Recovery OK ✓ 5 restarts");
    expect(ok).toContain('title="Checked on the finished log:');
    const broken = supervisor();
    broken.checks[0].violations = [{ check: "restarted", kind: "no_restart", seq: 3, detail: "o0 never restarted" }];
    broken.checks[0].ok = false;
    broken.ok = false;
    expect(html(describeServerRecovery(read(broken)))).toContain("badge--bad");
  });
});
