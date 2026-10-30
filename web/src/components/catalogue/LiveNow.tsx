import { formatDuration, type CatalogueRow } from "../../lib/catalogue";
import { Card } from "../ui";

/** The runs that are being written right now, apart from the recorded ones: these stream, those replay. */
export function LiveNow({ rows }: { rows: readonly CatalogueRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card title="Live now" hint="still recording: open one to watch it as it happens" className="livenow">
      <ul className="livenow__list">
        {rows.map(({ listing, workflow, facts }) => {
          const href = `#/run/${encodeURIComponent(listing.id)}`;
          return (
            <li key={listing.id} className="livenow__item">
              <span className="badge badge--live">● Live</span>
              <a className="mono livenow__id" href={href}>
                {listing.id}
              </a>
              <span>{workflow.label}</span>
              <span className="muted">
                {listing.events.toLocaleString("en-US")} events so far · {formatDuration(listing.duration_ms)}
                {facts?.clock === "live" ? " · live clock" : facts?.clock === "sim" ? " · simulated clock" : ""}
              </span>
              <a className="btn btn--on livenow__watch" href={href}>
                Watch
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
