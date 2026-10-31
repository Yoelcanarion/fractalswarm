// What the person asks for on text they pasted, as the bodies of the two calls that start it: the reading of the text
// (`POST api/intake`) and a run or a pair on the approved reading (`POST api/tasks`, `POST api/arena`).

import { crashesText, rivalLabel } from "../arena/helps/labels";
import type { Room } from "./proposal";
import type { Gate } from "./spend";
import { LIMITS } from "./validate";

// ---- the reading ----

export interface RoomRow {
  name: string;
  /** What the person typed: a whole number when they are done. */
  capacity: string;
}

export interface ReadingForm {
  conference: string;
  talks: string;
  notes: string;
  rooms: RoomRow[];
  /** Replace the speakers' names by "Speaker NN" in what the agents read. */
  names: boolean;
}

export const emptyForm = (): ReadingForm => ({ conference: "", talks: "", notes: "", rooms: [], names: false });

/** The server stops at this many characters a box. */
export const BOX_LIMIT = 200_000;

export type Backend = "fake" | "real";

// The practice reader is a parser and not a model: it reads only blocks in the sample's wording (`SUBMISSION` in intake/fake.py), so a text
// with fewer of them than a program takes can only end in an empty review. Muse reads any wording, and then the form has nothing to say.
const PRACTICE_TALK = /^Title:.+\nSpeaker:.+\nTrack:.+\nAbstract:.+$/gm;

/** How many talks of a text the practice reader can read. */
export const practiceTalks = (text: string): number => text.match(PRACTICE_TALK)?.length ?? 0;

/** The rooms the person filled in, or none (then the server uses its default four); a row half filled in is a mistake to show. */
export function roomsOf(rows: RoomRow[]): { rooms: Pick<Room, "name" | "capacity">[]; problems: string[] } {
  const rooms: Pick<Room, "name" | "capacity">[] = [];
  const problems: string[] = [];
  rows.forEach((row, i) => {
    const name = row.name.trim().replace(/\s+/g, " ");
    const capacity = row.capacity.trim();
    if (name === "" && capacity === "") return;
    if (name === "") problems.push(`room ${i + 1} has a capacity but no name`);
    else if (!/^\d+$/.test(capacity) || Number(capacity) < 1) problems.push(`room ${name} needs a capacity of at least 1`);
    else rooms.push({ name, capacity: Number(capacity) });
  });
  if (rooms.length === 1 && problems.length === 0) problems.push("give at least 2 rooms, or none to use the default rooms");
  return { rooms, problems };
}

/** Why the form cannot be read yet, in the person's terms; empty when it can. */
export function formProblems(form: ReadingForm, backend: Backend = "real"): string[] {
  const problems: string[] = [];
  if (form.talks.trim() === "") problems.push("Paste the talks: titles, speakers, abstracts.");
  else if (backend === "fake" && practiceTalks(form.talks) < LIMITS.minTalks) {
    problems.push(`The practice reader can read ${practiceTalks(form.talks)} of the ${LIMITS.minTalks} talks a program needs. It takes Title, Speaker, Track and Abstract lines, as in the sample text.`);
  }
  for (const [box, label] of [["talks", "talks"], ["notes", "notes"], ["conference", "conference"]] as const) {
    if (form[box].length > BOX_LIMIT) problems.push(`The ${label} box is over ${BOX_LIMIT.toLocaleString("en-US")} characters.`);
  }
  return [...problems, ...roomsOf(form.rooms).problems.map((problem) => problem.charAt(0).toUpperCase() + problem.slice(1) + ".")];
}

/** The body of `POST api/intake` (and of its preflight): what the person gave, and nothing they left empty. */
export function readingBody(form: ReadingForm, backend: Backend): Record<string, unknown> {
  const rooms = roomsOf(form.rooms).rooms;
  return {
    talks: form.talks,
    ...(form.notes.trim() === "" ? {} : { notes: form.notes }),
    ...(form.conference.trim() === "" ? {} : { conference: form.conference.trim() }),
    ...(rooms.length > 0 ? { rooms } : {}),
    names: form.names,
    backend,
  };
}

// ---- the run ----

/** The rivals the arena puts against the swarm; the server also takes single and pipeline, which have no coordinator to lose. */
export const RIVALS = ["durable-max", "durable", "central"] as const;
export type Rival = (typeof RIVALS)[number];

export const RUN_SCENARIOS = ["swarm", ...RIVALS] as const;
export type RunScenario = (typeof RUN_SCENARIOS)[number];

export const RUN_CHAOS = ["C0", "C1", "C2", "C3", "kill-half"] as const;
export const PAIR_CHAOS = ["half-the-brains", "C0", "C1", "C2", "C3"] as const;

export interface Choice {
  mode: "pair" | "run";
  rival: Rival;
  scenario: RunScenario;
  runChaos: (typeof RUN_CHAOS)[number];
  pairChaos: (typeof PAIR_CHAOS)[number];
  clock: "sim" | "live";
  speed: number;
  backend: Backend;
}

/** The arena pair on the default failure plan, on the simulated clock and the fake LLM: the way to try it at $0. */
export const DEFAULT_CHOICE: Choice = { mode: "pair", rival: "durable-max", scenario: "swarm", runChaos: "kill-half", pairChaos: "half-the-brains", clock: "sim", speed: 1, backend: "fake" };

export const GOAL = "Program the live conference";

export const scenarioLabel = (scenario: string): string => (scenario === "swarm" ? "FractalSwarm" : rivalLabel(scenario));

export function chaosLabel(chaos: string): string {
  if (chaos === "half-the-brains") return "Half the brains: the root and the track leads crash, and the supervisor at the same points";
  if (chaos === "kill-half") return "Kill half the brains";
  if (chaos === "C0") return "No failures (C0)";
  const crashes = crashesText(chaos);
  return crashes === null ? chaos : `${chaos}: ${crashes}`;
}

/** The TaskSpec of a run on an approved reading: the same one for both sides of a pair. */
export const specOf = (intakeId: string): Record<string, unknown> => ({ goal: GOAL, task: "t2_conference", inputs: { intake: intakeId }, seed: "1" });

/** The body of `POST api/tasks` or `POST api/arena`, and of the preflight that prices it. */
export function launchBody(intakeId: string, choice: Choice): Record<string, unknown> {
  const clock = { clock: choice.clock, ...(choice.clock === "live" ? { speed: choice.speed } : {}) };
  if (choice.mode === "pair") return { spec: specOf(intakeId), rival: choice.rival, chaos: choice.pairChaos, ...clock, backend: choice.backend };
  return { spec: specOf(intakeId), scenario: choice.scenario, chaos: choice.runChaos, ...clock, backend: choice.backend };
}

/** The same body with the check's token and the word typed: what a billed launch sends. The token is bound to everything else in it. */
export const confirmed = (body: Record<string, unknown>, token: string, word: string): Record<string, unknown> => ({ ...body, preflight_token: token, confirm: word });

/** What a launch sends, decided by the body itself: one that says it is free goes as it is, anything else is billed and goes
 * only through an open gate (a check that still fits, and the word typed), with its token and word. Whatever the page's other
 * state says, a body that is not plainly free never leaves without the word. */
export function requestFor(body: Record<string, unknown>, gate: Gate, typed: string): { send: Record<string, unknown> } | { refused: string } {
  if (body.backend === "fake") return { send: body };
  return gate.launch ? { send: confirmed(body, gate.token, typed) } : { refused: gate.reason };
}

/** The runs a launch started: both sides of a pair, or the one run. */
export const startedRuns = (launch: { left: string; right: string } | { run_id: string }): string[] => ("left" in launch ? [launch.left, launch.right] : [launch.run_id]);

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until every one of the runs is on the server's list, or the tries run out (and says which). The server accepts a launch (202)
 * before its runs are on the list, so a page opened at once on one of them finds none, and stays on that. */
export async function untilRunsListed(
  listed: () => Promise<ReadonlySet<string>>,
  runs: readonly string[],
  { tries = 40, everyMs = 400, sleep = pause }: { tries?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const there = await listed();
    if (runs.every((id) => there.has(id))) return true;
    await sleep(everyMs);
  }
  return false;
}

/** Where the person goes to watch it: the arena for a pair, the run page for one run. */
export const watchHash = (launch: { left: string; right: string } | { run_id: string }): string =>
  "left" in launch ? `#/arena/${encodeURIComponent(launch.left)}/${encodeURIComponent(launch.right)}` : `#/run/${encodeURIComponent(launch.run_id)}`;
