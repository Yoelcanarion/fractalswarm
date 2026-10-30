import { openCollisionCount } from "../lib/collisions";
import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";

const KEYS_SHOWN = 3;

export function CollisionsPanel({ view }: { view: ViewState }) {
  const { collisions } = view.panels;
  const open = openCollisionCount(collisions);
  const rows = [...collisions.rows].reverse();

  return (
    <Card title="Collisions log" hint="booking conflicts between squads, and who resolved them">
      <div className="pstats">
        <PStat label="collisions" value={collisions.rows.length} tone={collisions.rows.length > 0 ? "warn" : ""} />
        <PStat label="open" value={open} tone={open > 0 ? "bad" : ""} />
        <PStat label="resolved" value={collisions.rows.length - open} tone={collisions.rows.length - open > 0 ? "good" : ""} />
        <PStat label="leases booked" value={collisions.leases} title="each lease holds a squad's slot and speaker keys" />
        <PStat label="cells leased" value={collisions.leasedCells} />
        <PStat label="speaker keys" value={collisions.leasedSpeakers} />
      </div>

      {rows.length === 0 ? (
        <Nothing>
          No booking conflict so far{collisions.leases > 0 ? `: ${collisions.leases} leases were booked without one.` : "."}
        </Nothing>
      ) : (
        <>
          <Subhead hint="newest first">Conflicts and who resolved them</Subhead>
          <ul className="clist">
            {rows.slice(0, 12).map((row) => (
              <li key={`${row.id}-${row.detectedSeq}`} className={`crow crow--${row.status}`}>
                <div className="crow__head">
                  <Pill tone={row.status === "open" ? "bad" : "good"}>{row.status}</Pill>
                  <b className="mono">{row.goalId || row.id}</b>
                  <span className="muted">
                    {row.kind} · {row.holder} · t = {virtualSeconds(row.detectedTs)}
                  </span>
                </div>
                {row.conflicts.length > 0 && (
                  <div className="crow__keys mono">
                    {row.conflicts.slice(0, KEYS_SHOWN).map((c) => (
                      <span key={c.key}>
                        {c.key}
                        {c.reason ? ` (${c.reason}${c.holder ? ` by ${c.holder}` : ""})` : ""}{" "}
                      </span>
                    ))}
                    {row.conflicts.length > KEYS_SHOWN && <span className="muted">+{row.conflicts.length - KEYS_SHOWN} more</span>}
                  </div>
                )}
                {row.status === "resolved" && (
                  <div className="crow__res">
                    ⚖ {row.arbiter} · t = {virtualSeconds(row.resolvedTs ?? row.detectedTs)}: {row.resolution}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <GenericRows rows={collisions.other} title="Collision events this panel does not read yet" />
    </Card>
  );
}
