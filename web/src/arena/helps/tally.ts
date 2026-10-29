// The wins / ties / losses table: for each hypothesis, how often the swarm won, tied or lost against each
// rival, and where each of those results was. Counts come from the file as they are, and nothing is added
// up here: a result that is not a win, a tie or a loss is kept as "not scored" and never folded into one.

import type { Comparison, Honesty, Rules, Tally, Verdict } from "./honesty";
import { crashesText, fmt, metricName, metricUnit, settingLabel, taskName, valueText } from "./labels";
import { AXES, axisTitle } from "./regime";

export interface TallyCell {
  rival: string;
  tally: Tally;
}

export interface TallyRow {
  id: string;
  name: string;
  metric: string;
  /** What the design predicted before the results (bench/PREREG.md §2). */
  expected: string;
  /** Stall time: reported next to the hypotheses, but not one of them and not in the totals. */
  reported: boolean;
  cells: TallyCell[];
}

export const EMPTY_TALLY: Tally = { win: 0, tie: 0, loss: 0, na: 0 };

/** One row per hypothesis, in the file's order, one cell per rival (an empty one where the bench did not compare). */
export function tallyRows(honesty: Honesty, rivals: readonly string[]): TallyRow[] {
  return honesty.hypotheses.map((h) => ({
    id: h.id,
    name: h.name,
    metric: h.metric,
    expected: h.expected,
    reported: !h.id.startsWith("H"),
    cells: rivals.map((rival) => {
      return { rival, tally: h.tally[rival] ?? EMPTY_TALLY };
    }),
  }));
}

/** Which results to list for a cell of the table. */
export type Which = "win" | "tie" | "loss" | "na";

const matches = (verdict: Verdict, which: Which): boolean => (which === "na" ? verdict === "n/a" || verdict === "incomplete" : verdict === which);

export interface ComparisonLine {
  key: string;
  /** The setting: "Failure detection 1 s", "Gate C3 (5 crashes)". */
  where: string;
  /** The task and the profile it ran at. */
  context: string;
  swarm: string;
  rival: string;
  verdict: Verdict;
  mixed: boolean;
}

function lineOf(c: Comparison, index: number): ComparisonLine {
  const gate = c.axis === null;
  const crashes = crashesText(c.profile);
  return {
    key: `${c.hypothesis}:${c.rival}:${c.axis ?? "gate"}:${c.task}:${c.profile}:${c.value ?? ""}:${index}`,
    where: gate ? `${axisTitle(null)} ${c.profile}${crashes ? ` (${crashes})` : ""}` : `${axisTitle(c.axis)} ${settingLabel(c.axis, c.value, c.profile)}`,
    context: gate ? `${taskName(c.task)} · default assumptions` : `${taskName(c.task)} · ${c.profile}`,
    swarm: valueText(c.metric, c.swarm),
    rival: valueText(c.metric, c.rivalValue),
    verdict: c.verdict,
    mixed: c.mixed,
  };
}

const axisOrder = (axis: string | null): number => {
  const i = Object.keys(AXES).indexOf(axis ?? "gate");
  return i === -1 ? Object.keys(AXES).length : i;
};

/** Every comparison of one hypothesis against one rival that ended as `which`, the gate first, then each sweep in turn. */
export function comparisonLines(honesty: Honesty, hypothesis: string, rival: string, which: Which): ComparisonLine[] {
  return honesty.comparisons
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => c.hypothesis === hypothesis && c.rival === rival && matches(c.verdict, which))
    .sort((a, b) => axisOrder(a.c.axis) - axisOrder(b.c.axis) || (a.c.value ?? 0) - (b.c.value ?? 0) || a.c.task.localeCompare(b.c.task) || a.c.profile.localeCompare(b.c.profile))
    .map(({ c, index }) => lineOf(c, index));
}

/** The swarm's false deaths (a live coordinator declared dead, so its work is re-owned and its duplicate paid for,
 * bench/PREREG.md §5) at the last point of the gate that decides the outcome, next to the rival's: values of the
 * file's `false_deaths`, not computed here. */
export interface FalseDeathNote {
  task: string;
  profile: string;
  swarm: { mean: number; max: number };
  /** The rival the outcome is read against; null when the file has no row for it at that point. */
  rival: { id: string; mean: number; max: number } | null;
}

export function falseDeathNote(honesty: Honesty): FalseDeathNote | null {
  const point = honesty.outcome.gate.at(-1);
  if (!point) return null;
  const at = honesty.falseDeaths.filter((f) => f.axis === null && f.task === point.task && f.profile === point.profile);
  const swarm = at.find((f) => f.workflow === "swarm");
  if (!swarm) return null;
  const rival = at.find((f) => f.workflow === honesty.outcome.against);
  return {
    task: point.task,
    profile: point.profile,
    swarm: { mean: swarm.remapsMean, max: swarm.remapsMax },
    rival: rival ? { id: rival.workflow, mean: rival.remapsMean, max: rival.remapsMax } : null,
  };
}

/** How a result is decided, in the file's own numbers (bench/PREREG.md §3). */
export function ruleLines(rules: Rules): string[] {
  const lines = ["A result is a tie unless every seed agrees and the difference reaches the minimum effect."];
  const minimums = Object.entries(rules.difference).map(([metric, minimum]) => {
    const unit = metricUnit(metric).replace("%", " points");
    return `${metricName(metric).toLowerCase()} ${fmt(minimum)}${unit}`;
  });
  if (minimums.length > 0) lines.push(`Minimum effects: ${minimums.join(" · ")}.`);
  const ratios = Object.entries(rules.ratio).map(([metric, rule]) => `${metricName(metric).toLowerCase()} ${fmt(rule.ratio)}× (floor ${fmt(rule.floor)}${metricUnit(metric)})`);
  if (ratios.length > 0) lines.push(`Ratio metrics: a win is at most this fraction of the rival's value, once the rival's value is at least the floor: ${ratios.join(" · ")}.`);
  return lines;
}
