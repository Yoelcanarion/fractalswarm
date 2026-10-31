// Every sentence of the home page that is not a claim row, in one place, so that it can be read, sharpened and
// checked as text. Claims are never typed here: they come from docs/claims.md through the data file (parts/Claim).
// Numbers are never typed here either: a sentence that needs one takes it from the data (`facts`).
//
// The page is short on purpose (Yoel, Oct 30): a title and one sentence to a section, about 200 words in all with every
// "See more" closed, and the nuance folded. `words.test.ts` holds that number; a sentence added here has to pay for itself.
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
  title: `FractalSwarm · ${TAGLINE}`,
  description:
    "Kill half the brains. It still finishes. FractalSwarm is a multi-agent runtime on Muse Spark and Muse Wonder. Kill a coordinator yourself, watch the rest take over, then step into the app.",

  bar: { brand: "FractalSwarm", enter: "Enter the app", enterShort: "App", skip: "Skip to the story", home: "Back to the home page" },

  seeMore: "See more",
  repeat: "Repeat",

  // R5 has two bases for the extra cost, so a figure says which one it is: the pre-registered one estimates the cost of cancelled calls.
  labels: { stalled: "stalled", extraCost: "extra cost", extraCostBasis: "extra cost, pre-registered basis" },

  // Said next to every number that is set against the in-process supervisor (R5): the gap is mostly a property of that design.
  rivalReason: "In-process: its agents die with it. That design explains most of the gap.",
  // What the other rival's name means, and what a tie with it is worth (R2). The detection is the condition: the rival that restarts sooner beats the swarm (R3).
  durableReason: "Ideal durable: its agents survive; it restarts on detection. The tie comes with no central coordinator.",

  hero: {
    kicker: "Built on Meta’s Muse Spark and Muse Wonder",
    line: "AI agents plan a conference, led by a tree of small coordinators. Any of them can die, and the rest take over its work.",
    kill: "Kill one yourself",
    object: "The real tree of a recorded run: a root, its tracks and sessions, and their agents. Coordinators are killed one after another, and it heals.",
  },

  problem: {
    title: "A team that depends on one coordinator.",
    line: "In the simplest setup its agents die with it, and interrupted work is paid for twice.",
    key: "Rows: agents · Bars: model calls",
    film: "Work lanes of a real run of an in-process supervisor: one lane per agent, one bar per model call, on a shared clock. The coordinator crashes, the work waits, and the calls it had already made are made again.",
    more: {
      film: "The film:",
      example: (f: Facts) =>
        `The job: plan a conference from messy emails. ${f.talks ?? "—"} talks, ${word(f.tracks)} tracks, ${word(f.days)} ${plural(f.days, "day")}. A team of AI agents reads the emails and places the talks.`,
      numbers: "That is what it cost, in real runs.",
      rival: "In-process supervisor",
      swarm: "FractalSwarm",
      // the swarm's side of it is claim S3, drawn under the diagram: it is not retyped here
      better: "A better supervisor fixes the paying twice: its workers survive, and a standby takes over.",
    },
    parts: { supervisor: "Supervisor", standby: "Standby", watcher: "Watcher", workers: "Workers" },
  },

  solution: {
    title: "A tree of small coordinators.",
    line: "When one dies, each survivor reads the log and works out the same heir, so nobody votes.",
    cards: {
      log: { title: "One shared log", drawing: "Each new event is added to the log and carries the hash of the one before it." },
      // S1's words: the drawing says no more than the claim does
      heir: { title: "Everyone finds the same heir", drawing: "Every survivor computes the same heir from the log with one rule (HRW), so there is no election." },
      adopt: { title: "The heir takes over", drawing: "The heir adopts the dead coordinator's work, and its subtree is wired to the heir." },
    },
    demo: { title: "Kill one yourself", label: "An illustration, not a real run." },
    more: {
      terms: "The terms of the design, in the words of docs/claims.md.",
      limit: "The log is a central component. The swarm removes the coordinator as a single point of decision, not every single point of failure.",
    },
  },

  proof: {
    title: "What the real runs show.",
    bars: "Time stalled and extra cost when five of ten coordinators crash: the swarm against an in-process supervisor and against an ideal durable one.",
    conditions: "Conditions and limits",
    check: "Check it:",
    more: {
      lead: "The rest of the evidence is on its own page: the models, the fair fight, the charts, where it ties and where it does worse.",
      link: "Open the evidence",
      proves: "Replay proves that this code produces the recorded run from the recorded model outputs. It does not prove where those outputs came from.",
      recompute: "Recompute a log's hashes in your browser, and change a digit to watch it break",
      terminal: "The output of the commands, from the recorded demo run.",
      provenance: "Every number on this page comes from a committed result or a recorded run. Every claim is a row of docs/claims.md.",
    },
  },

  enter: {
    title: "Pick a door.",
    line: "Watch recorded runs, or break one.",
    closed: "Needs the local server",
  },

  footer: "Meta Global AI Developer Hackathon",

  // ---- the evidence page (#/evidence): a plain document, only the figure of its head moves ----

  evidencePage: {
    title: "The evidence",
    lede: "Everything the home page leaves out, with the settings and the limits. Every number is read from a committed result or a recorded run.",
    back: "Back to the story",
    figure: "The recorded run's event log going by, each event chained to the one before it, and the replay matching its head hash.",
  },

  models: {
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
      { id: "wonder", name: "Muse Wonder", does: "Writes the plan every run starts from." },
      { id: "guard", name: "Llama PromptGuard 2", does: "In the recorded demo runs, it screened the inputs before any model read them." },
    ],
    tokens: "Tokens by model, in the recorded demo run.",
    coordination: "coordination tokens",
    recovery: "recovery tokens",
  },

  evidence: {
    title: "What the runs show, and what they do not.",
    fair: {
      lead: "We built the strongest rival we could implement fairly.",
      why: "The rival is an ideal durable supervisor. These are the terms we granted it.",
      columns: { what: "What we grant it", value: "Value", why: "Why" },
      // the first terms are shown; the control opens the rest, and says how many there are
      showAll: (count: number) => `Show all ${count} terms`,
      showFewer: "Show fewer terms",
    },
    hero: { lead: "Waiting and extra cost, as coordinators die." },
    tie: {
      word: "Tie.",
      note: "Stall time and extra cost, one dot per seed, against an ideal durable supervisor.",
      // why two means that differ are a tie: bench/PREREG.md §3, and the seeds of H2 and of the stall disagree (R2's evidence)
      rule: "The means differ, but a win needs every seed to agree by a minimum effect, a rule fixed before the runs, and these seeds disagree. Extra cost is on the pre-registered basis, which estimates the cost of cancelled calls.",
      terms: "Locality: how much of the team a crash holds up. Coordinator-dependency time: waiting on a coordinator that was down, added up over the work that waited.",
      worse: "Where it does worse",
    },
    helps: {
      lead: "Locality ties too.",
      // `crashes` is read from the data ("three and five"), so the sentence follows the pre-registered profiles.
      gate: (crashes: string) => `With the fake model (the practice model in the app), at our pre-registered gate, this measure tied at ${crashes} crashes.`,
      cost: "One loss: its failure detector declared live coordinators dead on these runs.",
      perRun: "false deaths per run",
      realistic: "Two wins against a realistic durable supervisor.",
    },
    fails: {
      lead: "Where it does worse.",
      wins: "Here the supervisor wins.",
      fast: "A fast external restart",
      times: "×",
      falseDeaths: "False deaths",
      perProcess: "Per process",
      log: "The log as a central component",
      // only the titles: what these two say is the reason their rows give in docs/claims.md (`limits` in numbers.ts)
      deaths: "Not every set of deaths",
      trackLead: "A track lead's death, on the real model",
    },
    proof: {
      lead: "You do not have to trust us.",
      finished: "The recorded run that the home page replays.",
    },
    finish: { placed: "talks placed", violations: "hard violations", duplicates: "duplicate calls", cost: "cost" },
  },
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
