# Day 4 — Thu 29 Oct — Vertical slice on T2 at depth 2

Paste this into a **new Claude Code chat**. Branch/worktree: `day-04-slice`, from `master`.

## Read first
- `CLAUDE.md`
- `.plans/fractalswarm-spec.md` §4, §5.3, §6.1, §7.3 (`exact` fan-out), §9, §10, §11, §15.3 (T2)
- `docs/api-notes.md`
- `.plans/progress.md` (last entry)

## Goal
Run the T2 conference task end to end on the real API: root → 3 tracks → 6 sessions → agents. It must produce a schedule with **0 hard-constraint violations** whose replay verifies.

**Requires `MODEL_API_KEY` and the hackathon credits** for the real run (task 12). If either is still missing, build and test everything against the fake LLM, do the real run as soon as both are in place, and flag the delay to Yoel: it now blocks the crown-jewel days.

## Tasks (in order)
1. `bench/tasks/t2_conference/generator.py`: a seeded generator.
   - It produces about 48 talks with free-text abstracts, about 32 speaker emails with natural-language availability and preferences, 4 rooms with capacities, 2 days and 3 tracks, plus the ground-truth constraints.
   - Output goes to `tasks/fixtures/t2/seed-<n>/`.
   - Reserve a `--poison N` flag; it is implemented on Day 8.
2. `bench/tasks/t2_conference/checker.py`: the deterministic hard-constraint checker plus the soft score.
   - Hard constraints: room/slot double-booking, speaker double-booking, availability, capacity, track rules.
   - It checks against the ground truth.
3. Planning models: `planning/taskspec.py` (YAML schema and defaults), `planning/contracts.py`, `planning/dag.py`.
4. `planning/planner.py`.
   - Root decomposition with Wonder, using structured output, into tracks.
   - Each track orchestrator sub-plans into (track, day) sessions.
   - Session orchestrators write contracts (Spark, effort medium).
5. Actors:
   - `actors/orchestrator.py`;
   - `actors/agent.py`: tool loop with `memory.search`, `memory.publish_fact` and `workspace`;
   - `actors/integrator.py`: bottom-up integration, sessions → track → root.
6. `memory/blackboard.py` and `memory/fts.py`: facts and artifacts, FTS5, and draft/verified visibility.
7. `coord/leases.py`: leases plus CAS on slot keys (basic handling of temporal collisions).
8. `verify/checks.py` and `verify/judge.py` (Spark, effort low).
9. `coord/hrw.py`: a bounded-load HRW assignment function. No failure handling yet; that is Day 5. Use `exact` fan-out [3, 2] with 2 agents per leaf.
10. CLI: `fractalswarm run tasks/examples/t2-conference.yaml`.
11. A fake-LLM end-to-end test of the whole slice.
12. A real Standard run on T2 seed 1. Check for 0 violations, run `replay --verify`, and keep the cassette, which also feeds the Day 5 calibration.

## Exit criteria
- [ ] The real T2 run costs under $2, has 0 hard-constraint violations, and its replay verifies.
- [ ] The fake-LLM end-to-end test is green.
- [ ] Spend today ≤ $3.

## Allowed fallbacks today
- If Wonder's root planning is flaky, use a strict JSON schema plus few-shot examples.
- If 0 violations is hard to reach, add a repair pass. The session orchestrator gets the checker's violations as feedback and re-places the talks; placement must still be done by the LLM.

## Out of scope today
Failures and takeover, market, safety, UI.

## End of day
- Tests and lint green.
- Append to `.plans/progress.md`, including the cost per T2 run.
- Commit.
- Ask before merging into `master` or pushing.
