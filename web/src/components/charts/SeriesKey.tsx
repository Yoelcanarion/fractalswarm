import type { HeroSeries } from "../../lib/hero";
import { WORKFLOW_HELP } from "../../lib/heroText";
import { Tooltip } from "../ui";

export interface SeriesKeyProps {
  series: readonly HeroSeries[];
  colors: Record<string, string>;
  hidden: ReadonlySet<string>;
  /** Present: each entry is a toggle that hides or shows its workflow in every chart. Absent: the key is only a legend. */
  onToggle?: (id: string) => void;
}

/** How to read a mark of the charts, drawn as one. */
export function MarkKey() {
  return (
    <p className="markkey">
      <svg className="markkey__mark" width="14" height="26" viewBox="0 0 14 26" aria-hidden="true">
        <rect x="4" y="1" width="6" height="24" rx="3" />
        <circle cx="7" cy="15" r="5" />
      </svg>
      Dot: mean. Bar: lowest to highest seed.
    </p>
  );
}

/** The key to every chart of the page: one entry per workflow, with what it is on hover. One key serves all the charts, so none of
 * them repeats a legend. In view it is only a legend; the toggles that hide a workflow are the same key under Details. */
export function SeriesKey({ series, colors, hidden, onToggle }: SeriesKeyProps) {
  return (
    <ul className="serieskey" aria-label={onToggle ? "Workflows. Press one to hide or show it in every chart." : "Workflows"}>
      {series.map((s) => (
        <li key={s.id}>
          <Tooltip label={WORKFLOW_HELP[s.id] ?? s.label} placement="bottom">
            {onToggle ? (
              <button type="button" className="serieskey__item" aria-pressed={!hidden.has(s.id)} onClick={() => onToggle(s.id)}>
                <i className="serieskey__swatch" style={{ background: colors[s.id] }} aria-hidden="true" />
                {s.label}
              </button>
            ) : (
              <span className={hidden.has(s.id) ? "serieskey__item serieskey__item--static serieskey__item--off" : "serieskey__item serieskey__item--static"}>
                <i className="serieskey__swatch" style={{ background: colors[s.id] }} aria-hidden="true" />
                {s.label}
                {hidden.has(s.id) && <span className="sr-only"> (hidden in the charts)</span>}
              </span>
            )}
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
