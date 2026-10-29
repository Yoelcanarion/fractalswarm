// The wins / ties / losses table: for each hypothesis, how often the swarm won, tied or lost against each
// rival, and where each of those results was. Counts come from the file as they are; a result that is not
// a win, a tie or a loss is kept as "not scored" and never folded into one of them.

import type { Comparison, Honesty, Rules, Tally, Verdict } from "./honesty";
import { crashesText, fmt, metricName, metricUnit, settingLabel, taskName, valueText } from "./labels";
import { AXES, axisTitle } from "./regime";

export interface TallyCell {
  rival: string;
  tally: Tally;
  /** Comparisons counted: wins, ties, losses and results with no verdict. */
  total: number;
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

export const tallyTotal = (t: Tally): number => t.win + t.tie + t.loss + t.na;

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
      const tally = h.tally[rival] ?? EMPTY_TALLY;
      return { rival, tally, total: tallyTotal(tally) };
    }),
  }));
}

/** The totals over hypotheses H1 to H6, per rival: what the file's own `tally` adds up. */
export function tallyTotals(rows: readonly TallyRow[], rivals: readonly string[]): TallyCell[] {
  return rivals.map((rival, i) => {
    const tally = { ...EMPTY_TALLY };
    for (const row of rows) {
      if (row.reported) continue;
      const t = row.cells[i].tally;
      tally.win += t.win;
      tally.tie += t.tie;
      tally.loss += t.loss;
      tally.na += t.na;
    }
    return { rival, tally, total: tallyTotal(tally) };
  });
}

/** Which results to list for a cell of the table. */
export type Which = "win" | "tie" | "loss" | "na";

const matches = (verdict: Verdict, which: Which): boolean => (which === "na" ? verdict === "n/a" || verdict === "incomplete" : verdict === which);

export interface ComparisonLine {
  key: string;
  /** The setting: "Detection time 1 s", "Failures C3 (5 crashes)". */
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
    where: gate ? `Failures ${c.profile}${crashes ? ` (${crashes})` : ""}` : `${axisTitle(c.axis)} ${settingLabel(c.axis, c.value, c.profile)}`,
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

/** The swarm's false deaths: a live coordinator declared dead, so its work was re-owned and its duplicate paid for (bench/PREREG.md §5). */
export interface FalseDeathSummary {
  /** Swarm settings with at least one false death, and how many settings the swarm ran. */
  settingsWith: number;
  settings: number;
  /** The mean per run at the setting with the most, and where it was. */
  worstMean: number;
  worstWhere: string;
}

export function falseDeathSummary(honesty: Honesty): FalseDeathSummary | null {
  const swarm = honesty.falseDeaths.filter((f) => f.workflow === "swarm");
  if (swarm.length === 0) return null;
  const worst = swarm.reduce((a, b) => (b.remapsMean > a.remapsMean ? b : a));
  return {
    settingsWith: swarm.filter((f) => f.remapsMax > 0).length,
    settings: swarm.length,
    worstMean: worst.remapsMean,
    worstWhere: `${axisTitle(worst.axis)} ${settingLabel(worst.axis, worst.value, worst.profile)}`.trim(),
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
