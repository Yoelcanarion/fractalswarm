// The regime map: where the swarm's recovery stays local against a rival, and where it does not.
//
// The bench sweeps one assumption at a time from the default point (bench/PREREG.md §5), so the map is
// a strip per sweep with one cell per setting, as bench/results/regime.png draws it: not a grid, because
// two assumptions are never varied together.

import type { Honesty, LocalityTally, Ratios, RegimePoint } from "./honesty";
import { countText, crashesText, settingLabel, taskName } from "./labels";
import { crashModel } from "./models";

interface AxisInfo {
  title: string;
  /** What changes along the strip, in a line. */
  detail: string;
}

/** The gate and the sweeps, in the order the map draws them, named as bench/PREREG.md §5 names the assumption each checks. */
export const AXES: Record<string, AxisInfo> = {
  gate: { title: "Gate", detail: "The default assumptions, at each crash plan: C1, C2, C3." },
  recovery_ms: { title: "Failure detection", detail: "How long a crash takes to be noticed: the swarm's detection and the supervisor's restart, the same for both." },
  rival_restart_ms: { title: "Restart or failover time", detail: "The supervisor's restart, on top of its detection; the swarm unchanged." },
  rival_recovery_ms: { title: "Fast external restart", detail: "The supervisor back faster than the swarm detects (asymmetric detection)." },
  agent_latency_scale: { title: "Coordination density", detail: "The agents' latency, scaled." },
  agents: { title: "Width", detail: "Agents in the team." },
};

const ORDER = Object.keys(AXES);

export const axisTitle = (axis: string | null): string => AXES[axis ?? "gate"]?.title ?? axis ?? "Gate";

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
  /** The failure model of the row: every point of the map is per crash. */
  model: string;
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
      model: crashModel(ordered.map((point) => point.profile)),
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
  return rows.map(({ id, title, detail, model, cells }) => ({ id, title, detail, model, cells }));
}

/** The file's own count of a rival's localities in words; nothing is added up here. */
export function localityLine(t: LocalityTally): string {
  const line = `locality holds at ${countText(t.holds, "setting", "settings")}, ties at ${t.ties} and fails at ${t.fails}`;
  return t.na > 0 ? `${line}; ${t.na} have no verdict` : line;
}

export const RATIO_NAMES: { key: keyof Ratios; label: string }[] = [
  { key: "cdt", label: "Coordinator-dependency time" },
  { key: "blast", label: "Blast radius" },
  { key: "idle", label: "Idle agent-seconds" },
];
