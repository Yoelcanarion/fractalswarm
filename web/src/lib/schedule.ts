// The T2 schedule grid (rooms × slots × day) as a pure fold over placement events.
//
// The T2 slice does not emit these events yet, so the shapes below are this UI's proposal,
// derived from spec §6 and §15.3. See .plans/notes/day-07-ui.md for the wiring notes.
//
//   run.started.params.grid  {days: [..], rooms: [..], slots: [..]}       (optional axes)
//   schedule.placed          {talk_id, day, room, slot, squad, title?, speaker?}
//   schedule.removed         {day, room, slot, talk_id?}
//   collision.detected       {collision_id, cells: [{day, room, slot}], squads?, kind?}
//   collision.resolved       {collision_id, arbiter, rule?, winner?}
//   schedule.checked         {hard_violations, soft_score?}
//
// Without a grid in run.started, the axes are the sorted values seen in placements.

import type { RunEvent } from "./types";

export type Axis = string;

export interface Cell {
  talkId: string;
  title?: string;
  speaker?: string;
  squad: string;
  placedSeq: number;
}

export interface Collision {
  id: string;
  kind?: string;
  cells: string[]; // cell keys
  squads: string[];
  status: "open" | "resolved";
  detectedSeq: number;
  resolvedSeq?: number;
  arbiter?: string;
  rule?: string;
  winner?: string;
}

export interface ScheduleState {
  days: Axis[];
  rooms: Axis[];
  slots: Axis[];
  fixedAxes: boolean;
  cells: Record<string, Cell>;
  collisions: Record<string, Collision>;
  collisionOrder: string[];
  hardViolations: number | null;
  softScore: number | null;
  placements: number;
}

export const emptySchedule = (): ScheduleState => ({
  days: [],
  rooms: [],
  slots: [],
  fixedAxes: false,
  cells: {},
  collisions: {},
  collisionOrder: [],
  hardViolations: null,
  softScore: null,
  placements: 0,
});

export const cellKey = (day: unknown, room: unknown, slot: unknown): string =>
  `${String(day)}|${String(room)}|${String(slot)}`;

const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, "en", { numeric: true });

function withAxisValue(values: Axis[], value: unknown): Axis[] {
  const text = String(value);
  if (values.includes(text)) return values;
  return [...values, text].sort(naturalCompare);
}

function axis(value: unknown): Axis[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "number" && value > 0) return Array.from({ length: value }, (_, i) => String(i + 1));
  return [];
}

export function foldSchedule(state: ScheduleState, event: RunEvent): ScheduleState {
  const p = event.payload;
  switch (event.type) {
    case "run.started": {
      const grid = p.params?.grid;
      if (!grid) return state;
      return {
        ...state,
        days: axis(grid.days),
        rooms: axis(grid.rooms),
        slots: axis(grid.slots),
        fixedAxes: true,
      };
    }
    case "schedule.placed": {
      const key = cellKey(p.day, p.room, p.slot);
      const axes = state.fixedAxes
        ? {}
        : {
            days: withAxisValue(state.days, p.day),
            rooms: withAxisValue(state.rooms, p.room),
            slots: withAxisValue(state.slots, p.slot),
          };
      const cell: Cell = {
        talkId: String(p.talk_id),
        title: p.title,
        speaker: p.speaker,
        squad: String(p.squad ?? event.actor),
        placedSeq: event.seq,
      };
      return {
        ...state,
        ...axes,
        cells: { ...state.cells, [key]: cell },
        placements: state.placements + 1,
      };
    }
    case "schedule.removed": {
      const key = cellKey(p.day, p.room, p.slot);
      if (!state.cells[key]) return state;
      if (p.talk_id !== undefined && state.cells[key].talkId !== String(p.talk_id)) return state;
      const cells = { ...state.cells };
      delete cells[key];
      return { ...state, cells };
    }
    case "collision.detected": {
      const id = String(p.collision_id ?? event.idem_key);
      const cells = (Array.isArray(p.cells) ? p.cells : []).map((c: Record<string, unknown>) =>
        cellKey(c.day, c.room, c.slot),
      );
      const collision: Collision = {
        id,
        kind: p.kind,
        cells,
        squads: Array.isArray(p.squads) ? p.squads.map(String) : [],
        status: "open",
        detectedSeq: event.seq,
      };
      const order = state.collisionOrder.includes(id) ? state.collisionOrder : [...state.collisionOrder, id];
      return { ...state, collisions: { ...state.collisions, [id]: collision }, collisionOrder: order };
    }
    case "collision.resolved": {
      const id = String(p.collision_id);
      const open = state.collisions[id];
      if (!open) return state;
      const resolved: Collision = {
        ...open,
        status: "resolved",
        resolvedSeq: event.seq,
        arbiter: String(p.arbiter ?? event.actor),
        rule: p.rule,
        winner: p.winner,
      };
      return { ...state, collisions: { ...state.collisions, [id]: resolved } };
    }
    case "schedule.checked":
      return {
        ...state,
        hardViolations: Number(p.hard_violations ?? 0),
        softScore: p.soft_score ?? null,
      };
    default:
      return state;
  }
}

/** Collision state of one cell: open collisions flash; recently resolved ones show the arbiter. */
export function cellCollision(state: ScheduleState, key: string): Collision | undefined {
  let found: Collision | undefined;
  for (const id of state.collisionOrder) {
    const collision = state.collisions[id];
    if (!collision.cells.includes(key)) continue;
    if (collision.status === "open") return collision;
    found = collision;
  }
  return found;
}

export const openCollisions = (state: ScheduleState): number =>
  state.collisionOrder.filter((id) => state.collisions[id].status === "open").length;
