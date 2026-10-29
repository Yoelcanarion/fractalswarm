// What a person sees when they may answer an escalation, and what the server said about the answer (drawn on the server).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Sent } from "../lib/disputes";
import type { HumanEscalation } from "../lib/escalations";
import { AnswerBox, AnswerStatus } from "./AnswerBox";

const ID = "arbitration:speaker:S02:availability";

const item = (over: Partial<HumanEscalation> = {}): HumanEscalation => ({
  id: ID,
  seq: 120,
  ts: 10_000,
  actor: "o0",
  goalId: "track-ai/d1",
  text: "Which reading of S02's availability stands?",
  status: "open",
  options: ["A", "B"],
  fallback: "B",
  deadlineTs: 70_000,
  answers: [],
  ...over,
});

const box = (over: Partial<HumanEscalation>, waiting: boolean): string => renderToStaticMarkup(createElement(AnswerBox, { runId: "r1", item: item(over), waiting }));
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const labels = (html: string): string[] => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);

describe("the answer box", () => {
  it("offers a button per option while the escalation waits, and marks the ruling that stands", () => {
    const html = box({}, true);
    expect(labels(html)).toEqual(["A", "B (ruled)"]);
    expect(html).toContain(`aria-label="Answer ${ID}"`);
    expect(html).not.toContain("disabled");
    expect(text(html)).toContain("Your answer");
  });

  it("marks no ruling when none stands", () => {
    expect(labels(box({ fallback: undefined }, true))).toEqual(["A", "B"]);
  });

  it("says so when there is nothing to choose from", () => {
    const html = box({ options: [] }, true);
    expect(labels(html)).toEqual([]);
    expect(text(html)).toBe("no options to choose from");
  });

  it("draws nothing once the escalation has closed and nothing was sent", () => {
    expect(box({}, false)).toBe("");
  });
});

const sent = (over: Partial<Sent> = {}): Sent => ({ choice: "A", request: { ok: true, status: 200, detail: `answer to ${ID} requested for goal:track-ai/d1` }, verdict: "pending", ...over });
const status = (s: Sent): string => renderToStaticMarkup(createElement(AnswerStatus, { sent: s }));

describe("what the server said about an answer", () => {
  it("shows the request, and that the owner's verdict is being read from the log", () => {
    const html = status(sent());
    expect(html).toContain('role="status"');
    expect(html).not.toContain("chaos__result--bad");
    expect(text(html)).toBe(`A : answer to ${ID} requested for goal:track-ai/d1 · asking the server how the owner took it…`);
  });

  it("shows the owner's verdict once the log has it", () => {
    expect(text(status(sent({ verdict: { kind: "overruled", text: "accepted: A overrules B" } })))).toContain("· accepted: A overrules B");
    expect(text(status(sent({ verdict: { kind: "confirmed", text: "accepted: B confirms B" } })))).toContain("· accepted: B confirms B");
    expect(text(status(sent({ verdict: { kind: "ignored", text: "not accepted: the window closed" } })))).toContain("· not accepted: the window closed");
  });

  it("says when the log showed no verdict in time", () => {
    expect(text(status(sent({ verdict: null })))).toContain("· no verdict in the log yet");
  });

  // The words are the server's own (api/app.py `answer_escalation`, `http_error`).
  it.each([
    [409, "run 'r1' was not launched to take controls: start it from the API"],
    [422, "choice is required: what the person decided"],
    [422, "the escalation id is not valid"],
    [404, `no escalation '${ID}' in run 'r1'`],
  ])("shows the server's reason for a refusal (%i) as it words it, and no verdict", (status_, reason) => {
    const html = status(sent({ request: { ok: false, status: status_, detail: reason }, verdict: null }));
    expect(html).toContain("chaos__result--bad");
    expect(text(html)).toBe(`A : ${reason}`);
  });
});
