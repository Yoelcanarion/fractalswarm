// The page quotes claims; it never writes them. These tests hold it to docs/claims.md: the ids it uses exist there and
// are not "not claimed", the story it ships with holds each row in the row's own words and status, and no claim is
// typed into the code.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CLAIM_IDS, clauses, sentences } from "./parts/Claim";
import { bundledStory, claimState } from "./story";
import { bare, claimRows, claimWords, HOME, sources, statusOfCell } from "./testing";

const rows = claimRows();
const rowOf = (id: string) => rows.find((row) => row.id === id);

describe("the claims the page quotes", () => {
  it("are rows of docs/claims.md, and none of them is not claimed", () => {
    expect(rows.length).toBeGreaterThanOrEqual(CLAIM_IDS.length);
    for (const id of CLAIM_IDS) {
      const row = rowOf(id);
      expect(row, `${id} is not in docs/claims.md`).toBeDefined();
      expect(statusOfCell(row!.status), `${id} is not claimed`).not.toBe("not-claimed");
    }
  });

  it("leave out R1, which is not claimed", () => {
    expect(CLAIM_IDS).not.toContain("R1");
    expect(statusOfCell(rowOf("R1")!.status)).toBe("not-claimed");
  });

  it("are written in a status the page knows how to read", () => {
    for (const row of rows) expect(statusOfCell(row.status), `${row.id}: "${row.status}"`).not.toBeNull();
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
    const words = bundledStory.claims.R6?.text ?? claimWords(rowOf("R6")!.text);
    const lines = sentences(words);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe(words);
    expect(sentences("It stalled 14.6 s against 92.6 s. Done.")).toEqual(["It stalled 14.6 s against 92.6 s.", "Done."]);
    expect(sentences("One sentence only.")).toEqual(["One sentence only."]);
  });

  it("set R3's conditions as a list, one clause to a line, without changing a word", () => {
    const words = bundledStory.claims.R3?.text ?? claimWords(rowOf("R3")!.text);
    const lines = clauses(words);
    expect(lines.join(" ")).toBe(words);
    expect(lines).toHaveLength(5); // it holds; it ties; it fails. Per process. False deaths.
    expect(lines[1]).toMatch(/^it ties at the default assumptions/);
    expect(lines[2]).toMatch(/^it fails when an external supervisor/);
  });

  it("let the tagline be exactly the sentence of S7", () => {
    expect(claimWords(rowOf("S7")!.text)).toContain("Kill half the brains. It still finishes.");
  });
});

describe("the story the page ships with (data/story.json)", () => {
  it("carries every claim the page quotes, in the words of its row of docs/claims.md", () => {
    for (const id of CLAIM_IDS) {
      const claim = bundledStory.claims[id];
      expect(claim, `${id} is in docs/claims.md but not in data/story.json: the generator has to run again`).toBeDefined();
      expect(bare(claim.text), id).toBe(bare(claimWords(rowOf(id)!.text)));
    }
  });

  it("gives each claim the state its row has, and no state the page would read as allowed by mistake", () => {
    for (const [id, claim] of Object.entries(bundledStory.claims)) {
      const row = rowOf(id);
      expect(row, `${id} is in data/story.json but not in docs/claims.md`).toBeDefined();
      expect(claim.state, id).toBe(statusOfCell(row!.status));
      expect(claimState(claim.state) === "allowed", id).toBe(claim.state === "allowed");
    }
  });
});
