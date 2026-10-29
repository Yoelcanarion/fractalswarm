// The regime map: where the swarm's recovery stays local against a rival, and where it does not.
//
// The bench sweeps one assumption at a time from the default point (bench/PREREG.md §5), so the map is
// a strip per sweep with one cell per setting, as bench/results/regime.png draws it: not a grid, because
// two assumptions are never varied together.

import type { Honesty, Locality, Ratios, RegimePoint } from "./honesty";
import { crashesText, settingLabel, taskName } from "./labels";

interface AxisInfo {
  title: string;
  /** What changes along the strip, in a line. */
  detail: string;
}

/** The sweeps and the gate, in the order the map draws them. */
export const AXES: Record<string, AxisInfo> = {
  gate: { title: "Failures", detail: "1, 3 and 5 coordinator crashes: C1, C2, C3." },
  recovery_ms: { title: "Detection time", detail: "How long a crash takes to be noticed, for both." },
  rival_restart_ms: { title: "Restart time", detail: "Supervisor restart, on top of its 5 s detection." },
  rival_recovery_ms: { title: "Fast external restart", detail: "Supervisor back in 0.5 to 1 s; the swarm keeps 5 s." },
  agent_latency_scale: { title: "Coordination density", detail: "The agents' latency, scaled." },
  agents: { title: "Team width", detail: "Agents in the team." },
};

const ORDER = Object.keys(AXES);

export const axisTitle = (axis: string | null): string => AXES[axis ?? "gate"]?.title ?? axis ?? "Failures";

const axisRank = (axis: string | null): number => {
  const rank = ORDER.indexOf(axis ?? "gate");
  return rank === -1 ? ORDER.length : rank;
};

export interface MapCell {
  key: string;
  /** "5 s", "0.25×", "C2". */
  setting: string;
  /** "3 crashes" under a gate cell. */
  sub: string | null;
  point: RegimePoint;
  /** The point decides the outcome: the gate's default assumptions, or a point of the plausible region. */
  decides: boolean;
}

export interface MapRow {
  id: string;
  title: string;
  detail: string;
  cells: MapCell[];
}

/** The rows of the map against one rival: the gate for each task, then each sweep, the settings in order. */
export function regimeRows(honesty: Honesty, rival: string): MapRow[] {
  const decidingTask = honesty.outcome.gate[0]?.task ?? "";
  const decidesAtGate = (point: RegimePoint) => honesty.outcome.gate.some((g) => g.task === point.task && g.profile === point.profile);
  const groups = new Map<string, RegimePoint[]>();
  for (const point of honesty.regimes) {
    if (point.rival !== rival) continue;
    const id = `${point.axis ?? "gate"}:${point.task}`;
    groups.set(id, [...(groups.get(id) ?? []), point]);
  }
  const tasksOf = (axis: string | null) => new Set([...groups.values()].filter((g) => g[0].axis === axis).map((g) => g[0].task));
  const rows = [...groups.entries()].map(([id, points]): MapRow & { axis: string | null; task: string } => {
    const { axis, task } = points[0];
    const ordered = [...points].sort((a, b) => (a.value ?? 0) - (b.value ?? 0) || a.profile.localeCompare(b.profile));
    // A sweep run on one task needs no task in its name; the gate is read per task.
    const named = axis === null || tasksOf(axis).size > 1;
    return {
      id,
      axis,
      task,
      title: named ? `${axisTitle(axis)} · ${taskName(task)}` : axisTitle(axis),
      detail: AXES[axis ?? "gate"]?.detail ?? "",
      cells: ordered.map((point) => ({
        key: `${id}:${point.value ?? point.profile}`,
        setting: settingLabel(point.axis, point.value, point.profile),
        sub: point.axis === null ? crashesText(point.profile) : null,
        point,
        decides: point.plausible || (point.axis === null && decidesAtGate(point)),
      })),
    };
  });
  rows.sort((a, b) => axisRank(a.axis) - axisRank(b.axis) || Number(b.task === decidingTask) - Number(a.task === decidingTask) || a.task.localeCompare(b.task));
  return rows.map(({ id, title, detail, cells }) => ({ id, title, detail, cells }));
}

/** How many points of the map there are per locality, over the rows given: "5 hold, 9 tie, 2 fail". */
export function localityCounts(rows: readonly MapRow[]): Record<Locality, number> {
  const counts: Record<Locality, number> = { holds: 0, ties: 0, fails: 0, "n/a": 0 };
  for (const row of rows) for (const cell of row.cells) counts[cell.point.locality] += 1;
  return counts;
}

export const RATIO_NAMES: { key: keyof Ratios; label: string }[] = [
  { key: "cdt", label: "Coordinator-dependency time" },
  { key: "blast", label: "Blast radius" },
  { key: "idle", label: "Idle agent-seconds" },
];
