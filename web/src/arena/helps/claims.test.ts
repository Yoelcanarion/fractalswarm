// The panel may say only what docs/claims.md allows, in its words. This holds claims.ts to that file: when the
// decision gate flips a status there, this fails until claims.ts follows.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../lib/testing";
import { CLAIMS, headlineClaim, type ClaimId } from "./claims";

interface Row {
  claim: string;
  status: string;
}

/** The rows of the table "Against the rivals": `| R1 | "claim" | allowed when | evidence | status |`. */
function claimRows(markdown: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 7 || !/^R\d+$/.test(cells[1])) continue;
    const quoted = /^"(.*)"$/.exec(cells[2]);
    rows.set(cells[1], { claim: quoted ? quoted[1] : cells[2], status: cells[cells.length - 2] });
  }
  return rows;
}

const rows = claimRows(readFileSync(REPO_ROOT + "docs/claims.md", "utf-8"));

describe("the claims the panel quotes", () => {
  it("find their row in docs/claims.md", () => {
    expect([...rows.keys()].sort()).toEqual(expect.arrayContaining(Object.keys(CLAIMS)));
  });

  for (const id of Object.keys(CLAIMS) as ClaimId[]) {
    it(`${id} has the words of docs/claims.md`, () => {
      expect(CLAIMS[id].text).toBe(rows.get(id)?.claim);
    });

    it(`${id} is a placeholder while docs/claims.md has it pending, and only then`, () => {
      const status = rows.get(id)?.status ?? "";
      expect(status, `docs/claims.md gives ${id} a status this guard does not know`).toMatch(/^(pending|allowed)/i);
      expect(CLAIMS[id].placeholder).toBe(/^pending/i.test(status));
    });
  }

  it("make the headline the decision rule allows: R1 for outcome A, R2 for outcome B, none for anything else", () => {
    expect(headlineClaim("A")?.id).toBe("R1");
    expect(headlineClaim("B")?.id).toBe("R2");
    expect(headlineClaim("C")).toBeNull();
    expect(headlineClaim("")).toBeNull();
  });
});
