// The plain end of a pair: when both runs have played out, a few words on what each one did, and on what one pair is
// worth. Only counts the logs hold, and the scope in the words of docs/claims.md: a result is stated with its setting
// and never as a general claim, so this says one run of each, on one seed, under one failure plan, and nothing in it
// says who is ahead. Where a result holds over many seeds is the job of "Trade-offs" and of the Evidence page.

import { secondsText, type Assumptions, type SystemKind } from "./assumptions";

export interface EndSide {
  system: SystemKind;
  /** The replay has played the run to its last event. */
  finished: boolean;
  /** The log ends with the run completing, not with a halt. */
  completed: boolean;
  /** Coordinators (for a rival, the supervisor) that crashed. */
  crashes: number;
  /** Model calls made again for work already paid for. */
  duplicatedCalls: number;
  placed: number;
  /** The talks of the task; null when the task is not a list of talks. */
  total: number | null;
}

export interface PairEndText {
  headline: string;
  sides: { who: string; text: string }[];
  /** One run of each, on one seed, with the rival's setting. */
  scope: string;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** How a side's run ended, by the talks it placed. */
function finishing(side: EndSide): string {
  const talks =
    side.total === null ? count(side.placed, "talk") : side.placed >= side.total ? `all ${side.total} talks` : `${side.placed} of ${side.total} talks`;
  return side.completed ? `finished with ${talks} placed` : `did not finish: ${talks} placed`;
}

const paid = (side: EndSide): string => (side.duplicatedCalls === 0 ? "No call was paid for twice." : `${count(side.duplicatedCalls, "call")} paid for again.`);

/** What one side did, in a sentence or two, by the kind of system it is. */
export function sideText(side: EndSide, assumptions: Assumptions): string {
  const n = side.crashes;
  const pause = secondsText(assumptions.detectionMs + assumptions.restartMs);
  switch (side.system) {
    case "swarm":
      return n === 0 ? `No coordinator crashed. It ${finishing(side)}. ${paid(side)}` : `Lost ${count(n, "coordinator")} and ${side.completed ? "still " : ""}${finishing(side)}. ${paid(side)}`;
    case "central":
      return n === 0
        ? `Its supervisor did not crash. It ${finishing(side)}. ${paid(side)}`
        : `Its supervisor crashed ${count(n, "time")}, and its workers stopped with it each time. It ${finishing(side)}. ${paid(side)}`;
    case "durable-max":
      return n === 0
        ? `Its supervisor did not crash. It ${finishing(side)}. ${paid(side)}`
        : `Its supervisor crashed ${count(n, "time")}; its workers kept going and the board paused ${pause} each time. It ${finishing(side)}. ${paid(side)}`;
    case "durable":
      return n === 0
        ? `Its supervisor did not crash. It ${finishing(side)}. ${paid(side)}`
        : `Its supervisor crashed ${count(n, "time")}; its workers kept going, but the plan and the judging in progress were lost each time. It ${finishing(side)}. ${paid(side)}`;
    default:
      return `${n === 0 ? "Nothing crashed" : `Crashes: ${n}`}. It ${finishing(side)}. ${paid(side)}`;
  }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The words of the end of a pair. */
export function pairEndText(left: EndSide, right: EndSide, assumptions: Assumptions): PairEndText {
  const finished = [left, right].filter((side) => side.completed).length;
  return {
    headline: finished === 2 ? "Both runs finished." : finished === 1 ? "Only one of the two runs finished." : "Neither run finished.",
    sides: [
      { who: "FractalSwarm", text: sideText(left, assumptions) },
      { who: capitalize(assumptions.name), text: sideText(right, assumptions) },
    ],
    scope: `This is one run of each, on one seed, under one failure plan, with the rival noticing a crash after ${secondsText(assumptions.detectionMs)} and restarting after ${secondsText(assumptions.restartMs)}: it shows what happened here, not what usually happens.`,
  };
}
