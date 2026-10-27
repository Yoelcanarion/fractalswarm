# day-05-coord-foundations: stream notes

Branch `Yoelcanarion/day-05-coord-foundations`, base `b6abd07`. This is the part of Day 5 that does not need the Day 4 planning/actor slice. These notes stand in for a `progress.md` entry; the lead folds them in at merge time.

## Done
- **Bus** (`comms/bus.py`, `comms/topics.py`):
  - pub/sub, request/reply with timeouts, and subscribe frames;
  - priority lanes: critical is at-least-once (acks, exponential resend, given up when the receiver is dead in the members view); normal and low are at-most-once;
  - dedup by `idem_key`;
  - a causal buffer: `deps`, automatic FIFO deps on the critical lane per receiver, `hold_ms` release, and Lamport order among messages released together;
  - TTL;
  - fencing of frames from dead incarnations, with a `fenced` notice back to the sender.

  The bus runs inside each actor's own state: an `Endpoint` plus pure functions on top of the kernel's `Send`/`msg.sent`.
- **Membership** (`coord/membership.py`):
  - `MembersView` is a kernel reducer, so every actor reads the same table;
  - the embeddable `Detector`: 1 s heartbeats on the low lane, `member.suspected` after 3 missed, `member.dead` after 5;
  - the first verdict in the log wins, idempotent by `(member, incarnation)`, and bumps `member_epoch`;
  - a detector that hears none of its two or more peers assumes it is the one cut off and issues no verdicts;
  - `FencingToken`: writes from a dead incarnation, or older than a newer owner's write to the same resource, become `write.fenced`;
  - a zombie learns from the bus `fenced` notice that it was declared dead, and rejoins with `incarnation + 1`.
- **Chaos** (`comms/chaos.py`):
  - `build_plan(profile, seed)` for C0–C3 (§15.4): crashes at 20/35/50/65/80 % of contracts dispatched, agent shares, net loss/dup/delay/reorder, one seeded partition from C2 up, and the API fault rate;
  - the `net` relay actor injects frame faults and partitions;
  - the `chaos` monkey actor kills the coordinator picked by a pluggable `Targeting` rule (default `most_remaining_work`), kills agents, partitions a member and heals it;
  - `ProgressView` and `ActorsView` reducers feed the monkey;
  - every fault is a `chaos.injected` event.
- **API faults** (`llm/transport.py`):
  - one seeded `decide()`;
  - `FaultInjectingTransport` (`httpx2`) for real backends;
  - `FaultyBackend` for the fake: 429 with Retry-After, 503 (some of them 60 s overloads), timeouts and slow responses;
  - the faulty attempts land in the cassette, so replay needs no injection.
- **Model breaker** (`comms/breakers.py`):
  - opens after ≥5 failures in 30 s, or at once on a Retry-After above 20 s;
  - stays open 10 s·2^k, capped at 120 s and never shorter than the Retry-After;
  - then half-open with one probe;
  - `BreakerBoard.route` picks the next allowed model or returns `None` (queue).
- **Calibration** (`llm/calibrate.py`, `fractalswarm calibrate`):
  - fits latency per model (non-negative least squares with a lognormal residual) and reasoning tokens per (model, effort);
  - inputs are cassettes and samples; fake responses are skipped;
  - `config/fake_calibration.json` is fitted from `tests/fixtures/calibration/` (the redacted Day 3 spike) and the one-call golden, and a test checks that the fit reproduces exactly;
  - it is opt-in: `Calibration.backend()`. The default `FakeBackend` is unchanged.
- **Test-bed** (`actors/chaos_toy.py`, scenario `chaos-toy`):
  - N coordinators, each with a detector and a relayed endpoint, plus agents (one fake LLM call behind the breaker, results published on the critical lane);
  - leaderless takeover by rendezvous hashing over the live members: only the heir writes `toy.ownership.remapped`, with no LLM call and no messages;
  - orphan results already in hand are adopted (`adopted: true`, nothing redone);
  - every write carries a fencing token.
  - CLI: `fractalswarm toy --scenario chaos-toy --chaos C3 [--seed S]`.
- **Tests:** 141 green (88 before, 53 new). Ruff check and format are green.
  - Unit tests: `test_bus`, `test_membership`, `test_chaos`, `test_breakers`, `test_transport`, `test_calibrate`, using hypothesis for the bus (at-least-once + dedup + FIFO under drop, duplicate and reorder), death timing, plan determinism, the drop rate, the breaker span and the fault rate.
  - Integration tests (`test_chaos_replay`):
    - C3 on 8 coordinators: 5 targeted kills, agent kills, every net fault, a partition and 20 % API faults → 24/24 verified, only agents call the LLM, replay MATCH;
    - the same seed gives the same head;
    - orphan adoption;
    - **`test_zombie_fenced`**.
  - `test_silent_deliveries`, sim and live, guards the kernel replay fix below.
- **Golden hashes unchanged:** `tests/golden/toy` (`a47d0153…`) and `tests/golden/one-call` (`0e84ce4a…`) still replay to MATCH.
- **By hand:** `toy --scenario chaos-toy --chaos C1|C2|C3` with 10 coordinators and 30 contracts verifies 30/30 every time, and `replay --verify` gives MATCH.

## Deviations
- **Kernel replay fix** (`kernel/replay.py`, `kernel/effects.py`). A delivery that appends no event (for example a heartbeat that the bus absorbs) still moves its actor's Lamport clock.
  - Sim mode appended completions only on an empty queue, but replay injected a recorded completion before draining such deliveries. Every chaos run diverged.
  - Replay now drains the queue before each recorded completion.
  - The live driver now appends one completion at a time, and only once the queue is empty, as sim already did. Before this, live runs could not be replayed whenever a silent delivery was pending.
  - Existing goldens are unaffected.
- **Kernel additions (from the WIP), all additive:**
  - scenario reducers (`Scenario.reducers()`, `View.views`, `View.member_epoch`), which can refuse an `Emit` or replace it, for example with `write.fenced`, and can bump `member_epoch`;
  - an `Emit` with an explicit `idem_key` already in the log is skipped (first wins).
- **Chaos enters through actors, not external completion events.**
  - The `net` and `chaos` actors run on timer completions. Their decisions are pure functions of the seed and the log so far, so replay re-derives them.
  - Every fault is logged as `chaos.injected`; a kill is the kernel's `actor.stopped`.
  - API faults are the exception: they enter as effect completions, through the cassette.
- **The log is the lease authority.** A chaos-toy coordinator stops owner work as soon as the shared members view says its own incarnation is dead, like an expired etcd lease. It only learns that it must rejoin from the bus `fenced` notice, after the partition heals. Its periodic `toy.checkpoint` writes are fenced in the meantime.
- **The test-bed stands in for the slice.** chaos-toy uses plain rendezvous hashing (not the bounded-load HRW of `coord/hrw.py`) and its own `toy.*` event types, so it cannot clash with the Day 4 `contract.*` and `ownership.*` registrations.
- **`LLMClient` error results now carry `retry_after_ms`**, for the breaker.
- **The breaker lives in the calling actor's state** (one board per agent in chaos-toy), not in one board per process.
- **CLI additions:** `calibrate`; `toy --chaos`. The chaos-toy defaults are 10 coordinators, so that C3's five crashes kill half the brains, and 30 contracts.

## Issues
- **C3 causes false deaths.** 20 % heartbeat loss plus delays on the low lane means a healthy coordinator sometimes misses 5 heartbeats. It is declared dead, fenced, and rejoins. This is correct per §5.2, but it adds takeovers. Options: heartbeats on the normal lane, or exempt heartbeats from chaos loss.
- **C3 runs are long in virtual time** (about 70 s for 24 contracts): 60 s overload 503s make the client wait at least the Retry-After. This is fine for stall-time measurements; keep it in mind for the hero chart.
- **Heartbeat volume is quadratic.** Every coordinator heartbeats every peer, so 10 coordinators make about 90 frames per second. Once the tree exists, heartbeats should go to siblings, the parent and the children only (§5.2).
- **The monkey can kill every coordinator** when there are fewer coordinators than crashes. Respawning a whole dead sibling group (§5.3) is not done.
- **Not built:** the channel breaker and the topic-storm breaker (§8). `BreakerBoard.route` is not wired into role routing yet.
- **Duplicate C-profiles.** `bench/profiles.py` (day-06) defines its own C-profiles; after the merge, one should import the other (this module's `PROFILES` and `build_plan`).
- **Event-type collision risk.** This stream registers `member.*`, `write.fenced`, `chaos.injected` and `breaker.*`. If the Day 4 slice registers any of the same names, `register()` raises at import, so check this at merge time.

## Spend
$0. No real API calls. The tests never touch `~/.fractalswarm/ledger.sqlite`.

## What remains of Day 5 after the slice merges
1. Embed `membership.Detector` and the bus `Endpoint` in the Day 4 orchestrators. Put fencing tokens on the owner-scoped writes in the Day 4 reducers (contracts, ownership).
2. Point `ProgressSpec` at the real `contract.*` and `ownership.*` events (the defaults already match the spec names), and run the monkey against T2.
3. `coord/hrw.py` (bounded-load, ε = 0.25, minimal remap) in place of chaos-toy's rendezvous, plus `coord/tree.py`: subtree adoption (`tree.adopted`) and root succession.
4. `coord/ladder.py`, `coord/collisions.py` (LCA arbitration, human escalation).
5. `test_kill_half` on a small T2 at depth 2. Also the HRW property tests and the tree adoption tests.
6. Wire the breaker into the orchestrators' and agents' LLM calls, routing to the next allowed model.
7. Re-run `fractalswarm calibrate` with the Day 4/5 cassettes.
8. The real Standard T2 run at C3 (item 12, at most $4). Ask Yoel first.
