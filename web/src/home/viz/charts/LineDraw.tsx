import { useCallback, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { HeroSlice } from "../../data/types";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import { seedsText, signed } from "./chart";
import {
  LEAD,
  collectLine,
  lineCaptions,
  lineLayout,
  lineModel,
  lineSummary,
  paintLine,
  shapeOf,
  valueText,
  type Emphasis,
  type LineModel,
  type LineRig,
  type LineSeries,
  type PanelLayout,
} from "./line";
import { ChartTable, useBox } from "./parts";

export type LineDrawProps = VizProps<HeroSlice> & {
  /** Print the setting (task, model, seeds) under the chart. A page that prints it itself turns it off. */
  setting?: boolean;
};

/** What the box is before it is measured (and on the server): the page's hero frame at 1920 wide. */
const DEFAULT_BOX = { width: 1100, height: 520 };

const GROUPS: readonly Emphasis[] = ["quiet", "rival", "swarm"];

/** A mark for each system that is not the swarm, so that two lines are never told apart by shade alone. */
function Marker({ series }: { series: LineSeries }) {
  if (series.emphasis === "swarm") return <circle className="hv-ld-dot" r="4.5" />;
  if (series.id === "central") return <rect className="hv-ld-dot" x="-4" y="-4" width="8" height="8" rx="1" />;
  if (series.id === "durable-max") return <path className="hv-ld-dot" d="M0 -5.5L5.5 0L0 5.5L-5.5 0Z" />;
  return <circle className="hv-ld-dot" r="2.5" />;
}

const tip = (model: LineModel, s: LineSeries, panel: PanelLayout, i: number): string => {
  const p = s[panel.metric.key][i]!;
  const killed = `${p.x} ${p.x === 1 ? "coordinator" : "coordinators"} killed (${p.profile})`;
  const places = 1;
  return `${s.label}, ${killed}: ${valueText(panel.metric.key, p.mean)}, range ${signed(p.min, places)} to ${signed(p.max, places)} over ${seedsText(model.seedCount)}`;
};

export function LineDraw({ progress, data, still, stillAt, className, setting = true }: LineDrawProps) {
  const model = useMemo(() => lineModel(data), [data]);
  const captions = useMemo(() => lineCaptions(model), [model]);
  const summary = useMemo(() => lineSummary(model), [model]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const [root, box] = useBox(DEFAULT_BOX);
  const layout = useMemo(() => lineLayout(model, box.width, box.height, setting ? captions : []), [model, box, captions, setting]);

  const svg = useRef<SVGSVGElement>(null);
  const rig = useRef<LineRig | null>(null);
  const live = useRef(layout);
  live.current = layout;
  const last = useRef(0);
  const apply = useCallback((p: number) => {
    last.current = p;
    if (rig.current) paintLine(rig.current, live.current, p);
  }, []);
  useLayoutEffect(() => {
    if (!svg.current) return;
    rig.current = collectLine(svg.current);
    apply(last.current);
  }, [layout, apply]);
  useProgress(progress, apply, still, stillAt);

  const L = layout;
  const clip = (panel: number, group: Emphasis): string => `hv-ld-${uid}-${panel}-${group}`;

  return (
    <div ref={root} className={className ? `hv hv-chart hv-ld ${className}` : "hv hv-chart hv-ld"}>
      <svg ref={svg} className="hv-ch-svg" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="img" aria-label={summary}>
        <defs>
          {L.panels.flatMap((panel, pi) =>
            GROUPS.map((group) => (
              <clipPath key={`${pi}-${group}`} id={clip(pi, group)}>
                <rect data-wipe={group} data-panel={pi} x={fx(panel.left)} y={fx(panel.top - 10)} width={fx(panel.right - panel.left + 14)} height={fx(panel.bottom - panel.top + 20)} />
              </clipPath>
            )),
          )}
        </defs>

        {L.panels.map((panel, pi) => (
          <g key={panel.metric.key} data-panel-key={panel.metric.key}>
            <g data-part="axes">
              <text className="hv-ch-head" x={fx(panel.x)} y={fx(panel.titleY)}>
                <tspan className="hv-ch-name">{panel.metric.title}</tspan>
                <tspan className="hv-ch-sub" dx="8">
                  {panel.sub}
                </tspan>
              </text>
              {panel.yTicks.map((t) => (
                <g key={t.y}>
                  <line className={t.zero ? "hv-ch-zero" : "hv-ch-grid"} x1={fx(panel.left)} x2={fx(panel.right + 6)} y1={fx(t.y)} y2={fx(t.y)} />
                  <text className="hv-ch-tick hv-ch-tick--y" x={fx(panel.left - 8)} y={fx(t.y)}>
                    {t.label}
                  </text>
                </g>
              ))}
              <line className="hv-ch-axis" x1={fx(panel.left)} x2={fx(panel.right + 6)} y1={fx(panel.bottom)} y2={fx(panel.bottom)} />
              {panel.xTicks.map((t) => (
                <g key={t.x}>
                  <line className="hv-ch-axis" x1={fx(t.x)} x2={fx(t.x)} y1={fx(panel.bottom)} y2={fx(panel.bottom + 4)} />
                  <text className="hv-ch-tick hv-ch-tick--x" x={fx(t.x)} y={fx(panel.tickY)}>
                    {t.count}
                  </text>
                  {panel.tickY2 !== null && (
                    <text className="hv-ch-tick hv-ch-tick--x hv-ch-tick--dim" x={fx(t.x)} y={fx(panel.tickY2)}>
                      {t.profile}
                    </text>
                  )}
                </g>
              ))}
              <text className="hv-ch-axis-title" x={fx(panel.right)} y={fx(panel.axisTitle.y)}>
                coordinators killed
              </text>
            </g>

            {GROUPS.map((group) => (
              <g key={group} clipPath={`url(#${clip(pi, group)})`}>
                {model.series
                  .filter((s) => s.emphasis === group)
                  .map((s) => {
                    const shape = shapeOf(s, panel);
                    return (
                      <g key={s.id} className="hv-ld-series" data-emph={s.emphasis} data-id={s.id}>
                        {shape.band && <path className="hv-ld-band" d={shape.band} />}
                        <path className="hv-ld-line" d={shape.line} />
                        <path className="hv-ld-hit" d={shape.line} />
                        {shape.dots.map((d, i) => (
                          <g key={d.point.x} className="hv-ld-mark" transform={`translate(${fx(d.x)} ${fx(d.y)})`}>
                            <Marker series={s} />
                            <title>{tip(model, s, panel, i)}</title>
                          </g>
                        ))}
                      </g>
                    );
                  })}
              </g>
            ))}

            <g data-part="labels">
              {panel.labels.map((l) => {
                const s = model.series[l.series]!;
                const x = panel.right + LEAD;
                return (
                  <g key={s.id} className="hv-ld-label" data-emph={s.emphasis}>
                    <path className="hv-ld-lead" d={`M${fx(panel.right + 8)} ${fx(l.endY)}L${fx(x - 4)} ${fx(l.y)}`} />
                    <text className="hv-ld-name" x={fx(x)} y={fx(l.lines.length === 2 ? l.y - 7.5 : l.y)}>
                      {l.lines[0]}
                    </text>
                    {l.lines[1] && (
                      <text className="hv-ld-value" x={fx(x)} y={fx(l.y + 7.5)}>
                        {l.lines[1]}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        ))}

        {L.caption && (
          <text className="hv-ch-caption" x="10" y={fx(L.captionY)}>
            {L.caption}
          </text>
        )}
      </svg>

      {L.panels.map((panel) => (
        <ChartTable
          key={panel.metric.key}
          caption={`${panel.metric.title}, ${panel.metric.key === "stall" ? "in seconds" : "in percent, against the same system's own run with no failures"}: the mean over ${seedsText(model.seedCount)}, with the lowest and highest seed`}
          head={["System", ...model.xs.map((x, i) => `${x} killed (${model.profiles[i]})`)]}
          rows={model.series.map((s) => [
            s.label,
            ...s[panel.metric.key].map((p) => `${valueText(panel.metric.key, p.mean)} (${signed(p.min, 1)} to ${signed(p.max, 1)})`),
          ])}
        />
      ))}
    </div>
  );
}
