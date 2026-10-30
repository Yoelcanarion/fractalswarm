import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { axis, GRID, TOOLTIP_STYLE } from "../../lib/chart";
import { useFirstDraw } from "../../lib/chartMotion";
import { bandKey, chartRows, type HeroData, type MetricKey } from "../../lib/hero";
import { formatMetric, formatPoint, METRICS } from "../../lib/heroText";
import { Card, Term } from "../ui";

const AXIS = axis(14);

interface Row {
  x?: unknown;
  label?: unknown;
}

interface TipProps {
  active?: boolean;
  payload?: readonly { payload?: Row }[];
  hero: HeroData;
  metric: MetricKey;
  visible: readonly string[];
  colors: Record<string, string>;
}

/** The hover card: for each drawn workflow, its mean at that failure level and the lowest to highest seed. */
function ChartTip({ active, payload, hero, metric, visible, colors }: TipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="charttip" style={TOOLTIP_STYLE}>
      <div className="charttip__head">Coordinators killed: {String(row.label)}</div>
      <ul className="charttip__rows">
        {hero.series
          .filter((s) => visible.includes(s.id))
          .map((s) => {
            const point = s.points.find((p) => p.coordinatorsKilled === row.x);
            return (
              <li key={s.id}>
                <i className="serieskey__swatch" style={{ background: colors[s.id] }} aria-hidden="true" />
                <span className="charttip__name">{s.label}</span>
                <span className="charttip__value mono">{point ? formatPoint(metric, point) : "–"}</span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

export interface MetricChartProps {
  hero: HeroData;
  metric: MetricKey;
  colors: Record<string, string>;
  hidden: ReadonlySet<string>;
  /** Draw the lowest to highest seed behind each line, where the file records it. */
  showBand: boolean;
  height: number;
  /** What the axis is, when the file does not say. */
  note?: string;
}

export function MetricChart({ hero, metric, colors, hidden, showBand, height, note }: MetricChartProps) {
  const spec = METRICS[metric];
  const rows = useMemo(() => chartRows(hero, metric), [hero, metric]);
  const draw = useFirstDraw();
  const visible = hero.series.filter((s) => !hidden.has(s.id));
  const ids = visible.map((s) => s.id);
  const banded = (id: string) => hero.series.find((s) => s.id === id)?.points.some((p) => p.range[metric]) ?? false;
  const title = spec.term ? <Term id={spec.term}>{spec.title}</Term> : spec.title;
  return (
    <Card title={title} hint={hero.panels[metric]?.note || note} className="chartcard">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 12, right: 24, bottom: 24, left: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="label"
            {...AXIS}
            label={{ value: hero.xLabel, position: "insideBottom", offset: -14, fill: "var(--text-secondary)", fontSize: 14 }}
          />
          <YAxis
            {...AXIS}
            width={72}
            tickFormatter={(value) => formatMetric(metric, Number(value))}
            domain={spec.rate ? [0, 1] : ["auto", "auto"]}
            allowDecimals
          />
          {!spec.rate && <ReferenceLine y={0} stroke="var(--border-strong)" ifOverflow="extendDomain" />}
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={(props) => (
              <ChartTip
                active={props.active}
                payload={props.payload as TipProps["payload"]}
                hero={hero}
                metric={metric}
                visible={ids}
                colors={colors}
              />
            )}
          />
          {showBand &&
            visible
              .filter((s) => banded(s.id))
              .map((s) => (
                <Area
                  key={`${s.id}:band`}
                  dataKey={bandKey(s.id)}
                  stroke="none"
                  fill={colors[s.id]}
                  fillOpacity={0.14}
                  connectNulls
                  isAnimationActive={false}
                  activeDot={false}
                  legendType="none"
                  tooltipType="none"
                />
              ))}
          {visible.map((s) => (
            <Line
              key={s.id}
              dataKey={s.id}
              name={s.label}
              stroke={colors[s.id]}
              strokeWidth={s.id === "swarm" ? 3.5 : 2}
              dot={{ r: 4, strokeWidth: 2, fill: "var(--surface-1)" }}
              activeDot={{ r: 6 }}
              connectNulls
              {...draw}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
