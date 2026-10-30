import { useCallback, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { TokensSlice } from "../../data/types";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import { grouped, scaleAbout } from "./chart";
import { ChartTable, useBox } from "./parts";
import { collectTokens, paintTokens, percent, tokenLayout, tokenModel, tokenSummary, type TokenRig } from "./tokens";

/** What the box is before it is measured (and on the server): the page's frame for the bar, 56 px high. */
const DEFAULT_BOX = { width: 900, height: 56 };

export function TokenBar({ progress, data, still, stillAt, className }: VizProps<TokensSlice>) {
  const model = useMemo(() => tokenModel(data), [data]);
  const summary = useMemo(() => tokenSummary(model), [model]);

  const [root, box] = useBox(DEFAULT_BOX);
  const layout = useMemo(() => tokenLayout(model, box.width, box.height), [model, box]);

  const svg = useRef<SVGSVGElement>(null);
  const rig = useRef<TokenRig | null>(null);
  const last = useRef(0);
  const apply = useCallback((p: number) => {
    last.current = p;
    if (rig.current) paintTokens(rig.current, p);
  }, []);
  useLayoutEffect(() => {
    if (!svg.current) return;
    rig.current = collectTokens(svg.current);
    apply(last.current);
  }, [layout, apply]);
  useProgress(progress, apply, still, stillAt);

  const L = layout;
  const clip = `tk${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div ref={root} className={className ? `hv hv-tk ${className}` : "hv hv-tk"}>
      <svg ref={svg} className="hv-ch-svg" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="img" aria-label={summary}>
        <defs>
          <clipPath id={clip}>
            <rect data-wipe x="0" y="0" width={fx(L.width)} height={fx(L.height)} transform={scaleAbout(0, 0, 1, 1)} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          {L.segments.map((seg, i) => {
            const row = model.rows[i]!;
            return (
              <rect key={seg.model} className={`hv-tk-seg hv-tk-seg--${seg.kind}`} x={fx(seg.x)} y={fx(L.barY)} width={fx(seg.w)} height={fx(L.barH)} rx={fx(Math.min(L.radius, seg.w / 2))}>
                <title>{`${row.name}: ${grouped(row.tokens)} tokens, ${percent(row.share)} of the run's tokens. ${grouped(row.input)} read, ${grouped(row.output)} written, ${grouped(row.reasoning)} of those written while reasoning; ${row.calls} ${row.calls === 1 ? "call" : "calls"}.`}</title>
              </rect>
            );
          })}
        </g>
        <g data-part="legend">
          {L.legend.map((item) => (
            <g key={`${item.kind}-${item.row}-${item.x}`}>
              {item.kind === "guard" ? (
                <circle className="hv-tk-dot hv-tk-dot--guard" cx={fx(item.x + 5)} cy={fx(item.y)} r="4.5" />
              ) : (
                <rect className={`hv-tk-swatch hv-tk-seg--${item.kind}`} x={fx(item.x)} y={fx(item.y - 4)} width="10" height="8" rx="2.5" />
              )}
              <text className="hv-tk-text" x={fx(item.x + 16)} y={fx(item.y)}>
                {item.text}
              </text>
            </g>
          ))}
        </g>
      </svg>

      <ChartTable
        caption="Tokens by model in the recorded run, with the guard that read the inputs before any model did (it spends no tokens)"
        head={["Model", "Tokens", "Share of the run", "Read", "Written", "Of which reasoning", "Calls"]}
        rows={[
          ...model.rows.map((r) => [r.name, grouped(r.tokens), percent(r.share), grouped(r.input), grouped(r.output), grouped(r.reasoning), r.calls]),
          ...(model.guard ? [[model.guard.name, "0", "0%", "0", "0", "0", model.guard.text]] : []),
        ]}
      />
    </div>
  );
}
