// The form that starts a run and what a person reads after pressing Start the run: drawn on the server (react-dom/server), no browser.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LaunchResult } from "../lib/api";
import { Launched, NewTaskForm, SpecPreview } from "./NewTaskForm";

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

describe("the form", () => {
  const out = renderToStaticMarkup(createElement(NewTaskForm));
  const plain = out.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

  it("says in words what each field is for, as text on the page and not as a hover hint", () => {
    expect(out).not.toMatch(/ title="/);
    expect(plain).toContain("Coordinators per level");
    expect(plain).toContain("Builds the tree the fanout describes");
    expect(plain).toContain("Seeds the run's randomness");
    expect(plain).toContain("The most the run may spend");
    expect(plain).toContain("Agents per session");
    expect(plain).toContain("poisoned speaker email");
  });

  it("ties every help sentence to its control, so a screen reader reads them together", () => {
    const describedBy = [...out.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(describedBy.length).toBeGreaterThanOrEqual(6);
    for (const id of describedBy) expect(out).toContain(`id="${id}"`);
    const labelled = [...out.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);
    for (const id of labelled) expect(out).toContain(`id="${id}"`);
  });

  it("defines the words it uses instead of citing the spec", () => {
    expect(out).not.toMatch(/spec §/);
    expect(out).not.toContain("bench mode");
    expect(plain).toContain("task spec");
    expect(out).toContain('class="term"');
    expect(plain).toContain("T3");
    expect(plain).toContain("web report");
  });

  it("names the button for what it does", () => {
    expect(plain).toContain("Start the run");
    expect(plain).not.toContain("Submit for planning");
  });

  it("says what the goal is for, and does not shout that it is missing before anyone has typed", () => {
    expect(plain).toContain("The run cannot start without one");
    expect(out).not.toContain("newtask__errors");
    expect(plain).not.toContain("the goal is required");
  });

  it("shows the spec as YAML in a region a keyboard can scroll, with how to run the same file", () => {
    const preview = renderToStaticMarkup(createElement(SpecPreview, { yaml: "goal: x\ntask: t2_conference" }));
    expect(preview).toMatch(/<pre class="newtask__yaml mono" aria-labelledby="([^"]+)" tabindex="0">goal: x\ntask: t2_conference<\/pre>/);
    const id = /aria-labelledby="([^"]+)"/.exec(preview)![1];
    expect(preview).toContain(`id="${id}"`);
    expect(preview).toContain("uv run fractalswarm run task.yaml");
    expect(preview).toContain("--backend real --confirm-real-spend");
  });
});
