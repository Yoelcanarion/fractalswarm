# Stream: day-05-coord-foundations

Branch `Yoelcanarion/day-05-coord-foundations`, base `b6abd07` (Day 3 kernel + the real one-call golden).
This stream was started by a background agent of the day-03-kernel session on 2026-10-27 and paused
mid-work to move it into its own Orca workspace. Everything it had written is in the
`wip(day-05-coord-foundations)` commit; **no tests for the new modules exist yet and nothing has been run as a whole**.

You are already in this stream's Orca workspace: do not create another worktree or branch.
Run `uv sync` first.

## Parallel streams (do not edit their files)
- `day-04-slice`: T2 task, planning/, actors/ (orchestrator, agent, integrator, swarm…), memory/, coord/hrw.py, coord/leases.py, verify/checks.py, verify/judge.py.
- `day-06-bench-foundations` (finished, committed): bench/ scoring, charts, harness, T1, `bench/profiles.py` (its own C-profiles: coordinate with your chaos C0–C3 later; one should import the other).
- `day-07-ui`: api/, web/, demo/.
- `day-08-safety-economy` (finished, committed): safety/, tools/, verify/audit.py, market/{allocation,ladder,spend_breaker}.py, plus additive kernel changes for `run.halted` and budget shock (expect a merge conflict in `kernel/scheduler.py` and `cli.py`; keep both).

The lead merges the streams in this order: 4 → 5 → 6/8 → 7. Takeover pieces that need the slice (coord/tree.py, ladder, collisions, test_kill_half) come after the merge.

## Original brief (verbatim)

You are building FractalSwarm (a multi-agent LLM runtime for a hackathon). You work alone in your own git worktree, in parallel with other agents who own other modules. Repo base commit: b6abd07 (Day 3 kernel done).

FIRST: ~~`git switch -c Yoelcanarion/day-05-coord-foundations`~~ (already on it), then `uv sync`. Read `CLAUDE.md` (binding rules: determinism, security, English only, code style), `.plans/days/day-05.md`, spec `.plans/fractalswarm-spec.md` §5 (all), §6.2, §8, §15.2, §15.4, §19, `docs/api-notes.md`, last entries of `.plans/progress.md`. Study the kernel first: `src/fractalswarm/kernel/{scheduler,events,effects,replay,store,ids,clock}.py`, `llm/{client,fake,cassette}.py`, `actors/toy.py` (actor pattern: pure handlers returning (state, commands)), `tests/integration/test_replay_verify.py`.

YOUR JOB: the parts of Day 5 that do NOT depend on the Day 4 planning/actor slice (another agent is building that right now). Specifically:
1. `comms/bus.py` + `comms/topics.py`: pub/sub and request/reply on top of the kernel's Send/msg.sent, priority lanes, at-least-once delivery with acks on the critical lane, dedup, Lamport causal buffer. Deterministic and replayable.
2. `coord/membership.py`: 1 s heartbeats, member.suspected after 3 missed, member.dead after 5 missed (first in log wins), member_epoch; fencing-token helpers (emit `write.fenced`) and zombie re-join with new incarnation. Expose it as reusable actor logic / helper functions that orchestrators can embed later.
3. `comms/chaos.py`: seeded chaos schedules at logical progress points (C0–C3, spec §15.4): coordinator kills (targeting rule as a pluggable function: "most remaining owned work"), agent kills, bus faults (drop, delay, duplicate, reorder, partition). Chaos must enter as effect completions / kernel events so runs replay.
4. `llm/transport.py`: a custom httpx (the project uses `httpx2`, see llm/client.py OpenAIBackend transport param) fault-injecting transport for API faults (429 with Retry-After, 503, timeouts, slow), seeded; plus an equivalent fault wrapper for the FakeBackend so fake runs see the same faults.
5. `comms/breakers.py`: the model circuit breaker with backoff honoring Retry-After.
6. `llm/calibrate.py`: fit the fake LLM latency and token distributions (the LatencyModel hook in llm/fake.py) from cassettes. Real evidence available now: `tests/golden/one-call/cassette.jsonl` and the live spike at C:\Users\yogar\orca\workspaces\work-orquestrator\day-03-kernel\runs\spike\spike-20261027T214932Z-live.json (copy what you need into a small committed fixture; it is already redacted). Day 4/5 cassettes will be added later, so the fit must be re-runnable.
7. Tests: property tests (hypothesis) for the bus (dedup, causal order, at-least-once), membership timing, chaos schedule determinism, breaker behavior, transport faults; plus an integration test where a small toy-style scenario runs with bus faults and a killed actor under chaos and still `replay --verify`s to MATCH. A test that a zombie write is fenced (`test_zombie_fenced`).

NOT yours (owned by others; do not create/edit): coord/hrw.py, coord/leases.py, coord/tree.py, coord/ladder.py, coord/collisions.py (need the Day 4 slice; will be done after merge), planning/, actors/ (except you may add a new test scenario module under actors/ like actors/chaos_toy.py), memory/, verify/, bench/, api/, web/, safety/, tools/, market/. Keep edits to shared files (kernel/*, cli.py, events.py, runs.py, pyproject.toml) minimal and additive; if the kernel needs a new primitive, add it carefully and keep all existing tests and the golden hashes (tests/golden/*/HEAD) unchanged.

HARD RULES:
- Do NOT make any real Meta Model API call. Fake LLM and MockTransport only.
- Tests must never touch ~/.fractalswarm/ledger.sqlite.
- Do not edit `.plans/progress.md`; write your entry (done, deviations, issues, what remains of Day 5 after the slice merges) to `.plans/notes/day-05-coord-foundations.md`.

END: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` green; commit on your branch (end message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Do NOT merge or push. Report: branch, worktree path, commit hash, test counts, done/not done, deviations.

## Done so far (from the WIP diff; unverified)
The agent was about to write "the chaos test-bed scenario under `actors/`" when it was paused.
- New modules: `comms/{bus,topics,chaos,breakers}.py`, `coord/membership.py`, `llm/{transport,calibrate}.py`.
- Calibration: `config/fake_calibration.json` and fixture `tests/fixtures/calibration/spike-20261027-live.jsonl` (redacted spike data).
- Edits to shared files (~108 lines): `kernel/scheduler.py`, `llm/client.py`, `llm/fake.py`, `runs.py`, `cli.py`. Review these for "minimal and additive" and for unchanged golden hashes.

## Remaining
1. Read every WIP file; it was never run. Make it import and fit together.
2. Item 3 test-bed: `actors/chaos_toy.py` (a small toy-style scenario with a bus, heartbeats and a killable actor).
3. Item 7: all the tests (hypothesis for bus/membership/chaos/breaker/transport, `test_zombie_fenced`, the chaos integration test that replays to MATCH).
4. Check `tests/golden/toy/HEAD` and `tests/golden/one-call/HEAD` still replay to the same hash (`uv run fractalswarm replay tests/golden/toy --verify`). If calibration changes the fake's default latency, the golden toy hash must NOT change: keep the old default for existing scenarios or make calibration opt-in.

## How to close
- `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` all green.
- Write `.plans/notes/day-05-coord-foundations.md` (done, deviations, issues, what remains of Day 5 after the slice merges).
- Commit on `Yoelcanarion/day-05-coord-foundations` (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Do not merge or push. Tell Yoel it is ready, with the commit hash and test counts.
