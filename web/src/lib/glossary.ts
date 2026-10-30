// What the words of the UI mean, in one or two sentences each, for a reader who has not read the spec.
//
// A definition says what a word is and nothing else: it never compares one system with another, and it never says
// that anything is simpler, cheaper, faster or more reliable. Those sentences are claims, and the only place they
// come from is docs/claims.md. Where a term has a source, it is named next to it.

export interface Entry {
  /** The word as the page shows it. */
  term: string;
  /** What it means. */
  says: string;
}

export const GLOSSARY = {
  // chaos profiles (src/fractalswarm/bench/profiles.py)
  c0: {
    term: "C0",
    says: "No failures. The control run: extra cost and time lost are measured against it.",
  },
  c1: {
    term: "C1",
    says: "One coordinator crash, 10% of the agents killed, 5% API faults and 5% message loss.",
  },
  c2: {
    term: "C2",
    says: "Three coordinator crashes, 30% of the agents killed, 10% API faults, 10% message loss and a network partition.",
  },
  c3: {
    term: "C3",
    says: "Five coordinator crashes, 50% of the agents killed, 20% API faults, 20% message loss and a network partition. The crashes come at 20, 35, 50, 65 and 80% of the contracts dispatched.",
  },
  // tasks (tasks/examples)
  t1: {
    term: "T1",
    says: "The extraction task: read 40 documents about 10 companies and fill in 8 fields for each. When the documents disagree, the newest wins.",
  },
  t2: {
    term: "T2",
    says: "The conference task: place every talk of a two-day conference on a grid of rooms and slots, from the talk submissions and the speakers' emails, without double-booking a room or a speaker.",
  },
  t3: {
    term: "T3",
    says: "The web report: a comparative report in which every finding cites a page fetched in this run, with a quote that is in that page.",
  },
  taskSpec: {
    term: "Task spec",
    says: "The description of one job: its goal, the task, the budget and how large a swarm to build. The YAML shown under the form is the same file that fractalswarm run takes.",
  },
  // metrics (bench/REPORT.md §2)
  stall: {
    term: "Stall time",
    says: "Within the work window, the seconds during which no agent LLM call is in flight anywhere.",
  },
  extraCost: {
    term: "Extra cost",
    says: "(cost with failures − cost without) ÷ cost without, for the same workflow, task and seed.",
  },
  coordinationTokens: {
    term: "Coordination tokens",
    says: "LLM tokens spent on calls made to coordinate: the coordinator, supervisor, router and recovery roles. Planning and judging count as work.",
  },
  blastRadius: {
    term: "Blast radius",
    says: "The share of agents and goals waiting on a dead coordinator, and the idle agent-seconds the crash causes.",
  },
  dependencyTime: {
    term: "Coordinator-dependency time",
    says: "How long ready work cannot proceed because the coordinator that decides it is down.",
  },
  falseDeath: {
    term: "False death",
    says: "A live coordinator declared dead because its heartbeats were dropped or delayed.",
  },
  hardViolations: {
    term: "Hard violations",
    says: "Breaches of the schedule's hard rules: a double-booked room or speaker, a speaker who is not available, a room too small, two talks of one track at the same time. A valid schedule has none.",
  },
  // how the swarm works (spec §5, §7, §8)
  hrw: {
    term: "HRW",
    says: "Highest random weight, or rendezvous hashing. Every survivor scores each goal against each live member and picks the highest, so all of them reach the same heir from the same log, with no vote and no message.",
  },
  takeover: {
    term: "Takeover",
    says: "When an orchestrator is declared dead, the survivors re-own its work by the HRW rule, from the log. Nobody is elected.",
  },
  heartbeat: {
    term: "Heartbeat",
    says: "Each orchestrator tells its peers it is alive every second of virtual time. A peer is suspected after 3 missed beats and declared dead after 5.",
  },
  memberEpoch: {
    term: "Member epoch",
    says: "A counter that goes up each time a member is declared dead. A write from an owner that a newer epoch has replaced is refused.",
  },
  marketEpoch: {
    term: "Market epoch",
    says: "One round of the auction that shares the budget and the request and token rate limits among an orchestrator's children. What a child leaves unused goes back to the pool.",
  },
  breaker: {
    term: "Breaker",
    says: "A circuit breaker. It opens after repeated failures, so calls go to another model or wait. After a pause it lets a probe call through and closes again if the probe succeeds.",
  },
  aimd: {
    term: "AIMD quota",
    says: "A request-rate quota for one model. It starts at 50% of the limit, gains 5 points after a clean epoch and is multiplied by 0.7 after a 429.",
  },
  // reading pasted text (the intake and the ablation)
  muse: {
    term: "Muse",
    says: "Meta's model family. Here it is the reader: it turns messy pasted text into rows (talks, speakers, tracks) that a person checks before anything runs.",
  },
  // runs (the clocks, src/fractalswarm/runs.py)
  playhead: {
    term: "Playhead",
    says: "The marker on the timeline at the bottom of a run page. Every view shows the run as it was at that moment. Drag it, press play, or press an event's number in the Events view to move it.",
  },
  virtualTime: {
    term: "Virtual time",
    says: "The run's own clock. A live clock follows real time at the speed the run was started with; a simulated clock jumps ahead as fast as the machine can go.",
  },
  // the log (docs/claims.md, the rules)
  replay: {
    term: "Replay",
    says: "Rebuilds the run from its recorded log and compares every event's hash with the original. It shows that this code reproduces the recorded run from the recorded model outputs; it does not show where those outputs came from.",
  },
} as const satisfies Record<string, Entry>;

export type TermId = keyof typeof GLOSSARY;

export const defineTerm = (id: TermId): string => GLOSSARY[id].says;

/** The glossary entry of a chaos profile name ("C3"), or null for a name it does not define (a `K-o0` probe). */
export function profileTerm(profile: string | null | undefined): TermId | null {
  const id = (profile ?? "").toLowerCase();
  return id === "c0" || id === "c1" || id === "c2" || id === "c3" ? id : null;
}
