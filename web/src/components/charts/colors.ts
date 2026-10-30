import { WORKFLOW_ORDER, type HeroData } from "../../lib/hero";
import { SERIES } from "../../lib/layout";

/** One colour per workflow, the same in every set: a workflow keeps its slot of the categorical palette whether the set
 * draws three workflows or six. One the page has never heard of takes the next free slot. */
export function seriesColors(hero: HeroData): Record<string, string> {
  const strangers = hero.series.filter((s) => !WORKFLOW_ORDER.includes(s.id));
  return Object.fromEntries(
    hero.series.map((s) => {
      const known = WORKFLOW_ORDER.indexOf(s.id);
      const slot = known >= 0 ? known : WORKFLOW_ORDER.length + strangers.indexOf(s);
      return [s.id, SERIES[slot % SERIES.length]];
    }),
  );
}
