// What the arena grants the rival, in words, read from the runs themselves. The caption is always on
// screen (arena spec §A: "these assumptions are shown as a caption in the arena"), and it comes from
// the run's params, so a sweep run shows its own values instead of the defaults.
//
//   system     the scenario a run was recorded with, from run.started's "module:ATTR"
//   detection  how long the rival takes to notice a crash: `rival_recovery_ms`, else `recovery_ms`, else 5 s
//   restart    what it takes on top once it has noticed: `rival_restart_ms`, else 0 (an ideal hot standby)
//   swarm      its own detection time: `recovery_ms`, else 5 s (the detector counts five missed beats)
//
// A rival that is not the ideal one says so: `durable` loses its own in-flight plan and judge calls,
// `central` loses its workers with the process.

import { asNumber, asRecord } from "../lib/generic";
import type { RunEvent } from "../lib/types";

export type SystemKind = "swarm" | "durable-max" | "durable" | "central" | "single" | "pipeline" | "other";

const ATTRS: Record<string, SystemKind> = {
  SWARM: "swarm",
  DURABLE_MAX: "durable-max",
  DURABLE: "durable",
  CENTRAL: "central",
  SINGLE: "single",
  PIPELINE: "pipeline",
};

/** The system a run was recorded with, from run.started's scenario ("fractalswarm.actors.swarm:DURABLE_MAX"). */
export function systemKind(scenario: string | null | undefined): SystemKind {
  const attr = (scenario ?? "").split(":").at(-1) ?? "";
  return ATTRS[attr] ?? "other";
}

export const DEFAULT_DETECTION_MS = 5000;

/** "5 s", "0.5 s", "2.5 s", "0 s". */
export function secondsText(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(2))} s`;
}

export const startedOf = (events: readonly RunEvent[]): RunEvent | undefined => events.find((e) => e.type === "run.started");

const paramsOf = (started: RunEvent | undefined): Record<string, unknown> => asRecord(started?.payload.params);

export interface Assumptions {
  system: SystemKind;
  /** The rival as the caption names it. */
  name: string;
  detectionMs: number;
  restartMs: number;
  swarmDetectionMs: number;
  /** What else holds for this rival, as short phrases. */
  facts: string[];
  /** The one line the arena shows. */
  caption: string;
}

const NAMES: Record<SystemKind, string> = {
  swarm: "FractalSwarm",
  "durable-max": "ideal durable supervisor",
  durable: "durable supervisor",
  central: "in-process supervisor",
  single: "single agent",
  pipeline: "pipeline",
  other: "supervisor",
};

const FACTS: Record<SystemKind, string[]> = {
  swarm: [],
  "durable-max": ["workers survive", "same log"],
  durable: ["workers survive", "its in-flight plan and judge calls are lost", "same log"],
  central: ["a crash stops its workers", "same log"],
  single: ["same log"],
  pipeline: ["same log"],
  other: ["same log"],
};

/** The assumptions of a pair, from the `run.started` events of the rival's log and (optionally) the swarm's. */
export function assumptionsOf(rival: RunEvent | undefined, swarm?: RunEvent): Assumptions {
  const system = systemKind(typeof rival?.payload.scenario === "string" ? rival.payload.scenario : null);
  const rivalParams = paramsOf(rival);
  const swarmParams = paramsOf(swarm);
  const detectionMs = asNumber(rivalParams.rival_recovery_ms) ?? asNumber(rivalParams.recovery_ms) ?? DEFAULT_DETECTION_MS;
  const restartMs = asNumber(rivalParams.rival_restart_ms) ?? 0;
  const swarmDetectionMs = asNumber(swarmParams.recovery_ms) ?? asNumber(rivalParams.recovery_ms) ?? DEFAULT_DETECTION_MS;
  const facts = FACTS[system];
  const parts = [`${secondsText(detectionMs)} detection`, `${secondsText(restartMs)} restart`, ...facts];
  // An asymmetric pair (a fast external restart) must say so, or the caption would be read as symmetric.
  if (swarmDetectionMs !== detectionMs) parts.push(`swarm: ${secondsText(swarmDetectionMs)} detection`);
  const name = NAMES[system];
  return { system, name, detectionMs, restartMs, swarmDetectionMs, facts, caption: `Rival: ${name} — ${parts.join(" · ")}` };
}
