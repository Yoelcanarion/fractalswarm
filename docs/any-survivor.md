# Any survivor

**Status:** an opt-in parameter, off by default, added on Oct 31 by Yoel's decision 1 of that day. It is on in no recorded run. Every row under `bench/results/`, every bundle under `demo/` and every number in `docs/claims.md` was recorded without it, and none of them was recorded again. Rows made with it say so, and live in their own folder.

Turn it on with `fractalswarm run … --any-survivor`, `any_survivor: true` in a task spec, or the matrix knob `any_survivor: 1`. It is recorded in the run's params, swarm only.

## The hole it closes

Without the parameter, a run can hang for ever, at no cost in calls. Either no survivor can write the verdict that starts the recovery, or a goal has nobody who can inherit it.

Found on the fake model, on the frozen handlers:

| What dies | Runs that hang |
|---|---|
| A random set of five coordinators | 14 of 40 |
| A whole branch, the whole top, or o0, o1, o2, o3 one by one | Yes |
| The default plans alone | 0 of 20 |
| Kill half the brains pressed on a run at C2 or C3 | 18 of 30 |
| Pressed at half-the-brains | 5 of 15 |
| Pressed at C1 | 1 of 15 |
| Pressed at C0 | 0 of 27 |

For that reason the app offers the button only on a run with no failures (decision 2). "Kill half the brains" is true of the set the demo uses. "Any half" is not, and no public text says it.

## The four rules

Each one acts only with the parameter on. Each hole had its own cause.

1. **A ring of survivors** (`_ring` and `_peers` in `actors/orchestrator.py`). The tree can leave a crashed coordinator with no live watcher, and then its death never enters the log. Once the log holds a death, each coordinator also watches, and beats for, the two next to it on the sorted list of those the log calls alive. Some live member always sits next to a crashed one, and each verdict closes the gap for the next. Both ends of a link read the same list, so each beats for the other. A watch from one side only would kill a live member: the first version did, and it was replaced.
2. **A wholly dead child group stays named** (`_child_group`, same file). Such a goal used to go to its planner, which has no agents to run a session with. It now enters the log with a dead owner and takes the path that exists: no live sibling, so the owner of the parent goal respawns a member.
3. **A last resort for the root goal** (`successors` in `coord/tree.py`, read by `heir` and by `verify/takeover.py`). Once a track lead holds the root goal, its owner has a group that can die whole, and a root has no parent goal whose owner could respawn a member. It then goes to any live coordinator, by the same hash.
4. **"I am the one cut off" expires** (`ISOLATION_LIMIT_MS`, 30 s, in `coord/membership.py`). A detector that hears none of its peers assumes that it is the one cut off and issues no verdicts. If every peer is dead, nobody ever starts the recovery. The assumption now ends after 30 s of hearing nobody. A member that really was cut off was declared dead long before, so its late verdicts are fenced, and `sync` withdraws them.

**What stays the same:** the heir is still computed from the log with the same hash, by every survivor, with no election and no message about it. Late results are adopted, stale writers are fenced and every run replays as before. There is no new event type and no new field in an event payload. Nothing here adds a supervisor.

**With the parameter off,** a run takes the old paths. **With it on and nobody dead,** a run is identical to one without it, event for event (`test_with_nobody_dead_the_param_changes_nothing`).

## The evidence

All of it at $0, on the fake model and the simulated clock.

- **Sweep:** 421 runs, each once with the parameter on and once with it off, with a wall-clock limit of 60 s a run. With it off, 136 hang, and the other 285 end and replay. A hung run's simulated clock had passed 3,125 s when the limit stopped it; the longest run with the parameter on ends at 149 s. With it on, none hangs, and all 421 end and replay. The first 227 cells are the ones that found the holes: 82 hang with it off. The other 194 were drawn at random from a fixed seed once those holes were known, so they test the rules on sets nobody chose: 54 hang with it off, and none with it on.
- **The takeover check on those runs:** of the 136 that stop hanging, 127 end clean and 9 end flagged. Of the 285 that end on both sides, 282 carry the same flags on both sides, 249 of them none, and 3 differ.
- **Which rules ran:** in those 421 runs, rule 1 gave 533 verdicts across the tree in 224 runs, rule 2 sent 12 assignments to a dead member in 6 runs, rule 3 moved the root to a survivor outside its group in 8 runs, and rule 4 gave 289 verdicts after a long silence in 64 runs.
- **Mutations:** 22 of 22 deliberate breaks of the rules are caught by `tests/unit/test_any_survivor.py` and `tests/integration/test_any_survivor.py`.
- **The rows themselves:** `bench/results/any-survivor/`.

## Its effect on the C3 seeds

Fake model, T2, C3, the same plan and the same seed on each line. These are not the real rows of `bench/results/headline-10`, which stay as they were recorded.

| Seed | Span off (s) | Span on (s) | Notional cost off ($) | Notional cost on ($) | False deaths off | False deaths on | Takeover check off | Takeover check on |
|---|---|---|---|---|---|---|---|---|
| 1 | 73.49 | 71.59 | 0.3050 | 0.3049 | 2 | 2 | ok | ok |
| 2 | 57.48 | 55.48 | 0.2928 | 0.2928 | 1 | 3 | ok | ok |
| 3 | 84.45 | 78.24 | 0.3264 | 0.3291 | 1 | 2 | seed 3's four flags | seed 3's four flags |
| 4 | 95.32 | 88.43 | 0.4419 | 0.4396 | 2 | 2 | ok | ok |
| 5 | 71.89 | 71.89 | 0.3097 | 0.3097 | 5 | 4 | duplicate-call | duplicate-call |
| 6 | 78.91 | 80.91 | 0.2996 | 0.2999 | 4 | 3 | duplicate-call | duplicate-call |
| 7 | 64.01 | 64.01 | 0.2885 | 0.2885 | 1 | 1 | ok | ok |
| 8 | 64.06 | 92.46 | 0.3433 | 0.3677 | 2 | 4 | ok | duplicate-call |
| 9 | 51.04 | 56.52 | 0.2649 | 0.2735 | 2 | 5 | ok | ok |
| 10 | 61.80 | 58.80 | 0.2929 | 0.2929 | 2 | 3 | ok | ok |

Seed 3 fails its checks at C0 too, on the fake model, for every workflow (`bench/REPORT.md` §6): its four flags are `contract-failed`, `contract-unfinished`, `goal-not-ok` and `task-result`.

With the parameter on, the mean span is 71.83 s against 70.25 s, the mean notional cost $0.3199 against $0.3165, and the false deaths 29 against 22. Seed 8 takes the worst of it: 92.46 s against 64.06 s, 7.1% more cost, two more false deaths, and a duplicate call that the takeover check flags.

The ring adds heartbeats from the first death on, so message loss falls on other messages. From that point each line is two samples of one plan, not one run with one thing changed, so ten seeds do not give the size of the effect. They do show that the parameter is not free at C3. Four of the 29 false deaths came over links the ring added, and the other 25 over links of the tree.

## What it costs, and its limits

- **More false deaths.** In the 285 runs that end on both sides, false deaths go from 131 to 256, and 113 of those 125 more come from the 24 cuts of the whole bus. Span and notional cost hardly move on average (66.95 s against 67.09 s, $0.3002 against $0.3003), but one run can, as seed 8 above shows.
- **A long cut of the whole bus.** Rule 4 cannot tell a silent bus from dead peers, so a cut longer than its 30 s looks like the death of everyone. In six cells at each length, the runs end with the same flags on both sides, and the false deaths are:

  | Cut | Off | On |
  |---|---|---|
  | 20 s | 36 | 36 |
  | 35 s | 24 | 33 |
  | 60 s | 0 | 52 |
  | 120 s | 0 | 52 |

- **It does not make a run clean.** It ends the hang. With it on, 44 of the 421 runs carry takeover flags. Three of the 9 runs that stop hanging and end flagged show a `duplicate-call`, and six show the failed contract's four flags, on seed 3 four times. Of the 3 runs whose flags change, one gains a `duplicate-call`.
- **A sweep is not a proof.** It shows that none of these 421 hangs, and says nothing of a set it did not try.
- **It needs a survivor.** The sets go up to nine of the ten. With all ten dead there is nobody to act, and nothing here changes that.
- **The last resort covers the root goal only.** Any other goal whose owner has no live sibling still goes through the owner of its parent goal.
- **It has run on the fake model only.** No real run has the parameter on, so these figures say nothing of what it costs on the real model.

## Not mixed

The rows in `bench/results/headline-10`, `bench/results/rivals-gate`, `bench/results/sweeps` and `demo/` have the parameter off. The rows in `bench/results/any-survivor/` have it on or off as each row says, and no verdict of `bench/PREREG.md` reads them. The amendment in `bench/PREREG.md` §9 keeps it off in the real rows of a track lead's death.
