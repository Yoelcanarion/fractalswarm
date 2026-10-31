# The cold test by clicks

Oct 31, 2026. A fresh Sonnet agent with no repo, a step driver and six jury tasks, on a fresh clone with an empty home and no key (46 of 50 actions, 1366x768).

## The first tester's report

| Task | Result | Actions | Where it stopped |
|---|---|---|---|
| 1. Say what it does | done | 4 | "MUSE SPARK · MUSE WONDER", unexplained; who it is for is never said |
| 2. See one die | done | 7 | The caption of the first kill was off-screen and had reset to "Everything is back." |
| 3. Against a rival | done | 12 | Quoted numbers mid-count; "tie" beside 11.2 s and 21.9 s; "pre-registered basis" and "coordinator-dependency time", unexplained |
| 4. Own text | not done | 14 | "no talks could be read from the pasted text", "the program needs at least 8 talks; this has 0"; the step pills do not go back |
| 5. A thing it does worse | done | 4 | "Conditions and limits" opens a page headed "Tie.", full of codes; the loss is three screens down |
| 6. Check a run | done | 4 | Expected a Verify button; "PENDING" beside "needs no API key." |

Also: the arena plays 112 s at 1x, "Talks placed" stands at 0/48 past halfway. "Enter the app" only scrolls.

What the tester would tell a friend: "A clever, candid demo of AI agents that keep planning a conference while half their coordinators crash, including a 'where it does worse' section. But it is thick with unexplained jargon, and my own two talks got nowhere because it wants at least 8."

## How to read it

- The tester takes 10 to 20 s per step. It reads a counter mid-count and misses a timer: a person sees the first moving and meets the second in time.
- Its failed speed was "8×", which does not exist: 1, 2, 5, 10 and 20 do. The control is not broken, but the length was a real complaint.
- The stumbles with a dead end are the ones that count: task 4 first.

The fixes and their commits are in `.plans/progress.md`, under Oct 31.

## The second tester's report (59 actions)

| Task | Result | Actions | Where it stopped |
|---|---|---|---|
| 1. Say what it does | done | 5 | "In-process supervisor" and "Ideal durable supervisor", unexplained at that point; "what I get, and where my text goes" |
| 2. A result, start to finish | done | 30 | Landed on the arena at 0 / 12 with every number at zero; "Open the final run" opened a recorded run; its own run was under Runs, All 10 runs; a grid of T06, T12 under slots 0 1 5 6 |
| 3. With a change of its own | done, another change | 18 | The driver could not type in Attendance; it removed a talk; only the count proved the change was used |
| 4. Brains that died | done | from open screens | "Run 2 says 4 calls paid for again, yet Duplicated work 0 calls" |
| 5. Against a rival | done | default pair | Idle 0.0 against 67.8: the number was false |
| 6. Trust | partly | | "FAKE MODEL, SIMULATED CLOCK" on Trade-offs, nothing of the kind on the arena's results |

What the tester would tell a friend: "A free 12-talk schedule plus a rival comparison took about ten clicks, which is neat. But it shows only talk numbers, my result was hard to find, and the site itself says free runs are not real evidence: a promising demo, not proof."

## What the two tests teach

- A test that starts its own run finds what recordings cannot: the false score only exists while a run records.
- Ask of each screen what the person came for. Both testers reached the end of the job and neither was shown the product of it.
