# Takeover evidence: final-kill-half-1

Command: `fractalswarm takeover demo\final`

8771 events, head `a199a768072b817c406b85822f3fe647`.

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
| o0 | kill_coordinator | 22.2% | 4806 | 53.30s | 4808, chaos | 1 timer | 0 |
| o2.1 | kill_coordinator | 44.4% | 5887 | 63.50s | 5889, chaos | 1 timer | 0 |
| o1 | kill_coordinator | 50.0% | 6069 | 65.53s | 6071, chaos | 1 timer | 0 |
| o3.2 | kill_coordinator | 66.7% | 6778 | 74.22s | 6782, chaos | 1 llm, 1 timer | 0 |
| o2 | kill_coordinator | 83.3% | 7676 | 90.39s | 7678, chaos | 1 timer | 0 |

## 2. Death verdicts

| subject | declared by | seq | t | after the kill | verdict | rejoined |
|---|---|---|---|---|---|---|
| o0 | o1 | 5183 | 57.78s | 4.48s | true | - |
| o2.1 | o2.2 | 6229 | 67.91s | 4.41s | true | - |
| o1 | o3 | 6395 | 69.92s | 4.39s | true | - |
| o3.2 | o3.1 | 7095 | 78.97s | 4.75s | true | - |
| o2 | o3 | 7868 | 95.16s | 4.76s | true | - |

## 3. Succession

Heirs recomputed with `coord.tree.heir` on views folded from the log.

- `root`: o0 -> o1 -> o2 -> o3
- `track-ai/d1`: o2.1 -> o2.2
- `track-data`: o1 -> o3
- `track-hci/d2`: o3.2 -> o3.1
- `track-ai`: o2 -> o3

| seq | goal | previous | owner | recomputed heir | pool | works | adopted results | ok |
|---|---|---|---|---|---|---|---|---|
| 5260 | root | o0 | o1 | o1 | o1, o2, o3 | 0 | 0 | ok |
| 6290 | track-ai/d1 | o2.1 | o2.2 | o2.2 | o2.2 | 3 | 1 | ok |
| 6405 | root | o1 | o2 | o2 | o2, o3 | 0 | 0 | ok |
| 6461 | track-data | o1 | o3 | o3 | o2, o3 | 0 | 0 | ok |
| 7148 | track-hci/d2 | o3.2 | o3.1 | o3.1 | o3.1 | 2 | 1 | ok |
| 7906 | root | o2 | o3 | o3 | o3 | 0 | 0 | ok |
| 7908 | track-ai | o2 | o3 | o3 | o3 | 0 | 0 | ok |

**Root, seq 5260:** `o0` died (verdict at seq 5183); the heir is `o1` (recomputed `o1`).

| rank | candidate | HRW score (goal, member) |
|---|---|---|
| 1 | o1 | e5ec11ecd2057b7e |
| 2 | o2 | 40644f4adc41ea7c |
| 3 | o3 | 3dea08728f5da819 |

**Root, seq 6405:** `o1` died (verdict at seq 6395); the heir is `o2` (recomputed `o2`).

| rank | candidate | HRW score (goal, member) |
|---|---|---|
| 1 | o2 | 40644f4adc41ea7c |
| 2 | o3 | 3dea08728f5da819 |

**Root, seq 7906:** `o2` died (verdict at seq 7868); the heir is `o3` (recomputed `o3`).

| rank | candidate | HRW score (goal, member) |
|---|---|---|
| 1 | o3 | 3dea08728f5da819 |

## 4. Adoption

| seq | goal | dead | adopter | children | duties | ok |
|---|---|---|---|---|---|---|
| 5261 | root | o0 | o1 | o2, o3 | final integration, top-level arbitration | ok |
| 6291 | track-ai/d1 | o2.1 | o2.2 | o2.1.a1, o2.1.a2 | - | ok |
| 6406 | root | o1 | o2 | o3 | final integration, top-level arbitration | ok |
| 6462 | track-data | o1 | o3 | o1.1, o1.2 | integration, arbitration | ok |
| 7149 | track-hci/d2 | o3.2 | o3.1 | o3.2.a1, o3.2.a2 | - | ok |
| 7907 | root | o2 | o3 | - | final integration, top-level arbitration | ok |
| 7909 | track-ai | o2 | o3 | o2.2 | integration, arbitration | ok |

Orphan results (agent results sent to an owner that was already dead):

| seq | contract | from | to (dead) | after death | fate | consumer | verified at |
|---|---|---|---|---|---|---|---|
| 6151 | track-ai/d1/extract#0 | o2.1.a1 | o2.1 | True | adopted | o2.2 | 6293 |

## 5. Fencing

132 owner-scoped writes were checked against the goal's owner at that point of the log; 0 could not be.

_none_

## 6. Lost work

Contracts verified: 18 of 18.

Goals:

| goal | status | seq | written by | gaps |
|---|---|---|---|---|
| root | ok | 8744 | o3 | - |
| track-ai | ok | 8742 | o3 | - |
| track-ai/d1 | ok | 8740 | o2.2 | - |
| track-ai/d2 | ok | 6912 | o2.2 | - |
| track-data | ok | 7883 | o3 | - |
| track-data/d1 | ok | 7881 | o1.1 | - |
| track-data/d2 | ok | 7751 | o1.2 | - |
| track-hci | ok | 8424 | o3 | - |
| track-hci/d1 | ok | 6852 | o3.1 | - |
| track-hci/d2 | ok | 8422 | o3.1 | - |

`task.result`: 1 written by o3; status **ok**, placed **48** of expected **48**, hard violations **0**, gaps none.

## 7. Duplicate calls

78 llm calls started; 77 completed and billed, 0 failed (not billed). Completed calls sharing a request body: **0** group(s).

Calls cancelled in flight:

| effect | tag | by | cause | worst case | estimated billed | redone | contract |
|---|---|---|---|---|---|---|---|
| eff-6660.1 | judge/track-hci/d2/place/0 | o3.2 | kill | $0.011835 | $0.002717 | 1x same request | - |

- `idem_key` reused among `effect.started`: 0; effect ids started twice: 0; contract attempts dispatched twice: 0.
- Cassette: 77 entries; duplicated 0, without an effect 0, completed calls without an entry 0, recorded but cancelled 0, of another run 0.

## 8. Invariants

- Hash chain: verified.
- Audit: True
- Replay: not run.

## 9. Costs

Settled $0.478279; peak committed (settled + open reservations) $0.500280 at seq 8415, run cap 0.75; open reservations at the end: 0 ($0.000000); cancelled llm calls: 1, worst case $0.011835, estimated billed $0.002717.

| role | settled |
|---|---|
| agent | $0.278112 |
| judge | $0.057769 |
| root_planner | $0.051471 |
| sub_planner | $0.090926 |

| actor | settled |
|---|---|
| o0 | $0.051471 |
| o1 | $0.030832 |
| o1.1 | $0.010791 |
| o1.1.a1 | $0.003767 |
| o1.1.a2 | $0.040157 |
| o1.2 | $0.010850 |
| o1.2.a1 | $0.014002 |
| o1.2.a2 | $0.029092 |
| o2 | $0.015961 |
| o2.1 | $0.005337 |
| o2.1.a1 | $0.031166 |
| o2.1.a2 | $0.037557 |
| o2.2 | $0.030956 |
| o2.2.a1 | $0.007399 |
| o2.2.a2 | $0.026927 |
| o3 | $0.014169 |
| o3.1 | $0.024019 |
| o3.1.a1 | $0.021777 |
| o3.1.a2 | $0.014691 |
| o3.2 | $0.005780 |
| o3.2.a1 | $0.028001 |
| o3.2.a2 | $0.023577 |

## What the log cannot show

- A kill is an in-process Stop (actor.stopped): the log cannot show an operating-system process dying, only that the actor produced nothing afterwards.
- Message deliveries are not logged, only sends. Whether an orphaned result was ever delivered to its dead owner is inferred from who consumed it afterwards.
- The heir is recomputed with this repository's coord.tree.heir on views folded from the log: it proves the log is consistent with that code, not that the code matches the spec.
- Costs are the log's: settled amounts and reservation worst cases. What a provider billed for a call cancelled in flight is estimated, not known.
- A call that completed with an error is counted as not billed (its cost is 0 in the log); a provider may still bill a request that timed out.
- The chain and the replay show that this code reproduces the recorded run from the recorded model outputs, not where those outputs came from.
- The run was not replayed (add --replay): the code was not re-executed.

