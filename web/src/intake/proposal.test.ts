// The proposal reader, over the real reading of the sample text and over the ways a body can be wrong.

import { describe, expect, it } from "vitest";

import { readProposal } from "./proposal";
import { fixture, museReading } from "./testing";

const raw = () => fixture("intake.proposed.json").proposal;

describe("reading a proposal", () => {
  it("reads the real one, and keeps every field the server sent: nothing is lost on the way back", () => {
    const read = readProposal(raw());
    expect(read.ok).toBe(true);
    // the reading as read equals the reading as sent, field for field: what is approved is what was proposed
    expect(museReading()).toEqual(raw());
    expect(museReading().talks).toHaveLength(12);
    expect(museReading().speakers).toHaveLength(9);
    expect(museReading().tracks).toHaveLength(3);
  });

  it("keeps the fields the server knows and no others, so nothing the page invents is sent back", () => {
    const body = raw();
    body.invented = "x";
    body.talks[0].invented = "y";
    body.speakers[0].invented = "z";
    const read = readProposal(body);
    if (!read.ok) throw new Error(read.reason);
    expect(read.value).not.toHaveProperty("invented");
    expect(read.value.talks[0]).not.toHaveProperty("invented");
    expect(read.value.speakers[0]).not.toHaveProperty("invented");
  });

  it("fills in what the server leaves out the way its own model does, and nothing else", () => {
    const read = readProposal({ tracks: [{ id: "t", name: "T" }], speakers: [{ id: "S01" }], talks: [{ id: "T01", title: "A" }] });
    if (!read.ok) throw new Error(read.reason);
    expect(read.value.talks[0]).toMatchObject({ speaker_id: "", attendance: null, abstract: "" });
    expect(read.value.speakers[0]).toMatchObject({ name: "", available: null, preference: null });
    expect(read.value.warnings).toEqual([]);
  });

  it("refuses a field of the wrong kind, and names it", () => {
    const wrong = (change: (body: ReturnType<typeof raw>) => void, expected: string) => {
      const body = raw();
      change(body);
      const read = readProposal(body);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.reason).toContain(expected);
    };
    wrong((b) => (b.talks[2].attendance = "33"), "proposal.talks[2].attendance: expected a whole number");
    wrong((b) => (b.talks[2].attendance = -1), "proposal.talks[2].attendance: expected a whole number");
    wrong((b) => (b.talks[2].attendance = 3.5), "proposal.talks[2].attendance: expected a whole number");
    wrong((b) => (b.speakers[1].preference = "evening"), "proposal.speakers[1].preference: expected one of morning, afternoon");
    wrong((b) => (b.speakers[0].available = [[1, 0], [2]]), "proposal.speakers[0].available[1]: expected [day, slot]");
    wrong((b) => (b.speakers[0].available = [[1, "0"]]), "proposal.speakers[0].available[0][1]: expected a whole number");
    wrong((b) => delete b.tracks, "proposal.tracks: expected a list");
    wrong((b) => (b.talks[0].id = 7), "proposal.talks[0].id: expected text");
    wrong((b) => (b.warnings = [1]), "proposal.warnings[0]: expected text");
  });

  it("refuses what is not an object", () => {
    for (const body of [null, undefined, 7, "x", []]) expect(readProposal(body).ok).toBe(false);
  });
});
