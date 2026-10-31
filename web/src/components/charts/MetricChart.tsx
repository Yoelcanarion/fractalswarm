import { useMemo, type CSSProperties } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { axis, GRID, TOOLTIP_CURSOR, TOOLTIP_STYLE } from "../../lib/chart";
import { useFirstDraw } from "../../lib/chartMotion";
import { chartRows, rangeOf, shareDown, type ChartRow, type HeroData, type MetricKey } from "../../lib/hero";
import { formatMetric, formatPoint, formatTick, METRICS } from "../../lib/heroText";
import { Card, Term } from "../ui";

const AXIS = axis(14);
const BAR_W = 6;
const DOT_R = 6;
const FIGURE_SLOT = 54; // the narrowest slot whose mean fits beside its dot, short of the next workflow's bar

interface RangeMarkProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: ChartRow;
  id: string;
  color: string;
  metric: MetricKey;
  /** The row whose marks say their mean in figures. */
  figures: number;
}

/** One workflow at one failure level: a thin bar from its lowest to its highest seed, and a dot on its mean. The workflows stand side by side, so that
 * whether the seeds of two of them overlap reads at a glance. The level with the most failures says its means in figures beside the dots, where the slot
 * has room: over a bar, a figure would read as the height it stands at. */
function RangeMark({ x = 0, y = 0, width = 0, height = 0, index, payload, id, color, metric, figures }: RangeMarkProps) {
  const range = payload ? rangeOf(payload, id) : null;
  const mean = payload?.[id];
  if (range === null || typeof mean !== "number") return <g />;
  const middle = x + width / 2;
  const radius = Math.min(DOT_R, Math.max(3, width / 2 - 0.5));
  const dot = y + shareDown(mean, range) * height;
  return (
    <g>
      {height > 0 && <rect x={middle - BAR_W / 2} y={y} width={BAR_W} height={height} rx={BAR_W / 2} fill={color} fillOpacity={0.55} />}
      <circle cx={middle} cy={dot} r={radius} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
      {index === figures && width >= FIGURE_SLOT && (
        <text className="chartmark__figure" x={middle + radius + 5} y={dot}>
          {formatMetric(metric, mean)}
        </text>
      )}
    </g>
  );
}

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
  height: number;
  /** What the axis is, when the file does not say. */
  note?: string;
}

export function MetricChart({ hero, metric, colors, hidden, height, note }: MetricChartProps) {
  const spec = METRICS[metric];
  const rows = useMemo(() => chartRows(hero, metric), [hero, metric]);
  // recharts recomputes a series whose dataKey is a new function: one for each workflow, for as long as the set is the same.
  const ranges = useMemo(() => new Map(hero.series.map((s) => [s.id, (row: ChartRow) => rangeOf(row, s.id)])), [hero]);
  const draw = useFirstDraw();
  const visible = hero.series.filter((s) => !hidden.has(s.id));
  const ids = visible.map((s) => s.id);
  const title = spec.term ? <Term id={spec.term}>{spec.title}</Term> : spec.title;
  return (
    <Card title={title} hint={hero.panels[metric]?.note || note} className="chartcard">
      <div className="chartcard__plot" style={{ "--plot-h": `${height}px` } as CSSProperties}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 24, bottom: 24, left: 4 }} barGap={0} barCategoryGap="6%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              {...AXIS}
              label={{ value: hero.xLabel, position: "insideBottom", offset: -14, fill: "var(--text-secondary)", fontSize: 14 }}
            />
            <YAxis
              {...AXIS}
              width={72}
              tickFormatter={(value) => formatTick(metric, Number(value))}
              domain={spec.rate ? [0, 1] : ["auto", "auto"]}
              allowDecimals
            />
            {/* layer 0: under the marks, so that the line does not strike through a figure beside a dot */}
            {!spec.rate && <ReferenceLine y={0} stroke="var(--border-strong)" ifOverflow="extendDomain" zIndex={0} />}
            <Tooltip
              cursor={TOOLTIP_CURSOR}
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
            {visible.map((s) => (
              <Bar
                key={s.id}
                dataKey={ranges.get(s.id)}
                name={s.label}
                maxBarSize={72}
                shape={(mark: Omit<RangeMarkProps, "id" | "color" | "metric" | "figures">) => (
                  <RangeMark {...mark} id={s.id} color={colors[s.id]} metric={metric} figures={rows.length - 1} />
                )}
                {...draw}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
