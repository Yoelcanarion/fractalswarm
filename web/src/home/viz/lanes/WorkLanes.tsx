import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LanesSlice } from "../../data/types";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import { LABEL_W, READOUT_W, layoutFor, textWidth } from "./layout";
import { lanesModel, lifeTracks, timeMap, type Bar, type LanesModel } from "./model";
import { collectLanes, paintLanes, seconds, usd, type LanesRig } from "./paint";

export type WorkLanesProps = VizProps<LanesSlice>;

/** What the box is before it is measured (and on the server): the size of the page's frame at 1920 wide. */
const DEFAULT_BOX = { width: 820, height: 700, top: 180 };

/** The task as a person says it: t2_conference becomes "T2 conference". */
const taskName = (task: string): string => task.replace(/^t(\d+)_/, "T$1 ").replace(/_/g, " ");
const taskShort = (task: string): string => task.replace(/^(t\d+)_.*/, (_, t: string) => t.toUpperCase());

/** The setting of the run, longest form first: the one that fits the width is printed under the lanes. */
export function captionsFor(data: LanesSlice): string[] {
  const s = data.setting;
  if (!s) return [];
  return [
    `${s.label} · ${taskName(s.task)} · failure profile ${s.profile} · ${s.real ? "real" : "fake"} model · seed ${s.seed}`,
    `${s.label} · ${taskShort(s.task)} · ${s.profile} · ${s.real ? "real" : "fake"} · seed ${s.seed}`,
    `${taskShort(s.task)} · ${s.profile} · ${s.real ? "real" : "fake"} · seed ${s.seed}`,
  ];
}

/** The text alternative: what the lanes show, from the numbers of the data. */
export function summaryFor(model: LanesModel, data: LanesSlice): string {
  const s = data.setting;
  const agents = model.lanes.filter((l) => !l.brain).length;
  const where = s ? ` (${s.label}, ${taskName(s.task)}, failure profile ${s.profile}, ${s.real ? "real" : "fake"} model, seed ${s.seed})` : "";
  return (
    `One recorded run${where} drawn as work lanes: a coordinator and ${agents} agents, one lane each, with a bar for every call to the model. ` +
    `The coordinator crashes ${model.crashes.length} times and ${model.kills.length} agents are killed. ` +
    `${model.counts.cut} calls are cut off and ${model.counts.again} are paid for again. ` +
    `Of the ${usd(model.micro.total)} the run cost, ${usd(model.micro.counted + model.micro.other)} bought calls that counted, ` +
    `${usd(model.micro.cut)} calls that were cut off and ${usd(model.micro.again)} calls paid for again. ` +
    `No agent was working for ${seconds(model.stallMs)} of the run's ${seconds(model.durationMs)}.`
  );
}

const CROSS = "M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5";

const LEDGER = [
  { key: "counted", label: "counted" },
  { key: "cut", label: "cut off" },
  { key: "again", label: "paid again" },
  { key: "idle", label: "no agent working" },
] as const;

export function WorkLanes({ progress, data, still, stillAt, className }: WorkLanesProps) {
  const model = useMemo(() => lanesModel(data), [data]);
  const map = useMemo(() => timeMap(model), [model]);
  const captions = useMemo(() => captionsFor(data), [data]);
  const summary = useMemo(() => summaryFor(model, data), [model, data]);

  const root = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState(DEFAULT_BOX);
  const layout = useMemo(() => layoutFor(model, box.width, box.height, box.top, captions), [model, box, captions]);

  const live = useRef({ model, map, layout });
  live.current = { model, map, layout };
  const rig = useRef<LanesRig | null>(null);
  const last = useRef(0);

  const apply = useCallback((p: number) => {
    last.current = p;
    if (rig.current) paintLanes(rig.current, live.current.model, live.current.layout, live.current.map, p);
  }, []);

  // The box is measured when it changes size, never while the lanes move. The probe is as tall as the page's
  // counter, which sits over the top left of the box: the lanes start below it.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const measure = (): void => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      const top = Math.round(probe.current?.getBoundingClientRect().height ?? 0) || DEFAULT_BOX.top;
      if (width < 160 || height < 160) return;
      setBox((prev) => (prev.width === width && prev.height === height && prev.top === top ? prev : { width, height, top }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!svg.current) return;
    rig.current = collectLanes(svg.current, model);
    apply(last.current);
  }, [model, layout, apply]);
  useProgress(progress, apply, still, stillAt);

  const L = layout;
  const mid = (lane: number): number => L.lanes[lane]!.y + L.lanes[lane]!.h / 2;
  const tracks = lifeTracks(model);
  const bar = (b: Bar) => {
    const at = L.barBox(b);
    return (
      <rect
        key={b.index}
        className="hv-ln-bar"
        data-bar={b.index}
        data-kind={b.kind}
        data-state="hidden"
        x={fx(at.x)}
        y={fx(at.y)}
        width="0"
        height={fx(at.h)}
        rx={fx(Math.min(2.5, at.h / 3))}
      />
    );
  };
  const kept = model.bars.filter((b) => b.kind === "counted" || b.kind === "other");
  const lost = model.bars.filter((b) => b.kind === "cut" || b.kind === "again");

  return (
    <div ref={root} className={className ? `hv hv-lanes ${className}` : "hv hv-lanes"} role="img" aria-label={summary}>
      <div ref={probe} className="hv-ln-probe" aria-hidden="true" />
      <svg ref={svg} className="hv-ln-svg" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} aria-hidden="true">
        {/* the rows and the minutes behind everything */}
        <g className="hv-ln-back">
          {model.lanes.map((lane) =>
            lane.index % 2 === 1 ? <rect key={lane.id} className="hv-ln-zebra" x={fx(L.x0)} y={fx(L.lanes[lane.index]!.y)} width={fx(L.x1 - L.x0)} height={fx(L.lanes[lane.index]!.h)} /> : null,
          )}
          {L.ticks.map((t) => (
            <line key={t.label} className="hv-ln-grid" x1={fx(t.x)} x2={fx(t.x)} y1={fx(L.yTop)} y2={fx(L.yBottom)} />
          ))}
          <line className="hv-ln-rule" x1={fx(L.x0)} x2={fx(L.x1)} y1={fx(L.lanes[0]!.y + L.lanes[0]!.h)} y2={fx(L.lanes[0]!.y + L.lanes[0]!.h)} />
        </g>

        {model.lanes.map((lane) => (
          <text key={lane.id} className="hv-ln-label" data-lane-label={lane.index} data-brain={lane.brain} x={LABEL_W} y={fx(mid(lane.index))}>
            {lane.label}
          </text>
        ))}

        {/* the time nobody worked */}
        <g className="hv-ln-stalls">
          {model.stalls.map((s) => (
            <rect key={s.index} className="hv-ln-stall" data-stall={s.index} data-opened-by={s.crash ?? undefined} x={fx(L.xAt(s.startMs))} y={fx(L.yTop)} width="0" height={fx(L.yBottom - L.yTop)} />
          ))}
        </g>

        {/* while an agent's process was alive */}
        <g className="hv-ln-tracks">
          {tracks.map((t, i) => (
            <line key={i} className="hv-ln-track" data-track={i} x1={fx(L.xAt(t.startMs))} x2={fx(L.xAt(t.startMs))} y1={fx(mid(t.lane))} y2={fx(mid(t.lane))} />
          ))}
        </g>

        <g data-group="counted">{kept.map(bar)}</g>
        <g className="hv-ln-lost">{lost.map(bar)}</g>

        {/* the crashes and the agents that were killed */}
        <g className="hv-ln-crashes">
          {model.crashes.map((c, i) => {
            const m = L.crashMarks[i]!;
            return (
              <g key={c.n} data-crash={c.n} opacity="0">
                <line className="hv-ln-crash" x1={fx(m.x)} x2={fx(m.x)} y1={fx(L.markY + 5)} y2={fx(L.yBottom)} />
                <path className="hv-ln-cross" d={CROSS} transform={`translate(${fx(m.x)} ${fx(L.markY)})`} />
                {m.numbered && (
                  <text className="hv-ln-crash-n" x={fx(m.x + 8)} y={fx(L.markY + 4)}>
                    {c.n}
                  </text>
                )}
              </g>
            );
          })}
          {model.kills.map((k) => (
            <path key={k.lane} className="hv-ln-cross hv-ln-cross--kill" data-kill={k.lane} d={CROSS} transform={`translate(${fx(L.xAt(k.atMs))} ${fx(mid(k.lane))}) scale(0.8)`} opacity="0" />
          ))}
        </g>

        <line className="hv-ln-cursor" x1="0" x2="0" y1={fx(L.yTop - 6)} y2={fx(L.axisY + 3)} />

        {/* each period of waiting, told once the damage is shown */}
        <g data-group="notes" opacity="0">
          {L.stallLabels.map((label) => {
            const s = model.stalls[label.stall]!;
            const y0 = L.yBottom + 4;
            return (
              <g key={label.stall}>
                <path className="hv-ln-bracket" d={`M${fx(L.xAt(s.startMs))} ${fx(y0)}v4H${fx(L.xAt(s.endMs))}v-4`} />
                <text className="hv-ln-stall-label" x={fx(label.x)} y={fx(L.stallLabelY)}>
                  {label.text}
                </text>
              </g>
            );
          })}
        </g>

        {/* the time axis, and the moment of the run being shown */}
        <g className="hv-ln-axisg">
          <line className="hv-ln-axis" x1={fx(L.x0)} x2={fx(L.x1)} y1={fx(L.axisY)} y2={fx(L.axisY)} />
          {L.ticks.map((t) => (
            <g key={t.label}>
              <line className="hv-ln-tick" x1={fx(t.x)} x2={fx(t.x)} y1={fx(L.axisY)} y2={fx(L.axisY + 4)} />
              <text className="hv-ln-tick-label" x={fx(t.x)} y={fx(L.tickY)} textAnchor="middle">
                {t.label}
              </text>
            </g>
          ))}
        </g>

        {/* the moment of the run being shown: a box on the cursor, over the axis' numbers */}
        <g className="hv-ln-readout" transform="translate(0 0)" opacity="0">
          <rect className="hv-ln-readout-bg" x={-READOUT_W / 2} y={fx(L.tickY - 13)} width={READOUT_W} height="18" rx="4" />
          <text className="hv-ln-clock" x="0" y={fx(L.tickY)} textAnchor="middle">
            0.0 s
          </text>
        </g>

        {/* what was paid for, by kind of call */}
        <g className="hv-ln-ledger">
          {LEDGER.map((entry, i) => {
            const c = L.ledger[i]!;
            return (
              <g key={entry.key}>
                <rect className="hv-ln-swatch" data-swatch={entry.key} x={fx(c.x)} y={fx(c.y - 5)} width="10" height="10" rx="2" />
                <text className="hv-ln-ledger-label" x={fx(c.x + 16)} y={fx(c.y + 4)}>
                  {entry.label}
                </text>
                <text className="hv-ln-ledger-value" data-value={entry.key} x={fx(c.x + 16 + textWidth(entry.label) + 8)} y={fx(c.y + 4)} />
              </g>
            );
          })}
        </g>
        {L.caption && (
          <text className="hv-ln-caption" x="8" y={fx(L.captionY)}>
            {L.caption}
          </text>
        )}
      </svg>
    </div>
  );
}
