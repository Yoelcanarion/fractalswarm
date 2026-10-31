import { openedRunHash, resultsHash } from "../../lib/address";
import { formatDuration, STATES, type CatalogueRow } from "../../lib/catalogue";

function Row({ row, program }: { row: CatalogueRow; program?: boolean }) {
  const { listing, workflow, state } = row;
  return (
    <li className="featured__item">
      <a className="mono featured__id" href={openedRunHash(listing.id)}>
        {listing.id}
      </a>
      <span className="featured__what">{workflow.label}</span>
      <span className="muted">
        {STATES[state].label} · {listing.events.toLocaleString("en-US")} events · {formatDuration(listing.duration_ms)}
      </span>
      {program && state === "recorded" && row.facts?.task === "t2_conference" && (
        <a className="featured__program" href={resultsHash(listing.id)}>
          See the program
        </a>
      )}
    </li>
  );
}

/** The few runs worth opening, in words and each one a link: what a person who has never seen a run starts from. The full list, with
 * its search, sorting and checks, is under Details. */
export function FeaturedRuns({ rows, titled = false }: { rows: readonly CatalogueRow[]; titled?: boolean }) {
  if (rows.length === 0) return null;
  const list = (
    <ul className="featured featured--start" aria-label="Runs to start with">
      {rows.map((row) => (
        <Row key={row.listing.id} row={row} />
      ))}
    </ul>
  );
  if (!titled) return list;
  return (
    <section className="yourruns yourruns--start">
      <h2 className="yourruns__title">Runs to start with</h2>
      {list}
    </section>
  );
}

/** What a person ran here themselves, newest first, each with the way to what it produced. */
export function YourRuns({ rows }: { rows: readonly CatalogueRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="yourruns" aria-labelledby="yourruns">
      <h2 id="yourruns" className="yourruns__title">
        Your runs
      </h2>
      <ul className="featured">
        {rows.map((row) => (
          <Row key={row.listing.id} row={row} program />
        ))}
      </ul>
    </section>
  );
}
