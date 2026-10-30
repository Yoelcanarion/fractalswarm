// How the survivors' panels fit the box the page gives them. A panel in full has a header, a row and a bar
// for each candidate and its answer. The tighter tiers drop the bars and the answers (the line under the
// panels says it), and the tightest keeps the winning row alone, the same in every panel. The richest tier
// whose panels all fit is the one drawn, in as few columns as the height allows.

export type HrwTier = "full" | "compact" | "tiny";

export interface HrwFit {
  tier: HrwTier;
  cols: number;
  rows: number;
}

/** What the box is before it is measured (and on the server): the page's stage at a desktop height, the panels' share of it. */
export const HRW_DEFAULT_BOX = { width: 690, height: 640 };

const GAP = 12;

interface TierSpec {
  tier: HrwTier;
  /** The narrowest a panel of this tier can be. */
  minW: number;
  /** The height of a panel with `candidates` rows. */
  panel(candidates: number): number;
  /** The height of the line above the panels and of the one under them (with their margins). */
  head: number;
  verdict: number;
}

export const HRW_TIERS: readonly TierSpec[] = [
  { tier: "full", minW: 214, panel: (m) => 62 + 33 * m, head: 54, verdict: 38 },
  { tier: "compact", minW: 196, panel: (m) => 34 + 22 * m, head: 30, verdict: 30 },
  { tier: "tiny", minW: 104, panel: () => 48, head: 30, verdict: 30 },
];

const columnsThatFit = (spec: TierSpec, width: number, count: number): number => Math.max(1, Math.min(count, Math.floor((width + GAP) / (spec.minW + GAP))));

export function fitHrw(count: number, candidates: number, width: number, height: number): HrwFit {
  const n = Math.max(1, count);
  for (const spec of HRW_TIERS) {
    const most = columnsThatFit(spec, width, n);
    for (let cols = 1; cols <= most; cols++) {
      const rows = Math.ceil(n / cols);
      if (spec.head + rows * spec.panel(candidates) + (rows - 1) * GAP + spec.verdict <= height) return { tier: spec.tier, cols, rows };
    }
  }
  // Nothing fits: the tightest tier in as many columns as the width allows, so that it overflows as little as it can.
  const tightest = HRW_TIERS[HRW_TIERS.length - 1]!;
  const cols = columnsThatFit(tightest, width, n);
  return { tier: tightest.tier, cols, rows: Math.ceil(n / cols) };
}
