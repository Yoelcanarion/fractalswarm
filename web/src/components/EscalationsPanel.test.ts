// What the Escalations panel tells a person about an escalation they may answer, drawn on the server
// (react-dom/server) from the payloads W3 logs (.plans/notes/arena-meta.md, step 4).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { foldEvents } from "../lib/reducer";
import { Stream } from "../lib/testing";
import { EscalationsPanel } from "./EscalationsPanel";

const ID = "arbitration:speaker:S02:availability";

const base = () =>
  new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "swarm", params: {}, clock: "sim" }).at(10_000).emit("escalation.opened", "o0", {
    id: ID,
    goal_id: "track-ai/d1",
    question: "Which reading of S02's availability stands?",
    options: ["A", "B"],
    confidence: 0.4,
    timeout_ms: 60_000,
    default: "B",
  });

const text = (s: Stream): string =>
  renderToStaticMarkup(createElement(EscalationsPanel, { view: foldEvents(s.events) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("the Escalations panel", () => {
  it("asks for a human while the window is open, with the options, the ruling and the time left in virtual time", () => {
    const s = base().at(25_500).emit("msg.sent", "o0", { to: "o1", topic: "later" }); // the log has reached 25.5 s
    const out = text(s);
    expect(out).toContain("needs a human");
    expect(out).toContain("Which reading of S02's availability stands?");
    expect(out).toContain("options A, B (ruled: B)");
    expect(out).toContain("44.5 s left");
  });

  it("keeps asking after an ignored answer, and says why it was ignored", () => {
    const s = base().at(20_000).emit("escalation.answered", "o0", { id: ID, choice: "C", by: "human", accepted: false, overruled: false, reason: "C is not one of the options (A, B)" });
    const out = text(s);
    expect(out).toContain("needs a human");
    expect(out).toContain("ignored answer C");
    expect(out).toContain("C is not one of the options (A, B)");
    expect(out).not.toContain("confirmed");
    expect(out).not.toContain("overruled");
  });

  it("says a person overruled the ruling, and which label they chose over it", () => {
    const out = text(base().at(20_000).emit("escalation.answered", "o0", { id: ID, choice: "A", by: "human", accepted: true, overruled: true, reason: "" }));
    expect(out).toContain("overruled");
    expect(out).toContain("a person chose A over B");
    expect(out).not.toContain("needs a human");
  });

  it("says a person confirmed the ruling", () => {
    const out = text(base().at(20_000).emit("escalation.answered", "o0", { id: ID, choice: "B", by: "human", accepted: true, overruled: false, reason: "" }));
    expect(out).toContain("confirmed");
    expect(out).toContain("a person confirmed B");
  });

  it("stops asking once the log has passed the window: the ruling stands", () => {
    const out = text(base().at(70_001).emit("msg.sent", "o0", { to: "o1", topic: "later" }));
    expect(out).toContain("expired");
    expect(out).toContain("nobody answered in time; B stands");
    expect(out).not.toContain("needs a human");
  });

  it("stops asking when the run ends inside the window", () => {
    const out = text(base().at(40_000).emit("run.completed", "@kernel", { status: "ok" }));
    expect(out).toContain("closed");
    expect(out).toContain("the run ended before anyone answered; B stands");
    expect(out).not.toContain("needs a human");
  });
});
