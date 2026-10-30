import type { HeroSeries } from "../../lib/hero";
import { WORKFLOW_HELP } from "../../lib/heroText";
import { Tooltip } from "../ui";

export interface SeriesKeyProps {
  series: readonly HeroSeries[];
  colors: Record<string, string>;
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

/** The key to every chart of the page: one entry per workflow, with what it is on hover and a toggle to hide it.
 * One key serves all the charts, so none of them repeats a legend. */
export function SeriesKey({ series, colors, hidden, onToggle }: SeriesKeyProps) {
  return (
    <ul className="serieskey" aria-label="Workflows. Press one to hide or show it in every chart.">
      {series.map((s) => (
        <li key={s.id}>
          <Tooltip label={WORKFLOW_HELP[s.id] ?? s.label} placement="bottom">
            <button type="button" className="serieskey__item" aria-pressed={!hidden.has(s.id)} onClick={() => onToggle(s.id)}>
              <i className="serieskey__swatch" style={{ background: colors[s.id] }} aria-hidden="true" />
              {s.label}
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
