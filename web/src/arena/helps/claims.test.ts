// The panel may say only what docs/claims.md allows, in its words. This holds claims.ts to that file: when a row
// changes there (the gate decides, the real rows land), this fails until claims.ts follows.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../lib/testing";
import { CLAIMS, claimsToShow, headlineClaim, type ClaimId, type Claims, type ClaimStatus } from "./claims";

interface Row {
  claim: string;
  status: string;
}

/** The cell as the panel shows it: markdown's code ticks and bold marks left out. */
const plain = (cell: string): string => cell.replace(/[`*]/g, "").trim();

/** The rows of the table "Against the rivals": `| R1 | "claim" | allowed when | evidence | status |`. */
function claimRows(markdown: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 7 || !/^R\d+$/.test(cells[1])) continue;
    const quoted = /^"(.*)"$/.exec(cells[2]);
    rows.set(cells[1], { claim: plain(quoted ? quoted[1] : cells[2]), status: plain(cells[cells.length - 2]) });
  }
  return rows;
}

const kindOf = (status: string): ClaimStatus | null => (["pending", "allowed", "not claimed"] as const).find((kind) => status.toLowerCase().startsWith(kind)) ?? null;

const rows = claimRows(readFileSync(REPO_ROOT + "docs/claims.md", "utf-8"));

describe("the claims the panel quotes", () => {
  it("find their row in docs/claims.md", () => {
    expect([...rows.keys()].sort()).toEqual(expect.arrayContaining(Object.keys(CLAIMS)));
  });

  for (const id of Object.keys(CLAIMS) as ClaimId[]) {
    it(`${id} has the words of docs/claims.md`, () => {
      expect(CLAIMS[id].text).toBe(rows.get(id)?.claim);
    });

    it(`${id} has the status of docs/claims.md: pending, allowed or not claimed, and the note the file adds to it`, () => {
      const status = rows.get(id)?.status ?? "";
      expect(kindOf(status), `docs/claims.md gives ${id} a status this guard does not know`).not.toBeNull();
      expect(CLAIMS[id].status).toBe(kindOf(status));
      expect(CLAIMS[id].note).toBe(status);
    });
  }

  it("make the headline the decision rule allows: R1 for outcome A, R2 for outcome B, none for anything else", () => {
    expect(headlineClaim("A")?.id).toBe("R1");
    expect(headlineClaim("B")?.id).toBe("R2");
    expect(headlineClaim("C")).toBeNull();
    expect(headlineClaim("")).toBeNull();
  });
});

describe("what the strip may quote", () => {
  const withStatus = (status: Partial<Record<ClaimId, ClaimStatus>>): Claims => {
    const claims = structuredClone(CLAIMS);
    for (const id of Object.keys(status) as ClaimId[]) claims[id].status = status[id] as ClaimStatus;
    return claims;
  };
  const ids = (claims: Claims, outcome: string) => {
    const shown = claimsToShow(outcome, claims);
    return [shown.headline?.id ?? null, shown.conditions?.id ?? null];
  };

  it("is the headline of the outcome with the conditions next to it, when docs/claims.md allows them", () => {
    expect(ids(withStatus({ R1: "allowed", R2: "allowed", R3: "allowed" }), "B")).toEqual(["R2", "R3"]);
    expect(ids(withStatus({ R1: "allowed", R2: "allowed", R3: "allowed" }), "A")).toEqual(["R1", "R3"]);
  });

  it("quotes wording that is still pending, so that the panel can mark it", () => {
    expect(ids(withStatus({ R2: "pending", R3: "pending" }), "B")).toEqual(["R2", "R3"]);
  });

  it("quotes no claim docs/claims.md does not allow: not the headline, and then not the conditions either", () => {
    expect(ids(withStatus({ R2: "not claimed" }), "B")).toEqual([null, null]);
    expect(ids(withStatus({ R1: "not claimed", R3: "allowed" }), "A")).toEqual([null, null]);
  });

  it("quotes no conditions that docs/claims.md does not allow, and no headline for an outcome without one", () => {
    expect(ids(withStatus({ R2: "allowed", R3: "not claimed" }), "B")).toEqual(["R2", null]);
    expect(ids(withStatus({ R1: "allowed", R2: "allowed", R3: "allowed" }), "C")).toEqual([null, null]);
  });
});
