// What is wrong with the reading as it stands, before the person approves it. The server has the last word (it
// fits the proposal to the program again and refuses what it cannot fit), so this blocks only on what it would
// refuse too, and says the rest as advice: it moves a talk between tracks and tells the person when a track is short.

import type { Proposal } from "./proposal";

/** The program's shape, as intake/shape.py has it; validate.test.ts holds these numbers to that file. */
export const LIMITS = { minTalks: 8, maxTalks: 15, tracks: 3, minPerTrack: 2 } as const;

export interface Issue {
  /** `error` stops the approval, `advice` does not. */
  severity: "error" | "advice";
  /** What it is about: `talks[T03]`, `speakers[S02]`, `program`. */
  where: string;
  message: string;
}

const named = (title: string): string => (title.trim() === "" ? "a talk with no title" : `“${title.trim()}”`);

export function checkProposal(p: Proposal): Issue[] {
  const issues: Issue[] = [];
  // the server leaves a talk with no title out, so it does not count
  const talks = p.talks.filter((talk) => talk.title.trim() !== "");
  for (const talk of p.talks) {
    if (talk.title.trim() === "") issues.push({ severity: "advice", where: `talks[${talk.id}]`, message: `${talk.id} has no title: it is left out` });
  }
  if (talks.length < LIMITS.minTalks) {
    issues.push({ severity: "error", where: "program", message: `the program needs at least ${LIMITS.minTalks} talks; this has ${talks.length}` });
  } else if (talks.length > LIMITS.maxTalks) {
    issues.push({ severity: "advice", where: "program", message: `the program takes ${LIMITS.maxTalks} talks: the first ${LIMITS.maxTalks} are kept and the rest left out` });
  }
  const speakers = new Set(p.speakers.map((speaker) => speaker.id));
  const tracks = new Set(p.tracks.map((track) => track.id));
  for (const talk of talks) {
    if (!speakers.has(talk.speaker_id)) issues.push({ severity: "error", where: `talks[${talk.id}]`, message: `${named(talk.title)} has no speaker: give it one` });
    if (!tracks.has(talk.track_id)) issues.push({ severity: "error", where: `talks[${talk.id}]`, message: `${named(talk.title)} has no track: give it one` });
  }
  const speaking = new Set(talks.map((talk) => talk.speaker_id));
  for (const speaker of p.speakers) {
    if (speaker.name.trim() === "") issues.push({ severity: "error", where: `speakers[${speaker.id}]`, message: `${speaker.id} has no name` });
    // as the server words it when it drops them: a speaker with no talk is not in the program
    else if (!speaking.has(speaker.id)) issues.push({ severity: "advice", where: `speakers[${speaker.id}]`, message: `${speaker.name} has no talk in the program: left out` });
  }
  for (const track of p.tracks) {
    const size = talks.filter((talk) => talk.track_id === track.id).length;
    if (size < LIMITS.minPerTrack) {
      issues.push({ severity: "advice", where: `tracks[${track.id}]`, message: `${track.name} has ${size === 0 ? "no talk" : "1 talk"}: the program wants ${LIMITS.minPerTrack} a track, so the server moves a talk to it and says so, or refuses` });
    }
  }
  return issues;
}

/** True when nothing stops the person from approving. */
export const canApprove = (issues: Issue[]): boolean => issues.every((issue) => issue.severity !== "error");
