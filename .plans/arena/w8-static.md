# W8 `static`: the static showcase

Arena spec §M.11. A build of the web that needs no server and no API key, for GitHub Pages, so that Yoel can link it in the submission form. It holds the home page and 2 or 3 recorded replays. A juror opens the link and can read the story, then watch a real run and the arena pair replay in the browser.

Read first: `CLAUDE.md`, this brief, `.plans/arena/worker-rules.md`, `.plans/arena-spec.md` §M, `web/src/lib/api.ts`, `web/src/arena/api.ts`, `src/fractalswarm/api/` (what each route returns), `.plans/notes/arena-intake.md` and `.plans/notes/arena-ui-arena.md`.

## What to build

1. **A fetch shim, not a rewrite.** The client calls relative `api/...` URLs from several modules. In a static build a small shim (`web/src/static/`) answers those calls from pre-exported JSON files, so no component changes. It is installed in `main.tsx` only in the static build, through a dynamic import behind `import.meta.env.MODE === "static"`, so the local bundle does not grow. A route it cannot answer returns the same status the local server gives for a feature that is off, so the existing fallbacks work.
2. **The export.** `scripts/build_static_site.py --runs <run or bundle>... --pair <left>:<right>... --out <dir>`:
   - runs the Vite build in the static mode into `<dir>`;
   - writes what the shim serves: the run list, each run's events (one file per page, or one file if the size is reasonable), metrics, takeover, recovery, calls, models, disputes, the pair listing, `bench/results`, `bench/honesty`, capabilities with a `static: true` flag;
   - uses the same Python functions the API routes use, so a static answer equals the live one. Import them; do not reimplement them;
   - runs the real verification (`fractalswarm.replay` or the `verify` route's code) at build time and stores the report with the commit and date.
   Never export anything from `FRACTALSWARM_PRIVATE_DIR` or any run on live input: the same refusal as `fractalswarm bundle`.
3. **Honest labels.**
   - A slim banner in the app shell: `Static showcase: recorded runs only. Run it yourself: uv run fractalswarm demo --verify`. Not on the home page's hero.
   - The verify badge says what is true here: verified when this page was built, at commit X, not in your browser.
   - Live controls, new task and intake are off, through the capabilities the app already reads. W6's menu reads a flag to mark those doors `needs the local server`. Tell the coordinator the flag's name.
4. **No dead ends.** Every link in the static build lands on something that works or says why it does not. The hash routes work on GitHub Pages, including under a sub-path (`base: "./"`), and a reload on any route works.
5. **Publishing is not yours.** Prepare, do not publish. Write the exact steps in `.plans/notes/arena-static.md` (a `gh-pages` branch or a Pages workflow: choose the simpler, and say why). Publishing happens on Nov 3 with Yoel's OK, once the repo is public.

## Limits

- The whole site stays under about 40 MB. Report the size per run. If a run's events are too heavy, gzip through what Pages already does (it serves JSON compressed), and keep the page load reasonable: show progress while a large log loads.
- A real log of 14k events must replay smoothly from the static files: load in pages, as the live client does.

## Ownership

You may edit `web/src/static/**`, `web/src/main.tsx` (the one dynamic import), `web/vite.config.ts` (the mode), `scripts/build_static_site.py`, `tests/unit/test_static_site.py`, your notes `.plans/notes/arena-static.md`, and `web/src/components/` only for the banner. For anything else, ask the coordinator. No change under `src/fractalswarm` except, if you must, a helper the export needs in `api/`: ask first. The handler freeze holds. No real calls.

W6 is changing `web/src/App.tsx` to add the home route and split the bundle; do not edit that file. Build on arena after W6's first merge if you need it.

## Acceptance

- `uv run python scripts/build_static_site.py` with `demo/backup` and `demo/toy` for now produces a site. The final bundle and the arena pairs replace them later by changing arguments only.
- Serve it with a plain static server (`python -m http.server`) from an empty folder, with no FractalSwarm server running. Playwright opens the home page, a run at its end with its verify badge, the charts and the helps page, and the arena pair when one exists. No failed request, nothing in the console.
- `npm --prefix web run typecheck`, `test`, `build`: the local build is unchanged in size, and no static code reaches it (check the output).
- `tests/unit/test_static_site.py`: a shim answer equals the API's answer for each route, on `demo/toy`, using the FastAPI test client.

## How to work

Build the shim and the export first with `demo/toy`, then a real run. `merge_ready` at each working step. Slots: browsers, dev servers and builds run only between the coordinator's paid blocks: you get RELEASE when they are allowed and HOLD when they stop. On HOLD keep working on code, `tsc`, and vitest on one worker (`npx vitest run <dir> --maxWorkers=1`). `python -m http.server` is light, but a browser is not.
