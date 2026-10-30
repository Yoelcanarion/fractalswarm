// Helpers for the home page's tests: a made-up story, and the rows of docs/claims.md. Nothing here is imported by the page.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "../lib/testing";
import type { ClaimState, Story } from "./data/types";
import { bundledStory } from "./story";

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

/** The rows of the claims tables in docs/claims.md (S1 to S7, R1 to R6), read as the generator reads them. */
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

/** What a Status cell says, read the way the table writes it; null for wording nobody has classified. */
export function statusOfCell(cell: string): ClaimState | null {
  const plain = cell.replace(/[*_`]/g, "").trim().toLowerCase();
  if (plain.startsWith("not claimed")) return "not-claimed";
  if (plain.includes("pending")) return "pending";
  if (plain.startsWith("allowed")) return "allowed";
  return null;
}

/** Markdown marks and the spacing around them taken out, to compare the words of two renderings of one cell. */
export const bare = (text: string): string => text.replace(/[*_`"]/g, "").replace(/\s+/g, " ").trim();

/** Wording that says every run was valid. A first invalid real run is on record (swarm__t2_conference__C0__s5, no chaos,
 * 40 of 48 talks placed), so the page may say it only through a claim of docs/claims.md: in the row's own words, with
 * its setting beside it (S7 and R6 speak of C3). Nothing in the page's own copy may. "Not valid" is the other side of it
 * (W7's dot plot rings a run whose result is not valid and says so in its key), so a negated "valid" is not flagged. */
export const UNIVERSAL: [RegExp, string][] = [
  [/(?<!\b(?:not|never) )\bvalid\b/i, "valid"],
  [/\b(every|each|all)\b[^.]{0,40}\bruns?\b[^.]{0,40}\b(finish|complet|succe|surviv)/i, "every run finished"],
  [/\balways (finish|complete|succeed)/i, "always finishes"],
];

const must = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new Error(`the bundled story has no ${what}`);
  return value;
};

// States as docs/claims.md words them on Oct 30: three rows still pending, one not claimed.
const FIXTURE_STATE: Record<string, ClaimState> = {
  S1: "pending",
  S2: "pending",
  S3: "allowed",
  S4: "allowed",
  S5: "pending",
  S6: "allowed",
  S7: "allowed",
  R1: "not-claimed",
  R2: "allowed",
  R3: "allowed",
  R4: "allowed",
  R5: "allowed",
  R6: "allowed",
};

/** The text a test claim has: a plain sentence, with a code span in one and two sentences in R6. */
export const fixtureClaimText = (id: string): string =>
  id === "R6" ? "Test claim R6, first line. Test claim R6, second line." : id === "R3" ? "Test claim R3, against `durable-max` on T2." : `Test claim ${id}.`;

/** The real story with its numbers changed, each to a value that differs from every real one, so a test can tell that
 * the page printed the data it was given and not a number of its own. The claims are made up as well: the page must
 * draw the words of the row, whatever they are. Only the numbers the page prints itself are changed; the rest is real. */
function madeUp(): Story {
  const story = structuredClone(bundledStory);

  story.claims = Object.fromEntries(Object.entries(FIXTURE_STATE).map(([id, state]) => [id, { text: fixtureClaimText(id), status: state, state }]));

  // the two workflows of the problem chapter, at the heaviest failure profile of the first real matrix
  const last = (workflow: string) => must(story.hero.series[workflow]?.points.at(-1), `a last point for ${workflow}`);
  const seeds = ["1", "2", "3", "4", "5", "6", "7"];
  Object.assign(last("swarm"), { stall_s: 7.7, extra_cost_pct: 3.3, seeds });
  Object.assign(last("central"), { stall_s: 91.1, extra_cost_pct: 77.7, seeds });
  story.hero.seedCount = seeds.length;
  const headline = must(story.headline, "headline");
  headline.seeds = ["1", "2", "3", "4", "5"];
  headline.seedCount = 5;

  Object.assign(story.facts, { talks: 31, tracks: 4, days: 3, sessions: 5, orchestrators: 9, agents: 11 });
  Object.assign(story.finish, { task: "t1_extraction", real: false, seeds: 1, talksPlaced: 31, talksTotal: 31, costUsd: 4.56 });
  story.takeover.killed = 4;
  story.takeover.rootChain = ["o0", "o7", "o8"];

  story.failures = {
    fastRestart: [
      { value: 13.4, label: "the supervisor detects and restarts in 0.5 s, the swarm keeps 5 s" },
      { value: 5.9, label: "the supervisor detects and restarts in 1 s, the swarm keeps 5 s" },
    ],
    falseDeaths: [
      { value: 1.3, label: "per run at C2, fake model, 4 runs" },
      { value: 2.3, label: "per run at C3, fake model, 4 runs" },
      { value: 2.5, label: "per run at C3, real model, 3 seeds" },
    ],
    perProcess: { value: 0.91, label: "each coordinator process failing at the same rate", decimals: 2 },
  };
  const real = must(
    must(story.verdicts, "verdicts").falseDeaths.find((row) => row.workflow === "swarm" && row.profile === "C3"),
    "the swarm's false deaths at C3 in the verdicts",
  );
  real.remapsPerRun = 2.5;

  story.tokens = { coordination: 7, recovery: 9 };
  story.proof.lines = ["MATCH  backup: 1234 events, head abc123"];
  story.assumptions = [
    { id: "detection", label: "Failure detection", value: "5 s", why: "Same detector for both", checkedBy: "A sweep" },
    { id: "calls", label: "The rival's own calls", value: "`durable-max`: survive", why: "Two variants bound the range", checkedBy: "Both rows" },
  ];
  return story;
}

export const FIXTURE_STORY: Story = madeUp();
