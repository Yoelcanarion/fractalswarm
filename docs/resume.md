# `fractalswarm resume RUN`: process-crash recovery

Spec §8, "Process crash": *rebuild the views from the log and re-issue only the effects that have
no completion event. The cassette prevents paying twice.* This document says what that sentence
means for every effect that is open when the process dies. The prototype implements it
(`src/fractalswarm/resume.py`, `Runtime.resume`); the tests in `tests/integration/test_resume*.py`
check it. Section 9 lists what is proven and what is not.

`resume` is opt-in. It does not touch the default run path, any recording or any golden replay.

## 1. What it guarantees, in one paragraph

A run whose process was killed can be continued from its own log and cassette. Every effect that
completed before the kill is never sent again. Every effect whose reply reached the cassette is
answered from the cassette, so it is neither sent nor billed again. An effect that was sent
without a recorded reply is the one case that cannot be decided: resume sends it again, names it
in the log, and counts it as possible extra cost. The finished log is one hash chain that
`replay --verify` accepts from its first event.

## 2. Vocabulary

*Open effect*: an `effect.started` event with no `effect.completed` and no `effect.cancelled`
after it. After replaying the log this is exactly `Runtime.inflight`.

*Reaction*: the events that one delivery appends (`Runtime.step`, `scheduler.py`), or the pair
`effect.completed` + `budget.settled` that `Runtime.complete` appends.

*Cassette*: `cassette.jsonl`, one line per finished LLM call, keyed by `effect_id`.

## 3. What happens to each effect

| | State at the kill | What resume does | Logged as |
|---|---|---|---|
| (a) | `effect.completed` is in the log | Nothing. It is never sent or run again. Replay re-derives its completion from the cassette (LLM) or the log (timer, firewall) and the hash of the regenerated event must equal the logged one | nothing |
| (b) | reply in the cassette, no `effect.completed` | Answered from the cassette: no request, no bill. The completion is appended as usual | `run.resumed.from_cassette` |
| (c) | sent, no reply anywhere | **Sent again** (at-least-once). It may have run and been billed already | `effect.reissued {ambiguous: true}` and `run.resumed.ambiguous` |
| (d) | `effect.started` appended, never sent | Cannot be told from (c), so it is treated as (c) | as (c) |
| local | timer or firewall scan, no completion | Run again. They have no external side effect and no cost | `run.resumed.rerun` (counts) |

The ambiguous set is an over-approximation: it contains every (c) and every (d). It never
misses a (c).

### 3.1 (a) Completed and in the log

`effect.completed` is the commit point of an effect. Resume replays the log from `run.started`
(section 7), and a completed effect is fed to the actors from the recorded completion. For an
LLM effect, replay re-parses the recorded reply from the cassette and refuses a request that
differs from the recorded one (`CassetteBackend`); no backend is called. The regenerated
`effect.completed` has to hash like the logged one, so a log and a cassette that disagree stop
the resume with the first divergent `seq`.

### 3.2 (b) Reply in the cassette, no completion in the log

The window exists. In `LLMClient.call` (`llm/client.py`) the reply is made durable by
`self._record(entry)` (`Cassette.record`, `llm/cassette.py`: one `write` of one line, then close).
The completion becomes durable later, when the driver calls `Runtime.complete`, which appends
`effect.completed` (`scheduler.py`). Between the two:

- **sim clock** (`_drive_sim`, `kernel/effects.py`). Every effect runs as soon as it is started
  (`asyncio.gather`) and its outcome waits in the `pending` heap until its *virtual* completion
  time. So at any moment, every LLM call that is in flight in virtual time already has its reply
  in the cassette. This window is wide: a kill at a random point leaves several (b) effects.
- **live clock** (`_drive_live`). The window is the return path of the task plus the wait in the
  `arrived` queue: a completion is appended only when the delivery queue is empty. It is short,
  but it exists.

Resume answers such an effect from the cassette with a replay-mode `LLMClient` over a
`CassetteBackend`, the same code replay uses. No backend is involved, so no request is sent.

### 3.3 (c) Sent, with no reply recorded anywhere

Nothing is written between "the request left" and `Cassette.record`. The reply of a request that
was in flight when the process died is lost, and the provider may have run it, billed it, or
neither. The API has no idempotency key (`docs/api-notes.md`), so the provider cannot recognise a
repeat.

**Decision: send it again, loudly.** The alternative is to complete it with an error and let the
actor's replanning ladder (spec §5.5) decide. That does not avoid a second call: the ladder's
first step is to ask again, with the verifier's feedback appended, which changes the request and
so the plan. An LLM call is a pure request, so the only damage a repeat can do is cost. Cost is
bounded and visible, a different plan is not.

How it is made visible:

- `effect.reissued` for each such effect (`ambiguous: true`, `reserved_usd`, `reason`);
- `run.resumed.ambiguous` lists their ids, and `run.resumed.possible_extra_usd` is the sum of
  their worst-case reservations: the most the lost calls can have cost;
- `fractalswarm resume` prints the list before it continues.

Accounting:

- In-run ledger (`budget.*` events). The effect keeps the reservation it had. When the second
  call completes it is settled with that call's cost, so `run.completed.spent_usd` counts one
  call. It can under-report by up to `possible_extra_usd`.
- Project ledger (`~/.fractalswarm/ledger.sqlite`, real runs). The original reservation
  `run_id/effect_id` was committed before the request was sent (`LLMClient._reserve_project`) and
  is settled only after the reply arrives, so after a kill it is still `reserved` at its worst
  case. It stays that way: the possible bill stays committed against the project cap. The second
  send needs its own reservation, `run_id/effect_id#rN`, because `reservation_id` is `UNIQUE`: re-using the
  original id would raise `IntegrityError` and silently turn the re-send into an error
  completion. After the resume the ledger holds the stale reservation plus the settled second
  call. A person can settle the stale one by hand once the provider's billing page shows
  whether the first call was billed. Nothing automatic does it.
- A narrower sub-window: `call` settles the project reservation *before* it records the reply
  (`_settle_project`, then `_record`). A kill between the two leaves the first call settled in the
  project ledger and its reply lost. It is (c) too: the first call is already counted in the
  ledger, and the second is a second charge.

### 3.4 (d) Started in the log, never sent

The log shows `effect.started` for it, and no file shows anything else: the cassette is written
after the reply, so a request that was never sent and one that is in flight look the same.
Resume treats it as (c). The over-count is one possible extra call at most.

What could tell them apart, not done: with a real project ledger, the row `run_id/effect_id`
is committed before the send, so a missing row would prove "never sent". It needs the real
backend and a ledger query, and it would only shrink the list by the few effects that were
caught in the microseconds between `effect.started` and `reserve`. A write-ahead intent record
in the cassette would work for every backend but would change the default run path.

How wide is (d)? Effects are launched only after the whole reaction that started them is in the
log (`launch()` runs after `runtime.step()` returns, `_drive_live`; `_drive_sim` takes the
outbox the same way). So it is the time between the last event of a reaction and the first
`send`, not the lifetime of the effect.

### 3.5 Local effects

`timer` and `firewall` effects are not external: a timer is pure waiting, and a firewall scan is
a local classifier over the text in the request. Resume runs them again. Under the sim clock
a timer completes at `started.ts_virtual + delay_ms` as before. Under the live clock it waits
only the part of its delay that was left at the resume (`started.ts_virtual + delay_ms - now`),
not the whole delay again.

Any other effect kind is treated as external and ambiguous.

## 4. The torn tail

How `EventStore` commits: one SQLite transaction per event (`isolation_level=None`, one `INSERT`
in `append`), in WAL mode with `synchronous=NORMAL`. A killed process cannot leave a half-written
event, and cannot leave a broken chain, because each event is hashed against the previous one in
memory and then inserted atomically. It can leave **half a reaction**:

- a delivery whose handler returned four commands has appended two of the four events;
- `Runtime.complete` has appended `effect.completed` and not yet `budget.settled`;
- `Runtime.halt` has appended `run.halted` and some of its cancellations;
- `Runtime.start` has appended `run.started` and part of the boot.

What resume does: **it completes the reaction, it does not cut it.** The handlers are pure, so
the events that were never written are determined by the events that were. Replaying the log
regenerates the whole reaction; the part that was already in the log must hash like it, and the
rest is appended to the real log. The result is the log the dead process would have written.
Nothing is deleted or edited: the log stays append-only, and the chain stays valid. The number
of events added this way is `run.resumed.completed_tail`.

Why not truncate to the last whole reaction:

- A reaction has no marker in the log. Its events share a `causation_id`, but `Emit` with an
  explicit idempotency key and the `complete` pair break that, so the boundary would be a guess.
- It would delete evidence from a log whose purpose is to be evidence.
- It could throw away a reaction that the original run had already acted on.

This is safe because **an effect is never launched from a torn reaction**: a reaction is fully
appended before its effects are launched. So no cassette entry can belong to an effect in the
torn part. The tests check this on every kill.

Not done, the alternative that removes tearing: wrap each reaction in one SQLite transaction.
It changes how every run writes its log, so it is out of scope for an opt-in command.

The same applies to the cassette: a torn last line (a kill during the write) is cut off at the
last newline before the cassette is used, and the count of dropped bytes is in
`run.resumed.cassette_dropped_bytes`. The effect that line belonged to has no reply, so it is
(c).

## 5. Clocks

Virtual time is the `ts_virtual` of the events. Handlers only ever see `view.now`, the largest
`ts_virtual` so far (`Runtime.vtime`). Membership timeouts (3 and 5 missed heartbeats) compare
`view.now` values, never the wall clock.

**The clock continues from the last virtual time. The time the process was dead is not part of
virtual time.**

- *sim*: `ManualClock(start=vtime)`. It is a discrete-event clock: it jumps to the next
  completion, so the downtime does not exist in it. The pending completions are rebuilt from the
  open effects with the same latencies (from the cassette for LLM effects, from the request for
  timers), so they come due at the same virtual times.
- *live*: `LiveClock(speed, start_ms=vtime)`. A new `LiveClock` would start at 0 and leave
  `vtime` flat until it caught up; a clock based on the wall time of the original start would
  jump by the whole downtime, and the first membership tick would find every peer silent for
  longer than 5 s and declare all of them dead. Starting at `vtime` makes the downtime free.
  `--speed` can differ from the original run.

`run.resumed` is stamped with `vtime`. After it, `ts_virtual` never goes backwards.

## 6. Procedure

1. Open the run directory. Refuse if another process has the log open (an `EXCLUSIVE` probe on
   the SQLite file: a live writer makes it fail, and the OS releases it when a process dies). Refuse if
   `run.completed` is already in the log. Verify the hash chain; a broken chain stops here.
2. Cut a torn last line off the cassette.
3. Rebuild the runtime the way `replay` does, from the `run.started` payload (seed, scenario,
   params, clock, role and price tables, caps), into a scratch store. Feed every recorded
   completion from the log or the cassette. Every regenerated event must hash like the recorded
   one. The reaction the kill cut is completed here (section 4). Resume needs the same code that wrote the log: a
   changed handler diverges at the first changed event and resume refuses, exactly as
   `replay --verify` would.
4. Append the events beyond the old tail to the real log and switch the runtime to it.
5. Deliver whatever is still queued (what the original would have done next), then classify the open
   effects (section 3).
6. Append `run.resumed` (an outside event, only when the delivery queue is empty, like every
   completion) and one `effect.reissued` per ambiguous effect. Put the open effects in the outbox.
7. Continue with the normal drivers, recording into the same log and the same cassette. Pending control
   requests (`halt`, `budget`) written while the process was dead are applied. At the end,
   export `events.jsonl` as `run` does.

## 7. Replay

`replay --verify` from the first event works on a resumed run:

- `run.resumed` is an outside event (`@env`). Replay applies it from the recorded payload through
  `Runtime.resume`, exactly as it applies `run.halted` and `budget.shock`, and regenerates the
  `effect.reissued` events from it.
- A re-sent or cassette-served effect has its reply in the cassette under its own `effect_id`,
  so its completion replays like any other.
- Resuming a resumed run (a second crash) works the same way: the earlier `run.resumed` events
  are in the log that is replayed.

A resumed log is not the log of an uninterrupted run: it holds the marker, and the ids that
derive from `seq` (`eff-<seq>.<n>`) shift after it. It is a valid, verifiable log of a run that
was interrupted, which is the honest description of it.

## 8. Usage

```
fractalswarm resume RUN [--backend fake|real] [--confirm-real-spend] [--speed 1.0]
                        [--firewall auto|heuristic]
```

`RUN` is a run id under `runs/` or a directory. The clock mode, seed, scenario, parameters and
role and price tables come from the log. `--backend real` needs `--confirm-real-spend` like
`run`: re-sent effects are billed. Exit status: 0 for a completed run, 1 if the run has no
result or hard violations, 2 if the run cannot be resumed (broken chain, divergence, a live
writer, already completed).

## 9. Status

Filled in at the end of the work: see the report. In short:

- Proven by tests that really kill a process: sections 3.1, 3.2, 3.3 (with the fake backend),
  3.5, 5 and 7.
- Not proven: the real Meta API, OS crash or power loss, two resumes at the same instant, a
  control request consumed but not yet logged, and the exact set of effects of a real run that
  the provider billed. See the report for the list.
