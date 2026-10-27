# Stream: day-06-bench-foundations

Branch `Yoelcanarion/day-06-bench-foundations`, base `b6abd07`. **The first phase is finished**: commit
`dda1316` (135 tests green, ruff clean, $0). Its own notes are in
`.plans/notes/day-06-bench-foundations.md`. This file was added when the stream moved into its own Orca
workspace on 2026-10-27, so a new chat can pick up the rest of Day 6.

You are already in this stream's Orca workspace: do not create another worktree or branch.
Run `uv sync` first.

## Parallel streams (do not edit their files)
- `day-04-slice` (in progress): T2 task (`bench/tasks/t2_conference/`), planning/, actors/, memory/, coord/hrw.py, coord/leases.py, verify/checks.py, verify/judge.py.
- `day-05-coord-foundations` (in progress): comms/ (incl. `comms/chaos.py` with C0–C3), coord/membership.py, llm/transport.py, llm/calibrate.py.
- `day-07-ui` (in progress): api/, web/, demo/. It reads the hero-chart JSON that `bench/charts.py` writes.
- `day-08-safety-economy` (finished): safety/, tools/, verify/audit.py, market economy.

The lead merges the streams in this order: 4 → 5 → 6/8 → 7.

## Original brief (verbatim)

You are building FractalSwarm (a multi-agent LLM runtime for a hackathon). You work alone in your own git worktree, in parallel with other agents who own other modules. Repo base commit: b6abd07 (Day 3 kernel done).

FIRST: `git switch -c Yoelcanarion/day-06-bench-foundations`, then `uv sync`. Read `CLAUDE.md` (binding rules), `.plans/days/day-06.md`, spec `.plans/fractalswarm-spec.md` §15 (all; especially §15.2 fairness and §15.5 hero chart), §19, §20, §22, and the last entries of `.plans/progress.md`. Study `src/fractalswarm/kernel/{events,store,scheduler,replay}.py`, `llm/{client,fake}.py`, `market/prices.py`, `runs.py`, `actors/toy.py`.

YOUR JOB: the Day 6 pieces that do NOT need the Day 4 slice or the Day 5 takeover (other agents are building those now):
1. `bench/scoring.py`: all metrics computed purely from a recorded event log (events.jsonl / EventStore): stall time (intervals of virtual time with no agent LLM work in flight anywhere — define precisely from effect.started/effect.completed/effect.cancelled of kind llm), extra cost vs a C0 reference run, time lost vs C0, completion, validity (pluggable checker callback), coordination tokens (LLM tokens spent by coordinator roles on coordination — define from role tags), message counts, breaker trips (count events of a type to be named `breaker.tripped`; tolerate absence). Test on the golden toy log in tests/golden/toy and on synthetic logs built with EventStore.
2. `bench/charts.py`: the hero chart (PNG + JSON) per §15.5: two panels (stall time, extra cost vs coordinators killed 0/1/3/5), secondary row completion + validity, coordination-tokens panel, one line per workflow. Inputs: a results CSV/JSON produced by the harness. Use matplotlib (add it as a dependency in an optional `bench` extra or main deps — pick what fits pyproject). Readable, colorblind-safe, labeled, honest axes.
3. `bench/harness.py` + `fractalswarm bench MATRIX [--dry-run] [--fake]` CLI: matrix YAML (workflows × tasks × C-profiles × seeds), resumable (skip finished cells by result file), cost pre-flight with --dry-run using market/prices.py worst-case estimates, contributor opt-in flag in the matrix config, results CSV. Workflows and tasks are resolved through a registry, so the swarm/central/etc. runners can be plugged in later; for now register the `toy` scenario as a stand-in workflow so the harness runs end to end in --fake mode. Add `bench/matrix.yaml` (the real v1 matrix from day-06.md, referencing workflow/task names that will exist later) and a small `bench/matrix-smoke.yaml` that runs today with toy.
4. T1: `bench/tasks/t1_extraction/` generator (seeded) and deterministic scorer, per the spec's T1 description.
5. `bench/REPORT.md` skeleton with the fairness rules stated first (§15.2), and placeholders for numbers.
6. Tests for all of the above (hypothesis where logic is pure).

NOT yours (do not create/edit): baselines/ (need the slice; later), bench/tasks/t2_conference/ (Day 4 agent), coord/, comms/, planning/, actors/, memory/, verify/, api/, web/, safety/, tools/. Keep edits to shared files (cli.py, pyproject.toml, events.py) minimal and additive.

HARD RULES:
- Do NOT make any real Meta Model API call. Fake LLM only.
- Tests must never touch ~/.fractalswarm/ledger.sqlite.
- Do not edit `.plans/progress.md`; write your entry (done, deviations, issues, what remains of Day 6) to `.plans/notes/day-06-bench-foundations.md`.

END: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` green; commit on your branch (end message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Do NOT merge or push. Report: branch, worktree path, commit hash, test counts, done/not done, deviations.

## Done (commit dda1316, verified by the agent: 135 tests, ruff clean)
- `bench/scoring.py`: stall time inside the agent-work window (agent = role `agent`), coordination tokens (roles coordinator/supervisor/router/recovery or a `coord:` tag), extra cost and time lost vs C0, completion and validity via a checker callback, messages, `breaker.tripped` count, `chaos.*` events.
- `bench/{harness,registry,profiles}.py` + `fractalswarm bench MATRIX [--dry-run] [--fake] [--out] [--confirm-real-spend]`: resumable cells, worst-case pre-flight with per-run and per-matrix caps, contributor opt-in, `results.csv/json`; `toy` registered as a stand-in workflow.
- `bench/charts.py`: hero chart PNG + JSON (mean over seeds with min–max whiskers, colorblind-safe, each point keeps its run dir).
- T1: `bench/tasks/t1_extraction/` seeded generator (40 docs, 10 companies, 8 fields, distractors, newer-wins contradictions), field-level F1 scorer, `make_checker`.
- `bench/matrix.yaml` (v1, 32 cells, Contributor on), `bench/matrix-smoke.yaml`, `bench/REPORT.md` skeleton.
- Deviations (see the notes): matplotlib in main deps; stall time only inside the agent-work window; cancelled calls count as $0 extra cost; `breaker.tripped` counted by name, not registered; C-profiles in `bench/profiles.py`.

## Remaining (rest of Day 6; most of it needs the day-04 and day-05 merges)
Work that can be done now, without the slice:
1. Baseline semantics that are independent of the T2 actors: the supervisor restart policy (crash → restart 5 s later, 0 s restart, completed work kept, crash cancels in-flight worker calls) as a pure, tested module in `baselines/` that the runners will use.
2. A T1 runner sketch only if it does not need planning/ or actors/ from day-04.

After day-04 and day-05 are merged into this branch's base (wait for the lead; do not merge them yourself):
3. `baselines/{supervisor,central,single,pipeline}.py` on the shared runtime; register `swarm`, `central`, `single`, `pipeline` and the `t2_conference` task. Routing/re-plan calls use the `supervisor` role or a `coord:` tag.
4. The $0 gate: fake-LLM mini-matrix swarm vs central on T2 at C0–C3, and `test_bench_smoke` (swarm's stall time and extra cost lower than central's at C2 and C3). If the chart is flat, stop and tell Yoel.
5. The paid v1 run is done by the lead or Yoel, never by this stream (no real API calls).

## How to close
- `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` all green.
- Update `.plans/notes/day-06-bench-foundations.md`.
- Commit on `Yoelcanarion/day-06-bench-foundations` (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Do not merge or push. Tell Yoel what is ready, with the commit hash and test counts.
