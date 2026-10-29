// The edits a person makes in the review table, and what the server then says they changed.

import { describe, expect, it } from "vitest";

import { addSpeaker, addTalk, gridCells, givenCells, patchSpeaker, patchTalk, patchTrack, removeSpeaker, removeTalk, restoreRow, setConference, talksOf, toggleCell } from "./edit";
import { diffProposal, provenanceOf, removedRows } from "./provenance";
import { fixture, museReading } from "./testing";

describe("the edits", () => {
  it("change one field of one row and leave the reading it came from alone", () => {
    const muse = museReading();
    const edited = patchTalk(muse, "T01", { attendance: 99 });
    expect(edited.talks[0].attendance).toBe(99);
    expect(muse.talks[0].attendance).toBe(33);
    expect(edited.talks.slice(1)).toEqual(muse.talks.slice(1));
  });

  it("take a talk out, and put it back where it stood", () => {
    const muse = museReading();
    const without = removeTalk(muse, "T05");
    expect(without.talks.map((t) => t.id)).not.toContain("T05");
    expect(removedRows(muse, without, "talks").map((t) => t.id)).toEqual(["T05"]);
    const back = restoreRow(without, muse, "talks", "T05");
    expect(back).toEqual(muse);
    // two out, one back: it goes between the neighbours that remain
    const twice = removeTalk(removeTalk(muse, "T03"), "T05");
    expect(restoreRow(twice, muse, "talks", "T05").talks.map((t) => t.id)).toEqual(muse.talks.map((t) => t.id).filter((id) => id !== "T03"));
  });

  it("restore nothing that was not removed", () => {
    const muse = museReading();
    expect(restoreRow(muse, muse, "talks", "T05")).toBe(muse);
    expect(restoreRow(muse, muse, "talks", "T99")).toBe(muse);
  });

  it("keep a speaker who still has talks: removing them would leave the talks without a speaker", () => {
    const muse = museReading();
    expect(talksOf(muse, "S01").length).toBeGreaterThan(0);
    expect(removeSpeaker(muse, "S01")).toBe(muse);
    const free = removeSpeaker({ ...muse, talks: muse.talks.filter((t) => t.speaker_id !== "S01") }, "S01");
    expect(free.speakers.map((s) => s.id)).not.toContain("S01");
  });

  it("add a blank talk with an id no row of the reading has ever had, even one that was removed", () => {
    const muse = museReading();
    const added = addTalk(removeTalk(muse, "T12"), muse);
    expect(added.talks.at(-1)).toMatchObject({ id: "T13", title: "", attendance: null, speaker_id: muse.speakers[0].id, track_id: muse.tracks[0].id });
    const twice = addTalk(added, muse);
    expect(twice.talks.at(-1)?.id).toBe("T14");
    expect(addSpeaker(muse, muse).speakers.at(-1)).toMatchObject({ id: "S10", name: "", available: null, preference: null });
  });
});

describe("availability: a speaker's cells of the 2-day, 9-slot grid", () => {
  const muse = museReading();
  const free = muse.speakers.find((s) => s.available === null);
  if (free === undefined) throw new Error("the sample has a speaker with no constraint");

  it("is every cell when nothing was stated", () => {
    expect(gridCells(muse)).toHaveLength(18);
    expect(givenCells(muse, free)).toHaveLength(18);
  });

  it("takes one cell back, and giving it again is the same as stating nothing", () => {
    const narrowed = toggleCell(muse, free, [2, 8]);
    expect(narrowed.available).toHaveLength(17);
    expect(narrowed.available).not.toContainEqual([2, 8]);
    expect(toggleCell(muse, narrowed, [2, 8]).available).toBeNull();
  });

  it("refuses to take back the last cell: the server reads an empty list as no constraint, the opposite", () => {
    const one = { ...free, available: [[1, 3]] as [number, number][] };
    expect(toggleCell(muse, one, [1, 3])).toBe(one);
  });
});

describe("what the server says the person changed", () => {
  it("is what the page computes: one edit of a talk and one of a speaker, as the server reported them", () => {
    const muse = museReading();
    const preference = muse.speakers.find((s) => s.preference === null)?.id as string;
    const edited = patchSpeaker(patchTalk(muse, "T01", { attendance: 40 }), preference, { preference: "morning" });
    expect(diffProposal(muse, edited)).toEqual(fixture("approve.edited.json").edits);
  });

  it("is what the page computes for a mix of edits: a conference, a track, a speaker's name and cells, a talk added and one removed", () => {
    const { proposal, original } = fixture("approve.mixed.request.json");
    const muse = museReading();
    expect(muse).toEqual(original);
    // the same edits, made with the page's own operations
    let edited = setConference(muse, `${muse.conference} (live)`);
    edited = patchTrack(edited, muse.tracks[0].id, { name: `${muse.tracks[0].name} track` });
    edited = removeTalk(edited, "T05");
    edited = patchTalk(addTalk(edited, muse), "T13", { title: "Panel: what we learned", attendance: 40 });
    edited = patchSpeaker(edited, "S03", { name: "Renamed Speaker" });
    const free = edited.speakers.find((s) => s.available === null);
    if (free === undefined) throw new Error("no speaker without a constraint");
    edited = patchSpeaker(edited, free.id, toggleCell(edited, free, [2, 8]));
    // they build the very proposal the server was sent, and the page's list of changes is the server's
    expect(JSON.parse(JSON.stringify({ ...edited, warnings: [], errors: [] }))).toEqual(JSON.parse(JSON.stringify(proposal)));
    expect(diffProposal(muse, edited)).toEqual(fixture("approve.mixed.json").edits);
  });

  it("is nothing for a reading left as Muse gave it", () => {
    const muse = museReading();
    expect(diffProposal(muse, muse)).toEqual([]);
    expect(diffProposal(muse, JSON.parse(JSON.stringify(muse)))).toEqual([]);
  });
});

describe("where each row comes from", () => {
  const muse = museReading();
  const edited = removeTalk(patchTalk(addTalk(muse, muse), "T13", { title: "New" }), "T02");
  const edit = patchTalk(edited, "T01", { title: "Reworded" });

  it("says Muse for a row left alone, edited with the fields that differ, added for a new one", () => {
    expect(provenanceOf(muse, edit, "talks", "T03")).toEqual({ provenance: "muse", fields: [] });
    expect(provenanceOf(muse, edit, "talks", "T01")).toEqual({ provenance: "edited", fields: ["title"] });
    expect(provenanceOf(muse, edit, "talks", "T13")).toEqual({ provenance: "added", fields: [] });
  });

  it("does not take a value put back for an edit", () => {
    expect(provenanceOf(muse, patchTalk(patchTalk(muse, "T01", { attendance: 5 }), "T01", { attendance: 33 }), "talks", "T01").provenance).toBe("muse");
  });
});
