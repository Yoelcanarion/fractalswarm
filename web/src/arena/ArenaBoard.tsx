import { memo, useMemo, type CSSProperties } from "react";

import { ADOPTION_LIFE_MS, fadeLife, glowVars, ringVars } from "../lib/decay";
import type { Point } from "../lib/glide";
import { colorOf } from "../lib/layout";
import { rootHolder } from "../lib/reducer";
import { useRunStore } from "../store";
import { busyAgents, CHIP_H, CHIP_W, chipState, DOT, dotState, layoutBoard, TEAM_PAD, type Box } from "./board";
import { useBoardPlaces } from "./useBoardMotion";

const owner = (color: string): CSSProperties => ({ "--owner": color }) as CSSProperties;

const CHIP_WORDS = { up: "up", suspected: "suspected", restarting: "restarting", down: "down", finished: "finished" } as const;
const TAG_H = 16;
const CROSS = 5; // half-width of the ✕ drawn on a chip that is down

/** A cubic from the bottom of one chip to the top of another, leaving and arriving vertically. */
function edgePath(from: Point, to: Point): string {
  const x1 = from.x + CHIP_W / 2;
  const y1 = from.y + CHIP_H;
  const x2 = to.x + CHIP_W / 2;
  const y2 = to.y;
  const bend = (y2 - y1) / 2;
  return `M${x1} ${y1}C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
}

export interface ArenaBoardProps {
  /** The part of the drawing to show (frame.ts): the same size on both sides. */
  frame: Box;
  /** The screen-reader name of the picture. */
  label: string;
  /** What the holder of the root duties is called on its tag: "root" for the swarm, "supervisor" for a rival. */
  rootLabel: string;
}

/** One team, drawn from the nearest run store: coordinators as chips, agents as dots grouped under
 * the coordinator they answer to. A dot is filled while its agent has a model call in flight, hollow
 * while idle, dashed while idle and waiting on a coordinator that is out. */
export const ArenaBoard = memo(function ArenaBoard({ frame, label, rootLabel }: ArenaBoardProps) {
  const view = useRunStore((s) => s.view);
  const layout = useMemo(() => layoutBoard(view), [view]);
  const places = useBoardPlaces(layout);
  const busy = useMemo(() => busyAgents(view), [view]);
  const root = rootHolder(view);
  const at = (id: string): Point => places.get(id) ?? { x: 0, y: 0 };
  const colour = (id: string): string => colorOf(view, id);

  const chips = layout.nodes.filter((n) => !n.leaf);
  const dots = layout.nodes.filter((n) => n.leaf);

  return (
    <svg
      className="board"
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      <g className="board__teams">
        {layout.teams.map((team) => {
          const spots = team.leaves.map(at);
          const left = Math.min(...spots.map((p) => p.x)) - TEAM_PAD;
          const top = Math.min(...spots.map((p) => p.y)) - TEAM_PAD;
          const right = Math.max(...spots.map((p) => p.x + DOT)) + TEAM_PAD;
          const bottom = Math.max(...spots.map((p) => p.y + DOT)) + TEAM_PAD;
          const chip = at(team.owner);
          const out = chipState(view.actors[team.owner]);
          return (
            <g key={team.owner} className={`board__team${out === "down" || out === "restarting" ? " board__team--out" : ""}`} style={owner(colour(team.owner))}>
              <line x1={chip.x + CHIP_W / 2} y1={chip.y + CHIP_H} x2={(left + right) / 2} y2={top} />
              <rect x={left} y={top} width={right - left} height={bottom - top} rx={8} />
            </g>
          );
        })}
      </g>
      <g className="board__edges">
        {chips.map((node) => {
          const parent = node.parent === null ? undefined : layout.nodes.find((n) => n.id === node.parent && !n.leaf);
          if (!parent) return null;
          const actor = view.actors[node.id];
          const down = chipState(actor) === "down";
          const adopted = actor.adoptedTs !== undefined;
          return (
            <path
              key={node.id}
              className={`board__edge${down ? " board__edge--down" : ""}${adopted ? " board__edge--adopted" : ""}`}
              d={edgePath(at(parent.id), at(node.id))}
              style={{ ...owner(colour(node.id)), ...(adopted ? glowVars(actor.adoptedTs!, fadeLife(ADOPTION_LIFE_MS)) : {}) }}
            />
          );
        })}
      </g>
      <g className="board__chips">
        {chips.map((node) => {
          const actor = view.actors[node.id];
          const state = chipState(actor);
          const p = at(node.id);
          const adopted = actor.adoptedTs !== undefined && actor.status === "alive";
          const style = {
            ...owner(colour(node.id)),
            ...(adopted ? glowVars(actor.adoptedTs!, fadeLife(ADOPTION_LIFE_MS)) : {}),
            ...(actor.outage ? ringVars(actor.outage) : {}),
          } as CSSProperties;
          return (
            <g key={node.id} className={`chip chip--${state}${adopted ? " chip--adopted" : ""}`} transform={`translate(${p.x} ${p.y})`} style={style}>
              <title>{`${node.id} · ${CHIP_WORDS[state]}`}</title>
              <rect className="chip__box" width={CHIP_W} height={CHIP_H} rx={8} />
              <text className="chip__id" x={CHIP_W / 2 - (state === "down" ? 5 : 0)} y={CHIP_H / 2} dy="0.35em" textAnchor="middle">
                {node.id}
              </text>
              {state === "down" && (
                <path
                  className="chip__cross"
                  d={`M${CHIP_W - 15 - CROSS} ${CHIP_H / 2 - CROSS}l${2 * CROSS} ${2 * CROSS}m0 ${-2 * CROSS}l${-2 * CROSS} ${2 * CROSS}`}
                />
              )}
              {state === "restarting" && actor.outage && <rect className="chip__restart" x={4} y={CHIP_H - 6} width={CHIP_W - 8} height={3} rx={1.5} />}
              {root === node.id && (
                <g className="chip__tag" transform={`translate(${CHIP_W / 2} ${-TAG_H / 2 - 2})`}>
                  <rect x={-(rootLabel.length * 3.4 + 7)} y={-TAG_H / 2} width={rootLabel.length * 6.8 + 14} height={TAG_H} rx={TAG_H / 2} />
                  <text dy="0.35em" textAnchor="middle">
                    {rootLabel}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
      <g className="board__dots">
        {dots.map((node) => {
          const state = dotState(view, node.id, busy);
          const p = at(node.id);
          const actor = view.actors[node.id];
          // An agent whose coordinator died and whose team was taken over glows for a few seconds in its new owner's colour.
          const adopted = actor.adoptedTs !== undefined && state !== "down";
          const style = { ...owner(node.parent ? colour(node.parent) : colour(node.id)), ...(adopted ? glowVars(actor.adoptedTs!, fadeLife(ADOPTION_LIFE_MS)) : {}) };
          return (
            <g key={node.id} className={`dot dot--${state}${adopted ? " dot--adopted" : ""}`} transform={`translate(${p.x} ${p.y})`} style={style}>
              <title>{`${node.id} · ${state}`}</title>
              <circle className="dot__body" cx={DOT / 2} cy={DOT / 2} r={DOT / 2 - 1.5} />
              {state === "down" && <path className="dot__cross" d={`M${DOT * 0.32} ${DOT * 0.32}L${DOT * 0.68} ${DOT * 0.68}M${DOT * 0.68} ${DOT * 0.32}L${DOT * 0.32} ${DOT * 0.68}`} />}
            </g>
          );
        })}
      </g>
    </svg>
  );
});
