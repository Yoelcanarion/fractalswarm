// Human escalations as the arbitration logs them: escalation.opened is the
// ruling's open window, escalation.answered the owner's verdict on an answer, and only an accepted one decides.

import { describe, expect, it } from "vitest";

import { escalationState, openEscalations, timeLeftMs } from "./escalations";
import { foldEvents } from "./reducer";
import { Stream } from "./testing";

const ID = "arbitration:speaker:S02:availability";

const started = () => new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "swarm", params: {}, clock: "sim" });
const opened = (s: Stream, at = 10_000, over: Record<string, unknown> = {}) =>
  s.at(at).emit("escalation.opened", "o0", {
    id: ID,
    kind: "semantic",
    key: "speaker:S02:availability",
    goal_id: "track-ai/d1",
    question: "S02's availability is disputed: which reading stands?",
    options: ["A", "B"],
    confidence: 0.4,
    timeout_ms: 60_000,
    default: "B",
    ...over,
  });
const answered = (s: Stream, at: number, over: Record<string, unknown>) =>
  s.at(at).emit("escalation.answered", "o0", { id: ID, choice: "A", by: "human", accepted: true, overruled: true, reason: "", ...over });
const human = (s: Stream) => foldEvents(s.events).panels.escalations.human;

describe("an escalation a person may answer", () => {
  it("opens with its question, its options, the ruling that stands and the end of its window in virtual time", () => {
    const [item] = human(opened(started()));
    expect(item).toMatchObject({
      id: ID,
      goalId: "track-ai/d1",
      actor: "o0",
      text: "S02's availability is disputed: which reading stands?",
      status: "open",
      options: ["A", "B"],
      fallback: "B",
      deadlineTs: 70_000,
      answers: [],
    });
  });

  it("is closed by an accepted answer, and the choice is what it was resolved with", () => {
    const s = opened(started());
    answered(s, 20_000, { choice: "A", overruled: true });
    const [item] = human(s);
    expect(item).toMatchObject({ status: "resolved", resolution: "A", resolvedSeq: 3 });
    expect(item.answers).toEqual([{ seq: 3, ts: 20_000, choice: "A", accepted: true, overruled: true, reason: "" }]);
    expect(openEscalations(foldEvents(s.events).panels.escalations)).toEqual([]);
  });

  it("is NOT closed by an ignored answer: it stays open, and the answer is kept with the reason it was ignored", () => {
    const s = opened(started());
    answered(s, 20_000, { choice: "C", accepted: false, overruled: false, reason: "C is not one of the options (A, B)" });
    const state = foldEvents(s.events);
    const [item] = human(s);
    expect(item.status).toBe("open");
    expect(item.resolution).toBeUndefined();
    expect(item.answers).toEqual([{ seq: 3, ts: 20_000, choice: "C", accepted: false, overruled: false, reason: "C is not one of the options (A, B)" }]);
    expect(openEscalations(state.panels.escalations).map((h) => h.id)).toEqual([ID]);
    expect(escalationState(item, state.lastTs, state.completed)).toBe("waiting");
  });

  it("is decided by the first accepted answer; a later one that was ignored changes nothing", () => {
    const s = opened(started());
    answered(s, 20_000, { choice: "C", accepted: false, overruled: false, reason: "C is not one of the options (A, B)" });
    answered(s, 25_000, { choice: "B", accepted: true, overruled: false });
    answered(s, 30_000, { choice: "A", accepted: false, overruled: false, reason: "the escalation was already answered (B)" });
    const [item] = human(s);
    expect(item).toMatchObject({ status: "resolved", resolution: "B", resolvedSeq: 4 });
    expect(item.answers.map((a) => [a.choice, a.accepted])).toEqual([["C", false], ["B", true], ["A", false]]);
    expect(escalationState(item, 30_000, false)).toBe("answered"); // the ruled label confirmed
  });

  it("reads an answer with no `accepted` field as accepted, like the shape it was first built on", () => {
    const s = opened(started());
    s.at(20_000).emit("escalation.answered", "@env", { id: ID, choice: "B" });
    expect(human(s)[0]).toMatchObject({ status: "resolved", resolution: "B" });
  });

  it("ignores an answer to an escalation that was never opened", () => {
    const s = opened(started());
    answered(s, 20_000, { id: "arbitration:nope", accepted: false, reason: "no escalation arbitration:nope is open at track-ai/d1" });
    expect(human(s).map((h) => [h.id, h.status, h.answers.length])).toEqual([[ID, "open", 0]]);
  });

  it("still closes on escalation.resolved, and opens on escalation.raised, as the panel was first built", () => {
    const s = started()
      .emit("escalation.raised", "o0", { eid: "esc-1", goal_id: "track-ai/d1", reason: "parent failed" })
      .emit("escalation.resolved", "@env", { eid: "esc-1", decision: "skip" });
    expect(human(s)[0]).toMatchObject({ id: "esc-1", text: "parent failed", status: "resolved", resolution: "skip", options: [], answers: [] });
    expect(human(s)[0].deadlineTs).toBeUndefined();
  });
});

describe("where an escalation stands, in the run's virtual time", () => {
  const item = () => human(opened(started()))[0]; // opened at 10 s, answerable until 70 s

  it("counts the time left as deadline minus the time the log has reached, never the wall clock", () => {
    expect(timeLeftMs(item(), 10_000)).toBe(60_000);
    expect(timeLeftMs(item(), 25_500)).toBe(44_500);
    expect(timeLeftMs(item(), 70_000)).toBe(0);
    expect(timeLeftMs(item(), 500_000)).toBe(0); // never negative
  });

  it("has no time left to count for an escalation with no window", () => {
    const [raised] = human(started().emit("escalation.raised", "o0", { eid: "e", goal_id: "g", reason: "r" }));
    expect(timeLeftMs(raised, 1_000_000)).toBeNull();
    expect(escalationState(raised, 1_000_000, false)).toBe("waiting"); // it never expires
    expect(escalationState(raised, 1_000_000, true)).toBe("closed");
  });

  it("waits until the end of the window, which is still in time at its last millisecond", () => {
    expect(escalationState(item(), 10_000, false)).toBe("waiting");
    expect(escalationState(item(), 70_000, false)).toBe("waiting");
    expect(escalationState(item(), 70_001, false)).toBe("expired");
  });

  it("closes when the run ends inside the window, and expires when it ends after it", () => {
    expect(escalationState(item(), 40_000, true)).toBe("closed");
    expect(escalationState(item(), 90_000, true)).toBe("expired");
  });

  it("says confirmed or overruled once an answer was accepted, whatever the clock says", () => {
    const confirmed = opened(started());
    answered(confirmed, 20_000, { choice: "B", overruled: false });
    expect(escalationState(human(confirmed)[0], 999_000, true)).toBe("answered");
    const overruled = opened(started());
    answered(overruled, 20_000, { choice: "A", overruled: true });
    expect(escalationState(human(overruled)[0], 999_000, true)).toBe("overruled");
  });

  it("moves with the playhead: the same log at an earlier event is still waiting", () => {
    const s = opened(started());
    answered(s, 20_000, { choice: "A", overruled: true });
    const before = foldEvents(s.events.slice(0, 2)).panels.escalations.human[0];
    const after = foldEvents(s.events).panels.escalations.human[0];
    expect(escalationState(before, 10_000, false)).toBe("waiting");
    expect(escalationState(after, 20_000, false)).toBe("overruled");
  });
});
