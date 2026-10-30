import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { VerdictsSlice } from "../../data/types";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import { labelOf, systemName } from "./names";
import {
  barPath,
  collectPairs,
  pairCaptions,
  pairLayout,
  pairModel,
  pairSummary,
  paintPairs,
  valueText,
  verdictWords,
  type PairRig,
} from "./pairs";
import { ChartTable, useBox } from "./parts";

export type PairedBarsProps = VizProps<VerdictsSlice> & {
  /** The rival the swarm's bars are held against: the ideal durable supervisor, the strictest of them, unless told otherwise. */
  rival?: string;
  /** Print the setting (task, model, seeds) under the chart. A page that prints it itself turns it off. */
  setting?: boolean;
};

/** What the box is before it is measured (and on the server): the page's chart frame at 1920 wide. */
const DEFAULT_BOX = { width: 1100, height: 420 };

export function PairedBars({ progress, data, still, stillAt, className, rival = "durable-max", setting = true }: PairedBarsProps) {
  const model = useMemo(() => pairModel(data, rival), [data, rival]);
  const captions = useMemo(() => pairCaptions(model), [model]);
  const summary = useMemo(() => pairSummary(model), [model]);

  const [root, box] = useBox(DEFAULT_BOX);
  const layout = useMemo(() => pairLayout(model, box.width, box.height, setting ? captions : []), [model, box, captions, setting]);

  const svg = useRef<SVGSVGElement>(null);
  const rig = useRef<PairRig | null>(null);
  const live = useRef(layout);
  live.current = layout;
  const last = useRef(0);
  const apply = useCallback((p: number) => {
    last.current = p;
    if (rig.current) paintPairs(rig.current, live.current, p);
  }, []);
  useLayoutEffect(() => {
    if (!svg.current) return;
    rig.current = collectPairs(svg.current);
    apply(last.current);
  }, [layout, apply]);
  useProgress(progress, apply, still, stillAt);

  const L = layout;
  const swarmName = systemName("swarm", labelOf("swarm"), L.names);
  const rivalName = systemName(model.rival, model.rivalLabel, L.names);

  return (
    <div ref={root} className={className ? `hv hv-chart hv-pb ${className}` : "hv hv-chart hv-pb"}>
      <svg ref={svg} className="hv-ch-svg" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="img" aria-label={summary}>
        <g data-part="axes">
          <line className="hv-pb-half" x1={fx(L.halfX)} x2={fx(L.halfX)} y1={fx(L.guideTop)} y2={fx(L.axisY)} />
          <line className="hv-ch-axis" x1={fx(L.x0)} x2={fx(L.x0)} y1={fx(L.guideTop)} y2={fx(L.axisY)} />
          <line className="hv-ch-axis" x1={fx(L.x0)} x2={fx(L.xAt(model.domainMax))} y1={fx(L.axisY)} y2={fx(L.axisY)} />
          {L.ticks.map((t) => (
            <g key={t.label}>
              <line className="hv-ch-axis" x1={fx(t.x)} x2={fx(t.x)} y1={fx(L.axisY)} y2={fx(L.axisY + 4)} />
              <text className="hv-ch-tick hv-ch-tick--x" x={fx(t.x)} y={fx(L.axisY + 17)}>
                {t.label}
              </text>
            </g>
          ))}
          <text className="hv-ch-axis-title hv-pb-axis-title" x={fx(L.axisTitle.x)} y={fx(L.axisTitle.y)}>
            {L.axisTitle.text}
          </text>
          {model.rows.map((row, i) => {
            const g = L.groups[i]!;
            return (
              <g key={row.hypothesis}>
                <text className="hv-ch-head" x={fx(L.labelX)} y={fx(g.titleY)}>
                  <tspan className="hv-ch-name" style={L.titleSize === null ? undefined : { fontSize: L.titleSize }}>
                    {row.name}
                  </tspan>
                  {row.sub && g.sub && (
                    <tspan className="hv-ch-sub" dx="8">
                      {row.sub}
                    </tspan>
                  )}
                </text>
                <text className="hv-pb-name hv-pb-name--swarm" x={fx(L.labelX)} y={fx(g.swarm.y + g.swarm.h / 2)}>
                  {swarmName}
                </text>
                <text className="hv-pb-name" x={fx(L.labelX)} y={fx(g.rival.y + g.rival.h / 2)}>
                  {rivalName}
                </text>
              </g>
            );
          })}
          <line className="hv-pb-half hv-pb-half--key" x1={fx(L.x0)} x2={fx(L.x0 + 22)} y1={fx(L.keyY)} y2={fx(L.keyY)} />
          <text className="hv-pb-key" x={fx(L.x0 + 30)} y={fx(L.keyY)}>
            {L.key}
          </text>
        </g>

        {model.rows.map((row, i) => {
          const g = L.groups[i]!;
          return (
            <g key={row.hypothesis}>
              <path className="hv-pb-bar hv-pb-bar--rival" data-bar="rival" data-g={i} d={barPath(g.rival.x, g.rival.y, g.rival.w, g.rival.h)}>
                <title>{`${model.rivalLabel}, ${row.name}: ${valueText(row, row.rival)}`}</title>
              </path>
              <path className="hv-pb-bar hv-pb-bar--swarm" data-bar="swarm" data-g={i} d={barPath(g.swarm.x, g.swarm.y, g.swarm.w, g.swarm.h)}>
                <title>{`${labelOf("swarm")}, ${row.name}: ${valueText(row, row.swarm)}, ${Math.round(row.fraction * 100)}% of the ${model.rivalLabel.toLowerCase()}'s ${valueText(row, row.rival)}`}</title>
              </path>
            </g>
          );
        })}

        <g data-part="labels">
          {model.rows.map((row, i) => {
            const g = L.groups[i]!;
            return (
              <g key={row.hypothesis}>
                <text className="hv-pb-value hv-pb-value--swarm" x={fx(g.swarm.x + g.swarm.w + 8)} y={fx(g.swarm.y + g.swarm.h / 2)}>
                  {valueText(row, row.swarm)}
                </text>
                <text className="hv-pb-value" x={fx(g.rival.x + g.rival.w + 8)} y={fx(g.rival.y + g.rival.h / 2)}>
                  {valueText(row, row.rival)}
                </text>
                <g className="hv-pb-pill" data-verdict={row.verdict}>
                  <rect x={fx(g.pill.x)} y={fx(g.pill.y)} width={fx(g.pill.w)} height="20" rx="10" />
                  <text x={fx(g.pill.x + g.pill.w / 2)} y={fx(g.pill.y + 10)}>
                    {g.pill.text}
                  </text>
                  <title>{verdictWords(row.verdict, row.mixed)}</title>
                </g>
              </g>
            );
          })}
          {L.note && (
            <text className="hv-pb-key hv-pb-note" x={fx(L.noteX)} y={fx(L.noteY)}>
              {L.note}
            </text>
          )}
        </g>

        {L.caption && (
          <text className="hv-ch-caption" x="10" y={fx(L.captionY)}>
            {L.caption}
          </text>
        )}
      </svg>

      <ChartTable
        caption={`Locality, the mean of the seeds, the swarm against the ${model.rivalLabel.toLowerCase()} and against the ${labelOf("durable").toLowerCase()}, with the verdict of the pre-registered per-seed rule`}
        head={["Measure", labelOf("swarm"), model.rivalLabel, "Part of it", "Verdict", labelOf("durable"), "Part of it", "Verdict"]}
        rows={model.rows.map((r) => [
          `${r.name} (${r.hypothesis}${r.sub ? `, ${r.sub}` : ""})`,
          valueText(r, r.swarm),
          valueText(r, r.rival),
          `${Math.round(r.fraction * 100)}%`,
          verdictWords(r.verdict, r.mixed),
          r.other && r.other.value !== null ? valueText(r, r.other.value) : "none",
          r.other && r.other.ratio !== null ? `${Math.round(r.other.ratio * 100)}%` : "none",
          r.other ? verdictWords(r.other.verdict, r.other.mixed) : "none",
        ])}
      />
    </div>
  );
}
