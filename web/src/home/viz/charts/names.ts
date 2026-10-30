// How the charts name the systems they compare, and how loudly they draw each. One place, so that the
// hero chart, the dot plot and the paired bars call the same system by the same name in the same style.

/** The swarm is the accent; the two rivals the claims name are strong neutrals; the others are quiet. */
export type Emphasis = "swarm" | "rival" | "quiet";

export type Names = "full" | "short";

const EMPHASIS: Record<string, Emphasis> = { swarm: "swarm", central: "rival", "durable-max": "rival" };

/** The names the generator gives the workflows (`workflows` in the data): a test holds the two together. */
export const LABELS: Record<string, string> = {
  swarm: "FractalSwarm",
  central: "In-process supervisor",
  "durable-max": "Ideal durable supervisor",
  durable: "Realistic durable supervisor",
  pipeline: "Pipeline",
  single: "Single agent",
};

const SHORT: Record<string, string> = {
  swarm: "FractalSwarm",
  central: "In-process",
  "durable-max": "Ideal durable",
  durable: "Durable",
  pipeline: "Pipeline",
  single: "Single agent",
};

const MID: Record<string, string> = { durable: "Realistic durable" };

export const emphasisOf = (id: string): Emphasis => EMPHASIS[id] ?? "quiet";

export const labelOf = (id: string): string => LABELS[id] ?? id;

export const shortName = (id: string, label: string): string => SHORT[id] ?? label;

/**
 * A system's name at the width there is: the claims' own names for the three that matter
 * ("In-process supervisor", "Ideal durable supervisor"), short ones for the rest, and short ones
 * for all of them where there is no room.
 */
export function systemName(id: string, label: string, names: Names): string {
  if (names === "short") return shortName(id, label);
  return emphasisOf(id) === "quiet" ? (MID[id] ?? shortName(id, label)) : label;
}

/** The order the systems are drawn in, back to front: the quiet ones first, the swarm on top. */
export const DRAW_ORDER: readonly Emphasis[] = ["quiet", "rival", "swarm"];

/** The systems in the order the page tells them: the swarm, the rivals the claims name, the others. */
export const SYSTEM_ORDER: readonly string[] = ["swarm", "durable-max", "durable", "central", "pipeline", "single"];

export function bySystemOrder(ids: readonly string[]): string[] {
  const known = SYSTEM_ORDER.filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !SYSTEM_ORDER.includes(id)).sort()];
}
