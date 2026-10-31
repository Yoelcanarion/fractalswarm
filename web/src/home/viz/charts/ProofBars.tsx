import { useId, useMemo, useRef, useState, type RefObject } from "react";
import { useIsoLayoutEffect } from "../../hooks";
import { useStory } from "../../story";
import { useCalm } from "../page";
import { fx } from "../shared";
import { onFrame } from "../ticker";
import "../viz.css";
import { whileVisible } from "../visible";
import { proofPanels, proofReading, type ProofStory } from "./proof";
import {
  barLength,
  barNumber,
  collectProof,
  DEFAULT_W,
  DOT_R,
  dotsOpacity,
  dotsShift,
  layoutProof,
  paintProof,
  TOTAL,
  type LineGeo,
  type PanelGeo,
  type ProofGeo,
} from "./proofLayout";

export interface ProofBarsProps {
  /** 0 is not yet (the bars are at nothing); each increment grows them again, by themselves, from nothing. */
  play: number;
  /** The home data to draw; the page's own story when absent, and nothing when the page has none. */
  data?: ProofStory | null;
  /** Standing still, which the page says through its own context when this is absent: the chart whole, at once. */
  still?: boolean | undefined;
  className?: string;
}

/**
 * The swarm against each rival on the same task, in one drawing. Against the in-process supervisor: a bar and a number for the swarm
 * and for it, for the stall and for the extra cost. Against the ideal durable supervisor the data's verdict is a tie, and two bars
 * of the means would read as a win, so each seed is a dot on one shared axis with the verdict beside it as the data gives it. The
 * rival's name and the setting are in the drawing; the two panels stand side by side from a thousand pixels, and then say a setting
 * they share once. Bars, numbers and dots grow once, together, by one eased share each (1.25 to 1.6 s), written by one frame loop
 * that runs only while the chart is on screen.
 */
export function ProofBars({ play, data, still, className }: ProofBarsProps) {
  const page = useStory();
  const source: ProofStory | null = data === undefined ? page : data;
  const calm = useCalm(still);
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  /** How far the growth of the current `play` has got, kept across redraws (a resize) so that a finished chart stays whole. */
  const run = useRef({ play: -1, elapsed: 0 });
  const [width, setWidth] = useState(DEFAULT_W);

  const swarm = source?.workflows["swarm"] ?? "swarm";
  const panels = useMemo(() => (source ? proofPanels(source) : []), [source]);
  const geo = useMemo(() => layoutProof(panels, width, swarm), [panels, width, swarm]);
  const reading = useMemo(() => proofReading(panels, swarm), [panels, swarm]);
  /** The moment the markup is drawn at: whole when still, at nothing before the page plays it. */
  const at = calm ? Infinity : 0;

  useIsoLayoutEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const measure = (): void => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const watcher = new ResizeObserver(measure);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  useIsoLayoutEffect(() => {
    const element = svg.current;
    if (!element) return undefined;
    const rig = collectProof(element, geo);
    const state = run.current;
    if (state.play !== play) {
      state.play = play;
      state.elapsed = 0;
    }
    if (calm) {
      paintProof(rig, Infinity);
      return undefined;
    }
    if (play <= 0) {
      paintProof(rig, 0);
      return undefined;
    }
    paintProof(rig, state.elapsed);
    if (state.elapsed >= TOTAL) return undefined;
    let off: (() => void) | null = null;
    return whileVisible(host.current, () => {
      off = onFrame((dt) => {
        state.elapsed += dt;
        paintProof(rig, state.elapsed);
        if (state.elapsed >= TOTAL) off?.();
      });
      return () => off?.();
    });
  }, [geo, play, calm]);

  return (
    <div ref={host} className={className ? `hv-proof ${className}` : "hv-proof"} data-play={calm ? "still" : play > 0 ? "on" : "off"}>
      {source && <ProofDrawing geo={geo} reading={reading} at={at} id={id} svgRef={svg} />}
    </div>
  );
}

/** The drawing of a layout, at the moment `at` of its growth (Infinity is whole). */
export function ProofDrawing({ geo, reading, at, id, svgRef }: { geo: ProofGeo; reading: string; at: number; id: string; svgRef?: RefObject<SVGSVGElement> }) {
  return (
    <svg
      ref={svgRef}
      className="hv hv-proof-svg"
      width={geo.width}
      height={geo.height}
      viewBox={`0 0 ${geo.width} ${geo.height}`}
      role="img"
      aria-labelledby={`${id}-t ${id}-d`}
    >
      <title id={`${id}-t`}>The swarm against two rivals</title>
      <desc id={`${id}-d`}>{reading}</desc>
      {geo.panels.map((panel) => (
        <Panel key={panel.id} panel={panel} at={at} />
      ))}
      {geo.setting && (
        <text className="hv-proof-t hv-proof-setting" x={fx(geo.setting.at.x)} y={fx(geo.setting.at.y)}>
          {geo.setting.text}
        </text>
      )}
    </svg>
  );
}

function Panel({ panel, at }: { panel: PanelGeo; at: number }) {
  return (
    <g data-panel={panel.id} transform={panel.x === 0 ? undefined : `translate(${fx(panel.x)} 0)`}>
      <text className="hv-proof-t hv-proof-rival" x={fx(panel.rivalAt.x)} y={fx(panel.rivalAt.y)}>
        {panel.rival}
      </text>
      {panel.setting && (
        <text className="hv-proof-t hv-proof-setting" x={fx(panel.settingAt.x)} y={fx(panel.settingAt.y)} textAnchor={panel.settingEnd ? "end" : "start"}>
          {panel.setting}
        </text>
      )}
      {panel.rows.map((row) => (
        <g key={row.id} data-row={row.id}>
          <text className="hv-proof-t hv-proof-label" x={fx(row.labelAt.x)} y={fx(row.labelAt.y)}>
            {row.label}
          </text>
          {row.chip && (
            <g className="hv-proof-chip" transform={`translate(${fx(row.chip.x)} ${fx(row.chip.y)})`}>
              <rect width={fx(row.chip.w)} height={fx(row.chip.h)} rx={fx(row.chip.h / 2)} />
              <text className="hv-proof-t" x={fx(row.chip.w / 2)} y={fx(row.chip.h / 2)} textAnchor="middle">
                {row.chip.text}
              </text>
            </g>
          )}
          {row.zero && <line className="hv-proof-zero" x1={fx(row.zero.x)} x2={fx(row.zero.x)} y1={fx(row.zero.y1)} y2={fx(row.zero.y2)} />}
          {row.lines.map((line) => (
            <Line key={line.who} line={line} at={at} />
          ))}
        </g>
      ))}
    </g>
  );
}

function Line({ line, at }: { line: LineGeo; at: number }) {
  const { bar, track } = line;
  return (
    <g data-who={line.who}>
      <text className="hv-proof-t hv-proof-name" x={fx(line.nameAt.x)} y={fx(line.nameAt.y)}>
        {line.name}
      </text>
      <rect className="hv-proof-track" x={fx(track.x)} y={fx(track.y)} width={fx(track.w)} height={fx(track.h)} rx={fx(track.h / 2)} />
      {bar && (
        <>
          <rect data-bar="" className="hv-proof-bar" x={fx(bar.x)} y={fx(bar.y)} width={fx(barLength(bar, at))} height={fx(bar.height)} rx={fx(bar.height / 2)} />
          <text data-num="" className="hv-proof-t hv-proof-val" x={fx(bar.value.x)} y={fx(bar.value.y)} textAnchor="end">
            {barNumber(bar, at)}
          </text>
        </>
      )}
      {line.dots.length > 0 && (
        <g data-dots="" opacity={fx(dotsOpacity(line.order, at))} transform={`translate(${fx(dotsShift(line.order, at))} 0)`}>
          {line.dots.map((dot) => (
            <circle key={dot.seed} className="hv-proof-dot" cx={fx(dot.cx)} cy={fx(dot.cy)} r={DOT_R}>
              <title>{`Run ${dot.seed}: ${dot.text}`}</title>
            </circle>
          ))}
        </g>
      )}
    </g>
  );
}
