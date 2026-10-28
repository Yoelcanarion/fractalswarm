# Takeover evidence: t2-real-killhalf-seed1

Command: `fractalswarm takeover demo/backup --replay`

8177 events, head `b052b4bc33cfe1b54c7b6ceb2872de26`.

**Result: OK**

| check | result |
|---|---|
| Kills | OK |
| Death verdicts | OK |
| Succession | OK |
| Adoption | OK |
| Fencing | OK |
| Lost work | OK |
| Duplicate calls | OK |
| Invariants | OK |
| Costs | OK |

No violation.

## 1. Kills

| target | fault | progress | seq | t | stopped (seq, reason) | cancelled with it | events after stop |
|---|---|---|---|---|---|---|---|
| o0 | kill_coordinator | 22.2% | 4025 | 44.50s | 4027, chaos | 1 timer | 0 |
| o2.1 | kill_coordinator | 38.9% | 5167 | 55.38s | 5169, chaos | 1 timer | 0 |
| o1 | kill_coordinator | 50.0% | 5301 | 56.67s | 5303, chaos | 1 timer | 0 |
| o3.2 | kill_coordinator | 66.7% | 6063 | 65.91s | 6065, chaos | 1 timer | 0 |
| o2 | kill_coordinator | 83.3% | 6701 | 76.86s | 6703, chaos | 1 timer | 0 |

## 2. Death verdicts

| subject | declared by | seq | t | after the kill | verdict | rejoined |
|---|---|---|---|---|---|---|
| o0 | o3 | 4487 | 49.61s | 5.11s | true | - |
| o2.1 | o2 | 5567 | 59.78s | 4.41s | true | - |
| o1 | o3 | 5692 | 60.73s | 4.06s | true | - |
| o3.2 | o3 | 6339 | 70.83s | 4.92s | true | - |
| o2 | o2.2 | 6848 | 80.95s | 4.09s | true | - |

## 3. Succession

Heirs recomputed with `coord.tree.heir` on views folded from the log.

- `root`: o0 -> o1 -> o2 -> o3
- `track-ai/d1`: o2.1 -> o2.2
- `track-data`: o1 -> o3
- `track-hci/d2`: o3.2 -> o3.1
- `track-ai`: o2 -> o3

| seq | goal | previous | owner | recomputed heir | pool | works | adopted results | ok |
|---|---|---|---|---|---|---|---|---|
| 4538 | root | o0 | o1 | o1 | o1, o2, o3 | 0 | 0 | ok |
| 5584 | track-ai/d1 | o2.1 | o2.2 | o2.2 | o2.2 | 3 | 0 | ok |
| 5722 | root | o1 | o2 | o2 | o2, o3 | 0 | 0 | ok |
| 5753 | track-data | o1 | o3 | o3 | o2, o3 | 0 | 0 | ok |
| 6365 | track-hci/d2 | o3.2 | o3.1 | o3.1 | o3.1 | 2 | 1 | ok |
| 6856 | root | o2 | o3 | o3 | o3 | 0 | 0 | ok |
| 6858 | track-ai | o2 | o3 | o3 | o3 | 0 | 0 | ok |

**Root, seq 4538:** `o0` died (verdict at seq 4487); the heir is `o1` (recomputed `o1`).

| rank | candidate | HRW score (goal, member) |
|---|---|---|
| 1 | o1 | e5ec11ecd2057b7e |
| 2 | o2 | 40644f4adc41ea7c |
| 3 | o3 | 3dea08728f5da819 |

**Root, seq 5722:** `o1` died (verdict at seq 5692); the heir is `o2` (recomputed `o2`).

| rank | candidate | HRW score (goal, member) |
|---|---|---|
| 1 | o2 | 40644f4adc41ea7c |
| 2 | o3 | 3dea08728f5da819 |

**Root, seq 6856:** `o2` died (verdict at seq 6848); the heir is `o3` (recomputed `o3`).

| rank | candidate | HRW score (goal, member) |
|---|---|---|
| 1 | o3 | 3dea08728f5da819 |

## 4. Adoption

| seq | goal | dead | adopter | children | duties | ok |
|---|---|---|---|---|---|---|
| 4539 | root | o0 | o1 | o2, o3 | final integration, top-level arbitration | ok |
| 5585 | track-ai/d1 | o2.1 | o2.2 | o2.1.a1, o2.1.a2 | - | ok |
| 5723 | root | o1 | o2 | o3 | final integration, top-level arbitration | ok |
| 5754 | track-data | o1 | o3 | o1.1, o1.2 | integration, arbitration | ok |
| 6366 | track-hci/d2 | o3.2 | o3.1 | o3.2.a1, o3.2.a2 | - | ok |
| 6857 | root | o2 | o3 | - | final integration, top-level arbitration | ok |
| 6859 | track-ai | o2 | o3 | o2.2 | integration, arbitration | ok |

Orphan results (agent results sent to an owner that was already dead):

| seq | contract | from | to (dead) | after death | fate | consumer | verified at |
|---|---|---|---|---|---|---|---|
| 5973 | track-ai/d1/extract#0 | o2.1.a1 | o2.1 | True | adopted | o2.2 | 6032 |
| 6069 | track-hci/d2/place#0 | o3.2.a1 | o3.2 | True | retried | o3.1 | - |

## 5. Fencing

139 owner-scoped writes were checked against the goal's owner at that point of the log; 0 could not be.

_none_

## 6. Lost work

Contracts verified: 18 of 18.

Goals:

| goal | status | seq | written by | gaps |
|---|---|---|---|---|
| root | ok | 8150 | o3 | - |
| track-ai | ok | 7746 | o3 | - |
| track-ai/d1 | ok | 7744 | o2.2 | - |
| track-ai/d2 | ok | 6808 | o2.2 | - |
| track-data | ok | 6388 | o3 | - |
| track-data/d1 | ok | 6331 | o1.1 | - |
| track-data/d2 | ok | 6386 | o1.2 | - |
| track-hci | ok | 8148 | o3 | - |
| track-hci/d1 | ok | 7067 | o3.1 | - |
| track-hci/d2 | ok | 8146 | o3.1 | - |

`task.result`: 1 written by o3; status **ok**, placed **48** of expected **48**, hard violations **0**, gaps none.

## 7. Duplicate calls

79 llm calls started; 79 completed and billed, 0 failed (not billed). Completed calls sharing a request body: **0** group(s).

Calls cancelled in flight:

_none_

- `idem_key` reused among `effect.started`: 0; effect ids started twice: 0; contract attempts dispatched twice: 0.
- Cassette: 79 entries; duplicated 0, without an effect 0, completed calls without an entry 0, recorded but cancelled 0, of another run 0.

## 8. Invariants

- Hash chain: verified.
- Audit: True
- Replay: MATCH.

## 9. Costs

Settled $0.494767; peak committed (settled + open reservations) $0.516427 at seq 7707, run cap 0.75; open reservations at the end: 0 ($0.000000); cancelled llm calls: 0, worst case $0.000000, estimated billed $0.000000.

| role | settled |
|---|---|
| agent | $0.301002 |
| judge | $0.061039 |
| root_planner | $0.047071 |
| sub_planner | $0.085655 |

| actor | settled |
|---|---|
| o0 | $0.047071 |
| o1 | $0.016624 |
| o1.1 | $0.011085 |
| o1.1.a1 | $0.004708 |
| o1.1.a2 | $0.036551 |
| o1.2 | $0.009503 |
| o1.2.a1 | $0.014530 |
| o1.2.a2 | $0.024717 |
| o2 | $0.022680 |
| o2.1 | $0.005099 |
| o2.1.a1 | $0.028470 |
| o2.1.a2 | $0.030829 |
| o2.2 | $0.025267 |
| o2.2.a1 | $0.010001 |
| o2.2.a2 | $0.030337 |
| o3 | $0.017191 |
| o3.1 | $0.034026 |
| o3.1.a1 | $0.023797 |
| o3.1.a2 | $0.027648 |
| o3.2 | $0.005219 |
| o3.2.a1 | $0.027646 |
| o3.2.a2 | $0.041769 |

## What the log cannot show

- A kill is an in-process Stop (actor.stopped): the log cannot show an operating-system process dying, only that the actor produced nothing afterwards.
- Message deliveries are not logged, only sends. Whether an orphaned result was ever delivered to its dead owner is inferred from who consumed it afterwards.
- The heir is recomputed with this repository's coord.tree.heir on views folded from the log: it proves the log is consistent with that code, not that the code matches the spec.
- Costs are the log's: settled amounts and reservation worst cases. What a provider billed for a call cancelled in flight is estimated, not known.
- A call that completed with an error is counted as not billed (its cost is 0 in the log); a provider may still bill a request that timed out.
- The chain and the replay show that this code reproduces the recorded run from the recorded model outputs, not where those outputs came from.

