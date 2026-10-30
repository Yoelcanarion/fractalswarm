import { openedRunHash } from "../../lib/address";
import { formatDuration, STATES, type CatalogueRow } from "../../lib/catalogue";

/** The few runs worth opening, in words and each one a link: what a person who has never seen a run starts from. The full list, with
 * its search, sorting and checks, is under Details. */
export function FeaturedRuns({ rows }: { rows: readonly CatalogueRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="featured" aria-label="Runs to start with">
      {rows.map(({ listing, workflow, state }) => (
        <li key={listing.id} className="featured__item">
          <a className="mono featured__id" href={openedRunHash(listing.id)}>
            {listing.id}
          </a>
          <span className="featured__what">{workflow.label}</span>
          <span className="muted">
            {STATES[state].label} · {listing.events.toLocaleString("en-US")} events · {formatDuration(listing.duration_ms)}
          </span>
        </li>
      ))}
    </ul>
  );
}
