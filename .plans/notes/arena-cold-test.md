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

## The third tester: a juror on the static site, at 3d5fb11 (57 actions)

One agent, Sonnet, with the site's address and nothing else, asked to judge it as a juror would. Its verdict: "Yes, top three."

| What it found | What it was | What was done |
|---|---|---|
| "Verify 5 listed runs" computes nothing and "just turns green"; weakest point of the site: "nothing can be run or re-verified from the page" | True: the button showed a report the build had stored | The browser now recomputes every hash of the log from the files the page shows (`web/src/lib/blake2b.ts`, `web/src/static/chain.ts`). The button says Recompute, and a row says how many hashes and how long |
| No link to the code anywhere: "I would not know where to get the app" | True | The GitHub mark in both top bars, and "get the code" in the banner. The repo opens on Nov 3, and the site goes up after it |
| New task on the site is a dead end: the form works, "Use the sample text" gives a red error naming another command | True | No form on the site: what the app does, the three steps to it, and two ways on |
| "Half its agents killed" never seen | True: the recorded runs kill five coordinators and no agent; C3, the ten-seed numbers, also kills half the agents | The end of a pair says so when the logs show it. It counts the kills in the log, so a person's own pair that kills agents does not get the sentence |
| Validity 90% with no failures, "not on the home page" | Reported in `bench/REPORT.md` §4.10.7, and nowhere on the charts | A note under the charts of that set |
| The Runs column wraps names into tall rows | True, and the seeds read 1, 10, 2, 3 | A count that opens on the names, in the order of the seeds; seeds as "1 to 10" |
| "PENDING" unexplained | S5, lifted at release by `coord\verify_all.ps1` | Nothing to do until then |
| "A tree of small coordinators" undefined; the slogan comes before a description | A matter of taste, on reviewed copy, under the 230-word limit, and the tree is drawn beside it | Left as it is |
| Counters read as they count up | A model reads faster than the animation | Not a finding |

### The check, proved by clicks

- All five shipped logs hold in Chromium and in Firefox: 30,996 events, to the head stored with each run. That is the proof that reading the page files as text gives exactly the bytes the kernel hashed, on real logs and not only on the fixture.
- Everything together takes 2.1 s in Chromium and 3.5 s in Firefox, loading the files included. The largest log takes 0.4 s and 0.8 s.
- With one digit changed in the first file of `demo-final` on its way to the browser, the row says "Hash chain broken at event 2828", in both browsers, and the four other logs still hold.
- The same is one click on the site: "Change one digit" changes the page's own copy of a log and recomputes, and "Back to the real log" restores it. All five logs break in both browsers.
- It is not a replay, and the tooltip says so. The head comes from the same site, so it shows that a log and its head agree, not who wrote them (`docs/claims.md`, S8).

## What the three tests teach

- A juror asks what a button really did. A check that looks like work and is not is worse than no button: this one became real, and was cheap.
- The way to the code is the first thing a person who likes the demo looks for.
