# The split-brain check, before and after its fix (Oct 31, 2026)

`fractalswarm takeover` printed `split-brain` on three real rows of the headline: T2, C3, seeds 2, 6 and 7, five flags in all. All five were false alarms. This folder holds the evidence for that and for the fix. No log, row or result changed; only the checker's reading of them.

## The fault

The old rule grouped remaps by `(goal, previous)` and flagged a group with two owners. A member can hold a goal twice in turn: it is falsely declared dead, the goal moves away, it comes back, it gets the goal again, and it really dies later. Its two tenures then fall in one group, and read as two owners.

The five flags, as the old rule printed them:

| Row | Flag |
|---|---|
| C3 s2 | `track-data/d2` from `o1.2` was taken by 2 owners: `o1.1` at seq 6935, `o1.3` at seq 13821 |
| C3 s6 | `track-ai/d1` from `o2.3` was taken by 2 owners: `o2.4` at seq 18277, `o2.5` at seq 24103 |
| C3 s7 | `track-ai/d1` from `o2.1` was taken by 2 owners: `o2.1` at seq 12041, `o2.2` at seq 14996 |
| C3 s7 | `track-data/d1` from `o1.1` was taken by 3 owners: `o1.2` at seq 9250, `o1.1` at seq 11825, `o1.3` at seq 12493 |
| C3 s7 | `track-data/d2` from `o1.1` was taken by 2 owners: `o1.1` at seq 11827, `o1.3` at seq 12495 |

## The new rule

A goal has one holder at each point of the log, so a remap must start from that holder. A remap whose `previous` no longer holds the goal is split-brain. The rule is in `src/fractalswarm/verify/takeover.py` (`_split_brain`). It catches everything the old rule caught, except a goal that went back to `previous` through a remap in the log, and that remap is itself checked. It also catches one case the old rule let through: the same heir taking one tenure twice.

## The results

Recomputed with `scripts/split_brain_before_after.py`, which keeps the old rule word for word.

| | 20 real headline swarm runs (C0, C3, seeds 1–10) | 3 public bundles (`demo/final`, both pairs' swarm side) |
|---|---|---|
| Remaps | 113 | 21 |
| Flags, old rule | 5, in 3 runs | 0 |
| Flags, new rule | 0 | 0 |
| Remaps checked against the goal's owner by an independent walk of the log | 110, no break | 18, no break |
| First remap of the root (it has no `ownership.assigned` to check against) | 3 | 3 |
| Twins injected: a second taker right after each takeover | 105 | 21 |
| Twins caught, old rule | 105 | 21 |
| Twins caught, new rule | 105 | 21 |

The 8 remaps of the real runs with no twin are reclaims (a member taking back its own goal). What follows a reclaim is the next takeover, not a twin.

`violations-before.json` and `violations-after.json` list every violation kind of the 23 runs, on the code before and after the fix: 15 and 10. The only difference is the five `split-brain` flags. The other ten are the same on both sides.

| File | What it holds |
|---|---|
| `real-headline-swarm.json` | The 20 real runs, one row each |
| `public-bundles.json` | The 3 public bundles, one row each |
| `violations-before.json`, `violations-after.json` | Every violation kind per run, before and after |

The real runs' logs are not in git. Their cells are in `bench/results/headline-10/cells/`, and each row here carries the log's head hash.
