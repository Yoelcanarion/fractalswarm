import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { HeadlineSlice } from "../../data/types";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import {
  collectDots,
  dotCaptions,
  dotLayout,
  dotModel,
  dotSummary,
  dotValue,
  groupTitle,
  paintDots,
  runTip,
  TIE_SYSTEMS,
  type DotMetric,
  type DotRig,
} from "./dots";
import { systemName } from "./names";
import { ChartTable, SystemMark, useBox } from "./parts";

export type DotPlotProps = VizProps<HeadlineSlice> & {
  /** Print the setting (task, model, seeds) under the chart. A page that prints it itself turns it off. */
  setting?: boolean;
  /** The systems to draw, by their ids in the data: the swarm and the two durable supervisors unless told otherwise, and null for all of them. */
  systems?: readonly string[] | null;
};

/** What the box is before it is measured (and on the server): the page's chart frame at 1920 wide. */
const DEFAULT_BOX = { width: 1100, height: 460 };

export function DotPlot({ progress, data, still, stillAt, className, setting = true, systems = TIE_SYSTEMS }: DotPlotProps) {
  // the content of `systems` is the dependency: a page may pass a new array each render
  const which = systems === null ? null : systems.join(",");
  const model = useMemo(() => dotModel(data, systems), [data, which]);
  const captions = useMemo(() => dotCaptions(model), [model]);
  const summary = useMemo(() => dotSummary(model), [model]);

  const [root, box] = useBox(DEFAULT_BOX);
  const layout = useMemo(() => dotLayout(model, box.width, box.height, setting ? captions : []), [model, box, captions, setting]);

  const svg = useRef<SVGSVGElement>(null);
  const rig = useRef<DotRig | null>(null);
  const last = useRef(0);
  const apply = useCallback((p: number) => {
    last.current = p;
    if (rig.current) paintDots(rig.current, p);
  }, []);
  useLayoutEffect(() => {
    if (!svg.current) return;
    rig.current = collectDots(svg.current, layout);
    apply(last.current);
  }, [layout, apply]);
  useProgress(progress, apply, still, stillAt);

  const L = layout;
  const shownGroups = model.groups.slice(0, L.shown);

  return (
    <div ref={root} className={className ? `hv hv-chart hv-dp ${className}` : "hv hv-chart hv-dp"}>
      <svg ref={svg} className="hv-ch-svg" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="img" aria-label={summary}>
        {L.panels.map((panel, pi) => (
          <g key={panel.metric} data-panel-key={panel.metric}>
            <g data-part="axes">
              <text className="hv-ch-head" x={fx(panel.left)} y={fx(panel.headY)}>
                <tspan className="hv-ch-name">{panel.title}</tspan>
                <tspan className="hv-ch-sub" dx="8">
                  {panel.sub}
                </tspan>
              </text>
              <text className="hv-dp-meanh" x={fx(panel.meanX)} y={fx(panel.headY)}>
                mean
              </text>

              {panel.ticks.flatMap((t) =>
                panel.spans.map((s, si) => (
                  <line key={`${t.x}:${si}`} className={t.zero ? "hv-ch-zero" : "hv-ch-grid"} x1={fx(t.x)} x2={fx(t.x)} y1={fx(s.top)} y2={fx(s.bottom)} />
                )),
              )}
              {panel.groups.map((g) => (
                <g key={g.group}>
                  <line className="hv-dp-rule" x1={fx(panel.labels ? panel.labelX : panel.left)} x2={fx(panel.meanX)} y1={fx(g.rule)} y2={fx(g.rule)} />
                  {panel.labels && (
                    <text className="hv-dp-group" x={fx(panel.labelX)} y={fx(g.y)}>
                      {g.title}
                    </text>
                  )}
                </g>
              ))}
              {panel.rows.map((place, flat) => {
                const row = shownGroups[place.group]!.rows[place.row]!;
                return (
                  <g key={flat} data-emph={row.emphasis}>
                    <line className="hv-dp-guide" x1={fx(panel.left)} x2={fx(panel.right)} y1={fx(place.y)} y2={fx(place.y)} />
                    {panel.labels && (
                      <text className="hv-dp-label" x={fx(panel.labelX)} y={fx(place.y)}>
                        {systemName(row.id, row.label, L.names)}
                      </text>
                    )}
                  </g>
                );
              })}
              {panel.notes.map((n) => (
                <text key={n.group} className="hv-dp-note" x={fx(n.x)} y={fx(n.y)}>
                  {n.text}
                </text>
              ))}
              <line className="hv-ch-axis" x1={fx(panel.left)} x2={fx(panel.right)} y1={fx(panel.axisY)} y2={fx(panel.axisY)} />
              {panel.ticks.map((t) => (
                <g key={`t${t.x}`}>
                  <line className="hv-ch-axis" x1={fx(t.x)} x2={fx(t.x)} y1={fx(panel.axisY)} y2={fx(panel.axisY + 4)} />
                  {t.label && (
                    <text className="hv-ch-tick hv-ch-tick--x" x={fx(t.x)} y={fx(panel.axisY + 17)}>
                      {t.label}
                    </text>
                  )}
                </g>
              ))}
            </g>

            {panel.rows.map((place, flat) => {
              const row = shownGroups[place.group]!.rows[place.row]!;
              const group = shownGroups[place.group]!;
              return (
                <g key={flat} className="hv-dp-row" data-row={flat} data-emph={row.emphasis} data-id={row.id}>
                  {place.min !== null && place.max !== null && place.max > place.min && (
                    <line className="hv-dp-range" x1={fx(place.min)} x2={fx(place.max)} y1={fx(place.y)} y2={fx(place.y)} />
                  )}
                  {place.mean !== null && <line className="hv-dp-mean" x1={fx(place.mean)} x2={fx(place.mean)} y1={fx(place.y - 10)} y2={fx(place.y + 10)} />}
                  {place.dots.map((d, di) => {
                    const run = row.runs[d.runIndex]!;
                    return (
                      <g key={di} data-dot={`${pi}:${flat}:${di}`} transform={`translate(${fx(d.x)} ${fx(d.y)})`}>
                        {run.valid === false && <circle className="hv-dp-ring" r={fx(L.radius + 4.5)} />}
                        <SystemMark id={row.id} emphasis={row.emphasis} r={row.emphasis === "quiet" ? L.radius * 1.5 : L.radius} />
                        <title>{runTip(model, group, row, run, panel.metric)}</title>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            <g data-part="means">
              {panel.rows.map((place, flat) => {
                if (place.mean === null) return null;
                const row = shownGroups[place.group]!.rows[place.row]!;
                const v = panel.metric === "stall" ? row.meanStall : row.meanExtra;
                return (
                  <text key={flat} className="hv-dp-meanv" data-emph={row.emphasis} x={fx(panel.meanX)} y={fx(place.y)}>
                    {v === null ? "" : dotValue(panel.metric, v)}
                  </text>
                );
              })}
            </g>
          </g>
        ))}

        <g className="hv-dp-key" data-part="axes">
          {L.key.map((k) => (
            <g key={k.kind}>
              {k.kind === "dot" && <circle className="hv-dp-key-dot" cx={fx(k.x + 5)} cy={fx(L.keyY)} r="4.5" />}
              {k.kind === "mean" && <line className="hv-dp-mean" x1={fx(k.x + 5)} x2={fx(k.x + 5)} y1={fx(L.keyY - 7)} y2={fx(L.keyY + 7)} />}
              {k.kind === "range" && <line className="hv-dp-range" x1={fx(k.x)} x2={fx(k.x + 11)} y1={fx(L.keyY)} y2={fx(L.keyY)} />}
              {k.kind === "ring" && (
                <g>
                  <circle className="hv-dp-ring" cx={fx(k.x + 6)} cy={fx(L.keyY)} r="6.5" />
                  <circle className="hv-dp-key-dot" cx={fx(k.x + 6)} cy={fx(L.keyY)} r="3" />
                </g>
              )}
              <text className="hv-dp-key-text" x={fx(k.x + 16)} y={fx(L.keyY)}>
                {k.label}
              </text>
            </g>
          ))}
        </g>
        {L.caption && (
          <text className="hv-ch-caption" x="10" y={fx(L.captionY)}>
            {L.caption}
          </text>
        )}
      </svg>

      {(["stall", "extra"] as DotMetric[]).map((metric) => (
        <ChartTable
          key={metric}
          caption={`${metric === "stall" ? "Stall time, in seconds" : "Extra cost, in percent against the same system's own run with no failures"}, one value for each run (seed) and their mean`}
          head={["System", "Failures", ...model.seeds.map((s) => `Seed ${s}`), "Mean"]}
          rows={model.groups.flatMap((g) =>
            g.rows.map((r) => {
              const at = (seed: string): string => {
                const run = r.runs.find((x) => x.seed === seed);
                const v = run ? (metric === "stall" ? run.stall : run.extra) : null;
                return v === null || v === undefined ? "none" : `${dotValue(metric, v)}${run?.valid === false ? " (result not valid)" : ""}`;
              };
              const mean = metric === "stall" ? r.meanStall : r.meanExtra;
              return [r.label, groupTitle(g, false), ...model.seeds.map(at), mean === null ? "none" : dotValue(metric, mean)];
            }),
          )}
        />
      ))}
    </div>
  );
}
