// The route, the phases a reading goes through, and the words for cells and edits.

import { describe, expect, it } from "vitest";

import { describeCells, editWords, shortHash } from "./format";
import { isWorking, phaseFor, phaseOf, startingReading, stepOf } from "./flow";
import { intakeHash, parseIntakeRoute } from "./route";
import { fixture, museReading, stateOf } from "./testing";

describe("the address", () => {
  it("is the form, or a reading by its id", () => {
    expect(parseIntakeRoute("#/new")).toEqual({ intakeId: null });
    expect(parseIntakeRoute("#/new/")).toEqual({ intakeId: null });
    expect(parseIntakeRoute("#/new/intake-1?x=1")).toEqual({ intakeId: "intake-1" });
    expect(parseIntakeRoute("#/new/a%20b")).toEqual({ intakeId: "a b" });
  });

  it("is not another page's", () => {
    for (const hash of ["", "#/", "#/run/new", "#/arena/a/b", "#/helps", "#/newer"]) expect(parseIntakeRoute(hash), hash).toBeNull();
  });

  it("round-trips an id", () => {
    for (const id of [null, "intake-20261029-161812-8f6e", "odd id/with slash"]) expect(parseIntakeRoute(intakeHash(id))).toEqual({ intakeId: id });
  });
});

describe("the phases of a reading, from the server's state", () => {
  it("is review for a proposal, and approved once approved", () => {
    expect(phaseOf(stateOf("intake.proposed.json")).name).toBe("review");
    expect(phaseOf(stateOf("intake.approved.json")).name).toBe("approved");
  });

  it("is reading while the model works, and also for a state that says proposed but has nothing to review", () => {
    expect(phaseOf({ ...stateOf("intake.proposed.json"), state: "reading", proposal: null }).name).toBe("reading");
    expect(phaseOf({ ...stateOf("intake.proposed.json"), proposal: null }).name).toBe("reading");
  });

  it("says why a reading stopped: the firewall blocked a box, the schema was not met, the process is gone", () => {
    const refused = phaseOf(stateOf("intake.refused.json"));
    expect(refused).toMatchObject({ name: "stopped", headline: "The firewall blocked notes before any model read it." });
    if (refused.name === "stopped") expect(refused.details[0]).toContain("prompt-injection");
    const failed = phaseOf({ ...stateOf("intake.proposed.json"), state: "failed", proposal: null, failed: { errors: ["talks: field required", "x", "y", "z", "w", "v"] } });
    expect(failed).toMatchObject({ name: "stopped" });
    if (failed.name === "stopped") expect(failed.details).toEqual(["talks: field required", "x", "y", "z", "w"]);
    expect(phaseOf({ ...stateOf("intake.proposed.json"), state: "interrupted", proposal: null })).toMatchObject({ name: "stopped", headline: "The reading was interrupted." });
  });

  it("is the form with no reading in the address, and loading until the server has spoken about this one", () => {
    const proposed = stateOf("intake.proposed.json");
    expect(phaseFor(null, null)).toEqual({ name: "form" });
    expect(phaseFor(null, proposed)).toEqual({ name: "form" });
    expect(phaseFor(proposed.intake_id, null)).toEqual({ name: "loading", intakeId: proposed.intake_id });
    // what the server said about another reading is not this one's
    expect(phaseFor("another-intake", proposed)).toEqual({ name: "loading", intakeId: "another-intake" });
    expect(phaseFor(proposed.intake_id, proposed).name).toBe("review");
  });

  it("puts each phase on its step, and asks again only while the reading is going", () => {
    expect(stepOf({ name: "form" })).toBe("Paste");
    expect(stepOf(phaseOf(stateOf("intake.proposed.json")))).toBe("Review");
    expect(stepOf(phaseOf(stateOf("intake.approved.json")))).toBe("Run");
    expect(stepOf(phaseOf(stateOf("intake.refused.json")))).toBe("Read");
    expect(isWorking({ name: "loading", intakeId: "x" })).toBe(true);
    expect(isWorking(phaseOf(stateOf("intake.proposed.json")))).toBe(false);
    expect(isWorking(phaseOf(stateOf("intake.refused.json")))).toBe(false);
  });
});

describe("words", () => {
  const muse = museReading();

  it("describes cells as time ranges per day", () => {
    expect(describeCells(muse, null)).toBe("Any time");
    expect(describeCells(muse, [])).toBe("No cell");
    const first = muse.slots[0];
    const second = muse.slots[1];
    expect(describeCells(muse, [[1, 0], [1, 1]])).toBe(`Day 1 ${first.start}–${second.end}`);
    expect(describeCells(muse, [[1, 0], [1, 2]])).toBe(`Day 1 ${first.start}–${first.end}, ${muse.slots[2].start}–${muse.slots[2].end}`);
    expect(describeCells(muse, muse.slots.map((s): [number, number] => [2, s.index]))).toBe("Day 2 all day");
    expect(describeCells(muse, [[2, 1], [1, 0]])).toBe(`Day 1 ${first.start}–${first.end} · Day 2 ${second.start}–${second.end}`);
  });

  it("describes an availability the sample gave in words a person can check against the email", () => {
    const stated = muse.speakers.find((s) => s.available !== null);
    expect(stated?.available).toBeTruthy();
    expect(describeCells(muse, stated?.available ?? null)).toMatch(/^Day \d (all day|\d\d:\d\d–\d\d:\d\d)/);
  });

  it("puts the server's edits into words", () => {
    expect(fixture("approve.mixed.json").edits.map(editWords)).toEqual([
      "the conference name",
      "track track-human-centered-computing: name",
      "speaker S01: available",
      "speaker S03: name",
      "talk T13 added",
      "talk T05 removed",
    ]);
    expect(editWords("talks[T01].attendance_source")).toBe("talk T01: attendance source");
    expect(editWords("something else")).toBe("something else");
  });

  it("shortens a hash", () => {
    expect(shortHash("08e68651a1ffedcba9876543210")).toBe("08e68651a1ff");
  });
});

describe("the rows a review starts from", () => {
  it("is Muse's reading for a reading that waits for review", () => {
    const state = stateOf("intake.proposed.json");
    const start = startingReading(state);
    expect(start?.working).toBe(start?.original);
    expect(start?.original).toBe(state.proposal);
  });

  it("is the approved version for an approved intake, compared against Muse's, when the server keeps it", () => {
    const state = stateOf("intake.approved.json");
    const approvedReading = { ...museReading(), talks: museReading().talks.slice(0, 3) };
    const start = startingReading({ ...state, approved: { ...state.approved!, proposal: approvedReading } });
    expect(start?.original).toBe(state.proposal);
    expect(start?.working).toBe(approvedReading);
    expect(start?.working).not.toBe(start?.original);
  });

  it("falls back to Muse's reading when an older server does not send the approved one", () => {
    const state = stateOf("intake.approved.json");
    expect(startingReading(state)?.working).toBe(state.proposal);
  });

  it("is nothing while there is no reading", () => {
    expect(startingReading(stateOf("intake.started.json"))).toBeNull();
    expect(startingReading(stateOf("intake.refused.json"))).toBeNull();
  });
});
