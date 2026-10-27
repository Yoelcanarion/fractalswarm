# Day 5 — Fri 30 Oct — ★ Leaderless takeover at every level + chaos

Paste this into a **new Claude Code chat**. Branch/worktree: `day-05-takeover`, from `master`.

## Read first
- `CLAUDE.md`
- `.plans/fractalswarm-spec.md` §5 (all), §6.2, §8, §15.2, §15.4, §19
- `.plans/progress.md` (last entry)

## Goal
Make **"kill half the brains"** real. Five targeted coordinator kills across levels, the root included, must still produce a valid schedule. Survivors re-own the work with no election and zero coordination tokens. Two crown jewels land today.

## Tasks (in order)
1. `coord/membership.py`.
   - A 1 s heartbeat over the bus.
   - `member.suspected` after 3 missed heartbeats; `member.dead` after 5 missed (5 s). The first event in the log wins.
   - `member_epoch`.
2. Fencing tokens in the reducers, emitting `write.fenced`. A zombie rejoins with a new incarnation.
3. Ownership:
   - `coord/hrw.py`: bounded-load HRW (ε = 0.25) with minimal remap;
   - `coord/tree.py`: **subtree adoption** (`tree.adopted`) when a mid-level orchestrator dies, and **root succession**.
4. Orphan adoption through contract idempotency keys. In-flight agents of a dead owner finish and publish.
5. The bus, in `comms/bus.py` and `comms/topics.py`:
   - pub/sub and request/reply;
   - priority lanes, with at-least-once delivery and acks on the critical lane;
   - deduplication;
   - a Lamport causal buffer.
6. `comms/chaos.py`: seeded chaos schedules at logical progress points (C0–C3, §15.4).
   - **Targeted coordinator kills**: the coordinator with the most remaining owned work.
   - Agent kills.
   - Bus network faults: drop, delay, duplicate, reorder, partition.
   - API faults through `llm/transport.py`, a custom `httpx` transport.
7. The model breaker (part of `comms/breakers.py`), with backoff that honors Retry-After.
8. `coord/ladder.py`: the replanning ladder.
9. `coord/collisions.py`.
   - Declarative goal-collision detection over writes, produces and constraints, e.g. a speaker double-booked across squads.
   - The resolution rules.
   - **LCA arbitration**: the track lead, or the root or its successor, using Wonder.
   - Human escalation event.
10. `llm/calibrate.py`: fit the fake LLM's latency and token distributions to the Day 4–5 cassettes.
11. Tests:
    - **`test_kill_half`**: fake LLM, a small T2, 5 targeted kills including a track lead and the root → 0 violations, subtree adopted, root duties succeeded.
    - **`test_zombie_fenced`**.
    - HRW property tests: balance and minimal remap.
    - Tree adoption tests.
12. A real Standard T2 run at C3 completes with 0 violations, and its replay verifies.

## Exit criteria
- [ ] The tests above are green.
- [ ] The real C3 run completes and its replay verifies.
- [ ] The UI-less log shows `tree.adopted` and root succession.
- [ ] Spend today ≤ $4.

## Allowed fallbacks today
Last resort only: depth 1, if depth-2 adoption is still blocked at the end of the day. Record it in the progress log and tell Yoel.

## Out of scope today
Market, safety, UI, baselines.

## End of day
- Tests and lint green.
- Append to `.plans/progress.md`.
- Commit.
- Ask before merging into `master` or pushing.
