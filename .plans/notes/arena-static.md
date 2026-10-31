# W8 static: the static showcase (notes)

Branch `Yoelcanarion/w8-static-showcase`. Brief: `.plans/arena/w8-static.md`. Arena spec §M.11.

## Where this stands (stopped by Yoel at 12:00 CET, resumed at 15:45 after the reboot of 15:31)

**Oct 31, round 3 (HOLD until about 04:00 CET): arena fa5149c merged; the code side is done, the builds wait for RELEASE.**

- Merge: arena fa5149c (the redesign, the final pairs, Watch the first crash) into this branch as e5b7d92. Two conflicts, both import lines (VerifyBadge.tsx, catalogue.ts): I kept both sides, so my static branches sit beside arena's amber "Log intact. This code does not reproduce this recording" branch, and my verifywords test now covers that wording too. tsc clean.
- The app makes no new `api/` request (I read every request line added since a1ca0e4: arena only gave intake's fetcher a parameter). Rival runs no longer ask for a takeover check; a swarm's log still does, and the shim answers it from the stored file as before. The Ablation tab shows only when the run list holds an ablation run, which the site never does, so it stays hidden. `#/evidence` is W6's baked page (no request at all); the banner rule counts it as an app page, so the banner shows on it.
- Exporter: `GET api/pairs` now lists the pairs the repository ships (demo/pairs.json, public, with labels) first. For each `--pair` the site holds, `pairs.json` stores that shipped entry as the API lists it, and refuses one not marked public; a pair that is not shipped is described from its two logs, as before. A note says when the site does not hold the app's FINAL_RUN (demo-final). A probe of the six bundles (final, the four pair bundles, backup, toy) against the exporter's source and privacy refusals, first events only and no replay: all taken. `headline-10` is now a fourth recorded set in `GET api/bench/results`; `public_bench` leaves its path alone.
- The command for the final site: `uv run python scripts/build_static_site.py --runs demo/final --pair demo/pair-durable-max-swarm:demo/pair-durable-max-rival --pair demo/pair-central-swarm:demo/pair-central-rival`. A data-only export of exactly that (`--no-build`, slot from the coordinator, 31 s, scratch folder): all five bundles pass, each replay verified at build. Weight per run: demo-final 8.10 MB (8,771 events), demo-pair-central-swarm 8.20 (8,966), demo-pair-central-rival 6.01 (2,990), demo-pair-durable-max-swarm 6.95 (7,334), demo-pair-durable-max-rival 3.92 (1,935). Data 33.49 MB plus the app about 2 MB is about 35.5 MB of the 40 MB budget (demo/backup would add 7.9 MB). The stored pairs.json equals demo/pairs.json (same order and labels), bench/results carries four sets (headline-10, v1, headline, rivals-gate) with repo paths, and the only non-200 routes are feasibility 404 on every run and takeover 501 on the two rivals. No final-run note: the site holds demo-final.
- The browser check now expects the home page's four doors (three open: #/arena, #/runs, #/evidence; one closed: #/new), visits #/evidence, and defaults to the run demo-final. Its other needles (arena, new task, run page, the Runs page's verify button) come from before the redesign and are to be read at the first pass.
- web/src/director/sources.json is still all null; the Director is off the home menu, its route stays.

**Oct 30, after W4 (arena a1ca0e4) merged: the pass is partly done; the worker stopped at its usage limit.**

Done, commit 2793e71 on this branch (arena a1ca0e4 merged as 1152597):
- The two approved lines in `verifyWords` (web/src/lib/catalogue.ts): in a static build the Runs page's verify cell says "Replay verified at build" (the badge's words), never that a replay ran in the browser. Test: web/src/static/verifywords.test.ts, both modes.
- `public_bench` in scripts/build_static_site.py now rewrites only an absolute path. W4's `GET api/bench/results` names the recorded sets bench/results/<set>/hero-t2_conference.json, and the old rewrite would have turned those into paths that do not exist. Tests added; the fixture is regenerated (it gains `"sets": []`).
- Local-build proof, base = arena a1ca0e4 without my patch: IDENTICAL (22 files, 2,033,120 bytes, sha-256 of each equal; no static-only words; the packaged bundle untouched).
- Pair site rebuilt (backup, toy, swarm:central, swarm:pipeline): 20.53 MB, app 2.05 MB. Charts draws the three recorded sets (fixture false). Playwright pass at the root and at /fractalswarm/ on port 5178: CLEAN at both. Port 5177 was held by someone else's `node preview.mjs` (pid 18804, started 18:40), so I did not use it and did not touch it. All my servers are stopped.
- Runs page: all 5 verify cells say "Replay verified at build", and the page downloads only the 5 edges.json files (0.24 MB), no event page. No page-level scrollbar at 1366x768 or 1440x900 with the banner on. The built site opened from a file:// URL still shows its explanatory sentence.
- Checks run: vitest src/static + catalogue + runsCatalogue 188 passed (9 files); tsc clean; tests/unit/test_static_site.py 92 passed; ruff clean on the two Python files I touched.

Not done (usage limit): the whole vitest suite after the merge; tests/unit and the integration chunks after W4's change to api/app.py (the last full chunks were at 41798f8: unit 1181, integration 899 plus the strict-mode pair); the final merge_ready and worker_done.

Findings for their owners (nothing changed by me): the Runs page says "Every run this server holds", and the disabled "Start the run" tooltip says "this server does not start runs from here" (W4's wording; the banner above says it is a static showcase). The ablation scene's error card runs my sentence into the page's own "Asking again every 2 seconds." with no full stop (a stop after a command-line flag would break copy and paste, so I left it). demo-toy still shows the red takeover check. web/src/director/sources.json is all null. App pages overflow at 390 px.

**Oct 30, 18:40, the RELEASE pass is done** (RELEASE came at 18:07; port 5177; one browser at a time; everything at BelowNormal; nothing written under `~/.fractalswarm`; scratch in `C:\Users\yogar\w8p`, a short path on purpose: arena's sweep cell files have such long names that `git worktree add` fails against Windows' 260-character limit from the session's scratchpad). The branch tip at the pass was `41798f8`, which is arena `86f2951` (the looping hero, `4c81b41`, and a progress commit) merged in with no conflict, plus my commits. The pass changed no code of the branch, only the browser-check script (below). What is left is W4's part: its two lines in `verifyWords`, the Runs-page scenario and the local-build proof again, after W4 is in arena.

| Step | Result |
|---|---|
| Local-build proof: `npm --prefix web run build -- --outDir <scratch>` at arena `86f2951` and at this tree, compared | **IDENTICAL**: 21 files, 2,006,457 bytes, the same sha-256 for every file; none of the static-only words (`Static showcase`, `staticbar`, `BuildVerified`, `createStaticFetch`, `data/manifest.json`, ...) in either; the packaged bundle in `src/fractalswarm/api/static` equals the base build, and `git status` of it is clean after both builds. |
| Default site: `uv run python scripts/build_static_site.py` (backup + toy into `dist/static-site`) | 9 s, **10.06 MB** (data 8.04, app 2.02) of about 40; both replays verified at build; one `note:` (the director's `sources.json` names no run yet). |
| Pair site: `--runs demo/backup demo/toy --pair swarm:central swarm:pipeline` (refs `t2-*-killhalf`) | 18 s, **20.46 MB** (data 18.44, app 2.02): backup 7.74 MB (8 files), toy 0.04 (3), swarm 4.60 (8), central 2.68 (5), pipeline 3.08 (5). The swarm run, in two pairs, is exported once; all five replays verified at build; the takeover of central and pipeline is stored as 501 with no note; both pairs are in `pairs.json` (`billed` false, `private` false); each `edges.json` is about 45 kB (the first event carries the whole input); the longest path under the site is 83 characters. Charts says `fixture`: there is no `hero_chart.json` yet. |
| Playwright (Chromium 130, headless, 1920 x 1080), `.plans/notes/arena-static-browser-check.mjs`, a plain `python -m http.server` with no FractalSwarm server (8765 not running), at the root and under `/fractalswarm/` | **CLEAN both times** (2 min each). 26 distinct requests, all to the one origin; no failed request, no status of 400 or more, no console message, no page error. Home with no banner and no data file but the manifest; 4 open and 2 closed doors, each open door leading to a page with the banner, and the banner gone again on the way back; each run at its end with its verify badge ("Replay verified at build, commit ..., hash match ...", tooltip "not in your browser") and after a reload; the six views of each run; the Muse lens; charts, helps, runs, the arena picker and pair (and its reload); the director's list and six scenes (the arena scene plays on the real pair); the doors that need the server say so when used; phone width; the load bar on the 8177-event log over 750 kB/s; `index.html` from disk shows the placeholder sentence. |
| The 8177-event run | About 1.7 s to the page with its badge on localhost, cold (6.5 MB in 2 files). Over 750 kB/s the bar was seen from 0 % to 54 % and the badge came after 9.0 s. |
| Merge check | `tests/unit` **1181 passed** (3 deselected, promptguard) in 38 s. Integration: `[a-c]` **317** (6:00), `[d-k]` **169** (1:27), `[l]` **120** (3:34), `[m-r]` **107** (4:36), `[s-z]` **186** (1:18), 899 together. With the unit tests that is 2080 of the 2081 a whole collection gives (2084, 3 deselected); the 2081st is the `[IntakeOutput]` strict-mode test that exists only in a whole-suite collection, covered by `pytest tests/integration/test_intake_flow.py tests/unit/test_planning.py -k strict_mode_rules` (13 passed). `ruff check` and `ruff format --check` clean. Web: `tsc` clean, vitest on one worker 107 files / **1739 passed**; `tests/unit/test_static_site.py` 88 passed. I touched nothing that replays or runs through the kernel, so the refs comparison was not needed. |

What the pass showed (none of it a defect of the build):
- The first browser run reported five problems, all in the script: `innerText` applies `text-transform` ("Muse lens" reads MUSE LENS), the verify badge was looked up as "the first good badge" (on the backup run the takeover chip comes first), and a regex did not allow the line break inside the badge's text. Fixed in the script and repeated: clean.
- `demo-toy` shows a red chip "Takeover check failed: 5 violations" on every page of it. It is the live API's own answer for that bundle (`golden-toy`, a goal-less toy: `msg.sent: KeyError('goal_id')` four times and "the run wrote no task.result"), and the local app shows it too. **I recommend the published site does not carry `demo/toy`** (publish `demo/backup` and the pairs); the script's default stays backup + toy for the tests and the quick build.
- At 390 px the banner wraps well, but the app's own pages (run, helps) overflow sideways (1118 and 799 px): they are desktop-first. The home page is the one built for a phone.
- The director's ablation scene shows "s3-ablation cannot be shown: An ablation needs the local server ..." and then the page's own "Asking again every 2 seconds" (it polls; each answer is the shim's 503).

**Oct 30, 17:55, on HOLD, waiting for the browser slot (after W4's first audit):** W6's home page is in `Yoelcanarion/arena` (7452747) and merged here (b152d92); the only conflict was `main.tsx`: W6's lazy `Root` mounts the app and the `import.meta.env.MODE === "static"` guard stays around the mount. W6's doors already use that flag: `#/new` and `#/ablation` are closed in the static build with "Needs the local server", the other four (`#/arena`, `#/runs`, `#/director`, `#/charts`) lead on. What changed since the 15:50 paragraph below (all code, no build, no browser): the first and last event of every run come from a small `run/<id>/edges.json` (W4's Runs page asks for both of every run it lists, which from the pages would be a 2.7 to 3.7 MB page each); `verifiedAtBuild` in `BuildVerified.tsx` words the Runs page's verify cell (see Findings; waits for W4); the banner follows W6's home rule (`#/home` too); the placeholder tolerates attributes on `#root` (`index.html` now has three editors); `build_static_site.py` prints a `note:` for every run the director's `sources.json` names that the site does not hold; `static.css` keeps the director's list a window tall minus the banner; the browser-check script now covers the home page's doors and the director's scenes. Checked on HOLD: `tests/unit/test_static_site.py` 88 passed, ruff clean, `tsc` clean, the whole web suite on one worker 107 files / 1739 passed in 44 s. Predicted with `git merge-tree` (read-only, at b152d92): W4's `arena-ui-core` (local tip 961c413) merges into this branch with no conflict; W7's branch is already in arena. Nothing under `web/` uses a CSS container query on any branch (Chromium 130 crashes on them).

**Oct 30, 15:50, on HOLD:** `origin/Yoelcanarion/arena` (76ac1f0) is merged into this branch (bfae563, no conflict: arena touched nothing under `web/`, `scripts/` or my tests). `GET api/runs/{id}/takeover` of a supervisor's run now answers 501, so the central 500 below is gone from the live API; the exporter stores the 501 as the API gives it and prints no note for it (`TestATakeoverThatIsNotOffered`; `TestARouteThatRaises` now uses a `RuntimeError`, since a supervisor log no longer raises). Checked on HOLD (no build, no browser): `tests/unit/test_static_site.py` 75 passed, ruff clean, `tsc` clean, the whole web suite on one worker 79 files / 1294 passed in 26 s (the one new case reads a stored 501 through the app's own `fetchTakeover` as "not offered"). Still to do, each at RELEASE: the steps below.

- **Done and committed** (the branch tip, `git log -1`): the fetch shim, manifest reader, banner, installer, the `VerifyBadge` static branch, `scripts/build_static_site.py` (output-folder guard, a raising read route kept as the live 500 with a build note, pairs that share a run, data URLs versioned by build), `tests/unit/test_static_site.py` (74 passed), `web/src/static/*.test.ts` (139 passed), the fixture `web/src/static/fixtures/site`, these notes. Whole web suite (1293), `tests/unit` (1137), tsc and ruff were green at 2caa928. After it: the Python side was re-run (`tests/unit/test_static_site.py` 74 passed, ruff clean at the tip), and vitest was re-run after the two small edits to `Banner.tsx` (`useLayoutEffect`) and `install.tsx` (no-cache manifest, `?v=` on data files) on Oct 30 at 15:50 (79 files, 1294 passed, one worker). `merge_ready` 1 was sent for 2caa928; the coordinator reviewed the diff ("good") and planned to merge the tip after my browser pass.
- **(Done at RELEASE, see the pass above.) Half done: everything that needs a build or a browser, never run.** A paid block was on and RELEASE never came, so no `vite build`, no `http.server`, no Playwright. `install.tsx`, `Banner.tsx`, `static.css` (the banner above `#root`, the load bar) are type-checked only; nothing was seen in a browser. The integration chunks of the merge check were not run (I changed nothing they run).
- **Next steps, in order, each after RELEASE (steps 1 to 3 are done at 18:40, results above):**
  1. *Local-build proof.* `git worktree add --detach <scratch>\base 7452747` (arena's tip with the home page; use the arena tip the branch has merged by then), junction its `web\node_modules` to this tree's, then in both trees `node web\node_modules\vite\bin\vite.js build --outDir <scratch>\base-out` (and `mine-out`) `--emptyOutDir`; compare the two folders byte for byte. They must be identical (no static code in a local build). Never build into `src/fractalswarm/api/static`.
  2. `uv run python scripts/build_static_site.py --out <scratch>\site --runs demo/backup demo/toy --pair <refs>\t2-swarm-killhalf:<refs>\t2-central-killhalf`, with `<refs>` = `C:\Users\yogar\.fractalswarm\refs\arena-c2b5e08\runs` (later the final pairs bundled under `demo/`, one `--pair` each). The app adds its own size to the 15.2 MB of data.
  3. `python -m http.server 8770 --directory <scratch>\site` (no FractalSwarm server), then run `.plans/notes/arena-static-browser-check.mjs` (its header says how: `playwright-core@1.48.2` in a scratch folder outside the repo). It checks home (no banner, only the manifest asked for), the home page's doors (four open, two closed with their note; each open door leads to a page with the banner, and coming back removes it), a run at its end (banner, badge, reload), charts, helps, runs and the Runs page's "Verify all" (once W4 is merged), the director's list and its scenes, the arena picker and pair, the doors that need the local server, an unknown run and a phone width, and fails on a failed request, a status of 400 or more, another origin or any console message. Fix what it shows (likeliest: the banner's layout above `#root`, the director route), repeat it from a sub-path (site copied into `<tmp>\fractalswarm\`, serve `<tmp>`), time the load of the 8177-event run, then send the second `merge_ready`.
  4. Done at bfae563: `arena` is merged (its `/takeover` answers 501 for a supervisor log). At the site build, look for `status: 501` on `t2-central-killhalf` takeover in the manifest and no `note:` line.
- **To expect when resuming** (coordinator's mail, 10:44 and 10:47): the repo goes public on Nov 3 and the site goes up then, but publishing waits for Yoel's OK. The final pairs (a real pair against central and one against durable-max) are **not** bundled under `demo/`: the handoff says the sample text first and Yoel's own text for the final take, and those are intake runs, which the exporter refuses and must keep refusing (coordinator, Oct 30 after 15:31). The coordinator will record the same two pairs on the T2 fixture for the site; each goes in as a `--pair` argument. Until they exist, test with the refs pair `t2-swarm-killhalf:t2-central-killhalf`. W4 is making `/api/bench/results` serve the real hero files and removing the fixture badge, so the `charts` scenario in the check script, which expects the word `Fixture`, must drop that needle, and `public_bench` may see a new `source`. W6 changes `main.tsx` too (lazy shell): a small conflict is expected; keep the `import.meta.env.MODE === "static"` guard around the mount.
- Scratch outside the repo (may be gone): exports `site-default/` and `site-pair/`, and `pw/` with `playwright-core@1.48.2`, in the session's scratchpad. Nothing from it is committed; screenshots from the check go to the folder you name, keep it outside the repo.

## State

**Merge point 1 (shim and export work on `demo/toy`): reached.** Checked without a build or a browser (a paid block was running):

| What | Result |
|---|---|
| `uv run pytest tests/unit/test_static_site.py` | 63 passed at 2caa928; 74 passed, 5 s at the tip |
| `uv run pytest tests/unit` (merge check, unit chunk) | 1137 passed, 3 deselected (promptguard), 79 s |
| `npx vitest run --maxWorkers=1` (whole web suite) | 79 files, 1293 passed (139 of them in `web/src/static`) |
| `npm --prefix web run typecheck`, `ruff check`, `ruff format --check` | clean |
| `scripts/build_static_site.py --no-build` on `demo/backup demo/toy` | 9.9 s, 7.99 MB of data, both replays verified at build, secrets/paths scan clean |

**Not done yet at merge point 1** (the RELEASE pass above did all of it except what waits for W4):
- The Vite build, the browser checks with Playwright and the "local build is unchanged" proof: **wait for RELEASE** (builds and browsers). Until then nothing here is shown in a browser.
- The integration chunks of the merge check: **need a slot**. I touched no code they run (only `scripts/`, `tests/unit/test_static_site.py`, `web/`); say GO and I run them in chunks.
- The final pairs (a real pair against central, one against durable-max, bundled under `demo/` by the coordinator): `--pair` takes them by arguments and may be repeated; a run in two pairs is exported once. Tried so far on the $0 refs pair `~/.fractalswarm/refs/arena-c2b5e08/runs/t2-swarm-killhalf:t2-central-killhalf` with `--no-build`: both replays verified at build, 15.2 MB of data with backup and toy (swarm 4.56 MB, central 2.64 MB), 5001 events = two pages, the second holding one event.
- Publishing: prepared below, not done. It needs Yoel's OK.

## What it is

`web/src/static/` holds a fetch shim. In `vite build --mode static` the app starts only after the shim is in place; the shim answers the client's relative `api/...` calls from files under `data/` that `scripts/build_static_site.py` wrote. No component knows about it.

- `main.tsx`: one dynamic import behind `import.meta.env.MODE === "static"`. Vite folds the test away in every other build.
- `vite.config.ts`: the `static` mode changes the default `outDir` to `dist/static-site` (git ignores `dist/`), so it can never overwrite the build the Python package serves, and adds one plugin, `static-placeholder`: a sentence inside `index.html`'s `#root` ("Loading the static showcase. If this stays empty, the page cannot run from a file: serve this folder (python -m http.server) ..."). The app replaces it when it mounts; where the script cannot run (index.html opened from disk: a module script does not load over `file:`) it is what the visitor reads instead of a blank page. `base: "./"` was already there: hash routes, a sub-path and a reload work. Every other mode builds exactly as before (the proof is in the steps below).
- `web/src/components/VerifyBadge.tsx`: 3 lines, with the coordinator's OK. In the static build the badge reads `Replay verified at build, commit abc1234 ✓ hash match <head12>`, and its tooltip says "Checked when this page was built, at commit X on DATE, not in your browser" and gives `uv run fractalswarm demo --verify`. The static component is `web/src/static/BuildVerified.tsx`.

### The exporter

```
uv run python scripts/build_static_site.py                                   # demo/backup + demo/toy -> dist/static-site
uv run python scripts/build_static_site.py --runs demo/backup demo/toy --pair <swarm run>:<rival run> --out <dir>
  --no-build        write only data/ (no Vite)          --web-dist DIR   copy a built app instead of running Vite
  --require-clean   refuse a tree with uncommitted changes (use it to publish)
  --bench-dir DIR   where hero_chart.json and honesty.json are read (default bench/results)
```

A run is a directory with `events.jsonl` (a run id under `~/.fractalswarm/runs`, a bundle name under `demo/`, or any path). A drive letter in `--pair` (`C:\a:C:\b`) is not taken for the colon.

It is not a second implementation of the API. The files it reads are copied into a scratch catalog, the real `create_app` is built over it and every route is called through Starlette's test client; a file holds what the live server answers. `tests/unit/test_static_site.py` asks the live API the same questions and compares: every read route, every event page byte for byte, every call in full, the replay report, the run list, the bench routes.

What it writes under `data/`:

| File | Holds |
|---|---|
| `manifest.json` | the format number, the build stamp (`commit`, `commit_short`, `dirty`, `built_at`, `page_size`), and one entry per route: `{status, body}` when the answer is 4 KB or less (or not a 200), else `{status, file, bytes}` |
| `run/<id>/events-0001.json` ... | the log in pages of 5000: exactly the API's answer for `from_seq=1`, `5001`, ... with `limit=5000`, which is the request the client makes, so a page is sent as it is |
| `run/<id>/edges.json` | the API's answers for the first and the last event alone (`from_seq=1&limit=1`, `from_seq=<last>&limit=1`), keyed by seq. W4's Runs page asks for both of every run it lists (`fetchEventAt`, 4 at a time): from the pages that would be a whole page each (2.7 to 3.7 MB for the 8177-event run), from this file it is about 45 kB per run (the first event holds the whole input). The manifest's `events.edges` names the file and the seqs it holds |
| `run/<id>/call-details.json` | every `calls/{effectId}` of the run in one file, keyed by effect id (read when the lens opens a call) |
| `run/<id>/<route>.json` | a large answer (summary, calls, takeover, metrics ...) |
| `bench-honesty.json`, `bench-results.json`, `runs.json`, `pairs.json`, `capabilities.json` | the global routes, when large |

Run ids are those of the catalog: a bundle `demo/backup` is `demo-backup`.

**Replay check.** `POST .../verify` runs at build time, over the staged log. A run that fails it, has a broken hash chain or is a live-input run stops the build. The report is stored with `static: {where: "build", commit, commit_short, dirty, built_at}`. `dirty` is true when the tree had uncommitted changes (untracked files do not count).

**Nothing private goes in.** The same refusal as `fractalswarm bundle` (an intake run, `input.source` of `intake` or `inline`, a source inside `FRACTALSWARM_PRIVATE_DIR`), plus a run whose spec points at an intake or inline text. Only `events.jsonl`, `cassette.jsonl` and `HEAD` are copied out of a run. At the end the whole site is scanned (text files, JSON-escaped backslashes too) for the secret values, the home directory, the private directory and this repo's path; a hit fails the build. The one deliberate difference from the live API: `bench/results` names the file it read by its absolute path on this machine, so `source` is rewritten to `bench/results/<name>` (the packaged fixture keeps `source: "fixture"`).

### The shim: what each route answers

| Call | Answer |
|---|---|
| `GET api/runs`, `capabilities`, `pairs`, `bench/results`, `bench/honesty` | from the manifest |
| `GET api/runs/{id}`, `feasibility`, `takeover`, `recovery`, `metrics`, `models`, `disputes` | from the manifest, with the status the API gave (404 and 409 stay as they were: the app already treats them as "not offered") |
| `GET api/runs/{id}/events?from_seq=&limit=` | a request for exactly one page (`from_seq` = 1 mod 5000, `limit=5000`) is the page file as it is; a `limit=1` request for the first or the last event is the small `edges.json` (falling back to the pages if that file does not hold it); any other window is cut from the pages it falls in, with the same `next_seq`, `last_seq` and `done`; paging errors are the API's own 422 words |
| `GET api/runs/{id}/calls` | the list; `role`, `status`, `actor`, `model`, `purpose` filter it like `lens.py` (exact match, last value wins) and `count` follows |
| `GET api/runs/{id}/calls/{effectId}` | from `call-details.json`; `404 {"error": "no LLM call 'x' in run 'y'"}` otherwise |
| `POST api/runs/{id}/verify` | the report the build made |
| `POST api/runs/{id}/chaos`, `approve`, `budget`, `halt`, `escalations/{eid}` | 409 `run 'x' is a recording, not a live run (...)`, as the local server answers for any run that is not live |
| `api/tasks`, `arena`, `intake/*`, `jobs`, `ablation*` (any method) | 503 `... needs the local server: this is the static showcase: recorded runs only. Run it yourself: uv run fractalswarm demo --verify` |
| a run id the site does not hold | 404 naming the runs it holds and the command |
| a wrong verb | 405 `Method Not Allowed`; anything else under `api/` is 404 |
| any other URL (fonts, assets) | the browser's own `fetch` |
| the `WebSocket` of `tailEvents` | closes at once (a recording is never live, so the app never asks) |
| a data file that does not load | 502 saying which file, so a half-published site reads as that |

All errors are `{"error": reason}`, the shape of `http_error` in `api/app.py`. A page that opens `index.html` from disk (no web server) shows why in the page instead of a blank screen.

A large log loads without freezing the page: the client already loads in pages of 5000, each is one file, and the shim reads it as a stream and reports bytes to a thin bar in the banner (shown from 0.5 MB). `demo-backup` is 8177 events in two files (3.7 MB and 2.7 MB before gzip).

## Honest labels

- **Banner** (every route except home): `Static showcase: recorded runs only. Run it yourself: uv run fractalswarm demo --verify`, and on the right `Replays were checked when this site was built (commit abc1234, DATE), not in your browser.` (tooltip: the whole commit, the command to check one yourself). It is a sibling above `#root`, mounted by the installer in its own React root, so `App.tsx` is untouched. It is not on the home page, which is where W6's `isHomeHash` says: `""`, `#`, `#/`, `#/home`, with a query or a trailing slash (`Banner.tsx` has its own copy of the rule, so that the static folder does not import the home code; `banner.test.ts` pins the cases, `#/run/home` and `#/homework` included).
- **Verify badge**: see above.
- **Live controls off**: `GET api/capabilities` answers every key `false` and adds `static: true`. The app's capability parser keeps only the keys it knows, so the new key is for readers outside it.
- **W6's menu** (`home/doors.ts`) uses the same flag, `import.meta.env.MODE === "static"`: the live-run door (`#/new`) and the ablation door (`#/ablation`) are closed there with "Needs the local server", the shim's server-only list (`tasks`, `arena`, `intake`, `jobs`, `ablation`) matches them, and the home page asks for no data file.
- **Charts**: with no `bench/results/hero_chart.json` the API answers its packaged fixture and the page shows its "Fixture data, not measured" badge. The static site carries whatever the API gives; build it after the hero file exists.
- A pair's `billed` is always `false` and `created_at` null: a log cannot say what was billed, and the exporter does not invent it.

## Sizes (`--no-build`, backup + toy)

| Run | Events | Files | Data |
|---|---:|---:|---:|
| `demo-backup` | 8177 | 7 | 7.70 MB (events 6.46, call details 1.13, calls 0.05, summary 0.04, takeover 0.01, metrics 0.006) |
| `demo-toy` | 56 | 2 | 0.04 MB |
| global | | | 0.26 MB (`bench-honesty.json` 0.23 MB, manifest 0.03 MB) |
| **data** | | | **7.99 MB**; the app adds its own size (to measure with the build) against the 40 MB budget; Pages serves gzip |

The script prints this table and `OVER BUDGET` above 40 MB.

## Tests

- `tests/unit/test_static_site.py`: the exporter against the live API (see above), the pages tiling a log, every refusal (intake, live input, spec pointing at pasted text, private directory, tampered log, duplicate names, unsafe names), the scan, `--pair` parsing, the bench `source`, the command (`main`) and the committed fixture being current. `UPDATE_STATIC_FIXTURE=1 uv run pytest tests/unit/test_static_site.py` writes the fixture again after the exporter changes.
- `web/src/static/*.test.ts`: paging against a reference over every window of logs of 0 to 10 events; the manifest reader; every route of the shim, both ways, with sub-path hosting, aborts, missing files, progress; the socket stub; the banner's and badge's words; and `client.test.ts`, which runs the app's own client functions (`listRuns`, `loadAllEvents`, `verifyRun`, `fetchPairs`, `fetchCalls` ...) through the shim over `web/src/static/fixtures/site`, a real export of `demo/toy` and `tests/golden/one-call` with a fixed stamp.

## Findings for the coordinator

- **Resolved at 76ac1f0 (merged here as bfae563): `GET api/runs/{id}/takeover` answered 500 for a supervisor log (central).** `check_run` raises `SupervisorLog` ("supervisor log: use `fractalswarm recovery`") and `api/app.py` does not catch it, so uvicorn sends 500 and the `TakeoverChip` goes to its error state on a central run. The site stores what the live server says (500) and prints a note at build, so nothing is hidden. The coordinator fixed it in `api/app.py` (`e688aad`: answer 501 for `SupervisorLog`; `fetchTakeover` already reads 404, 405, 409 and 501 as "not offered"), so the site now stores the 501 and the chip shows nothing, as on the local server.
- **The packaged build `src/fractalswarm/api/static` is committed.** Mine does not change it: `vite build` for every mode but `static` folds the guard in `main.tsx` and the badge away (proof after RELEASE: both builds from 7452747 and from this branch into scratch folders, compared byte for byte). I never write to that folder. Arena rebuilt it with the home page (`ac6f772`); the merge here took that as it is.
- **W4's Runs page words its verify cell in `lib/catalogue.ts` `verifyWords`:** "Replay verified" with "N events re-run from run.started". In the static site the report is the one the build made, so that cell would say a replay ran in the browser, which the brief forbids. `static/BuildVerified.tsx` `verifiedAtBuild(report)` gives the badge's truth in the same shape (`label: "Replay verified at build"`, `detail`: where and when it was checked, "not in your browser", the head, the command). The fix is two lines in the good branch of `verifyWords`: `import { verifiedAtBuild } from "../static/BuildVerified"` and `if (import.meta.env.MODE === "static") return { ...verifiedAtBuild(report), tone: "good" };` before the existing return. The coordinator's answer (Oct 30, 16:41): I apply it right after W4 merges into arena, then prove the local build unchanged again.
- **The director's scenes need runs the site holds.** The home page's "Director" door opens `#/director`, a list of scenes that play on the runs named in `web/src/director/sources.json` (all `null` today; W5 fills it with the final pair in one commit). The site must hold those runs (`--pair swarm:rival`, the same ids), or a scene says it needs them. `build_static_site.py` now prints a `note: director: ...` for each run `sources.json` names that the site does not hold, and when it names none (`director_notes`; tests `TestTheRunsTheDirectorPlays`). The ablation scene (`s3-ablation`, `?ablation=<id>`) reads `GET api/ablation/<id>`, which needs the server, so on the site it can only say so. Open for the coordinator and W5: whether the scene list should say which scenes work on the static site.

## Deviations and decisions

1. `VerifyBadge.tsx` edited, with the coordinator's OK (3 lines; `package.json` untouched).
2. The exporter needs no change under `src/fractalswarm` (not even a helper in `api/`).
3. `bench/results.source` is rewritten (above). `pairs.json` is built by the exporter from the two `run.started` events, because the live `GET api/pairs` reads a private directory the site must not have; the shape is that of `api/arena.py`'s manifest.
4. `data/` is read relative to the document (`document.baseURI`), not with `new URL(..., import.meta.url)`, so it does not depend on Vite's asset scanner.
5. The manifest is fetched with `cache: "no-cache"`, and every data file with `?v=<commit>-<built_at>`: GitHub Pages lets a browser keep a file for ten minutes, and a new manifest over old pages would not describe them.
6. A read route that raises while the site is built is kept as the 500 the live server gives (with a note in the build report) instead of stopping the build; since e688aad no route of a real run does; a route that is missing for a run is a 404 saying it is not part of the showcase.

## Open questions

- **Pages from a private repo.** GitHub serves Pages from a private repository only on a paid plan. If the repo stays private until the submission, the site cannot go up before it goes public. Yoel's call.
- **Which runs and which pair to publish.** Default is backup and toy. For the arena I need the pair's two run ids (and for anything else, `demo/final` or similar).
- **Build the hero chart first.** Until `bench/results/hero_chart.json` exists the Charts page shows its fixture badge.

## Publishing (prepared; do it only with Yoel's OK)

**Choice: a `gh-pages` branch, not a Pages workflow.** The build needs this machine's recorded runs (the refs pair lives outside git) and replays them locally, and the stamp then says which commit it was checked at. A workflow would need those runs committed as bundles, a toolchain setup in CI (uv, Python 3.12, Node 24) and Actions enabled, none of which can be tried before the repo is public. A branch needs nothing but a push, and rolling back is pushing the previous commit.

```powershell
# 0. Yoel says go. The repo is public, or the plan serves Pages from a private repo (see above).
# 1. Build from a clean tree at the commit to publish (the badge and the banner print it).
git status --porcelain --untracked-files=no          # must print nothing
uv run python scripts/build_static_site.py --require-clean --runs demo/backup demo/toy --pair <swarm run>:<rival run> --out dist/static-site
#    every run must say "verified at build"; the script fails on a secret or a local path in the site.
# 2. Look at it with no FractalSwarm server running.
python -m http.server 8765 --directory dist/static-site     # http://127.0.0.1:8765/ : home, a run at its end, charts, helps, arena
# 3. Publish: the site is the whole of an orphan gh-pages branch.
$site = (Resolve-Path dist/static-site).Path
git worktree add --detach dist/pages-worktree
Set-Location dist/pages-worktree
git checkout --orphan gh-pages
git rm -rf . --quiet
Copy-Item -Recurse -Force "$site\*" .
Get-ChildItem -Force .nojekyll                            # must exist, or Pages skips files that start with _ or .
git add -A
git commit -m "Static showcase built from <commit>`n`nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push --force origin gh-pages                          # this is the publishing step
Set-Location ../..
git worktree remove --force dist/pages-worktree
# 4. GitHub > Settings > Pages > Build and deployment: Deploy from a branch, gh-pages, /(root).
#    The site is at https://<owner>.github.io/<repo>/ . Pages takes a minute or two.
# 5. Open the live URL and repeat the checks of step 2 (no failed request in the network tab, nothing in the console).
```

The links in the app are hash routes and every asset and data URL is relative, so the sub-path needs no setting. A custom domain needs nothing from the site either.
