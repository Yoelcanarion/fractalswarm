// Every sentence of the home page that is not a claim row, in one place, so that it can be read, sharpened and
// checked as text. Claims are never typed here: they come from docs/claims.md through the data file (parts/Claim).
// Numbers are never typed here either: a sentence that needs one takes it from the data (`facts`).
//
// Rules the guard test holds this file to: no "simpler", "cheaper", "more reliable", "first", and not the old
// tagline's second half.

export const TAGLINE = "Kill half the brains. It still finishes.";

export interface Facts {
  talks: number | null;
  tracks: number | null;
  days: number | null;
  sessions: number | null;
  orchestrators: number | null;
  agents: number | null;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** `3` is "three"; anything the list does not cover stays a digit, and a missing number is a dash. */
export const word = (n: number | null | undefined): string =>
  typeof n !== "number" || !Number.isFinite(n) ? "—" : Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n);

const plural = (n: number | null | undefined, one: string, many: string = `${one}s`): string => (n === 1 ? one : many);

export const COPY = {
  title: "FractalSwarm: kill half the brains, it still finishes",
  description:
    "Kill half the brains. It still finishes. FractalSwarm is a multi-agent runtime on Muse Spark and Muse Wonder. Scroll through the problem, the design and the evidence, then step into the simulation.",

  bar: { brand: "FractalSwarm", enter: "Enter the simulation", skip: "Skip to the story", rail: "Chapters" },

  labels: { stalled: "stalled", extraCost: "extra cost" },

  // Said next to every number that is set against the in-process supervisor (R5): the gap is mostly a property of that design.
  rivalReason: "In-process: its workers die with it, so most of the gap comes from that design.",

  hero: {
    kicker: "FractalSwarm · multi-agent runtime on Muse Spark and Muse Wonder",
    conditions: "Where this holds, and where it does not",
    how: "See how it works",
    enter: "Enter the simulation",
    object: "The real tree of a recorded run: a root, its tracks and sessions, and their agents. Coordinators are killed one after another, and it heals.",
  },

  problem: {
    eyebrow: "The problem",
    title: "A team that depends on one coordinator.",
    example: (f: Facts) =>
      `Take a real job: plan a conference from messy emails. ${f.talks ?? "—"} talks, ${word(f.tracks)} tracks, ${word(f.days)} ${plural(f.days, "day")}. A team of AI agents reads the emails and places the talks.`,
    visual: "Work lanes of a real run of an in-process supervisor: one lane per agent, one bar per model call, on a shared clock.",
    steps: {
      team: { lead: "A team of AI agents usually has one coordinator.", more: "It plans, assigns and checks the work." },
      crash: { lead: "Then it crashes.", more: "The work waits." },
      twice: {
        lead: "In the usual setup, the workers run inside the coordinator, so they die with it.",
        more: "Their calls were already paid for. Now they are paid for again.",
      },
      numbers: { lead: "That is what it cost, in a real run.", rival: "In-process supervisor", swarm: "FractalSwarm" },
      better: {
        lead: "A better supervisor fixes the paying twice: its workers survive, and a standby takes over.",
        more: "But then you run a supervisor, a standby and something to watch them. Even an ideal one has to stop to recover.",
      },
    },
    parts: { supervisor: "Supervisor", standby: "Standby", watcher: "Watcher", workers: "Workers" },
    waiting: "the work is waiting",
    question: "Can a team recover without one?",
  },

  solution: {
    eyebrow: "The solution",
    title: "A tree of small coordinators.",
    lede: (f: Facts) =>
      `${word(f.orchestrators)} coordinators, called brains here, each lead a few agents. Any of them can die, the root included.`,
    visual: "The real tree of a recorded run: the root, its tracks and sessions, and the agents. Brains die one by one, and the survivors take over.",
    steps: {
      tree: { lead: "Replace the one coordinator with a tree of small ones.", more: "A brain is a coordinator. An agent is a worker." },
      log: {
        more: "Every event in the log carries the hash of the one before it.",
        limit: "The log is a central component. The swarm removes the coordinator as a single point of decision, not every single point of failure.",
      },
      kill: { lead: "Kill the root.", more: "Its heartbeats stop. The others count the seconds until they agree it is dead." },
      heir: { more: "Each survivor works it out alone. No arrows between the panels: nothing was sent." },
      adopt: { lead: "The heir adopts the work, and every result already in the log.", more: "Its subtree re-wires to the heir." },
      again: { lead: "Again.", more: "A session, a track, another session, another track. The root moves from one brain to the next." },
      done: { lead: "It still finishes." },
    },
    finish: { placed: "talks placed", violations: "hard violations", duplicates: "duplicate calls", cost: "cost" },
  },

  models: {
    eyebrow: "Why Meta’s models matter",
    title: "The hard part of this task is reading people.",
    email: "A message from a speaker, as it arrived.",
    constraints: "What Muse Spark read in it. Each constraint points at the sentence it came from.",
    noExtraction: "A real extraction from a recorded run goes here.",
    ablation: {
      lead: "Is the model really doing the work?",
      more: "The same notes, a hand-written parser against Muse Spark.",
      parser: "hand-written parser",
      muse: "Muse Spark",
      of: "of",
    },
    muse: { lead: "Muse does the understanding." },
    roles: [
      { id: "spark", name: "Muse Spark", does: "Reads the emails, places the talks and checks the results." },
      { id: "wonder", name: "Muse Wonder", does: "Plans the work and settles disagreements." },
      { id: "guard", name: "Llama PromptGuard 2", does: "Guards the inputs before any model reads them." },
    ],
    tokens: "Tokens by model, in the recorded demo run.",
    coordination: "coordination tokens",
    recovery: "recovery tokens",
  },

  evidence: {
    eyebrow: "The evidence",
    title: "What the runs show, and what they do not.",
    fair: {
      lead: "We built the strongest rival we could, and gave it every advantage.",
      why: "The rival is an ideal durable supervisor. These are the terms we granted it.",
      columns: { what: "What we grant it", value: "Value" },
    },
    hero: { lead: "Waiting and extra cost, as coordinators die." },
    tie: { word: "Tie.", note: "Stall time and extra cost, one dot per seed, against an ideal durable supervisor." },
    helps: { lead: "Where it helps.", gate: "At the $0 gate, locality ties against durable-max (T2, C2 and C3)." },
    fails: {
      lead: "Where it does not.",
      wins: "Here the supervisor wins.",
      fast: "A fast external restart",
      times: "×",
      falseDeaths: "False deaths",
      perProcess: "Per process",
      log: "The log as a central component",
    },
    proof: {
      lead: "You do not have to trust us.",
      command: "uv run fractalswarm demo --verify",
      terminal: "The output of the command, from the recorded demo run.",
      proves: "Replay proves that this code produces the recorded run from the recorded model outputs. It does not prove where those outputs came from.",
    },
  },

  enter: {
    eyebrow: "Enter the simulation",
    title: "Pick a door.",
    lede: "Everything above is a recorded run. Behind these doors you can watch more of them, or break one yourself.",
    closed: "Needs the local server",
  },

  footer: "Every number on this page comes from a committed result or a recorded run. Every claim is a row of docs/claims.md.",
} as const;

/** The sentences the guard test scans: everything in COPY, flattened. */
export function allCopy(): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      // with no data: a sentence that needs a number takes it from the story, and shows a dash without one
      out.push((value as (facts: Facts) => string)({ talks: null, tracks: null, days: null, sessions: null, orchestrators: null, agents: null }));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(COPY);
  return out;
}
