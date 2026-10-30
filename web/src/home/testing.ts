// Helpers for the home page's tests: a made-up story, and the rows of docs/claims.md. Nothing here is imported by the page.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "../lib/testing";
import type { ClaimStatus, FalseDeathRow, Story } from "./data/types";
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
export function statusOfCell(cell: string): ClaimStatus | null {
  const plain = cell.replace(/[*_`]/g, "").trim().toLowerCase();
  if (plain.startsWith("not claimed")) return "not-claimed";
  if (plain.includes("pending")) return "pending";
  if (plain.startsWith("allowed")) return "allowed";
  return null;
}

/** Markdown marks and the spacing around them taken out, to compare the words of two renderings of one cell. */
export const bare = (text: string): string => text.replace(/[*_`"]/g, "").replace(/\s+/g, " ").trim();

const must = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new Error(`the bundled story has no ${what}`);
  return value;
};

// Statuses as docs/claims.md words them on Oct 30: three rows still pending, one not claimed.
const FIXTURE_STATUS: Record<string, ClaimStatus> = {
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

  story.claims = Object.fromEntries(
    Object.entries(FIXTURE_STATUS).map(([id, status]) => [id, { text: fixtureClaimText(id), status, statusText: status }]),
  );

  // the two workflows of the problem chapter, at the heaviest failure profile of the first real matrix
  const v1 = must(story.hero.v1, "hero.v1");
  const last = (workflow: string) => must(v1.series.find((series) => series.id === workflow)?.points.at(-1), `a last point for ${workflow}`);
  const seeds = ["1", "2", "3", "4", "5", "6", "7"];
  Object.assign(last("swarm"), { stallS: 7.7, extraPct: 3.3, seeds });
  Object.assign(last("central"), { stallS: 91.1, extraPct: 77.7, seeds });
  v1.seedCount = seeds.length;
  must(story.headline, "headline").seeds = ["1", "2", "3", "4", "5"];
  must(story.hero.headline, "hero.headline").seedCount = 5;

  Object.assign(story.finish, { placed: 31, expected: 31, costUsd: 4.56 });
  Object.assign(story.tree.counts, { orchestrators: 9, agents: 11, tracks: 4, sessions: 5 });
  story.takeover.killCount = 4;
  story.takeover.chains["root"] = ["o0", "o7", "o8"];
  story.takeover.detection.meanS = 5.5;
  story.sources.bundle.runId = "t1-fake-killhalf-seed3";

  const fast = must(
    story.regime.rows.find((row) => row.axis === "rival_recovery_ms"),
    "the fast external restart row of the regime",
  );
  [13.4, 5.9].forEach((ratio, i) => (fast.points[i].cdtRatio = ratio));
  const swarm = (rows: FalseDeathRow[], profile: string, value: number) =>
    (must(rows.find((row) => row.workflow === "swarm" && row.profile === profile), `swarm ${profile} false deaths`).remapsPerRun = value);
  swarm(story.falseDeaths.rows, "C2", 1.3);
  swarm(story.falseDeaths.rows, "C3", 2.3);
  swarm(must(story.verdicts, "verdicts").falseDeaths, "C3", 2.5);
  story.perProcess.ratio["cdt_s"] = 0.91;

  story.tokensByModel.coordinationTokens = 7;
  story.tokensByModel.recoveryTokens = 9;
  story.hashes.replay.line = "MATCH  1234 events, head abc123";
  story.assumptions.items = [
    { assumption: "Failure detection", value: "5 s", why: "Same detector for both", checkedBy: "A sweep" },
    { assumption: "The rival's own calls", value: "`durable-max`: survive", why: "Two variants bound the range", checkedBy: "Both rows" },
  ];
  return story;
}

export const FIXTURE_STORY: Story = madeUp();
