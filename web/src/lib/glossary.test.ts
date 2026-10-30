import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { defineTerm, GLOSSARY, profileTerm, type TermId } from "./glossary";
import { REPO_ROOT } from "./testing";

const ids = Object.keys(GLOSSARY) as TermId[];

describe("the glossary", () => {
  it("defines every term in a sentence or two, ending with a full stop", () => {
    for (const id of ids) {
      const { term, says } = GLOSSARY[id];
      expect(term.length, id).toBeGreaterThan(0);
      expect(says.endsWith("."), `${id} ends with a full stop`).toBe(true);
      expect(says.length, `${id} is short enough to read in a bubble`).toBeLessThan(260);
    }
  });

  it("only defines: no comparison, and none of the words docs/claims.md keeps for itself", () => {
    // "Needs no supervisor" is not simpler, cheaper or more reliable, and "first" is shown, not claimed (docs/claims.md).
    const claims = /simpler|cheaper|more reliable|reliab|faster|better|\bbest\b|worse|\bfirst\b|outperform|without stalling|paying twice/i;
    for (const id of ids) expect(GLOSSARY[id].says, id).not.toMatch(claims);
  });

  it("states the chaos profiles as bench/profiles.py defines them", () => {
    const source = readFileSync(REPO_ROOT + "src/fractalswarm/bench/profiles.py", "utf-8");
    const profile = (name: string) => {
      const block = new RegExp(`name="${name}",([\\s\\S]*?)\\)`).exec(source)?.[1] ?? "";
      const field = (key: string) => Number(new RegExp(`${key}=(\\d+)`).exec(block)?.[1]);
      return {
        crashes: field("coordinator_crashes"),
        killed: field("agents_killed_pct"),
        faults: field("api_fault_pct"),
        loss: field("message_loss_pct"),
        partition: /partition=True/.test(block),
      };
    };
    const crashes = { c1: ["One", 1], c2: ["Three", 3], c3: ["Five", 5] } as const;
    for (const id of ["c1", "c2", "c3"] as const) {
      const p = profile(id.toUpperCase());
      const says = GLOSSARY[id].says;
      expect(p.crashes, `${id} crashes`).toBe(crashes[id][1]);
      expect(says.startsWith(crashes[id][0]), id).toBe(true);
      expect(says, id).toContain(`${p.killed}% of the agents killed`);
      expect(says, id).toContain(`${p.faults}% API faults`);
      expect(says, id).toContain(`${p.loss}% message loss`);
      expect(/network partition/.test(says), `${id} partition`).toBe(p.partition);
    }
    expect(profile("C0")).toMatchObject({ crashes: 0, killed: 0, partition: false });
  });

  it("finds the entry of a profile name", () => {
    expect(profileTerm("C3")).toBe("c3");
    expect(profileTerm("c0")).toBe("c0");
    expect(profileTerm("K-o0")).toBeNull();
    expect(profileTerm(null)).toBeNull();
    expect(defineTerm("stall")).toContain("no agent LLM call is in flight");
  });
});
