# Stream: day-04-slice

Branch `Yoelcanarion/day-04-slice`, base `b6abd07` (Day 3 kernel + the real one-call golden).
This stream was started by a background agent of the day-03-kernel session on 2026-10-27 and paused
mid-work to move it into its own Orca workspace. Everything it had written is in the
`wip(day-04-slice)` commit; **nothing has been run or tested yet as a whole**.

You are already in this stream's Orca workspace: do not create another worktree or branch.
Run `uv sync` first.

## Parallel streams (do not edit their files)
- `day-05-coord-foundations`: comms/ (bus, topics, chaos, breakers), coord/membership.py, llm/transport.py, llm/calibrate.py.
- `day-06-bench-foundations` (finished, committed): bench/ scoring, charts, harness, T1, profiles, REPORT.md.
- `day-07-ui`: api/, web/, demo/.
- `day-08-safety-economy` (finished, committed): safety/, tools/, verify/audit.py, market/{allocation,ladder,spend_breaker}.py.

The lead (day-03-kernel session or Yoel) merges the streams in this order: 4 → 5 → 6/8 → 7.

## Original brief (verbatim)

You are building FractalSwarm (a multi-agent LLM runtime for a hackathon). You work alone in your own git worktree, in parallel with other agents who own other modules. Repo base commit: b6abd07 (Day 3 kernel done).

FIRST: ~~`git switch -c Yoelcanarion/day-04-slice`~~ (already on it), then `uv sync`. Read `CLAUDE.md` (binding rules: determinism, security, English only, code style), then `.plans/days/day-04.md` (your task list), the spec sections it lists in `.plans/fractalswarm-spec.md`, `docs/api-notes.md`, and the last entries of `.plans/progress.md`. Study the existing kernel before designing: `src/fractalswarm/kernel/{scheduler,events,effects,replay,store,ids}.py`, `llm/{client,fake,cassette,roles}.py`, `market/{ledger,prices}.py`, `actors/toy.py` (the reference pattern for actors: pure handlers returning (state, commands)), `runs.py`, `cli.py`, and `tests/integration/test_replay_verify.py`.

Live API evidence from today's spike (read it, it matters for structured output, tools and effort levels): C:\Users\yogar\orca\workspaces\work-orquestrator\day-03-kernel\runs\spike\spike-20261027T214932Z-live.md (and the .json next to it). The findings are also summarised in the **Live** lines of `docs/api-notes.md` on the day-03-kernel branch (commit 8ff042d). Key facts: Responses API works with structured output (strict json_schema needs additionalProperties:false), function tools work (2 parallel calls per turn seen), tool_choice only "auto", effort levels minimal..max all valid ("none" invalid), web_search only on Responses, prompt caching saves ~84% on a repeated prefix with one prompt_cache_key.

YOUR JOB: Day 4 tasks 1–11 (T2 generator + checker, planning models + planner, orchestrator/agent/integrator actors, blackboard + FTS5 memory, leases/CAS, verify checks + judge, bounded-load HRW in coord/hrw.py, the `fractalswarm run` CLI, and a fake-LLM end-to-end test of the whole depth-2 slice). The fake LLM must be scripted so the e2e run produces a valid schedule with 0 hard violations deterministically, and the run must pass `replay --verify` (add an integration test that records the fake slice and replays it to MATCH). Make the fake script realistic enough (it parses the request and answers the JSON the role expects) that it will later be swapped for the real model without code changes.

HARD RULES:
- Do NOT make any real Meta Model API call. Never use `--backend real`, never construct OpenAIBackend against the network. Fake LLM only. Task 12 (real run) is done later by the lead, so leave a ready command for it and document it.
- Tests must never touch the shared project ledger at ~/.fractalswarm/ledger.sqlite (use tmp paths / env override FRACTALSWARM_LEDGER_PATH).
- Other agents are concurrently building: comms/ (bus, chaos, breakers), coord/membership.py, llm/transport.py, llm/calibrate.py (Day 5 foundations); bench/ scoring/charts/T1 (Day 6); api/ + web/ + demo (Day 7); safety/, tools/, verify/audit.py, market economy (Day 8). Do not create or edit those files. You own: bench/tasks/t2_conference/, planning/, actors/ (except toy.py), memory/, coord/leases.py, coord/hrw.py, verify/checks.py, verify/judge.py, tasks/examples/t2-conference.yaml, tasks/fixtures/. Keep edits to shared files (cli.py, events.py, runs.py, pyproject.toml, config/*.yaml) minimal and additive.
- Do not edit `.plans/progress.md`. Instead write your end-of-day entry (done, deviations, issues, next, exact command for the real T2 run) to `.plans/notes/day-04-slice.md`.
- Determinism lint must stay green; the existing 88 tests must stay green.

END: `uv run pytest` and `uv run ruff check` + `uv run ruff format --check` green, commit on your branch (end commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Do NOT merge or push. Report: branch name, worktree path, commit hash, test counts, what is done/not done, and any deviations from the spec.

## Done so far (from the WIP diff; unverified)
The agent was about to "wire `runs.py` and a params helper, then try a first end-to-end run" when it was paused.
- T2 task (task 1–2): `bench/tasks/t2_conference/{generator,checker,task,fake}.py`, fixture `tasks/fixtures/t2/seed-1/{corpus,truth}.json`, `tasks/examples/t2-conference.yaml`. `fake.py` is the scripted fake-LLM for T2.
- Planning (3–4): `planning/{taskspec,contracts,dag,planner,schemas}.py`.
- Actors (5): `actors/{orchestrator,agent,integrator,board,events,swarm}.py` (`swarm.py` is presumably the scenario that wires the tree).
- Memory (6): `memory/{blackboard,fts}.py`.
- Coordination (7, 9): `coord/{leases,hrw}.py`.
- Verify (8): `verify/{checks,judge}.py`.
- Small edits to `llm/fake.py` and `runs.py` (in progress).

## Remaining
1. Read every WIP file before building on it; it was never run. Fix what does not import or does not fit together.
2. Finish wiring `runs.py` (register the swarm scenario, params from the TaskSpec YAML).
3. Task 10: `fractalswarm run tasks/examples/t2-conference.yaml` (fake backend by default; real behind `--backend real --confirm-real-spend`, never used by you).
4. Task 11: fake-LLM end-to-end test: depth 2, `exact` fan-out [3, 2], 2 agents per leaf → 0 hard violations, and record + `replay --verify` MATCH.
5. Unit tests for generator determinism, checker (each hard constraint), HRW (balance, minimal remap; hypothesis), leases/CAS, blackboard/FTS visibility, planner schemas.
6. Determinism lint must cover the new handler modules and stay green; goldens `tests/golden/*/HEAD` unchanged.
7. Task 12 (real Standard run on T2 seed 1) is NOT for this stream: write the exact command in the notes.

## How to close
- `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` all green.
- Write `.plans/notes/day-04-slice.md` (done, deviations, issues, next, the real-run command, expected cost).
- Commit on `Yoelcanarion/day-04-slice` (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Do not merge or push. Tell Yoel it is ready, with the commit hash and test counts.
