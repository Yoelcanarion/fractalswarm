import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { RegimeSlice } from "../../data/types";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import { ChartTable, useBox } from "./parts";
import {
  cellText,
  collectRegime,
  paintRegime,
  ratioNum,
  regimeCaptions,
  regimeLayout,
  regimeModel,
  regimeSummary,
  scaleAbout,
  WORD,
  type GlyphKind,
  type RegimeRig,
} from "./regime";

export type RegimeStripProps = VizProps<RegimeSlice> & {
  /** Print the setting (model, task, profile, seeds, the rival) under the chart. On unless the page prints it itself. */
  setting?: boolean;
};

/** What the box is before it is measured (and on the server): the page's chart frame at 1920 wide. */
const DEFAULT_BOX = { width: 1100, height: 460 };

/** One glyph, centred on the origin: a mark of the strip, or its twin in the key. */
function Glyph({ kind, r }: { kind: GlyphKind; r: number }) {
  switch (kind) {
    case "holds":
      return <circle className="hv-rg-holds" r={fx(r)} />;
    case "ties":
      return <circle className="hv-rg-ties" r={fx(r - 1)} />;
    case "fails": {
      const a = r * 0.72;
      return <path className="hv-rg-fails" d={`M${fx(-a)} ${fx(-a)}L${fx(a)} ${fx(a)}M${fx(a)} ${fx(-a)}L${fx(-a)} ${fx(a)}`} />;
    }
    case "na":
      return <path className="hv-rg-na" d={`M${fx(-r * 0.6)} 0H${fx(r * 0.6)}`} />;
    case "implausible":
      return <circle className="hv-rg-ring" r={fx(r)} />;
    case "default":
      return <path className="hv-rg-caret" d={`M${fx(-r * 0.7)} ${fx(-r * 0.4)}L0 ${fx(r * 0.5)}L${fx(r * 0.7)} ${fx(-r * 0.4)}Z`} />;
  }
}

export function RegimeStrip({ progress, data, still, stillAt, className, setting = true }: RegimeStripProps) {
  const model = useMemo(() => regimeModel(data), [data]);
  const captions = useMemo(() => regimeCaptions(model), [model]);
  const summary = useMemo(() => regimeSummary(model), [model]);

  const [root, box] = useBox(DEFAULT_BOX);
  const layout = useMemo(() => regimeLayout(model, box.width, box.height, setting ? captions : []), [model, box, captions, setting]);

  const svg = useRef<SVGSVGElement>(null);
  const rig = useRef<RegimeRig | null>(null);
  const live = useRef(layout);
  live.current = layout;
  const last = useRef(0);
  const apply = useCallback((p: number) => {
    last.current = p;
    if (rig.current) paintRegime(rig.current, live.current, p);
  }, []);
  useLayoutEffect(() => {
    if (!svg.current) return;
    rig.current = collectRegime(svg.current);
    apply(last.current);
  }, [layout, apply]);
  useProgress(progress, apply, still, stillAt);

  const L = layout;
  const R = L.markR;

  return (
    <div ref={root} className={className ? `hv hv-chart hv-rg ${className}` : "hv hv-chart hv-rg"}>
      <svg ref={svg} className="hv-ch-svg" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="img" aria-label={summary}>
        {model.rows.map((row, r) => {
          const rl = L.rows[r]!;
          return (
            <g key={row.axis} className="hv-rg-row" data-axis={row.axis}>
              <g data-head data-r={r}>
                {rl.head.lines.map((line, i) => (
                  <text key={i} className="hv-rg-head" x={fx(rl.head.x)} y={fx(rl.head.y + i * 16)}>
                    {line}
                  </text>
                ))}
              </g>
              {row.cells.map((c, k) => {
                const pt = rl.points[k]!;
                return (
                  <g key={k} data-pl data-r={r} data-k={k}>
                    {pt.band && <rect className="hv-rg-band" x={fx(pt.band.x)} y={fx(pt.band.y)} width={fx(pt.band.w)} height={fx(pt.band.h)} rx="6" />}
                    <text className={c.isDefault ? "hv-rg-val hv-rg-val--default" : "hv-rg-val"} x={fx(pt.cx)} y={fx(pt.valueY)}>
                      {pt.value}
                    </text>
                    {pt.ratio !== null && pt.ratioY !== null && (
                      <text className="hv-rg-ratio" x={fx(pt.cx)} y={fx(pt.ratioY)}>
                        {pt.ratio}
                      </text>
                    )}
                  </g>
                );
              })}
              <line
                className="hv-rg-rail"
                data-rail
                data-r={r}
                x1={fx(rl.rail.x1)}
                x2={fx(rl.rail.x2)}
                y1={fx(rl.rail.y)}
                y2={fx(rl.rail.y)}
                transform={scaleAbout(rl.rail.x1, rl.rail.y, 1, 1)}
              />
              {row.cells.map((c, k) => {
                const pt = rl.points[k]!;
                return (
                  <g key={k} data-mark data-r={r} data-k={k} transform={`translate(${fx(pt.cx)} ${fx(pt.cy)}) scale(1.000)`}>
                    <g className={c.plausible ? "hv-rg-glyph" : "hv-rg-glyph hv-rg-glyph--out"} data-locality={c.locality}>
                      <circle className="hv-rg-halo" r={fx(R + (c.plausible ? 3.5 : 6))} />
                      {!c.plausible && <circle className="hv-rg-ring" r={fx(R + 5)} />}
                      <Glyph kind={c.locality === "n/a" ? "na" : c.locality} r={R} />
                    </g>
                    {c.isDefault && (
                      <g transform={`translate(0 ${fx(-(R + 10))})`}>
                        <Glyph kind="default" r={5} />
                      </g>
                    )}
                  </g>
                );
              })}
              {row.cells.map((c, k) => {
                const pt = rl.points[k]!;
                return (
                  <rect
                    key={k}
                    className="hv-rg-hit"
                    x={fx(pt.cx - L.pitch / 2)}
                    y={fx(pt.cy - L.lane / 2)}
                    width={fx(L.pitch)}
                    height={fx(pt.valueY + 8 + (pt.ratioY !== null ? 16 : 0) - (pt.cy - L.lane / 2))}
                  >
                    <title>{cellText(model, row, c)}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        <g data-part="key">
          {L.key.map((item) => (
            <g key={item.kind}>
              <g transform={`translate(${fx(item.x + 8)} ${fx(item.y)})`}>
                <Glyph kind={item.kind} r={item.kind === "ties" ? 6.5 : 6} />
              </g>
              <text className="hv-rg-key" x={fx(item.x + 24)} y={fx(item.y)}>
                {item.label}
              </text>
            </g>
          ))}
          {L.ratioNote && (
            <text className="hv-rg-key" x={fx(L.ratioNote.x)} y={fx(L.ratioNote.y)}>
              {L.ratioNote.text}
            </text>
          )}
        </g>

        {L.caption.lines.map((line, i) => (
          <text key={i} className="hv-ch-caption" x={fx(L.caption.x)} y={fx(L.caption.y + i * 16)}>
            {line}
          </text>
        ))}
      </svg>

      <ChartTable
        caption={`Locality of the swarm against the ${model.againstLabel.toLowerCase()} at each setting that was run, one assumption moved at a time: it holds when the coordinator-dependency time and the blast radius are wins and idle agent-seconds is not a loss, fails when the first or the second is a loss, and ties otherwise (PREREG section 4). Ratios of the swarm's mean to the supervisor's, over the seeds.`}
        head={["Setting", "Locality", "Coordinator-dependency time", "Blast radius", "Idle agent-seconds", "In the plausible region", "The default"]}
        rows={model.rows.flatMap((row) =>
          row.cells.map((c) => [
            `${row.label} ${c.value}`,
            WORD[c.locality],
            c.cdt === null ? "none" : ratioNum(c.cdt),
            c.blast === null ? "none" : ratioNum(c.blast),
            c.idle === null ? "none" : ratioNum(c.idle),
            c.plausible ? "yes" : "no",
            c.isDefault ? "yes" : "no",
          ]),
        )}
      />
    </div>
  );
}
