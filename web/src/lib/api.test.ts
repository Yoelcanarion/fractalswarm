import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCapabilities, fetchTakeover, postControl, verifyRun } from "./api";

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
