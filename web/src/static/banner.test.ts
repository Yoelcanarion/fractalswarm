import { describe, expect, it } from "vitest";

import { isHomeHash } from "../home/route";
import { COMMAND } from "./answers";
import { buildDetail, buildNote, isHome } from "./Banner";
import { readStamp, verifiedAtBuild, whereChecked } from "./BuildVerified";
import { megabytes, overall, SHOW_FROM_BYTES, type LoadProgress } from "./progress";
import { VERIFY, makeSite } from "./testing";

describe("where the banner shows", () => {
  it.each(["", "#", "#/", "#//", "#/?x=1", "#?x=1", "#/?at=solution", "#/home", "#/home/", "#/home?at=tie"])(
    "is not on the home page, %j",
    (hash) => {
      expect(isHome(hash)).toBe(true);
    },
  );

  it.each(["#/run/demo-backup", "#/run/home", "#/home/x", "#/homework", "#/arena", "#/runs", "#/helps", "#/charts", "#/new", "#/ablation", "#/director/demo-backup"])(
    "is on %s",
    (hash) => {
      expect(isHome(hash)).toBe(false);
    },
  );

  // The banner keeps its own copy of the rule, so that the static folder imports none of the home page. This keeps the
  // two from drifting: if W6's rule changes, this fails and Banner.tsx follows.
  it("agrees with the home route, whatever the hash", () => {
    const hashes = ["", "#", "#/", "#//", "#?x=1", "#/?at=solution", "#/?still", "#/home", "#/home/", "#/home?at=tie", "#/home-lab", "#/home-lab/", "#/Home"];
    for (const hash of [...hashes, "#/run/home", "#/home/x", "#/homework", "#/arena", "#/runs", "#/charts", "#/new", "#/director", "#/director/s1-arena-open?hold"]) {
      expect(isHome(hash), hash).toBe(isHomeHash(hash));
    }
  });
});

describe("what the banner says about the build", () => {
  const { site } = makeSite().manifest;

  it("gives the command to run the real thing", () => {
    expect(COMMAND).toBe("uv run fractalswarm demo --verify");
  });

  it("says the replays were checked at build, at which commit, and not in the browser", () => {
    const note = buildNote(site);
    expect(note).toContain("checked when this site was built");
    expect(note).toContain("cccccccc".slice(0, 7));
    expect(note).toContain("2026-10-30");
    expect(note).toContain("not in your browser");
  });

  it("marks a build from a tree with uncommitted changes", () => {
    expect(buildNote({ ...site, dirty: true })).toContain("ccccccc+");
    expect(buildDetail({ ...site, dirty: true })).toContain("with uncommitted changes");
    expect(buildDetail(site)).not.toContain("uncommitted");
  });

  it("gives the whole commit and the command to check a replay yourself in the tooltip", () => {
    const detail = buildDetail(site);
    expect(detail).toContain("c".repeat(40));
    expect(detail).toContain("uv run fractalswarm replay RUN --verify");
  });
});

describe("what the verify badge says about the report", () => {
  it("reads the stamp the build added to the report", () => {
    expect(readStamp(VERIFY)).toEqual({ commit_short: "c".repeat(12), built_at: "2026-10-30T10:00:00Z" });
  });

  it("reads no stamp from a report that carries none", () => {
    const { static: _stamp, ...bare } = VERIFY;
    expect(readStamp(bare)).toBeNull();
    expect(readStamp({ static: { commit_short: 3 } })).toBeNull();
  });

  it("gives a plain-words verdict for a table cell, which never says a replay ran just now", () => {
    const words = verifiedAtBuild(VERIFY as never);
    expect(words.label).toBe("Replay verified at build");
    expect(words.detail).toContain("not in your browser");
    expect(words.detail).toContain("commit ccccccc on 2026-10-30");
    expect(words.detail).toContain("uv run fractalswarm demo --verify");
    expect(`${words.label} ${words.detail}`).not.toMatch(/re-run|replaying|just now/i);
  });

  it("says where the check was made, whether or not it can say when", () => {
    expect(whereChecked(readStamp(VERIFY))).toBe("Checked when this page was built, at commit ccccccc on 2026-10-30, not in your browser.");
    expect(whereChecked(null)).toBe("Checked when this page was built, not in your browser.");
  });
});

describe("the load bar", () => {
  const report = (runId: string, loaded: number, total: number): [string, LoadProgress] => [runId, { runId, loaded, total }];

  it("shows nothing for a log that loads before anyone could read it", () => {
    expect(overall(new Map([report("small", 0, SHOW_FROM_BYTES - 1)]))).toBeNull();
  });

  it("shows nothing once a log has loaded", () => {
    expect(overall(new Map([report("big", 6_000_000, 6_000_000)]))).toBeNull();
  });

  it("shows the logs still loading, with their bytes summed", () => {
    const loading = overall(new Map([report("a", 1_000_000, 6_000_000), report("b", 2_000_000, 3_000_000), report("done", 5_000_000, 5_000_000)]));
    expect(loading).toEqual({ loaded: 3_000_000, total: 9_000_000, runs: ["a", "b"] });
  });

  it("writes megabytes with one decimal", () => {
    expect(megabytes(6_432_100)).toBe("6.4");
    expect(megabytes(0)).toBe("0.0");
  });
});
