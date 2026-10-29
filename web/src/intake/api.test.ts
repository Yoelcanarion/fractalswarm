// The page's calls to the API: what it sends (every POST says it is JSON), what it makes of each answer, and that a
// call never throws. The answers are the real bodies of W2's API at $0, saved under fixtures/.

import { describe, expect, it } from "vitest";

import { createIntakeApi, errorOf, readApproval, readArenaLaunch, readIntakeState, readSample, readStarted, readTaskLaunch, type Fetcher } from "./api";
import { fixture, museReading } from "./testing";

interface Seen {
  path: string;
  init: RequestInit | undefined;
}

/** A fetcher that answers with a body and records what it was asked. */
function serving(answer: (path: string) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  const fetcher: Fetcher = async (path, init) => {
    seen.push({ path, init });
    const { status = 200, body } = answer(path);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { api: createIntakeApi(fetcher), seen };
}

const headersOf = (seen: Seen): Record<string, string> => (seen.init?.headers ?? {}) as Record<string, string>;

describe("what the page sends", () => {
  const calls: [string, (api: ReturnType<typeof createIntakeApi>) => Promise<unknown>, string][] = [
    ["a reading", (api) => api.startReading({ talks: "x" }), "api/intake"],
    ["an approval of the reading as proposed", (api) => api.approve("i1", null), "api/intake/i1/approve"],
    ["an approval of an edited reading", (api) => api.approve("i1", museReading()), "api/intake/i1/approve"],
    ["the price of a reading", (api) => api.preflight("intake", { talks: "x" }), "api/intake/preflight"],
    ["the price of a run", (api) => api.preflight("task", {}), "api/tasks/preflight"],
    ["the price of a pair", (api) => api.preflight("arena", {}), "api/arena/preflight"],
    ["a run", (api) => api.launchTask({}), "api/tasks"],
    ["a pair", (api) => api.launchArena({}), "api/arena"],
  ];

  for (const [what, call, path] of calls) {
    it(`says it is JSON when it posts ${what}, to ${path}`, async () => {
      const { api, seen } = serving(() => ({ status: 422, body: { error: "no" } }));
      await call(api);
      expect(seen).toHaveLength(1);
      expect(seen[0].path).toBe(path);
      expect(seen[0].init?.method).toBe("POST");
      expect(headersOf(seen[0])["Content-Type"]).toBe("application/json");
      // and the body is JSON, even when there is nothing to say: the server refuses anything else with a 415
      expect(() => JSON.parse(seen[0].init?.body as string)).not.toThrow();
    });
  }

  it("sends an unedited approval as an empty body, which the server reads as 'approve as read'", async () => {
    const { api, seen } = serving(() => ({ body: fixture("approve.edited.json") }));
    await api.approve("i1", null);
    expect(seen[0].init?.body).toBe("{}");
  });

  it("sends an edited reading as `proposal`, with the fields the server knows", async () => {
    const { api, seen } = serving(() => ({ body: fixture("approve.edited.json") }));
    await api.approve("i1", museReading());
    expect(JSON.parse(seen[0].init?.body as string)).toEqual({ proposal: fixture("intake.proposed.json").proposal });
  });

  it("reads with a plain GET, and escapes an id into the path", async () => {
    const { api, seen } = serving(() => ({ body: fixture("intake.proposed.json") }));
    await api.intake("a b/c");
    expect(seen[0]).toEqual({ path: "api/intake/a%20b%2Fc", init: undefined });
    await api.sample(3);
    expect(seen[1].path).toBe("api/intake/sample?seed=3");
  });
});

describe("what the page makes of each answer", () => {
  it("reads the sample the server offers", () => {
    const sample = readSample(fixture("sample.json"));
    if (!sample.ok) throw new Error(sample.reason);
    expect(sample.value.talks).toContain("Submission 1");
    // the sample names no rooms: the server then uses its default four
    expect(sample.value.rooms).toEqual([]);
  });

  it("reads the start of a reading", () => {
    expect(readStarted(fixture("intake.started.json"))).toEqual({ ok: true, value: expect.objectContaining({ intake_id: expect.stringMatching(/^intake-/), billed: false }) });
  });

  it("reads a reading that is proposed: the proposal, the text as kept, and what the scan found in each box", () => {
    const read = readIntakeState(fixture("intake.proposed.json"));
    if (!read.ok) throw new Error(read.reason);
    expect(read.value).toMatchObject({ state: "proposed", refused: null, failed: null, approved: null });
    expect(read.value.proposal?.talks).toHaveLength(12);
    expect(Object.keys(read.value.texts).sort()).toEqual(["conference", "notes", "talks"]);
    expect(read.value.scans.map((scan) => [scan.source_id, scan.decision, scan.findings])).toEqual([
      ["conference", "allow", []],
      ["talks", "allow", ["email"]],
      ["notes", "allow", ["email"]],
    ]);
  });

  it("reads an approved reading with the edits it was approved with", () => {
    const read = readIntakeState(fixture("intake.approved.json"));
    if (!read.ok) throw new Error(read.reason);
    expect(read.value.state).toBe("approved");
    expect(read.value.approved).toMatchObject({ edits: ["speakers[S02].preference", "talks[T01].attendance"], truth_mode: "approved", names_pseudonymized: false });
  });

  it("reads a refusal by the firewall: which box, why, and no proposal", () => {
    const read = readIntakeState(fixture("intake.refused.json"));
    if (!read.ok) throw new Error(read.reason);
    expect(read.value).toMatchObject({ state: "refused", proposal: null, refused: { segments: ["notes"], reason: expect.stringContaining("prompt-injection") } });
  });

  it("reads an approval and the launches", () => {
    expect(readApproval(fixture("approve.mixed.json"))).toEqual({
      ok: true,
      value: expect.objectContaining({ edits: expect.arrayContaining(["talks[T13] added", "talks[T05] removed"]), warnings: ["Quinn Tanaka has no talk in the program: left out"] }),
    });
    // the launch bodies as W2's notes give them (a launch starts subprocesses, so none was captured)
    expect(readTaskLaunch({ job_id: "job-1", run_id: "ui-1", run_ids: ["ui-1"], state: "starting", private: true, warnings: [], job: {} })).toEqual({ ok: true, value: { job_id: "job-1", run_id: "ui-1", warnings: [] } });
    expect(readArenaLaunch({ pair_id: "p1", job_id: "job-2", left: "p1-swarm", right: "p1-durable-max", state: "starting", private: true, billed: false, warnings: ["the CPU is at 90%"] })).toEqual({
      ok: true,
      value: { pair_id: "p1", job_id: "job-2", left: "p1-swarm", right: "p1-durable-max", warnings: ["the CPU is at 90%"] },
    });
  });

  it("refuses a state it does not know, and a reading whose proposal it cannot read, naming the field", () => {
    const unknown = readIntakeState({ ...fixture("intake.proposed.json"), state: "paused" });
    expect(unknown).toEqual({ ok: false, reason: expect.stringContaining("intake.state: expected one of reading, proposed") });
    const body = fixture("intake.proposed.json");
    body.proposal.talks[1].attendance = "many";
    expect(readIntakeState(body)).toEqual({ ok: false, reason: expect.stringContaining("intake.proposal.talks[1].attendance") });
  });
});

describe("when a call goes wrong", () => {
  it("says what the server said: its error, as it words it", async () => {
    for (const name of ["error.empty-talks.json", "error.unknown-intake.json", "error.already-approved.json"]) {
      const { status, body } = fixture(name);
      const { api } = serving(() => ({ status, body }));
      const outcome = await api.intake("x");
      expect(outcome).toEqual({ ok: false, status, error: body.error });
    }
  });

  it("falls back to FastAPI's detail, a list of them, and then the status", () => {
    expect(errorOf(422, { detail: "no spec" })).toBe("no spec");
    expect(errorOf(422, { detail: [{ msg: "a" }, { msg: "b" }, {}] })).toBe("a; b");
    expect(errorOf(500, null)).toBe("the server answered 500");
    expect(errorOf(500, { error: "" })).toBe("the server answered 500");
  });

  it("does not throw when the server cannot be reached: it says so", async () => {
    const api = createIntakeApi(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await api.sample()).toEqual({ ok: false, status: 0, error: "could not reach the server: Failed to fetch" });
  });

  it("refuses an answer it cannot read, with the field, rather than showing half of it", async () => {
    const { api } = serving(() => ({ body: { ...fixture("intake.proposed.json"), state: "paused" } }));
    const outcome = await api.intake("x");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("the server's answer could not be read: intake.state");
  });

  it("does not throw on an answer that is not JSON", async () => {
    const api = createIntakeApi(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await api.intake("x")).toEqual({ ok: false, status: 502, error: "the server answered 502" });
  });
});
