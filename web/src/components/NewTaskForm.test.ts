// What a person reads after pressing Submit for planning: drawn on the server (react-dom/server), no browser.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LaunchResult } from "../lib/api";
import { Launched } from "./NewTaskForm";

const started = (runId: string): LaunchResult => ({ ok: true, status: 202, detail: `Started run ${runId}.`, runId, jobId: "job-1", warnings: [] });
const refused = (status: number, detail: string): LaunchResult => ({ ok: false, status, detail, runId: null, jobId: null, warnings: [] });
const html = (result: LaunchResult, waits: boolean) => renderToStaticMarkup(createElement(Launched, { result, waits }));

describe("the answer to a launch", () => {
  it("links the run it started, and says the plan is approved on its own", () => {
    const out = html(started("ui-20261029-001228-cc5e"), false);
    expect(out).toContain('href="#/run/ui-20261029-001228-cc5e"');
    expect(out).toContain("Started run");
    expect(out).toContain("approved automatically");
    expect(out).not.toContain("chaos__result--bad");
  });

  it("sends a person to the Plan tab when the plan waits for them", () => {
    const out = html(started("ui-1"), true);
    expect(out).toContain('href="#/run/ui-1/plan"');
    expect(out).toContain("waits for your approval on the Plan tab");
  });

  it("escapes a run id into the link", () => {
    expect(html(started("a b/c"), false)).toContain('href="#/run/a%20b%2Fc"');
  });

  it("shows what the server warned about at launch", () => {
    const out = html({ ...started("ui-1"), warnings: ["the CPU is at 91%: a live-clock run may miss heartbeats"] }, false);
    expect(out).toContain("the CPU is at 91%");
  });

  it("shows the server's reason for a refusal, as an alert", () => {
    const out = html(refused(422, "inputs: give the input: inputs.fixture, inputs.inline or inputs.intake"), false);
    expect(out).toContain('role="alert"');
    expect(out).toContain("chaos__result--bad");
    expect(out).toContain("give the input: inputs.fixture");
    expect(out).not.toContain("Started run");
  });
});
