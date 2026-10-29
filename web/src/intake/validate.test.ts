// What stops an approval on the page, and what is only advice.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../lib/testing";
import { addSpeaker, patchTalk, removeTalk } from "./edit";
import { fixture, museReading } from "./testing";
import { canApprove, checkProposal, LIMITS } from "./validate";

const messages = (issues: ReturnType<typeof checkProposal>, severity: "error" | "advice") => issues.filter((issue) => issue.severity === severity).map((issue) => issue.message);

describe("the program's limits", () => {
  const shape = readFileSync(REPO_ROOT + "src/fractalswarm/intake/shape.py", "utf-8");
  const constant = (name: string) => Number(new RegExp(`^${name} = (\\d+)`, "m").exec(shape)?.[1]);

  it("are the server's own: this page mirrors intake/shape.py and fails when that changes", () => {
    expect(LIMITS).toEqual({ minTalks: constant("MIN_TALKS"), maxTalks: constant("MAX_TALKS"), tracks: constant("TRACK_COUNT"), minPerTrack: constant("MIN_PER_TRACK") });
  });
});

describe("checking a reading", () => {
  const muse = museReading();

  it("finds nothing wrong with Muse's reading of the sample", () => {
    expect(checkProposal(muse)).toEqual([]);
    expect(canApprove(checkProposal(muse))).toBe(true);
  });

  it("stops at fewer talks than the program needs", () => {
    let few = muse;
    for (const talk of muse.talks.slice(0, 5)) few = removeTalk(few, talk.id);
    const issues = checkProposal(few);
    expect(messages(issues, "error")).toEqual([`the program needs at least ${LIMITS.minTalks} talks; this has 7`]);
    expect(canApprove(issues)).toBe(false);
  });

  it("does not count a talk with no title: the server leaves it out", () => {
    let blank = muse;
    for (const talk of muse.talks.slice(0, 5)) blank = patchTalk(blank, talk.id, { title: "  " });
    const issues = checkProposal(blank);
    expect(messages(issues, "error")[0]).toContain("this has 7");
    expect(messages(issues, "advice").filter((m) => m.includes("has no title: it is left out"))).toHaveLength(5);
    // four blank titles still leave eight: enough
    let four = muse;
    for (const talk of muse.talks.slice(0, 4)) four = patchTalk(four, talk.id, { title: "" });
    expect(messages(checkProposal(four), "error")).toEqual([]);
  });

  it("stops at a talk with no speaker or no track, and names the talk", () => {
    const issues = checkProposal(patchTalk(patchTalk(muse, "T02", { speaker_id: "S99" }), "T03", { track_id: "" }));
    expect(messages(issues, "error")).toEqual([expect.stringMatching(/“.+” has no speaker: give it one/), expect.stringMatching(/“.+” has no track: give it one/)]);
  });

  it("stops at a speaker with no name, which would give the checker nobody to name", () => {
    expect(messages(checkProposal(addSpeaker(muse, muse)), "error")).toEqual(["S10 has no name"]);
  });

  it("says a speaker with no talk left is out of the program, as the server words it when it drops them", () => {
    // the talk the mixed edits of the real approval removed was the only one its speaker had
    const issues = checkProposal(removeTalk(muse, "T05"));
    expect(messages(issues, "error")).toEqual([]);
    expect(fixture("approve.mixed.json").warnings).toEqual(messages(issues, "advice").filter((m) => m.endsWith("has no talk in the program: left out")));
  });

  it("only advises about a short track: the server moves a talk and says so, it does not refuse", () => {
    const first = muse.tracks[0].id;
    let short = muse;
    for (const talk of muse.talks.filter((t) => t.track_id === first).slice(1)) short = patchTalk(short, talk.id, { track_id: muse.tracks[1].id });
    const issues = checkProposal(short);
    expect(messages(issues, "error")).toEqual([]);
    expect(messages(issues, "advice")).toEqual([expect.stringContaining("has 1 talk")]);
    expect(canApprove(issues)).toBe(true);
  });

  it("only advises about more talks than the program takes", () => {
    let many = muse;
    for (let i = 0; i < 4; i++) {
      many = { ...many, talks: [...many.talks, { ...muse.talks[0], id: `T${20 + i}`, title: `Extra ${i}` }] };
    }
    const issues = checkProposal(many);
    expect(messages(issues, "advice")).toEqual([`the program takes ${LIMITS.maxTalks} talks: the first ${LIMITS.maxTalks} are kept and the rest left out`]);
    expect(canApprove(issues)).toBe(true);
  });
});
