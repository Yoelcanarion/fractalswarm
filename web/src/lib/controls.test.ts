import { describe, expect, it } from "vitest";

import { asRunStatus, controlState, DEFAULT_CAPABILITIES, LIVE_ONLY, parseCapabilities, siteOf, statusBadge, type Capabilities } from "./controls";

const everything: Capabilities = { chaos: true, approve: true, tasks: true, budget: true, halt: true };

describe("which controls can be used", () => {
  it("disables every action on a recording, whatever the server offers", () => {
    for (const status of ["completed", "halted", "interrupted", "empty", null] as const) {
      for (const control of ["chaos", "approve", "budget", "halt"] as const) {
        expect(controlState(control, { status, capabilities: everything })).toEqual({ enabled: false, reason: LIVE_ONLY });
      }
    }
  });

  it("enables an action on a live run when the server offers it", () => {
    for (const control of ["chaos", "approve", "budget", "halt"] as const) {
      expect(controlState(control, { status: "running", capabilities: everything })).toEqual({ enabled: true, reason: "" });
    }
  });

  it("keeps chaos, approve and new task off on a server that has not wired them", () => {
    expect(controlState("chaos", { status: "running", capabilities: DEFAULT_CAPABILITIES })).toEqual({
      enabled: false,
      reason: "this server does not offer it yet",
    });
    expect(controlState("approve", { status: "running", capabilities: DEFAULT_CAPABILITIES }).enabled).toBe(false);
    expect(controlState("tasks", { status: null, capabilities: DEFAULT_CAPABILITIES })).toEqual({
      enabled: false,
      reason: "this server does not start runs from here",
    });
  });

  it("leaves budget and halt on for a live run on a server that predates the capabilities list", () => {
    expect(controlState("budget", { status: "running", capabilities: DEFAULT_CAPABILITIES }).enabled).toBe(true);
    expect(controlState("halt", { status: "running", capabilities: DEFAULT_CAPABILITIES }).enabled).toBe(true);
  });

  it("starts a new task without needing a live run", () => {
    expect(controlState("tasks", { status: "completed", capabilities: everything }).enabled).toBe(true);
    expect(controlState("tasks", { status: null, capabilities: everything }).enabled).toBe(true);
  });
});

describe("on the static showcase, which has no server", () => {
  // what the exporter writes (scripts/build_static_site.py): every control off, and `static`
  const showcase: Capabilities = { chaos: false, approve: false, tasks: false, budget: false, halt: false, real: false, static: true };

  it("is read from the capabilities the site answers, only as a yes, and a server never sends it", () => {
    expect(parseCapabilities({ ...showcase })).toEqual(showcase);
    expect(siteOf(parseCapabilities({ ...showcase }))).toBe("static");
    expect(siteOf(parseCapabilities({ static: "yes" }))).toBe("server");
    expect(siteOf(parseCapabilities({ chaos: true }))).toBe("server");
    expect(siteOf(DEFAULT_CAPABILITIES)).toBe("server");
    expect("static" in parseCapabilities({ chaos: true })).toBe(false);
  });

  it("says that the site shows recorded runs, not that a server does not start them, and how to start one", () => {
    expect(controlState("tasks", { status: null, capabilities: showcase })).toEqual({
      enabled: false,
      reason: "this site shows recorded runs only: to start one, run the app with uv run fractalswarm serve",
    });
    expect(controlState("chaos", { status: "running", capabilities: showcase })).toEqual({ enabled: false, reason: "this site shows recorded runs only" });
  });

  it("still says first that a recording has nothing live to act on", () => {
    for (const control of ["chaos", "approve", "budget", "halt"] as const) {
      expect(controlState(control, { status: "completed", capabilities: showcase })).toEqual({ enabled: false, reason: LIVE_ONLY });
    }
  });
});

describe("reading the capabilities a server sent", () => {
  it("takes what is listed as true, and nothing else", () => {
    expect(parseCapabilities({ chaos: true, approve: false, tasks: true })).toEqual({
      chaos: true,
      approve: false,
      tasks: true,
      budget: false,
      halt: false,
    });
  });

  it("reads the list from `controls` too", () => {
    expect(parseCapabilities({ controls: { chaos: true, budget: true } })).toMatchObject({ chaos: true, budget: true, halt: false });
  });

  it("does not take a truthy value for a yes", () => {
    expect(parseCapabilities({ chaos: "yes", approve: 1, tasks: {} })).toMatchObject({ chaos: false, approve: false, tasks: false });
  });

  it("copes with a body that is not an object", () => {
    for (const body of [null, undefined, 3, "x", []]) {
      expect(parseCapabilities(body)).toEqual({ chaos: false, approve: false, tasks: false, budget: false, halt: false });
    }
  });
});

describe("how a run's status is shown", () => {
  it("names the four states a run can be in", () => {
    expect(statusBadge("running")).toMatchObject({ label: "● LIVE", tone: "live" });
    expect(statusBadge("completed")).toMatchObject({ label: "REPLAY", tone: "muted" });
    expect(statusBadge("halted")).toMatchObject({ label: "HALTED", tone: "warn" });
    expect(statusBadge("interrupted")).toMatchObject({ label: "INTERRUPTED", tone: "bad" });
  });

  it("shows a status it does not know as it came, and a dash before it is known", () => {
    expect(statusBadge("paused").label).toBe("PAUSED");
    expect(statusBadge(null).label).toBe("…");
  });

  it("recognises only real statuses", () => {
    expect(asRunStatus("interrupted")).toBe("interrupted");
    expect(asRunStatus("paused")).toBeNull();
    expect(asRunStatus(undefined)).toBeNull();
  });
});
