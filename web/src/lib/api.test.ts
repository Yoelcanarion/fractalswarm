import { afterEach, describe, expect, it, vi } from "vitest";

import { answerEscalation, fetchCapabilities, fetchDisputes, fetchTakeover, launchTask, loadAllEvents, postControl, verifyRun } from "./api";
import { buildTaskSpec, defaultForm, taskLaunchBody } from "./taskspec";

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stand in for the server: ``fetch`` answers ``status`` and ``body``, and every call is kept. */
function server(status: number, body: unknown = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return reply(status, body);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("a POST the server accepts", () => {
  it("sends the verify request as JSON, with an empty object, as the server refuses anything else (415)", async () => {
    const calls = server(200, { ok: true });
    await verifyRun("run 1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("api/runs/run%201/verify");
    expect(calls[0].init).toMatchObject({ method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  });

  it("surfaces the server's own reason when the verify request is refused", async () => {
    server(415, { detail: "expected application/json" });
    await expect(verifyRun("r")).rejects.toThrow("expected application/json");
  });
});

// The server wraps every refusal as {"error": reason} (api/app.py `http_error`); the words below are W2's own
// (api/controls.py, api/app.py), so what a person reads in the chaos panel is what the server said.
describe("a control the server takes or refuses", () => {
  it.each(["api_storm", "net_fault"])("shows the server's reason for %s (422): it belongs to the plan a run starts with", async (kind) => {
    const reason = `${kind} cannot be injected into a running run: it is part of the chaos plan a run starts with; live kinds are kill_half, kill_coordinator, kill_agent`;
    const calls = server(422, { error: reason });
    await expect(postControl("api/runs/r1/chaos", { kind })).resolves.toEqual({ ok: false, status: 422, detail: reason });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("api/runs/r1/chaos");
    expect(calls[0].init).toMatchObject({ method: "POST", body: JSON.stringify({ kind }), headers: { "Content-Type": "application/json" } });
  });

  it("shows why a run cannot take controls (409)", async () => {
    server(409, { error: "run 'r1' is a recording, not a live run" });
    await expect(postControl("api/runs/r1/chaos", { kind: "kill_half" })).resolves.toMatchObject({ ok: false, status: 409, detail: "run 'r1' is a recording, not a live run" });
    server(409, { error: "run 'r1' does not wait for approval (auto_approve)" });
    await expect(postControl("api/runs/r1/approve", { goal_id: "root", approve: true })).resolves.toMatchObject({ ok: false, status: 409, detail: "run 'r1' does not wait for approval (auto_approve)" });
  });

  it("takes the server's words for a success, and reads a `detail` body too", async () => {
    server(200, { ok: true, detail: "5 chaos action(s) requested" });
    await expect(postControl("api/runs/r1/chaos", { kind: "kill_half" })).resolves.toEqual({ ok: true, status: 200, detail: "5 chaos action(s) requested" });
    server(422, { detail: "the body must be JSON" });
    await expect(postControl("api/runs/r1/chaos", {})).resolves.toMatchObject({ ok: false, detail: "the body must be JSON" });
  });

  it("falls back to the status text when the answer is not JSON (a proxy's error page)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" })));
    await expect(postControl("api/runs/r1/chaos", { kind: "kill_half" })).resolves.toEqual({ ok: false, status: 502, detail: "Bad Gateway" });
  });

  it("reads FastAPI's own list of problems when it refused the body before the API's handler saw it", async () => {
    server(422, { detail: [{ type: "missing", loc: ["body", "spec"], msg: "Field required" }, { loc: [], msg: "second" }, { oops: true }] });
    await expect(postControl("api/tasks", {})).resolves.toEqual({ ok: false, status: 422, detail: "spec: Field required; second" });
  });
});

// api/app.py `answer_escalation`: the goal is the escalation's own, read from the log; the server only *requests* the answer.
describe("a person's answer to an escalation", () => {
  const ID = "arbitration:speaker:S02:availability";

  it("posts the choice as JSON to the escalation's own route, with both ids escaped", async () => {
    const detail = `answer to ${ID} requested for goal:track-ai/d1`;
    const calls = server(200, { ok: true, detail });
    await expect(answerEscalation("run 1", ID, "A")).resolves.toEqual({ ok: true, status: 200, detail });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("api/runs/run%201/escalations/arbitration%3Aspeaker%3AS02%3Aavailability");
    expect(calls[0].init).toMatchObject({ method: "POST", body: JSON.stringify({ choice: "A" }), headers: { "Content-Type": "application/json" } });
  });

  it.each([
    [409, "run 'r1' was not launched to take controls: start it from the API"],
    [422, "choice is required: what the person decided"],
    [422, "the escalation id is not valid"],
    [404, `no escalation '${ID}' in run 'r1'`],
  ])("shows the server's reason for a refusal (%i) exactly as it words it", async (status, reason) => {
    server(status, { error: reason });
    await expect(answerEscalation("r1", ID, "A")).resolves.toEqual({ ok: false, status, detail: reason });
  });
});

// api/lens.py `disputes_view`: where each escalation of a run stands and the answers it got.
describe("the escalations as the server reads them from the log", () => {
  it("reads the escalation and the verdicts on its answers", async () => {
    const calls = server(200, {
      run_id: "r1",
      disputes: [
        {
          key: "speaker:S02:availability",
          ruling: { winner: "B" },
          escalation: { id: "e1", state: "overruled", answers: [{ choice: "A", by: "human", accepted: true, overruled: true, reason: "", seq: 900 }] },
        },
      ],
    });
    await expect(fetchDisputes("run 1")).resolves.toEqual([
      { id: "e1", state: "overruled", ruled: "B", answers: [{ seq: 900, choice: "A", by: "human", accepted: true, overruled: true, reason: "" }] },
    ]);
    expect(calls[0].url).toBe("api/runs/run%201/disputes");
  });

  it("is null for a server that does not offer them (404), and fails on any other error", async () => {
    server(404, { error: "no such view" });
    await expect(fetchDisputes("r1")).resolves.toBeNull();
    server(500, { error: "boom" });
    await expect(fetchDisputes("r1")).rejects.toThrow("boom");
  });
});

// The request and the answers are those of api/jobs.py (`TaskRequest`, extra="forbid") and of the API reference in
// A TaskSpec goes under `spec`, and a 202 names the run it started.
describe("a run started from the New task form", () => {
  const accepted = {
    job_id: "job-20261029-001228-cc5e",
    run_id: "ui-20261029-001228-cc5e",
    run_ids: ["ui-20261029-001228-cc5e"],
    state: "starting",
    private: false,
    warnings: ["the CPU is at 91%: a live-clock run may miss heartbeats"],
    job: { id: "job-20261029-001228-cc5e", kind: "run" },
  };
  const built = () => buildTaskSpec({ ...defaultForm(), goal: "Build the program." }).spec!;

  it("posts the TaskSpec under `spec`, and only a fake-LLM run, never the bare spec that the server refuses (422)", async () => {
    const calls = server(202, accepted);
    await launchTask(taskLaunchBody(built()));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("api/tasks");
    expect(calls[0].init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["backend", "spec"]);
    expect(sent.backend).toBe("fake");
    expect(sent.spec).toEqual(built());
  });

  it("names the run the server started, with the job and what it warned about", async () => {
    server(202, accepted);
    await expect(launchTask(taskLaunchBody(built()))).resolves.toEqual({
      ok: true,
      status: 202,
      detail: "Started run ui-20261029-001228-cc5e.",
      runId: "ui-20261029-001228-cc5e",
      jobId: "job-20261029-001228-cc5e",
      warnings: ["the CPU is at 91%: a live-clock run may miss heartbeats"],
    });
  });

  it.each([
    [422, "inputs: give the input: inputs.fixture, inputs.inline or inputs.intake"],
    [422, "spec.goal: String should have at least 1 character"],
    [409, "run id 'ui-1' is already used"],
    [429, "8 jobs are active"],
    [503, "the API was started without a private directory"],
  ])("shows the server's reason for a refusal (%i) and starts nothing", async (status, reason) => {
    server(status, { error: reason });
    await expect(launchTask(taskLaunchBody(built()))).resolves.toEqual({ ok: false, status, detail: reason, runId: null, jobId: null, warnings: [] });
  });

  it("is not fooled by a body that is not an object (a proxy's page)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 502, statusText: "Bad Gateway", headers: { "Content-Type": "application/json" } })));
    await expect(launchTask(taskLaunchBody(built()))).resolves.toMatchObject({ ok: false, status: 502, detail: "Bad Gateway", runId: null });
  });
});

// api/app.py `events_page` answers {events, next_seq, last_seq, done}. Since W3's fix (b702dc5) the page and `last_seq` come from one
// snapshot, so `done` is true as soon as a page reaches the end of the log as it was when the page was read, however fast a live
// run writes; what is committed after that comes over the WebSocket tail from next_seq.
describe("reading a whole log", () => {
  /** A server whose log grows by `growth` events after every page it serves (a live run), snapshot-firm like the API's. */
  function growing(start: number, growth: number) {
    const log = Array.from({ length: start }, (_, i) => ({ seq: i + 1 }));
    const calls: { from: number; limit: number }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = new URL(url, "http://x/").searchParams;
        const from = Number(query.get("from_seq"));
        const limit = Number(query.get("limit"));
        calls.push({ from, limit });
        if (calls.length > 20) throw new Error("the reader is still chasing the log after 20 pages");
        const last = log.length; // the snapshot
        const events = log.slice(from - 1, from - 1 + limit);
        const next = events.length ? events.at(-1)!.seq + 1 : from;
        for (let i = 0; i < growth; i++) log.push({ seq: log.length + 1 });
        return reply(200, { events, next_seq: next, last_seq: last, done: next > last });
      }),
    );
    return calls;
  }

  it("pages from the first event to the end of the log it saw, in order, and stops there", async () => {
    const calls = growing(12_000, 0);
    const events = await loadAllEvents("run 1");
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 12_000 }, (_, i) => i + 1));
    expect(calls).toEqual([
      { from: 1, limit: 5000 },
      { from: 5001, limit: 5000 },
      { from: 10_001, limit: 5000 },
    ]);
  });

  it("does not chase a run that writes while it reads: it ends once a page reaches the end of its own snapshot", async () => {
    const calls = growing(12_000, 300);
    const events = await loadAllEvents("r");
    const seqs = events.map((e) => e.seq);
    expect(calls).toHaveLength(3);
    expect(seqs[0]).toBe(1);
    expect(seqs.every((seq, i) => seq === i + 1)).toBe(true); // no gap, no repeat: the tail takes over from the next event
    expect(seqs.length).toBeGreaterThanOrEqual(12_000);
    expect(seqs.length).toBeLessThan(12_000 + 3 * 300 + 1);
  });

  it("starts where it is told to", async () => {
    const calls = growing(300, 0);
    expect((await loadAllEvents("r", 201)).map((e) => e.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 201));
    expect(calls).toEqual([{ from: 201, limit: 5000 }]);
  });

  it("stops on an empty page even if the server still says it is not done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { events: [], next_seq: 1, last_seq: 5, done: false })));
    await expect(loadAllEvents("r")).resolves.toEqual([]);
  });

  it("fails with the server's own reason", async () => {
    server(500, { detail: "boom" });
    await expect(loadAllEvents("r")).rejects.toThrow("boom");
  });
});

describe("the takeover check", () => {
  it.each([404, 405, 409, 501])("shows nothing when the server answers %i (not offered, or the run has not completed)", async (status) => {
    server(status, { detail: "not yet" });
    await expect(fetchTakeover("r")).resolves.toBeNull();
  });

  it("reads a report that has a verdict", async () => {
    server(200, { ok: true, violations: [], successions: [], adoptions: [], kills: [] });
    await expect(fetchTakeover("r")).resolves.toMatchObject({ ok: true });
  });

  it("fails on any other error, and on a report with no verdict", async () => {
    server(500, { detail: "boom" });
    await expect(fetchTakeover("r")).rejects.toThrow("boom");
    server(200, { violations: [] });
    await expect(fetchTakeover("r")).rejects.toThrow("without a verdict");
  });
});

describe("the capabilities", () => {
  it("passes on whether the server allows billed launches, when it says", async () => {
    server(200, { tasks: true, chaos: false, approve: false, budget: true, halt: true, real: true });
    await expect(fetchCapabilities()).resolves.toMatchObject({ tasks: true, real: true });
    server(200, { tasks: true, chaos: false, approve: false, budget: true, halt: true, real: "yes" });
    await expect(fetchCapabilities()).resolves.toMatchObject({ real: false });
  });

  it("leaves it out for a server that does not say", async () => {
    server(200, { tasks: true });
    expect(await fetchCapabilities()).not.toHaveProperty("real");
  });
});
