import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { benchResults } from "../lib/api";
import { chartRows, normalizeHero, type HeroData, type HeroPoint } from "../lib/hero";
import { SERIES } from "../lib/layout";

const AXIS = { stroke: "#5c5b56", tick: { fill: "#c3c2b7", fontSize: 14 } };
const GRID = "#2c2c2a";

function colorFor(hero: HeroData, id: string): string {
  return SERIES[hero.series.findIndex((s) => s.id === id) % SERIES.length];
}

interface PanelProps {
  hero: HeroData;
  metric: keyof HeroPoint;
  title: string;
  unit: string;
  height?: number;
  percent?: boolean;
}

function MetricPanel({ hero, metric, title, unit, height = 340, percent }: PanelProps) {
  const rows = useMemo(() => chartRows(hero, metric), [hero, metric]);
  const format = (v: number) => (percent ? `${Math.round(v * 100)}%` : `${v}${unit}`);
  return (
    <section className="panel chart">
      <header className="panel__title">{title}</header>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 12, right: 24, bottom: 8, left: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} tickFormatter={format} width={64} domain={percent ? [0, 1] : [0, "auto"]} />
          <Tooltip
            contentStyle={{ background: "#1f1f1d", border: "1px solid #3a3936", borderRadius: 8 }}
            labelStyle={{ color: "#f0efec" }}
            formatter={(value) => (typeof value === "number" ? format(Number(value.toFixed(2))) : String(value))}
            labelFormatter={(label) => `coordinators killed: ${label}`}
          />
          <Legend wrapperStyle={{ color: "#c3c2b7", fontSize: 14 }} />
          {hero.series.map((s) => (
            <Line
              key={s.id}
              dataKey={s.id}
              name={s.label}
              stroke={colorFor(hero, s.id)}
              strokeWidth={s.id === "swarm" ? 3.5 : 2}
              dot={{ r: 4, strokeWidth: 2, fill: "#1a1a19" }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

function TokensPanel({ hero }: { hero: HeroData }) {
  const rows = useMemo(() => chartRows(hero, "coordinationTokens"), [hero]);
  return (
    <section className="panel chart">
      <header className="panel__title">Coordination tokens per run</header>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 12, right: 24, bottom: 8, left: 4 }} barGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} width={64} />
          <Tooltip contentStyle={{ background: "#1f1f1d", border: "1px solid #3a3936", borderRadius: 8 }} cursor={{ fill: "#ffffff10" }} />
          <Legend wrapperStyle={{ color: "#c3c2b7", fontSize: 14 }} />
          {hero.series.map((s) => (
            <Bar key={s.id} dataKey={s.id} name={s.label} fill={colorFor(hero, s.id)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

export function ChartsPage() {
  const [state, setState] = useState<{ hero?: HeroData; fixture?: boolean; source?: string; error?: string }>({});
  useEffect(() => {
    benchResults()
      .then((r) => setState({ hero: normalizeHero(r.data), fixture: r.fixture, source: r.source }))
      .catch((error) => setState({ error: String(error) }));
  }, []);

  if (state.error) return <div className="empty empty--bad">Could not load the bench results: {state.error}</div>;
  if (!state.hero) return <div className="empty">Loading the bench results…</div>;
  const { hero } = state;
  return (
    <div className="charts">
      <div className="charts__head">
        <div>
          <h1>Kill the coordinators: who stalls, who pays twice?</h1>
          <p className="muted">
            {hero.task}, same failures for every workflow, 5 s detection = best-case restart for the baselines (spec §15.2).
          </p>
        </div>
        {state.fixture ? (
          <span className="badge badge--warn">Fixture data — not measured. Run the bench to replace it.</span>
        ) : (
          <span className="badge badge--muted mono">{state.source}</span>
        )}
      </div>
      <div className="charts__hero">
        <MetricPanel hero={hero} metric="stallS" title="Stall time (s)" unit=" s" height={400} />
        <MetricPanel hero={hero} metric="extraCostPct" title="Extra cost vs C0 (%)" unit="%" height={400} />
      </div>
      <div className="charts__secondary">
        <MetricPanel hero={hero} metric="completionRate" title="Completion rate" unit="" percent height={220} />
        <MetricPanel hero={hero} metric="validityRate" title="Validity rate" unit="" percent height={220} />
        <TokensPanel hero={hero} />
      </div>
      <details className="panel charts__table">
        <summary>Table view</summary>
        <table>
          <thead>
            <tr>
              <th>workflow</th>
              <th>killed</th>
              <th>profile</th>
              <th>stall s</th>
              <th>extra cost %</th>
              <th>completion</th>
              <th>validity</th>
              <th>coord. tokens</th>
              <th>runs</th>
            </tr>
          </thead>
          <tbody>
            {hero.series.flatMap((s) =>
              s.points.map((p) => (
                <tr key={`${s.id}-${p.coordinatorsKilled}`}>
                  <td>{s.label}</td>
                  <td>{p.coordinatorsKilled}</td>
                  <td>{p.profile}</td>
                  <td>{p.stallS ?? "–"}</td>
                  <td>{p.extraCostPct ?? "–"}</td>
                  <td>{p.completionRate ?? "–"}</td>
                  <td>{p.validityRate ?? "–"}</td>
                  <td>{p.coordinationTokens ?? "–"}</td>
                  <td>
                    {p.runs.map((run) => (
                      <a key={run} href={`#/run/${encodeURIComponent(run)}`}>
                        {run}{" "}
                      </a>
                    ))}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </details>
      {hero.note && <p className="muted">{hero.note}</p>}
    </div>
  );
}
