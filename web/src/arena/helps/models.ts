// The failure models of bench/PREREG.md §6. A result about locality holds under one of them, so every
// row of the panel says which (docs/claims.md: "A claim about locality names its failure model").

import { crashesText } from "./labels";

export type ModelKind = "crash" | "process";

export const MODELS: Record<ModelKind, { name: string; says: string }> = {
  crash: {
    name: "Per crash",
    says: "Every system loses the same number of coordinators at the same points of the run: C1, C2 and C3 are 1, 3 and 5 crashes.",
  },
  process: {
    name: "Per process",
    says: "Every coordinator process fails at the same rate, so a system that runs more coordinators sees more crashes: the swarm runs several, a supervisor one.",
  },
};

/** What a row of the map says about its crashes: "Per crash", and how many when its settings share one plan (a sweep runs at C3). */
export function crashModel(profiles: readonly string[]): string {
  const plans = [...new Set(profiles)];
  const crashes = plans.length === 1 ? crashesText(plans[0]) : null;
  return crashes === null ? MODELS.crash.name : `${MODELS.crash.name} · ${crashes} (${plans[0]})`;
}
