import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, Nothing, Pill, PStat, percent, Subhead } from "./PanelParts";

export function MemoryPanel({ view }: { view: ViewState }) {
  const { memory } = view.panels;
  const squads = Object.values(memory.squads).sort((a, b) => b.published - a.published || a.squad.localeCompare(b.squad));
  const most = Math.max(...squads.map((row) => row.published), 1);
  const facts = memory.order.map((key) => memory.facts[key]).sort((a, b) => b.seq - a.seq);
  const artifacts = memory.artifactOrder.map((path) => memory.artifacts[path]).sort((a, b) => b.seq - a.seq);
  const reuse = memory.hits > 0 ? memory.crossSquadHits / memory.hits : null;

  return (
    <Card title="Memory" hint="facts the squads publish for each other to find">
      <div className="pstats">
        <PStat label="facts" value={memory.order.length} />
        <PStat label="published" value={memory.published} title="every publication, new versions included" />
        <PStat label="promoted" value={memory.promoted} title="squad-local drafts made global" />
        <PStat label="searches" value={memory.searches} />
        <PStat
          label="reuse"
          value={reuse === null ? "–" : percent(reuse)}
          tone={reuse !== null && reuse > 0 ? "good" : ""}
          title={`cross-squad reuse: ${memory.crossSquadHits} of the ${memory.hits} facts found by memory.search came from another squad`}
        />
      </div>

      <Subhead hint="published · global · reused by other squads">By squad</Subhead>
      {squads.length === 0 ? (
        <Nothing>No fact has been published yet.</Nothing>
      ) : (
        <ul className="bars bars--memory">
          {squads.slice(0, 5).map((row) => (
            <li key={row.squad}>
              <span className="mono bars__name">{row.squad}</span>
              <span className="bars__track">
                <i style={{ width: `${(row.published / most) * 100}%` }} />
              </span>
              <span className="mono bars__value">{row.published}</span>
              <span className="muted bars__calls">
                {row.promoted} global · {row.reused} reused
              </span>
            </li>
          ))}
        </ul>
      )}

      {facts.length > 0 && (
        <>
          <Subhead hint="newest first">Facts</Subhead>
          <table className="ptable">
            <tbody>
              {facts.slice(0, 3).map((fact) => (
                <tr key={fact.key}>
                  <td className="mono">{fact.key}</td>
                  <td>{fact.squad}</td>
                  <td>v{fact.version}</td>
                  <td>
                    <Pill tone={fact.promoted ? "good" : "muted"}>{fact.promoted ? `global · ${fact.promotedBy}` : fact.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {artifacts.length > 0 && (
        <>
          <Subhead hint={`${memory.artifactOrder.length} written, versioned with CAS`}>Artifacts</Subhead>
          <table className="ptable">
            <tbody>
              {artifacts.slice(0, 2).map((artifact) => (
                <tr key={artifact.path}>
                  <td className="mono">{artifact.path}</td>
                  <td>v{artifact.version}</td>
                  <td>{artifact.author}</td>
                  <td className="mono">{artifact.size} B</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <GenericRows rows={memory.other} title="Memory events this panel does not read yet" />
    </Card>
  );
}
