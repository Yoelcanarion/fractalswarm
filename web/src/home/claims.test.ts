// The page quotes claims; it never writes them. These tests hold it to docs/claims.md: the ids it uses exist there and
// are not "not claimed", the status wording is read the way the table writes it, and no claim is typed into the code.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CLAIM_IDS, sentences } from "./parts/Claim";
import { claimState } from "./story";
import { claimRows, claimWords, HOME, sources } from "./testing";

const rows = claimRows();
const rowOf = (id: string) => rows.find((row) => row.id === id);

describe("the claims the page quotes", () => {
  it("are rows of docs/claims.md, and none of them is not claimed", () => {
    expect(rows.length).toBeGreaterThanOrEqual(CLAIM_IDS.length);
    for (const id of CLAIM_IDS) {
      const row = rowOf(id);
      expect(row, `${id} is not in docs/claims.md`).toBeDefined();
      expect(claimState(row!.status), `${id} is not claimed`).not.toBe("refused");
    }
  });

  it("leave out R1, which is not claimed", () => {
    expect(CLAIM_IDS).not.toContain("R1");
    expect(claimState(rowOf("R1")!.status)).toBe("refused");
  });

  it("are read from the status cell the way the table writes it", () => {
    for (const row of rows) {
      const plain = row.status.replace(/[*_`]/g, "").toLowerCase();
      const state = claimState(row.status);
      if (plain.startsWith("not claimed")) expect(state, row.id).toBe("refused");
      else if (plain.includes("pending")) expect(state, `${row.id} says pending`).toBe("pending");
      else if (plain.startsWith("allowed")) expect(state, row.id).toBe("allowed");
    }
  });

  it("are only ever drawn through <Claim id=...>, with an id from that list", () => {
    const used = new Set<string>();
    for (const file of sources(HOME)) {
      for (const match of readFileSync(file, "utf-8").matchAll(/<Claim\s+id="([A-Z]\d)"/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(CLAIM_IDS as readonly string[], `${id} is drawn but not in CLAIM_IDS`).toContain(id);
  });

  it("are not typed into the page: the words of a row appear only in the data", () => {
    const code = sources(HOME).map((file) => readFileSync(file, "utf-8").replace(/\s+/g, " "));
    for (const row of rows) {
      if (row.id === "S7") continue; // the tagline is the one claim that is also copy
      const head = claimWords(row.text).replace(/\s+/g, " ").slice(0, 48);
      for (const text of code) expect(text.includes(head), `${row.id} is written out in the code: "${head}"`).toBe(false);
    }
  });

  it("split R6, the hero's subtitle, into its two sentences without changing a word", () => {
    const words = claimWords(rowOf("R6")!.text);
    const lines = sentences(words);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe(words);
    expect(sentences("It stalled 14.6 s against 92.6 s. Done.")).toEqual(["It stalled 14.6 s against 92.6 s.", "Done."]);
    expect(sentences("One sentence only.")).toEqual(["One sentence only."]);
  });

  it("let the tagline be exactly the sentence of S7", () => {
    expect(claimWords(rowOf("S7")!.text)).toContain("Kill half the brains. It still finishes.");
  });
});
