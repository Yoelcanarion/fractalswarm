import { describe, expect, it } from "vitest";

import { buildTaskSpec, defaultForm, parseInputs, taskLaunchBody, toYaml } from "./taskspec";

const form = (patch: Partial<ReturnType<typeof defaultForm>> = {}) => ({ ...defaultForm(), goal: "Build the program.", ...patch });

// The fields of api/jobs.py `TaskRequest` (extra="forbid") and the ones of planning/taskspec.py `TaskSpec`.
const TASK_REQUEST_FIELDS = ["spec", "scenario", "chaos", "clock", "speed", "backend", "run_id", "budget_usd", "cross_audit", "feasibility_report", "preflight_token", "confirm"];
const TASK_SPEC_FIELDS = ["goal", "task", "inputs", "seed", "budget_usd", "scaling", "market", "max_steps", "max_attempts", "contributor_opt_in", "auto_approve", "channel_breakers", "cross_audit", "feasibility_report"];

describe("the New task form", () => {
  it("builds the TaskSpec that planning/taskspec.py takes", () => {
    const { spec, errors } = buildTaskSpec(form());
    expect(errors).toEqual([]);
    expect(spec).toEqual({
      goal: "Build the program.",
      task: "t2_conference",
      inputs: { fixture: "tasks/fixtures/t2/seed-1" },
      seed: "1",
      budget_usd: 2,
      scaling: { mode: "exact", fanout: [3, 2], agents_per_leaf: 2 },
      contributor_opt_in: false,
      auto_approve: true,
    });
  });

  it("puts the inputs in, reading numbers and quoted text as such", () => {
    const { spec } = buildTaskSpec(
      form({ inputs: 'fixture: tasks/fixtures/t2/seed-1\ngenerate_seed: 1\npoison: 2\npoison_wording: "explicit,authority"\n# a comment\n\nsubjects: ["a", "b"]' }),
    );
    expect(spec?.inputs).toEqual({
      fixture: "tasks/fixtures/t2/seed-1",
      generate_seed: 1,
      poison: 2,
      poison_wording: "explicit,authority",
      subjects: ["a", "b"],
    });
  });

  it("explains what is wrong instead of building a spec", () => {
    expect(buildTaskSpec(form({ goal: "  " })).errors).toEqual(["the goal is required"]);
    expect(buildTaskSpec(form({ budgetUsd: "0" })).errors[0]).toMatch(/budget/);
    expect(buildTaskSpec(form({ budgetUsd: "" })).errors[0]).toMatch(/budget/);
    expect(buildTaskSpec(form({ fanout: "3,0" })).errors[0]).toMatch(/fanout/);
    expect(buildTaskSpec(form({ fanout: "3,x" })).errors[0]).toMatch(/fanout/);
    expect(buildTaskSpec(form({ agentsPerLeaf: "1.5" })).errors[0]).toMatch(/agents/);
    expect(buildTaskSpec(form({ inputs: "no colon here" })).errors).toEqual(['inputs line 1: expected "key: value"']);
    const bad = buildTaskSpec(form({ goal: "", budgetUsd: "-1" }));
    expect(bad.spec).toBeNull();
    expect(bad.errors).toHaveLength(2);
  });

  it("writes YAML that keeps a multi-line goal and quotes every string", () => {
    const { spec } = buildTaskSpec(form({ goal: 'Plan "DevConf":\nday 1 and day 2', inputs: "fixture: tasks/fixtures/t2/seed-1", autoApprove: false }));
    expect(toYaml(spec!)).toBe(
      [
        'goal: "Plan \\"DevConf\\":\\nday 1 and day 2"',
        'task: "t2_conference"',
        "inputs:",
        '  fixture: "tasks/fixtures/t2/seed-1"',
        'seed: "1"',
        "budget_usd: 2",
        "scaling:",
        '  mode: "exact"',
        "  fanout: [3, 2]",
        "  agents_per_leaf: 2",
        "contributor_opt_in: false",
        "auto_approve: false",
      ].join("\n"),
    );
  });

  it("reads a value that is not JSON as plain text", () => {
    expect(parseInputs("fixture: a path with spaces/and: colons").value).toEqual({ fixture: "a path with spaces/and: colons" });
    expect(parseInputs("poison: 0").value).toEqual({ poison: 0 });
  });

  it("starts with the input that the default task needs, so the first Submit is not refused", () => {
    expect(buildTaskSpec(form()).errors).toEqual([]);
    expect(defaultForm().inputs).toBe("fixture: tasks/fixtures/t2/seed-1");
  });

  it("says what a conference task is missing before the server has to (422: give the input)", () => {
    expect(buildTaskSpec(form({ inputs: "" })).errors).toEqual(['t2_conference needs an input: add a line like "fixture: tasks/fixtures/t2/seed-1"']);
    expect(buildTaskSpec(form({ inputs: "poison: 1" })).errors).toHaveLength(1); // a setting is not an input
    expect(buildTaskSpec(form({ task: "t1_extraction", inputs: "" })).errors).toEqual(['t1_extraction needs an input: add a line like "fixture: tasks/fixtures/t1/seed-1"']);
    for (const given of ['fixture: tasks/fixtures/t2/seed-2', "intake: abc123", 'inline: {"corpus": {}}']) {
      expect(buildTaskSpec(form({ inputs: given })).errors).toEqual([]);
    }
    expect(buildTaskSpec(form({ task: "t3_report", inputs: "" })).errors).toEqual([]); // the report task names its own sources
    expect(buildTaskSpec(form({ inputs: "no colon here" })).errors).toEqual(['inputs line 1: expected "key: value"']); // one problem at a time
  });
});

// POST /api/tasks refuses a body with a key it does not know (extra="forbid"), so a form that sent the bare
// TaskSpec got a 422 for every field of it.
describe("the body that starts a run", () => {
  it("wraps the TaskSpec under `spec` and asks for the fake LLM", () => {
    const { spec } = buildTaskSpec(form({ autoApprove: false }));
    const body = taskLaunchBody(spec!);
    expect(body).toEqual({ spec, backend: "fake" });
    expect(Object.keys(body).every((key) => TASK_REQUEST_FIELDS.includes(key))).toBe(true);
    expect(TASK_REQUEST_FIELDS).toContain("spec");
  });

  it("holds only fields of the TaskSpec, for every shape of the form", () => {
    for (const patch of [{}, { scalingMode: "autoscale" as const }, { contributorOptIn: true }, { autoApprove: false }, { inputs: "fixture: tasks/fixtures/t2/seed-1\npoison: 1\ngenerate_seed: 1" }]) {
      const { spec } = buildTaskSpec(form(patch));
      expect(Object.keys(spec!).every((key) => TASK_SPEC_FIELDS.includes(key))).toBe(true);
    }
  });
});
