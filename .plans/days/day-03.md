# Day 3 — Wed 28 Oct — ★ Kernel + verifiable replay + LLM layer

Paste this into a **new Claude Code chat**. Branch/worktree: `day-03-kernel`, from `master`.

## Read first
- `CLAUDE.md` (determinism rules)
- `.plans/fractalswarm-spec.md` §3 (architecture and determinism contract), §5.1, §7.1, §14, §19
- `docs/api-notes.md`
- `.plans/progress.md` (last entry)

## Goal
Build the deterministic kernel and the **hash-verified replay** (a crown jewel), plus an LLM layer with cost accounting. Everything later depends on this.

## Tasks (in order)
1. `kernel/ids.py`: stable ids, `blake2b` helpers, canonical JSON.
2. `kernel/events.py`: a pydantic event envelope (fields as in §5.1) and a type registry.
3. `kernel/store.py`: SQLite (WAL) event store.
   - Append-only, with a hash chain (`prev_hash`, `hash`).
   - `idem_key` is UNIQUE.
   - Read by seq, plus `verify_chain()`.
4. `kernel/clock.py`: a virtual clock (live mode follows the wall clock; replay uses recorded timestamps), plus Lamport helpers.
5. `kernel/scheduler.py`: actor registry and mailboxes.
   - The queue is ordered by `(vtime, lamport, seq)`.
   - Handlers are pure and return commands: `Emit`, `Send`, `StartEffect`, `SetTimer`, `Spawn`, `Stop`.
6. `kernel/effects.py`: the effect runner. Asyncio tasks produce completion events, and timers are effects too.
7. `llm/client.py`: an `AsyncOpenAI` wrapper following `docs/api-notes.md`.
   - Role → (model, effort, max_output_tokens).
   - Parse the rate-limit headers and honor Retry-After.
   - Turn usage into cost with `config/prices.yaml`.
8. `llm/cassette.py`: record and replay, with `Authorization` headers and secrets redacted.
9. `llm/fake.py`: a scripted, deterministic fake LLM, with a latency-model hook for the Day 5 calibration.
10. `market/ledger.py`: two-phase reserve/settle.
    - Caps per contract, squad, run and project.
    - Project ledger in `runs/ledger.sqlite`.
    - CLI command `fractalswarm spend`.
11. `kernel/replay.py` and CLI `replay RUN --verify`. Re-run the actors against the cassette in the recorded completion order, then compare the final hash.
12. Toy scenario: 3 actors exchanging messages, with fake LLM calls and timers → record → `replay --verify`.
13. One real tiny recorded Spark call, replayed hash-identically. Store it as a golden fixture (redacted) in `tests/golden/`. If `MODEL_API_KEY` or the hackathon credits are not in place yet, skip this item, record it as pending, and do it as soon as both are; everything else runs on the fake LLM.
14. Tests:
    - `test_replay_verify` (golden);
    - hash-chain verification;
    - ledger property tests: caps are never exceeded under concurrent reserves;
    - the determinism lint test, now active on real code.

## Exit criteria
- [ ] All the tests above are green.
- [ ] `replay --verify` reports a hash match for the toy scenario, and for the real call once the key and the credits are in place.
- [ ] Spend ≤ $0.50.

## Allowed fallbacks today
None. This is crown-jewel work.

## Out of scope today
Planning, orchestrators, HRW, chaos, UI.

## End of day
- Tests and lint green.
- Append to `.plans/progress.md`.
- Commit.
- Ask before merging into `master` or pushing.
