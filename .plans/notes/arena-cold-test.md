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

## The fourth test: a technical juror on the repository (Oct 31, at 26711d9)

A fresh agent on a clean clone with `.plans/` removed, reading the README and running what it says. "Probably yes, top three." What convinced it: `demo --verify` (19 s), all seven bundles MATCH, one changed byte gives MISMATCH, the ten-seed figures recomputed by hand from `results.csv`, 1,211 unit and 47 integration tests pass, ruff clean. What put it off: the README's evidence as a wall, and the drafts in `docs/`.

| What it said | Was it true | What changed |
|---|---|---|
| "Zero LLM tokens spent on coordination", yet the coordinators call the model to plan, judge and audit | The README never said what coordination is | It does now: takeover, routing and recovery are code; planning and judging call the model and count as work (`bench/REPORT.md` §2) |
| −1.1% against +29.2% on completed calls cannot be checked | True: the logs they came from are not committed, and the computation was a scratch script | `bench/results/headline-10/completed-calls.csv`, written from the 80 logs, and `scripts/completed_calls.py`, which prints both bases with no key. A test pins R5's four rows |
| The README says outcome B, and R2's command prints PENDING | True: the gate derives the outcome, and `headline-10` holds no gate | The README's Verify lists both commands and says why; so does R2 |
| "before the first run" | False against the 29 cells of Oct 28; true of the durable rivals, which started on Oct 29 at 17:07 | "before any run against that rival" |
| The README says PromptGuard 2 screens everything, and a plain `uv sync` falls back to regexes in silence | Worse than it said: **none of the 176 bench cells used it**. They use the pattern scanner, the bench's default, the same for every workflow; all six recorded demo and pair runs did use it, 32 scans each. The eight LangGraph cells log no scan. Both scanners allowed every input, 6,656 scans and 192, so no number moves | New row M3 with that scope, every public sentence brought to it (README, submission draft, the home's list of models), a sentence in the REPORT's §3, `--extra safety` in Run it, and a real run on an install without it now says so on stderr |
| T2, C0, C3 and `durable-max` undefined in the README | True | One line over the evidence bullets |
| S5 and S8 point at files outside the public tree (`coord/verify_all.ps1`, `.plans/`) | True, and so did three places in the REPORT, `docs/api-notes.md` and a comment in `lens.ts` | Reworded |
| S5 still "pending" | True until the release commit | Lifted there, as planned |
| `.plans/` is tracked; `C:\Users\yogar` paths in 12 files | Outside `.plans/` only `CLAUDE.md` holds one | Yoel's decision at publish |
| Placeholders in `docs/submission.md` and `docs/video-script.md` | True | Yoel's text |

**Found while checking it:** `bench verdicts bench/results/rivals-gate bench/results/sweeps --prereg` without `--json bench/results/honesty.json` overwrites the older `rivals-gate/honesty.json` and dirties the tree. The README gives the form that only prints.

**A lesson for the claims:** "every input" had passed four readings because all the runs a reader meets are the recorded ones. The bench's default never showed in a public sentence until someone asked what a plain install does. Counting the `firewall` effects per log took five seconds.
