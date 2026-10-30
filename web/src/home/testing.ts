// Helpers for the home page's tests: a made-up story, and the rows of docs/claims.md. Nothing here is imported by the page.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "../lib/testing";
import type { Story, StoryClaim } from "./story";

/** The folder of the home page. */
export const HOME = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "");

/** The code of the page: every .ts and .tsx under `dir`, but not the tests, these helpers or W7's generated data. */
export function sources(dir: string = HOME): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return name === "data" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && name !== "testing.ts" ? [path] : [];
  });
}

export interface ClaimRow {
  id: string;
  /** The "Claim, as worded" cell, with its markdown as written. */
  text: string;
  /** The Status cell, with its markdown as written. */
  status: string;
}

/** The rows of the claims tables in docs/claims.md (S1 to S7, R1 to R5), read as the generator reads them. */
export function claimRows(): ClaimRow[] {
  const doc = readFileSync(`${REPO_ROOT}docs/claims.md`, "utf-8");
  const rows: ClaimRow[] = [];
  for (const line of doc.split(/\r?\n/)) {
    if (!/^\|\s*[SR]\d\s*\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.push({ id: cells[0], text: cells[1], status: cells[cells.length - 1] });
  }
  return rows;
}

/** A claim's words as the page shows them: the row's text without the quotation marks around it. */
export const claimWords = (text: string): string => text.replace(/^"|"$/g, "");

// Statuses as docs/claims.md words them on Oct 30: three rows still pending, one not claimed.
const claim = (id: string, status: string): [string, StoryClaim] => [id, { text: `Test claim ${id}.`, status }];

/** A story with made-up numbers, each chosen to differ from every real one, so a test can tell that the page printed the
 * data it was given and not a number of its own. */
export const FIXTURE_STORY: Story = {
  claims: Object.fromEntries([
    claim("S1", "allowed by construction; pending the recorded check on the final bundle"),
    claim("S2", "pending"),
    claim("S3", "allowed by construction"),
    claim("S4", "**allowed** as a property of the design, never as an advantage over the rivals"),
    claim("S5", "pending"),
    claim("S6", "allowed, always with the limitation"),
    claim("S7", "**allowed**. The measured numbers go under it as a subtitle"),
    claim("R1", "**not claimed** (outcome B)"),
    claim("R2", "**allowed** (gate, Oct 29; real rows, Oct 30)"),
    claim("R3", "**allowed**, always with R2"),
    claim("R4", "**allowed with its setting** (Oct 30)"),
    claim("R5", "**allowed with its setting** (Oct 30)"),
  ]),
  facts: { talks: 31, tracks: 3, days: 2, sessions: 6, orchestrators: 10, agents: 12 },
  hero: {
    task: "t2_conference",
    title: "rivals-real",
    series: {
      swarm: {
        points: [
          { profile: "C0", x: 0, stall_s: 0.4, extra_cost_pct: 0.2, seeds: ["1", "2"] },
          { profile: "C3", x: 5, stall_s: 7.7, extra_cost_pct: 3.3, seeds: ["1", "2"] },
        ],
      },
      central: {
        points: [
          { profile: "C0", x: 0, stall_s: 0.5, extra_cost_pct: 0.3, seeds: ["1", "2"] },
          { profile: "C3", x: 5, stall_s: 91.1, extra_cost_pct: 77.7, seeds: ["1", "2"] },
        ],
      },
    },
  },
  headline: { real: true, cells: [{ seed: 1 }, { seed: 2 }, { seed: 3 }, { seed: 1 }, { seed: 2 }, { seed: 3 }] },
  finish: { talksPlaced: 31, talksTotal: 31, hardViolations: 0, duplicateCalls: 0, costUsd: 4.56, task: "t2_conference", real: false, seeds: 1 },
  takeover: { killed: 4, rootChain: ["o0", "o1", "o2", "o3"], deathVerdictS: 5.5 },
  failures: {
    fastRestart: [
      { value: 13.4, label: "at 0.5 s" },
      { value: 5.9, label: "at 1 s" },
    ],
    falseDeaths: [
      { value: 1.3, label: "at C2" },
      { value: 2.3, label: "at C3" },
    ],
    perProcess: { value: 0.91, label: "swarm over supervisor", decimals: 2 },
  },
  assumptions: [
    { id: "detect", label: "Failure detection", value: "5 s" },
    { id: "restart", label: "Extra restart time", value: "none" },
  ],
  tokens: { coordination: 0, recovery: 0 },
  extraction: {
    email: "Hi, I can only do Thursday afternoon, and please not against Priya's talk.",
    constraints: [
      { text: "Available Thursday afternoon only", source: "only do Thursday afternoon" },
      { text: "Not against Priya's talk", source: [49, 73] },
    ],
    model: "Muse Spark, one call",
  },
  ablation: { parser: 11, muse: 17, total: 20 },
  proof: { lines: ["MATCH  1234 events, head abc123", "TAKEOVER OK: no violation"] },
};
