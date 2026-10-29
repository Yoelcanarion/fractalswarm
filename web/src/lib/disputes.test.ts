import { describe, expect, it } from "vitest";

import type { ControlResult } from "./api";
import { READ_BACK_MS, readDisputes, sendAnswer, verdictAfter, withLoggedVerdict, type Answering, type DisputeEscalation, type Judged, type Sent } from "./disputes";

// The shape api/lens.py `disputes_view` answers with (one dispute whose escalation a person may answer).
const dispute = (over: Record<string, unknown> = {}) => ({
  key: "speaker:S02:availability",
  status: "ruled",
  ruling: { winner: "B", by: "arbiter", reason: "", confidence: 0.4 },
  escalation: {
    id: "arbitration:speaker:S02:availability",
    options: ["A", "B"],
    default: "B",
    state: "waiting",
    deadline_ts: 70_000,
    answers: [],
    ...over,
  },
});

const body = (...disputes: unknown[]) => ({ run_id: "r1", ended: false, now_ts: 25_000, count: disputes.length, open: 0, waiting: 1, disputes });

const answer = (over: Record<string, unknown> = {}) => ({ choice: "A", by: "human", accepted: true, overruled: true, reason: "", seq: 900, ts_virtual: 26_000, ...over });

describe("reading the disputes of a run", () => {
  it("keeps the escalations, with the ruling each one is about and the answers it got", () => {
    const found = readDisputes(body(dispute({ state: "overruled", answers: [answer({ accepted: false, overruled: false, choice: "C", reason: "C is not one of the options (A, B)", seq: 800 }), answer()] })));
    expect(found).toEqual([
      {
        id: "arbitration:speaker:S02:availability",
        state: "overruled",
        ruled: "B",
        answers: [
          { seq: 800, choice: "C", by: "human", accepted: false, overruled: false, reason: "C is not one of the options (A, B)" },
          { seq: 900, choice: "A", by: "human", accepted: true, overruled: true, reason: "" },
        ],
      },
    ]);
  });

  it("skips a dispute that has no escalation, and reads nothing from what is not a disputes answer", () => {
    expect(readDisputes(body({ key: "k", ruling: null, escalation: null }))).toEqual([]);
    expect(readDisputes(null)).toEqual([]);
    expect(readDisputes({ disputes: "none" })).toEqual([]);
    expect(readDisputes({ error: "no such run" })).toEqual([]);
  });

  it("has no ruling to name while the arbiter has not ruled", () => {
    expect(readDisputes(body({ ...dispute(), ruling: null }))[0].ruled).toBeNull();
  });
});

const esc = (answers: DisputeEscalation["answers"], ruled: string | null = "B"): DisputeEscalation => ({ id: "e1", state: "waiting", ruled, answers });
const reply = (over: Partial<DisputeEscalation["answers"][number]> = {}): DisputeEscalation["answers"][number] => ({
  seq: 900,
  choice: "A",
  by: "human",
  accepted: true,
  overruled: true,
  reason: "",
  ...over,
});

describe("the verdict on an answer", () => {
  it("is nothing until the log holds an answer newer than the last one the panel had seen", () => {
    expect(verdictAfter(undefined, 0)).toBeNull();
    expect(verdictAfter(esc([]), 0)).toBeNull();
    expect(verdictAfter(esc([reply({ seq: 800 })]), 800)).toBeNull();
  });

  it("says an accepted answer overruled the ruling", () => {
    expect(verdictAfter(esc([reply()]), 0)).toEqual({ kind: "overruled", text: "accepted: A overrules B" });
  });

  it("says an accepted answer confirmed the ruling", () => {
    expect(verdictAfter(esc([reply({ choice: "B", overruled: false })]), 0)).toEqual({ kind: "confirmed", text: "accepted: B confirms B" });
  });

  it("gives the owner's reason for an answer it ignored", () => {
    expect(verdictAfter(esc([reply({ accepted: false, overruled: false, choice: "C", reason: "C is not one of the options (A, B)" })]), 0)).toEqual({
      kind: "ignored",
      text: "not accepted: C is not one of the options (A, B)",
    });
    expect(verdictAfter(esc([reply({ accepted: false, overruled: false })]), 0)?.text).toBe("not accepted: the owner did not take it");
  });

  it("reads the newest answer after the one seen, not an older one", () => {
    const answers = [reply({ seq: 700, accepted: false, overruled: false, reason: "too early" }), reply({ seq: 950, choice: "B", overruled: false })];
    expect(verdictAfter(esc(answers), 700)).toEqual({ kind: "confirmed", text: "accepted: B confirms B" });
    expect(verdictAfter(esc(answers), 0)?.kind).toBe("confirmed"); // the newest of all
  });

  it("names no ruling when the arbiter has not ruled", () => {
    expect(verdictAfter(esc([reply()], null), 0)?.text).toBe("accepted: A overrules the ruling");
  });
});

describe("sending an answer", () => {
  const ok: ControlResult = { ok: true, status: 200, detail: "answer to e1 requested for goal:g1" };

  /** A server stand-in: `reads` are what successive looks at the disputes show; `waits` and `reports` are recorded. */
  function rig(post: ControlResult | Error, reads: (DisputeEscalation[] | null | Error)[], alive: () => boolean = () => true) {
    const waits: number[] = [];
    const reports: Sent[] = [];
    const posted: string[] = [];
    let look = 0;
    const how: Answering = {
      async post(choice) {
        posted.push(choice);
        if (post instanceof Error) throw post;
        return post;
      },
      async read() {
        const next = reads[Math.min(look, reads.length - 1)];
        look += 1;
        if (next instanceof Error) throw next;
        return next;
      },
      wait: async (ms) => void waits.push(ms),
      alive,
    };
    return { how, waits, reports, posted, looks: () => look, report: (sent: Sent) => void reports.push(sent) };
  }

  it("shows the server's own words for a refusal and reads nothing back", async () => {
    const reason = "run 'r1' was not launched to take controls: start it from the API";
    const t = rig({ ok: false, status: 409, detail: reason }, [[]]);
    await sendAnswer(t.how, "e1", "A", 0, t.report);
    expect(t.posted).toEqual(["A"]);
    expect(t.reports).toEqual([{ choice: "A", request: { ok: false, status: 409, detail: reason }, verdict: null }]);
    expect(t.looks()).toBe(0);
    expect(t.waits).toEqual([]);
  });

  it("shows a request that could not be made at all", async () => {
    const t = rig(new Error("Failed to fetch"), [[]]);
    await sendAnswer(t.how, "e1", "A", 0, t.report);
    expect(t.reports).toEqual([{ choice: "A", request: { ok: false, status: 0, detail: "Failed to fetch" }, verdict: null }]);
  });

  it("reads the verdict back from the disputes as soon as the log has one", async () => {
    const t = rig(ok, [[esc([])], [esc([reply()])]]);
    await sendAnswer(t.how, "e1", "A", 0, t.report);
    expect(t.reports.map((r) => r.verdict)).toEqual(["pending", { kind: "overruled", text: "accepted: A overrules B" }]);
    expect(t.waits).toEqual(READ_BACK_MS.slice(0, 2));
    expect(t.looks()).toBe(2);
  });

  it("reports an answer the owner ignored, with its reason", async () => {
    const t = rig(ok, [[esc([reply({ accepted: false, overruled: false, reason: "the window closed" })])]]);
    await sendAnswer(t.how, "e1", "A", 0, t.report);
    expect(t.reports.at(-1)?.verdict).toEqual({ kind: "ignored", text: "not accepted: the window closed" });
  });

  it("looks at the escalation it answered, not at another", async () => {
    const other: DisputeEscalation = { ...esc([reply()]), id: "other" };
    const t = rig(ok, [[other, esc([])], [other, { ...esc([reply({ seq: 901 })]), id: "e1" }]]);
    await sendAnswer(t.how, "e1", "A", 0, t.report);
    expect(t.looks()).toBe(2);
  });

  it("gives up with no verdict after the last look", async () => {
    const t = rig(ok, [[esc([])]]);
    await sendAnswer(t.how, "e1", "A", 0, t.report);
    expect(t.reports.map((r) => r.verdict)).toEqual(["pending", null]);
    expect(t.waits).toEqual(READ_BACK_MS);
  });

  it("stops looking when the server does not offer the disputes (404) or cannot be reached", async () => {
    const none = rig(ok, [null]);
    await sendAnswer(none.how, "e1", "A", 0, none.report);
    expect(none.reports.map((r) => r.verdict)).toEqual(["pending", null]);
    expect(none.looks()).toBe(1);
    const down = rig(ok, [new Error("offline")]);
    await sendAnswer(down.how, "e1", "A", 0, down.report);
    expect(down.reports.map((r) => r.verdict)).toEqual(["pending", null]);
    expect(down.looks()).toBe(1);
  });

  it("says nothing once whoever asked has gone", async () => {
    let gone = false;
    const t = rig(ok, [[esc([])]], () => !gone);
    gone = true;
    await sendAnswer(t.how, "e1", "A", 0, t.report);
    expect(t.reports).toEqual([]);
    let asked = 0;
    const u = rig(ok, [[esc([])]], () => asked++ < 1); // there when the post returns, gone by the end of the first wait
    await sendAnswer(u.how, "e1", "A", 0, u.report);
    expect(u.reports.map((r) => r.verdict)).toEqual(["pending"]);
    expect(u.looks()).toBe(0);
  });
});

describe("what the box says once the page's own copy of the log has the verdict", () => {
  const own = (answers: Judged[] = [reply()]) => ({ ruled: "B", answers });
  const request: ControlResult = { ok: true, status: 200, detail: "answer to e1 requested for goal:g1" };
  const waiting: Sent = { choice: "A", request, verdict: "pending" };
  const overruled = { kind: "overruled", text: "accepted: A overrules B" };

  it("takes the verdict the stream brought before the poll's next look, and one the poll gave up on", () => {
    expect(withLoggedVerdict(waiting, own(), 0)).toEqual({ ...waiting, verdict: overruled });
    expect(withLoggedVerdict({ ...waiting, verdict: null }, own(), 0)).toEqual({ ...waiting, verdict: overruled });
  });

  it("keeps the verdict the poll read", () => {
    const read: Sent = { ...waiting, verdict: { kind: "confirmed", text: "accepted: B confirms B" } };
    expect(withLoggedVerdict(read, own(), 0)).toBe(read);
  });

  it("keeps waiting while the page's log holds nothing newer than the last answer it had seen", () => {
    expect(withLoggedVerdict(waiting, own([]), 0)).toBe(waiting);
    expect(withLoggedVerdict(waiting, own([reply({ seq: 800 })]), 800)).toBe(waiting);
  });

  it("has no verdict to look for after a refusal", () => {
    const refused: Sent = { choice: "A", request: { ok: false, status: 409, detail: "not launched to take controls" }, verdict: null };
    expect(withLoggedVerdict(refused, own(), 0)).toBe(refused);
  });

  it("reads the fold's answers the way it reads the server's (no `by` there)", () => {
    const fold = [{ seq: 900, ts: 26_000, choice: "B", accepted: true, overruled: false, reason: "" }];
    expect(withLoggedVerdict(waiting, own(fold), 0).verdict).toEqual({ kind: "confirmed", text: "accepted: B confirms B" });
  });
});
