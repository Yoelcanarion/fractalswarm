import { describe, expect, it } from "vitest";

import { buildTaskSpec, defaultForm, parseInputs, toYaml } from "./taskspec";

const form = (patch: Partial<ReturnType<typeof defaultForm>> = {}) => ({ ...defaultForm(), goal: "Build the program.", ...patch });

describe("the New task form", () => {
  it("builds the TaskSpec that planning/taskspec.py takes", () => {
    const { spec, errors } = buildTaskSpec(form());
    expect(errors).toEqual([]);
    expect(spec).toEqual({
      goal: "Build the program.",
      task: "t2_conference",
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
});
