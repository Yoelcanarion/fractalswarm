// The New task form (spec §16 item 6, MVI): a TaskSpec built from form fields, as an object (what
// POST /api/tasks takes) and as YAML (what ``fractalswarm run`` takes). The fields are those of
// planning/taskspec.py; the server validates the rest (``extra="forbid"``).

export const KNOWN_TASKS = ["t2_conference", "t3_report"] as const;

export interface TaskForm {
  goal: string;
  task: string;
  seed: string;
  budgetUsd: string;
  scalingMode: "exact" | "autoscale";
  fanout: string; // "3,2"
  agentsPerLeaf: string;
  contributorOptIn: boolean;
  autoApprove: boolean;
  inputs: string; // "key: value" lines
}

export const defaultForm = (): TaskForm => ({
  goal: "",
  task: "t2_conference",
  seed: "1",
  budgetUsd: "2",
  scalingMode: "exact",
  fanout: "3,2",
  agentsPerLeaf: "2",
  contributorOptIn: false,
  autoApprove: true,
  inputs: "",
});

/** ``key: value`` lines to a flat object. A value that is valid JSON (a number, true, "text",
 * [1, 2]) is read as that; anything else is a plain string. */
export function parseInputs(text: string): { value: Record<string, unknown>; errors: string[] } {
  const value: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    const key = colon < 0 ? "" : line.slice(0, colon).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push(`inputs line ${index + 1}: expected "key: value"`);
      continue;
    }
    const rest = line.slice(colon + 1).trim();
    try {
      value[key] = JSON.parse(rest);
    } catch {
      value[key] = rest;
    }
  }
  return { value, errors };
}

export interface BuiltTask {
  spec: Record<string, unknown> | null;
  errors: string[];
}

export function buildTaskSpec(form: TaskForm): BuiltTask {
  const errors: string[] = [];
  if (!form.goal.trim()) errors.push("the goal is required");
  const budget = Number(form.budgetUsd);
  if (form.budgetUsd.trim() === "" || !Number.isFinite(budget) || budget <= 0) errors.push("the budget must be a number above 0");
  const fanout = form.fanout.split(",").map((part) => Number(part.trim()));
  if (fanout.length === 0 || fanout.some((n) => !Number.isInteger(n) || n < 1)) errors.push("the fanout is a list of whole numbers from 1, like 3,2");
  const agents = Number(form.agentsPerLeaf);
  if (!Number.isInteger(agents) || agents < 1) errors.push("the agents per leaf is a whole number from 1");
  const inputs = parseInputs(form.inputs);
  errors.push(...inputs.errors);
  if (errors.length > 0) return { spec: null, errors };
  const spec: Record<string, unknown> = {
    goal: form.goal.trim(),
    task: form.task.trim() || "t2_conference",
  };
  if (Object.keys(inputs.value).length > 0) spec.inputs = inputs.value;
  spec.seed = form.seed.trim() || "1";
  spec.budget_usd = budget;
  spec.scaling = { mode: form.scalingMode, fanout, agents_per_leaf: agents };
  spec.contributor_opt_in = form.contributorOptIn;
  spec.auto_approve = form.autoApprove;
  return { spec, errors };
}

const scalar = (value: unknown): string => (typeof value === "string" ? JSON.stringify(value) : String(value));

/** The TaskSpec as YAML. Strings are double-quoted JSON strings, which YAML reads the same way. */
export function toYaml(spec: Record<string, unknown>, indent = ""): string {
  return Object.entries(spec)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${indent}${key}: [${value.map(scalar).join(", ")}]`;
      if (value !== null && typeof value === "object") return `${indent}${key}:\n${toYaml(value as Record<string, unknown>, `${indent}  `)}`;
      return `${indent}${key}: ${scalar(value)}`;
    })
    .join("\n");
}
