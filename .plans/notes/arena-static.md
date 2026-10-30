# W8 static: the static showcase (notes)

Branch `Yoelcanarion/w8-static-showcase`. Brief: `.plans/arena/w8-static.md`. Arena spec §M.11.

## STOPPED by Yoel (Oct 30, 12:00 CET): where this stands, and the next step

- **Done and committed** (the branch tip, `git log -1`): the fetch shim, manifest reader, banner, installer, the `VerifyBadge` static branch, `scripts/build_static_site.py` (output-folder guard, a raising read route kept as the live 500 with a build note, pairs that share a run, data URLs versioned by build), `tests/unit/test_static_site.py` (74 passed), `web/src/static/*.test.ts` (139 passed), the fixture `web/src/static/fixtures/site`, these notes. Whole web suite (1293), `tests/unit` (1137), tsc and ruff were green at 2caa928. After it: the Python side was re-run (`tests/unit/test_static_site.py` 74 passed, ruff clean at the tip), but vitest was **not** re-run after the two small edits to `Banner.tsx` (`useLayoutEffect`) and `install.tsx` (no-cache manifest, `?v=` on data files); only `tsc` was (clean). `merge_ready` 1 was sent for 2caa928; the coordinator reviewed the diff ("good") and planned to merge the tip after my browser pass.
- **Half done: everything that needs a build or a browser, never run.** A paid block was on and RELEASE never came, so no `vite build`, no `http.server`, no Playwright. `install.tsx`, `Banner.tsx`, `static.css` (the banner above `#root`, the load bar) are type-checked only; nothing was seen in a browser. The integration chunks of the merge check were not run (I changed nothing they run).
- **Next steps, in order, each after RELEASE:**
  1. *Local-build proof.* `git worktree add --detach <scratch>\base 287704a`, junction its `web\node_modules` to this tree's, then in both trees `node web\node_modules\vite\bin\vite.js build --outDir <scratch>\base-out` (and `mine-out`) `--emptyOutDir`; compare the two folders byte for byte. They must be identical (no static code in a local build). Never build into `src/fractalswarm/api/static`.
  2. `uv run python scripts/build_static_site.py --out <scratch>\site --runs demo/backup demo/toy --pair <refs>\t2-swarm-killhalf:<refs>\t2-central-killhalf`, with `<refs>` = `C:\Users\yogar\.fractalswarm\refs\arena-c2b5e08\runs` (later the final pairs bundled under `demo/`, one `--pair` each). The app adds its own size to the 15.2 MB of data.
  3. `python -m http.server 8770 --directory <scratch>\site` (no FractalSwarm server), then run `.plans/notes/arena-static-browser-check.mjs` (its header says how: `playwright-core@1.48.2` in a scratch folder outside the repo). It checks home (no banner), a run at its end (banner, badge, reload), charts, helps, runs, the arena picker and pair, the doors that need the local server, an unknown run and a phone width, and fails on a failed request, a status of 400 or more, another origin or any console message. Fix what it shows (likeliest: the banner's layout above `#root`, the director route), repeat it from a sub-path (site copied into `<tmp>\fractalswarm\`, serve `<tmp>`), time the load of the 8177-event run, then send the second `merge_ready`.
  4. Once `arena` is merged into this branch's base (its `/takeover` now answers 501 for a supervisor log), the build note about the central 500 disappears by itself.
- **To expect when resuming** (coordinator's mail, 10:44 and 10:47): the repo goes public on Nov 3 and the site goes up then, but publishing waits for Yoel's OK. The final runs come as a real pair against central and one against durable-max, bundled under `demo/`: pass each as a `--pair`. W4 is making `/api/bench/results` serve the real hero files and removing the fixture badge, so the `charts` scenario in the check script, which expects the word `Fixture`, must drop that needle, and `public_bench` may see a new `source`. W6 changes `main.tsx` too (lazy shell): a small conflict is expected; keep the `import.meta.env.MODE === "static"` guard around the mount.
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

**Not done yet** (each waits for something named):
- The Vite build, the browser checks with Playwright and the "local build is unchanged" proof: **wait for RELEASE** (builds and browsers). Until then nothing here is shown in a browser.
- The integration chunks of the merge check: **need a slot**. I touched no code they run (only `scripts/`, `tests/unit/test_static_site.py`, `web/`); say GO and I run them in chunks.
- The final pairs (a real pair against central, one against durable-max, bundled under `demo/` by the coordinator): `--pair` takes them by arguments and may be repeated; a run in two pairs is exported once. Tried so far on the $0 refs pair `~/.fractalswarm/refs/arena-c2b5e08/runs/t2-swarm-killhalf:t2-central-killhalf` with `--no-build`: both replays verified at build, 15.2 MB of data with backup and toy (swarm 4.56 MB, central 2.64 MB), 5001 events = two pages, the second holding one event.
- Publishing: prepared below, not done. It needs Yoel's OK.

## What it is

`web/src/static/` holds a fetch shim. In `vite build --mode static` the app starts only after the shim is in place; the shim answers the client's relative `api/...` calls from files under `data/` that `scripts/build_static_site.py` wrote. No component knows about it.

- `main.tsx`: one dynamic import behind `import.meta.env.MODE === "static"`. Vite folds the test away in every other build.
- `vite.config.ts`: the `static` mode only changes the default `outDir` to `dist/static-site` (git ignores `dist/`), so it can never overwrite the build the Python package serves. `base: "./"` was already there: hash routes, a sub-path and a reload work.
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
| `GET api/runs/{id}/events?from_seq=&limit=` | a request for exactly one page (`from_seq` = 1 mod 5000, `limit=5000`) is the page file as it is; any other window is cut from the pages it falls in, with the same `next_seq`, `last_seq` and `done`; paging errors are the API's own 422 words |
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

- **Banner** (every route except home): `Static showcase: recorded runs only. Run it yourself: uv run fractalswarm demo --verify`, and on the right `Replays were checked when this site was built (commit abc1234, DATE), not in your browser.` (tooltip: the whole commit, the command to check one yourself). It is a sibling above `#root`, mounted by the installer in its own React root, so `App.tsx` is untouched. It is not on the home page: hash `""`, `#`, `#/`.
- **Verify badge**: see above.
- **Live controls off**: `GET api/capabilities` answers every key `false` and adds `static: true`. The app's capability parser keeps only the keys it knows, so the new key is for readers outside it.
- **For W6's menu**: the flag is `import.meta.env.MODE === "static"` (the coordinator confirmed). A door that needs the local server (new task, intake, ablation, anything that starts a run) should say so when it is true.
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

- **`GET api/runs/{id}/takeover` answers 500 for a supervisor log (central).** `check_run` raises `SupervisorLog` ("supervisor log: use `fractalswarm recovery`") and `api/app.py` does not catch it, so uvicorn sends 500 and the `TakeoverChip` goes to its error state on a central run. The site stores what the live server says (500) and prints a note at build, so nothing is hidden. A one-line fix in `api/app.py` (not mine) would make the app show nothing instead: answer 501 for `SupervisorLog`; `fetchTakeover` already reads 404, 405, 409 and 501 as "not offered". Say if you want me to do it (the brief lets me touch `api/` only for a helper, so I ask first).
- **The packaged build `src/fractalswarm/api/static` is committed.** Mine does not change it: `vite build` for every mode but `static` folds the guard in `main.tsx` and the badge away (proof after RELEASE: both builds from `287704a` and from this branch into scratch folders, compared byte for byte). I never write to that folder.

## Deviations and decisions

1. `VerifyBadge.tsx` edited, with the coordinator's OK (3 lines; `package.json` untouched).
2. The exporter needs no change under `src/fractalswarm` (not even a helper in `api/`).
3. `bench/results.source` is rewritten (above). `pairs.json` is built by the exporter from the two `run.started` events, because the live `GET api/pairs` reads a private directory the site must not have; the shape is that of `api/arena.py`'s manifest.
4. `data/` is read relative to the document (`document.baseURI`), not with `new URL(..., import.meta.url)`, so it does not depend on Vite's asset scanner.
5. The manifest is fetched with `cache: "no-cache"`, and every data file with `?v=<commit>-<built_at>`: GitHub Pages lets a browser keep a file for ten minutes, and a new manifest over old pages would not describe them.
6. A read route that raises while the site is built is kept as the 500 the live server gives (see the findings) instead of stopping the build; a route that is missing for a run is a 404 saying it is not part of the showcase.

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
