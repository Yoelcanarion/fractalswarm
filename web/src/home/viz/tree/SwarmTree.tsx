import type { MotionValue } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { prefersReducedMotion } from "../../../lib/motion";
import type { TreeSlice } from "../../data/types";
import { fx, useProgress, type VizProps } from "../shared";
import { onFrame } from "../ticker";
import "../viz.css";
import { whileVisible } from "../visible";
import { Ambient } from "./ambient";
import { treePlayer, type TreeFrame } from "./frame";
import type { KillInfo, NodeInfo, TreeModel } from "./model";
import { collectTree, MAX_DASHES, paintAmbient, paintTree, SCORE_WIDTH, U, type TreeRig } from "./paint";
import type { Pacing } from "./timeline";

/** The ambient layer reads the frame the loop has just painted, so it runs after it (see ticker.ts). */
const AMBIENT_ORDER = 10;

export interface SwarmTreeProps extends VizProps<TreeSlice> {
  /** "story" (the default, the one TREE_KEYFRAMES describe): slow enough to read, for a scroll.
   * "hero": about nine seconds when driven by time. */
  pacing?: Pacing;
  /** Under each node: its id; its id and name; nothing. */
  labels?: "ids" | "names" | "none";
  /** The run clock in the corner. */
  clock?: boolean;
  /**
   * The ambient layer (ambient.ts): pulses along the live edges, a halo breathing round each live brain, a ring pinging round
   * each working agent. It runs on a clock of its own, only while the tree is on screen and the person has not asked for less
   * motion, adds no number and no label, and leaves the recorded layer as it is.
   */
  ambient?: boolean;
  /** How much of the tree is drawn, 0..1 (1 when absent): the hero's loop grows it from the root and folds it back. */
  appear?: MotionValue<number>;
}

/** Where the missed-heartbeat dots sit around the top of a dead brain, in degrees (SVG, y down). */
const TICK_ANGLES = [205, 237.5, 270, 302.5, 335];

const crack = (R: number): string => {
  const p = (a: number, b: number): string => `${fx(a * R)} ${fx(b * R)}`;
  return `M${p(0.42, -0.93)}L${p(0.57, -0.68)}L${p(0.34, -0.5)}L${p(0.5, -0.22)}`;
};

function BrainNode({ info, kill, labels, glow }: { info: NodeInfo; kill: KillInfo | undefined; labels: SwarmTreeProps["labels"]; glow: string | null }) {
  const R = info.size * U;
  const names = labels === "names";
  return (
    <g className="hv-node" data-node={info.id} data-kind="brain" data-role={info.role}>
      {glow && <circle className="hv-amb-halo" r={fx(R * 1.75)} fill={`url(#${glow})`} opacity="0" />}
      <circle className="hv-flash" r={R} opacity="0" />
      <circle className="hv-pulse" r={R} opacity="0" />
      <circle className="hv-crown" r={R + 3} opacity="0" />
      <circle className="hv-cand" r={R + 6} opacity="0" />
      <circle className="hv-core" r={R * 0.74} />
      <circle className="hv-ring" r={R} pathLength={100} />
      <path className="hv-crack" d={crack(R)} />
      <circle className="hv-heir" r={R + 6} opacity="0" />
      <g className="hv-ticks" opacity="0">
        {TICK_ANGLES.map((a) => (
          <circle
            key={a}
            className="hv-tick"
            r="2.7"
            cx={fx((R + 11) * Math.cos((a * Math.PI) / 180))}
            cy={fx((R + 11) * Math.sin((a * Math.PI) / 180))}
            data-on="false"
          />
        ))}
      </g>
      {labels !== "none" && (
        <>
          <text className="hv-tag" x={fx(-R - 10)} y="4" textAnchor="end" opacity="0">
            ROOT
          </text>
          <text className="hv-stamp" x={fx(R + 10)} y="4" opacity="0">
            DEAD
          </text>
        </>
      )}
      <g className="hv-score" transform={`translate(${fx(R + 10)} -9)`} opacity="0">
        <rect className="hv-score-track" y="9" width={SCORE_WIDTH} height="3" rx="1.5" />
        <rect className="hv-score-bar" y="9" width="1" height="3" rx="1.5" />
        <text className="hv-score-text" y="0" />
      </g>
      {labels !== "none" && (
        <text className="hv-id" y={fx(R + 16)} textAnchor="middle">
          {info.id}
        </text>
      )}
      {names && (
        <text className="hv-name" y={fx(R + 29)} textAnchor="middle">
          {info.label}
        </text>
      )}
      {kill && labels !== "none" && (
        <text className="hv-sub" y={fx(R + (names ? 42 : 29))} textAnchor="middle" opacity="0">
          {`† ${(kill.atMs / 1000).toFixed(1)} s`}
        </text>
      )}
    </g>
  );
}

function AgentNode({ info, labels, ping }: { info: NodeInfo; labels: SwarmTreeProps["labels"]; ping: boolean }) {
  const s = info.size * U;
  return (
    <g className="hv-node" data-node={info.id} data-kind="agent">
      {ping && <rect className="hv-amb-ping" x={fx(-s)} y={fx(-s)} width={fx(2 * s)} height={fx(2 * s)} rx="3" opacity="0" />}
      <rect className="hv-square" x={fx(-s)} y={fx(-s)} width={fx(2 * s)} height={fx(2 * s)} rx="3" />
      {labels === "ids" || labels === "names" ? (
        <text className="hv-id" y={fx(s + 15)} textAnchor="middle">
          {info.label}
        </text>
      ) : null}
    </g>
  );
}

function describe(model: TreeModel): string {
  const { counts, talks } = model.tree;
  const first = model.kills[0];
  return (
    `A tree of ${counts.orchestrators} orchestrators and ${counts.agents} agents, drawn while the run replays. ` +
    `${model.kills.length} of the ${counts.orchestrators} orchestrators are killed in turn${first?.heldRoot ? ", beginning with the root" : ""}. ` +
    `After each death the survivors, reading the same log, pick the same heir and re-wire the tree, with no election. ` +
    `${talks.placed} of ${talks.expected} talks end up placed.`
  );
}

export function SwarmTree({ progress, data, still, stillAt, className, pacing = "story", labels = "ids", clock = true, ambient = false, appear }: SwarmTreeProps) {
  const player = useMemo(() => treePlayer(data, pacing), [data, pacing]);
  const { model } = player;
  const svg = useRef<SVGSVGElement>(null);
  const rig = useRef<TreeRig | null>(null);
  /** The frame the recorded layer shows now, for the ambient layer to read. */
  const shown = useRef<TreeFrame | null>(null);
  const uid = useId();
  const glow = ambient ? `${uid.replace(/:/g, "")}-glow` : null;

  const sizes = useMemo(
    () => Object.fromEntries(model.ids.map((id) => [id, { size: model.node[id]?.size ?? 0.2, brain: model.node[id]?.kind === "brain" }])),
    [model],
  );
  useLayoutEffect(() => {
    rig.current = svg.current ? collectTree(svg.current, sizes) : null;
  }, [sizes, labels, clock, ambient]);
  const apply = useCallback(
    (p: number) => {
      if (!rig.current) return;
      // A still frame (or less motion) shows the whole tree: how much of it is drawn belongs to the loop, which is not running.
      const drawn = still || prefersReducedMotion() ? 1 : (appear?.get() ?? 1);
      const frame = player.frame(p, drawn);
      shown.current = frame;
      paintTree(rig.current, frame);
    },
    [player, appear, still],
  );
  useProgress(progress, apply, still, stillAt);
  useLayoutEffect(() => {
    if (!appear || still || prefersReducedMotion()) return undefined;
    return appear.on("change", () => apply(progress.get()));
  }, [appear, apply, progress, still]);

  useEffect(() => {
    const element = svg.current;
    if (!ambient || still || prefersReducedMotion() || !element) return undefined;
    const layer = new Ambient(model);
    return whileVisible(element, () =>
      onFrame((dt) => {
        if (!shown.current || !rig.current) return;
        layer.step(dt, shown.current);
        paintAmbient(rig.current, layer);
      }, AMBIENT_ORDER),
    );
  }, [ambient, still, model]);

  const b = model.bounds;
  const memorialY = Math.max(...Object.values(model.memorial).map((s) => s.y));
  const brains = model.ids.filter((id) => model.node[id]?.kind === "brain");
  const agents = model.ids.filter((id) => model.node[id]?.kind === "agent");

  return (
    <svg
      ref={svg}
      className={className ? `hv hv-tree ${className}` : "hv hv-tree"}
      viewBox={`${fx(b.x0 * U)} ${fx(b.y0 * U)} ${fx((b.x1 - b.x0) * U)} ${fx((b.y1 - b.y0) * U)}`}
      role="img"
      aria-labelledby={`${uid}-t ${uid}-d`}
    >
      <title id={`${uid}-t`}>The swarm tree</title>
      <desc id={`${uid}-d`}>{describe(model)}</desc>
      {glow && (
        <defs>
          <radialGradient id={glow}>
            <stop offset="0.5" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            <stop offset="0.66" style={{ stopColor: "var(--accent)", stopOpacity: 0.5 }} />
            <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>
      )}
      <g className="hv-memorial" opacity="0">
        <line className="hv-memorial-rule" x1={fx((b.x0 + 0.2) * U)} x2={fx((b.x1 - 0.2) * U)} y1={fx((memorialY - 0.95) * U)} y2={fx((memorialY - 0.95) * U)} />
        {labels !== "none" && (
          <text className="hv-memorial-label" x={fx((b.x0 + 0.2) * U)} y={fx(memorialY * U + 4)}>
            KILLED
          </text>
        )}
      </g>
      <g>
        {model.ids.map((id) => (
          <path key={id} className="hv-edge" data-edge={id} opacity="0" />
        ))}
      </g>
      <g>
        {Array.from({ length: MAX_DASHES }, (_, i) => (
          <line key={i} className="hv-dash" data-dash={i} x1="-7" x2="7" y1="0" y2="0" opacity="0" />
        ))}
      </g>
      {ambient && (
        <g className="hv-amb" aria-hidden="true">
          {model.ids.map((id) => (
            <g key={id} className="hv-amb-dot" data-amb-dot={id} opacity="0">
              <circle className="hv-amb-glow" r="8" />
              <circle className="hv-amb-tail hv-amb-tail--far" r="1.5" />
              <circle className="hv-amb-tail hv-amb-tail--near" r="2.1" />
              <circle className="hv-amb-head" r="2.7" />
            </g>
          ))}
        </g>
      )}
      <g>
        {brains.map((id) => (
          <BrainNode key={id} info={model.node[id] as NodeInfo} kill={model.killOf[id]} labels={labels} glow={glow} />
        ))}
        {agents.map((id) => (
          <AgentNode key={id} info={model.node[id] as NodeInfo} labels={labels} ping={ambient} />
        ))}
      </g>
      {clock && (
        <g>
          <text className="hv-clock-label" x={fx((b.x0 + 0.2) * U)} y={fx((b.y0 + 0.6) * U)}>
            RUN
          </text>
          <text className="hv-clock" x={fx((b.x0 + 0.2) * U)} y={fx((b.y0 + 0.6) * U + 20)}>
            0.0 s
          </text>
        </g>
      )}
    </svg>
  );
}
