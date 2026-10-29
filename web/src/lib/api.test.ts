import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCapabilities, fetchTakeover, verifyRun } from "./api";

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
