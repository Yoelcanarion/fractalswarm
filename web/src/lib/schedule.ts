// The T2 schedule grid (rooms × slots × day) as a pure fold over placement events.
//
// The T2 slice logs a placement as a booking on the blackboard, not as a placement event, so the
// grid is read from what it does log (actors/board.py, actors/orchestrator.py):
//
//   run.started.params.corpus  {days, rooms: [{id}], slots: [{index}]}   the axes
//   msg.sent book              body {goal_id, contract_id, attempt, writes: [{key: "cell:d1:s0:room-b",
//                              value: {day, room, slot, talk_id, speaker_id}}]}   an owner asks for its cells
//   msg.sent book.result       body {goal_id, contract_id, attempt, conflicts}   no conflict: the cells are placed
//   collision.detected         {kind, goal_id, holder, conflicts: [{key: "cell:d1:s0:room-b", reason, holder}]}
//   collision.resolved         {kind, goal_id, resolution}               the owner re-placed the goal
//   task.result                {report: {hard_violations, soft_score}}   the final check
//
// The shapes this UI proposed on Day 7 are still read (spec §6 and §15.3), for a runtime that
// logs placements directly:
//
//   run.started.params.grid  {days: [..], rooms: [..], slots: [..]}       (optional axes)
//   schedule.placed          {talk_id, day, room, slot, squad, title?, speaker?}
//   schedule.removed         {day, room, slot, talk_id?}
//   collision.detected       {collision_id, cells: [{day, room, slot}], squads?, kind?}
//   collision.resolved       {collision_id, arbiter, rule?, winner?}
//   schedule.checked         {hard_violations, soft_score?}
//
// Without axes in run.started, they are the sorted values seen in placements.

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
  goalId?: string;
  cells: string[]; // cell keys
  squads: string[];
  status: "open" | "resolved";
  detectedSeq: number;
  resolvedSeq?: number;
  resolvedTs?: number; // virtual ms: the ruling is marked on the cell for a while after it
  arbiter?: string;
  rule?: string;
  winner?: string;
}

/** The cells an owner asked the board for, until the board answers. */
interface Booking {
  squad: string;
  cells: { day: string; room: string; slot: string; talkId: string; speaker?: string }[];
}

export interface ScheduleState {
  days: Axis[];
  rooms: Axis[];
  slots: Axis[];
  fixedAxes: boolean;
  cells: Record<string, Cell>;
  collisions: Record<string, Collision>;
  collisionOrder: string[];
  pending: Record<string, Booking>; // `${goal}|${contract}|${attempt}` -> its cells
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
  pending: {},
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

// A T2 run carries its conference in the params: the rooms and slots are the grid's axes.
function gridOf(params: Record<string, any> | undefined): Record<string, unknown> | null {
  if (params?.grid) return params.grid;
  const corpus = params?.corpus;
  if (!corpus || !Array.isArray(corpus.rooms)) return null;
  return {
    days: corpus.days,
    rooms: corpus.rooms.map((room: any) => room?.id ?? room),
    slots: Array.isArray(corpus.slots) ? corpus.slots.map((slot: any) => slot?.index ?? slot) : corpus.slots,
  };
}

const CELL_KEY = /^cell:d(\d+):s(\d+):(.+)$/;

/** The grid cells of a collision's conflicts (their keys are ``cell:d1:s0:room-b``). */
const conflictCells = (conflicts: unknown): string[] =>
  (Array.isArray(conflicts) ? conflicts : []).flatMap((conflict) => {
    const match = CELL_KEY.exec(String(conflict?.key ?? ""));
    return match ? [cellKey(match[1], match[3], match[2])] : [];
  });

const bookingKey = (body: Record<string, any>): string => `${body.goal_id}|${body.contract_id}|${body.attempt}`;

function foldBooking(state: ScheduleState, event: RunEvent, topic: string, body: Record<string, any>): ScheduleState {
  const key = bookingKey(body);
  if (topic === "book") {
    const cells = (Array.isArray(body.writes) ? body.writes : []).flatMap((write: Record<string, any>) =>
      String(write.key).startsWith("cell:") && write.value
        ? [
            {
              day: String(write.value.day),
              room: String(write.value.room),
              slot: String(write.value.slot),
              talkId: String(write.value.talk_id),
              speaker: write.value.speaker_id === undefined ? undefined : String(write.value.speaker_id),
            },
          ]
        : [],
    );
    return { ...state, pending: { ...state.pending, [key]: { squad: event.actor, cells } } };
  }
  // book.result: the board answered. Without conflicts the owner's cells are placed.
  const booking = state.pending[key];
  if (!booking) return state;
  const pending = { ...state.pending };
  delete pending[key];
  if (Array.isArray(body.conflicts) && body.conflicts.length > 0) return { ...state, pending };
  let next: ScheduleState = { ...state, pending };
  for (const cell of booking.cells) {
    next = {
      ...next,
      ...(next.fixedAxes
        ? {}
        : {
            days: withAxisValue(next.days, cell.day),
            rooms: withAxisValue(next.rooms, cell.room),
            slots: withAxisValue(next.slots, cell.slot),
          }),
      cells: {
        ...next.cells,
        [cellKey(cell.day, cell.room, cell.slot)]: { talkId: cell.talkId, speaker: cell.speaker, squad: booking.squad, placedSeq: event.seq },
      },
      placements: next.placements + 1,
    };
  }
  return next;
}

export function foldSchedule(state: ScheduleState, event: RunEvent): ScheduleState {
  const p = event.payload;
  switch (event.type) {
    case "msg.sent": {
      const topic = String(p.topic ?? "");
      return topic === "book" || topic === "book.result" ? foldBooking(state, event, topic, p.body ?? {}) : state;
    }
    case "task.result": {
      const report = p.report;
      if (typeof report?.hard_violations !== "number") return state;
      return { ...state, hardViolations: report.hard_violations, softScore: report.soft_score ?? null };
    }
    case "run.started": {
      const grid = gridOf(p.params);
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
      const cells = Array.isArray(p.cells)
        ? p.cells.map((c: Record<string, unknown>) => cellKey(c.day, c.room, c.slot))
        : conflictCells(p.conflicts);
      const collision: Collision = {
        id,
        kind: p.kind,
        goalId: p.goal_id === undefined ? undefined : String(p.goal_id),
        cells,
        squads: Array.isArray(p.squads) ? p.squads.map(String) : p.holder === undefined ? [] : [String(p.holder)],
        status: "open",
        detectedSeq: event.seq,
      };
      const order = state.collisionOrder.includes(id) ? state.collisionOrder : [...state.collisionOrder, id];
      return { ...state, collisions: { ...state.collisions, [id]: collision }, collisionOrder: order };
    }
    case "collision.resolved": {
      // Named by its id, or (as the runtime logs it) by the goal whose owner re-placed it.
      const ids =
        p.collision_id !== undefined
          ? [String(p.collision_id)]
          : state.collisionOrder.filter(
              (id) => state.collisions[id].status === "open" && state.collisions[id].goalId === String(p.goal_id),
            );
      const collisions = { ...state.collisions };
      for (const id of ids) {
        const open = collisions[id];
        if (!open || open.status === "resolved") continue;
        collisions[id] = {
          ...open,
          status: "resolved",
          resolvedSeq: event.seq,
          resolvedTs: event.ts_virtual,
          arbiter: String(p.arbiter ?? event.actor),
          rule: p.rule ?? p.resolution,
          winner: p.winner,
        };
      }
      return { ...state, collisions };
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

/** When the last ruling mark stops fading, in virtual ms: ``-Infinity`` when no collision has been
 * ruled. It counts every ruled collision, not only the ones a cell shows, so it is never early. */
export function rulingsEnd(state: ScheduleState, lifeMs: number): number {
  let end = -Infinity;
  for (const id of state.collisionOrder) {
    const ruled = state.collisions[id]?.resolvedTs;
    if (ruled !== undefined) end = Math.max(end, ruled + lifeMs);
  }
  return end;
}

export const openCollisions = (state: ScheduleState): number =>
  state.collisionOrder.filter((id) => state.collisions[id].status === "open").length;
