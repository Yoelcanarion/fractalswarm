# Stream day-04-slice — end-of-stream notes (Day 4, tasks 1–11)

Branch `Yoelcanarion/day-04-slice`, base `b6abd07`. The entry for `.plans/progress.md` is
for the lead to merge in; this stream did not edit that file.

## Done
- **The fake-LLM vertical slice runs end to end on T2 seed 1.**
  - Tree: root `o0`, 3 track orchestrators, 6 session orchestrators and 12 agents, plus the board actor.
  - Result: 48/48 talks placed, **0 hard violations**, soft score 0.83.
  - Size: 976 events and 64 LLM calls (1 root planner, 9 sub-planner, 46 agent, 8 judge).
  - Two booking collisions are caught by the CAS and resolved by a re-place.
  - `replay --verify` gives **MATCH**, and a second recording reproduces the same head.
  - A run takes about 2 s.
- Tasks 1–9 (WIP from the paused agent), read, fixed where needed and tested:
  - T2 generator, checker, task adapter and scripted fake (`bench/tasks/t2_conference/`);
  - `planning/` (taskspec, contracts, dag, planner, schemas);
  - actors: orchestrator, agent, integrator, board, swarm scenario, events;
  - `memory/` (blackboard, FTS5);
  - `coord/leases.py` and `coord/hrw.py`;
  - `verify/checks.py` and `verify/judge.py`.
- **Task 10:** `fractalswarm run <taskspec.yaml>`.
  - Fake backend by default.
  - `--backend real` refuses to run without `--confirm-real-spend`; a test checks the refusal and that nothing is written.
  - It prints placed/expected, hard violations, the soft score and the gaps, and exits 1 on any hard violation or a missing result.
- **Task 11:** `tests/integration/test_t2_slice.py`. It checks:
  - 0 violations and 48 placed;
  - the tree shape (exact fan-out [3, 2], 2 agents per leaf);
  - every mechanism fires: plan approval, refinements, HRW ownership, contracts verified, judge, leases, promotions, artifacts and collisions;
  - replay MATCH and an identical head on re-recording;
  - the CLI run plus `replay --verify`;
  - the real-spend guard.
- **Unit tests:**
  - `test_t2_task.py`:
    - generator determinism and the committed fixture equal to `generate(1)`;
    - the ground-truth schedule is feasible for seeds 1–10;
    - the fake reads every email and abstract exactly as the truth, for seeds 1–10;
    - one test per hard constraint.
  - `test_coord.py`:
    - HRW, with hypothesis: total assignment, the load bound, member-order independence, minimal remap;
    - leases and CAS: all-or-nothing booking, lease expiry, fencing.
  - `test_memory.py`: draft/verified visibility, no downgrade of a verified fact, FTS ranking and sanitizing, the workspace jail.
  - `test_planning.py`:
    - every schema meets the strict-mode rules;
    - TaskSpec defaults;
    - spotlighting cannot be closed from inside a block;
    - plan-parse feedback, the DAG, contract idem keys, checks and judge fallback.
- **Determinism lint** now covers `actors/`, `planning/`, `memory/`, `bench/tasks/t2_conference/`, `verify/checks.py` and `verify/judge.py`. It is green.
- **Tests:** 162 passed (88 before). `ruff check` and `ruff format --check` are green. The goldens (`tests/golden/*/HEAD`) are unchanged.

## Fixes to the WIP
- **Orchestrator crash:** the root stopped itself before stopping the board, and the next command crashed (`KeyError: 'o0'`). The board is now stopped first.
- **FTS tokenizer:** it keeps `:` inside tokens, so `speaker:S01:availability` did not match `availability`, and a natural query like `S01 availability` found nothing. The fake only searched by ids and never hit this, but a real model would have. Facts are now indexed with their key both whole and split.

## Deviations from the spec / day prompt
- **Integration is pure functions, not a separate actor.** `actors/integrator.py` is called by the orchestrator that owns the subgoal. On Day 5, a successor that adopts a subgoal inherits the integration duty with it.
- **Extra actors and event types:**
  - a `board` actor serves the memory and workspace tools, promotions and bookings, and logs every change (`fact.*`, `artifact.written`, `lease.booked`, `collision.*`);
  - the swarm's event types live in `actors/events.py`, so the kernel stays task-agnostic.
- **The run params hold the corpus and the ground truth** (in `run.started`), so a run replays without the fixture files. Prompts never see the truth; only the checks and the final report use it.
- **The judge runs only on `place` contracts.** `extract` and `blurb` are covered by the deterministic checks.
- **No golden bundle for the T2 slice.** It would be about 2 MB. Determinism is pinned instead by the record-twice test and the replay test.
- **`--poison N`** is accepted by the generator CLI but raises `NotImplementedError`; it is a Day 8 item.
- **Shared files touched:**
  - `cli.py`: the new `run` command;
  - `tests/unit/test_determinism_lint.py`: more linted paths;
  - `runs.py`: the `swarm` scenario name, in the WIP commit;
  - `llm/fake.py`: `tool_calls` on `FakeReply`, in the WIP commit.

## Issues / known limits
- **Seed 8 ends `partial` with the fake.** Talk T32 (153 attendees) fits only the main hall. Sessions that booked earlier took every main-hall slot where its speaker is free, so `place` fails after 6 attempts. 9 of seeds 1–10 are clean; seed 1, the Day 4 target, is clean.
  - Cause: sessions book first-come, with no cross-session repair.
  - Possible fixes: escalate to the parent orchestrator, or have the LCA re-place the sessions that compete for a room (spec §6.2); or a `place` heuristic that holds the largest room back for talks that need it.
- **Real-model unknowns,** none of them tested here because no real calls were allowed:
  - how many tool turns the agents take;
  - whether Wonder's root plan parses on the first try (the fallbacks are a strict schema plus validation feedback, 3 attempts, then a deterministic plan);
  - token use at effort high.
  - The stateless tool round trip with encrypted reasoning was verified live by the Day 3 spike (`tools.responses.results`: 200).
- **Fake costs are not real costs.** The fake run "costs" $0.22, computed from fake token counts at the real prices. The peak of concurrent worst-case reservations is $0.35, so the $2 run cap will not refuse calls at this concurrency.

## Next (lead)
1. Merge order 4 → 5 → 6/8 → 7. When merging Day 8, check that the determinism lint still passes with `verify/` partly linted.
2. **Task 12, the real Standard run on T2 seed 1.** It needs Yoel's go-ahead. Expected cost: about $0.3–0.8; hard cap $2 (the TaskSpec's `budget_usd`).
   ```
   uv run fractalswarm spend
   uv run fractalswarm run tasks/examples/t2-conference.yaml --backend real --confirm-real-spend --clock live --run-id t2-real-seed1
   uv run fractalswarm replay t2-real-seed1 --verify
   uv run fractalswarm spend
   ```
   Pass criteria: `result ok`, `hard violations 0`, `MATCH`, and a spend under $2.

   Keep `runs/t2-real-seed1/cassette.jsonl`: it feeds the Day 5 latency calibration.

   If the result is partial, read the `contract.rejected` and `plan.rejected` reasons in the log (`replay t2-real-seed1` lists the counts). Then tune `config/roles.yaml` (effort, max_output_tokens) or the guides in `task.py`.
3. Day 5: failure handling on top of `coord/hrw.remap`, plus subgoal adoption (the integrator duty moves with the subgoal).
