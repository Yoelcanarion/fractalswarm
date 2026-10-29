export type ModelFamily = "wonder" | "spark" | "contributor" | "guard";

const LABELS: Record<ModelFamily, string> = {
  wonder: "Wonder",
  spark: "Spark",
  contributor: "Contributor",
  guard: "PromptGuard",
};

/** The family of a Meta model id: `muse-wonder-1.0`, `muse-spark-1.3`, `muse-spark-1.3-contributor`,
 * `promptguard-2`. Null for an id this UI does not know. */
export function modelFamily(id: string): ModelFamily | null {
  const s = id.toLowerCase();
  if (s.includes("guard")) return "guard";
  if (s.includes("contributor")) return "contributor";
  if (s.includes("wonder")) return "wonder";
  if (s.includes("spark")) return "spark";
  return null;
}

export interface ModelBadgeProps {
  /** A model id (`muse-spark-1.3`) or a family name (`wonder`). */
  model: string;
  /** Show the id's version too: "Spark 1.3". */
  version?: boolean;
}

/** Which model made a call: a dot in the model's colour and its name. The name carries the
 * meaning, so the colour is never the only cue. */
export function ModelBadge({ model, version = false }: ModelBadgeProps) {
  const family = modelFamily(model);
  const number = version ? /(\d+(?:\.\d+)?)(?:-contributor)?$/.exec(model)?.[1] : undefined;
  const name = family ? LABELS[family] : model;
  return (
    <span className="model-badge" data-model={family ?? "unknown"} title={model}>
      <i className="model-badge__dot" aria-hidden />
      {name}
      {number && <span className="model-badge__version">{number}</span>}
    </span>
  );
}
