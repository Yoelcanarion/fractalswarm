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

## The fifth test: a juror on a phone, on the static site (Oct 31, at 1e22bf7, 69 actions)

One agent, Sonnet, with the site's address at 390 x 844 and nothing else. The door nobody had walked. Its verdict: "Top three: not as it stands; yes if the repo opens." The best thing: "candour (the Tie headline, Where it does worse, the tamper test)". The weakest: the code it could not reach, and the evidence pages on a phone.

| What it found | Was it true | What changed |
|---|---|---|
| The code link is a 404 | Yes, and expected: the repo is private until the release, and the site goes up after it | Nothing |
| Evidence opened at the bottom, mid-chart | True, and at every width: all the pages share one scroller, and its action log shows it scrolled the arena and then pressed Evidence | A new path starts at the top, the window too (a run scrolls the window on a phone). `?at=` keeps the place |
| Trade-offs wider than the phone, its cards clipped | True: the per-process cards pushed the page 39 px sideways | One card to a line. The full count scrolls in its own frame |
| The Runs table wider than the phone, the check off the screen, names broken letter by letter | True: the table was 422 px wider than its box | A run is a card on a phone, each cell saying what it is |
| Tooltips stick over the page, and Escape did not close one | Half the driver: its mouse stays where it clicked. Half real: at any width a press on a button held its hint open until the next click elsewhere, and Escape only worked with the focus in the hint, against what the component said | Focus opens a hint only from the keyboard or on a `focusable` one, Escape works from the window, and a scroll closes one a thumb opened |
| The replay bar covers a third of the run | It was 150 px of 844 | Two lines, 97 px |
| The caption overlaps the chips | True: the Evidence page's frame gave the strip 270 px and it needs more with the headings over it | 400 px below 900 wide, and a test that reads the height from `home.css` and lays the strip out in it |
| The terminal clipped | True: the head hash was off the side with no sign it could be scrolled | It wraps |
| Demo nodes ~16 px, and it reset itself | The tap areas are 40 px, and it puts itself back after 16 s of nobody touching it. A model is slow | Nothing |
| A 150-word paragraph of numbers; jargon on Trade-offs; "PENDING" unexplained | R2 and R3 in their own words; a page of Details; S5, lifted at release | Nothing |

**Found while checking it, not by the tester:**
- The Security page went 190 px sideways: a bare `1fr` track grows to its widest line. It is `minmax(0, 1fr)` in all five grids of that rule, and the approved plan's three columns stack.
- The broken chain's verdict ran off the card with its number. A verdict wraps there.
- The More views menu was cut by the edge of the screen.
- `.plans/notes/arena-static-browser-check.mjs` had stopped before its end since the redesign, so nothing had read the site from end to end. It reports CLEAN again, and it now clicks Recompute, Change one digit and Back to the real log.

**Every fix checked by taps and clicks** on a scratch build, at 390 with touch and at 1366 with a mouse, and for sideways scroll at 360, 390 and 430.

**What this test teaches:** a model's slowness hides a real fault as often as it invents one. "Evidence opened at the bottom" read like a slip of the driver until its action log showed the two steps before it.

## The sixth test: a juror at a desk, full HD, on the static site (Oct 31, at 58167d6, 60 actions)

A fresh agent with no repo, eight jury tasks and a mouse, in a browser window of 1920x950 on a copy of the site served with gzip. Its verdict: top three if the repository opens, otherwise top five. Best: the candour, and the hashes a person can check. Weakest: nothing on the site can be run.

| What it found | Was it true | What changed |
|---|---|---|
| The code link is a 404 | Yes, and expected: the repo is private until the release | Nothing. Repo before site, as the release list says |
| "PENDING" beside `demo --verify` with MATCH under it | True: S5 is pending until the release commit | Nothing. It is lifted by `verify_all.ps1` at the release. The tag must be gone on the page that ships |
| The tree jumps about 20 px under the first click | True: the line said "I am under the bar" at any place above its own scroll margin, and the landing of Kill one yourself stands 19 px above that | The page moves only if the line really is under the bar. Measured at seven sizes: 0 px |
| "AI · Day 1" unexplained | True | "o2.1 (AI track, day 1)", the id the tree shows first |
| The pair's name is cut ("one ru") | True, at every width: the select stopped at 520 px and the name needs 565 | 720 px at most. It shows whole from 800 wide up; a phone already wrapped it |
| The end of the pair is a wall of three paragraphs | True | Two sentences a side and the scope. What was added for a careful reader (why 6 hand-overs for 5 coordinators, no agent killed here) is under More on this pair |
| Evidence and "The evidence" are two pages | True | Inside the app, Evidence is the tab: the arena's two links go to Charts. The home's page keeps its name |
| The same five runs listed twice | True | With the table open the short list gives way. The guide's link lands on the table alone |
| Run views leave half the window | True: at 1920x950 the page started at 248 px | The evidence strip shares the row of the run's views from 1521 wide up, so a page starts at 195 px, and each head's sentence is one line. At a laptop's width the strip keeps a row of its own |
| Trade-offs is dense jargon, with a bare × | True | "Where it holds" for "Regime map", locality has a definition on hover, and the key under the map says what N× is. "Gate" stays: it is PREREG's name. The losses are on the fake model and the page says so |
| Plan text cut at the panel's edge | No: it is the fold of a scroller with a scrollbar | Nothing |
| The popover covers the rival's title | True while open, as a menu does. Escape and a click away close it | Nothing |
| Security is nearly empty, Events opens on actor.stopped | No fault: all zeros is the result, and newest first at the end of a run is that | Nothing |
| "Run" hit an event row, the counters mid-count | The driver, and a model's pace | Nothing |

**Found while checking it, not by the tester:**
- With the guide open on a laptop, the Muse lens covered the replay bar's right half, and with the full guide it ran off the window. The committed build did it too: `menus_over` had printed FAIL there and I had read past it. Its height came from a fixed 163 px of bars. It now reads the room the page has (`lib/room.ts`, shared with the arena), and it follows the guide band as that comes and goes: clear of the bar in 14 of 15 cases at five sizes. The one left is 1280x720 with the full guide open, where 277 px of page cannot hold the drawer's floor of 320; it stays inside the window.
- The fold "What the models cost" would have left the window at 1536 once the strip moved to the middle of the row. Its width follows the window there.

**Checked by:** `desk_check.mjs` at eight window sizes, `lens_room.mjs`, `wheel_views.mjs`, `menus_over.mjs`, `phone_checks` 16 of 16, by eye at 1920x950, 1920x1080 and 1366x768.

**What this test teaches:** a tool that prints FAIL is read like any other line. The lens FAIL had been on my screen and I reported the check as passed; run the old build beside the new one before calling a FAIL new or old, and fix it either way.

## The seventh test: a juror on a laptop, on the static site (Oct 31, at b503b3a, about 70 actions)

A fresh agent with no repo, eight jury tasks and a mouse, in a window of 1536x730, the size most laptops give a browser. Its verdict: top three if the repository is public. What it valued most: a tie admitted, a page on where it does worse, and the tamper check.

| What it found | Was it true | What changed |
|---|---|---|
| The code link is a 404, in the same tab | The 404 is expected until the release. The same tab was a fault: the reader lost the page | All four links to the code open beside the page |
| The 3-step band stays on every page | True: 55 px of 730 for the whole visit, because the tester never pressed "Got it" | 37 px on a laptop. Each step is marked as it is done, and the band retires with the third |
| The Guide button grows the band to 145 px and the bar cuts the trees | True, on request, and one click closes it | Nothing |
| The hero shows nothing dying for 35 s | No: the 35 s is the run's clock. On a real clock the first death is 3.9 s after the page opens (`home_timing.mjs`) | Nothing |
| A wall of grey text on the conditions | True | R3 reads as the list it is, one clause to a line, with no word changed (`clauses`, tested by joining them back) |
| The home cites files the reader cannot open | True until the repo is public | Nothing. The release opens them |
| "How to read the map" looks dead | True: at the foot of the window it opened out of sight | Any fold a person opens comes into view (`nearest`; `reveal` still goes to the top) |
| "4 agents 1.44×" is a tie and "5.71×" a failure, unclear | Partly: the fold says why, and it was out of sight | The fold above. Nothing more: the key under the map is the rule's own |
| View tabs reshuffle after each pick | True: the row inserted the open view in the middle | Run and Results stay where they are, and the menu takes the name of the open view |
| "Takeover OK, 6 hand-overs" at t=0 | True: a verdict on the finished log, before anything has happened | On the page it waits for the end of the film. The takes keep it, because their scenes point at it (`.arena--bare`) |
| A rejection's reason cut ("booke...") | True, with no way to read the rest | It wraps |
| All zeros on Security, a popover over a heading | No fault: the first is the result, the second is a menu | Nothing |
| Numbers caught mid-count | A model's pace | Nothing |

**Found while reading it, not by the tester:** the Charts page. Its hero chart was cut by the fold at this size, and four translucent bands read as mud. It is now a dot on each mean and a bar from the lowest seed to the highest, and it fits the first screen with the guide open (788c704).

**Checked by:** `triage_check.mjs` 12 of 12 by clicks on a first visit, `phone_checks` 16 of 16, `menus_over.mjs`, `wheel_views.mjs`, web 2,732, Firefox.

**What this test teaches:** read a tester's clock. "35 s" was true of the label on the screen and false of the visitor's wait, and the check took a minute. And the band that was measured at every size with the guide open was still a cost nobody had counted, because every earlier test measured a page, not a visit.

## The eighth cold test: the README (Nov 1)

A fresh agent as a juror with ninety seconds, reading only screens of the page on a laptop and a phone, and frames of the three films. Commit 9614236 holds the fixes.

| What it said | True? | What changed |
|---|---|---|
| "Talks placed" with no task, "coordinator" defined a screen late | True | The opening says what a coordinator does and what the demo does |
| "Can a team recover without one?" One what? | True | "without a supervisor" |
| Quotation marks with no speaker | True: left over from the claims table | Gone, the words kept |
| "outcome B" of what? | True | "The outcomes were written down before any run against that rival. We got outcome B:" |
| Blast radius, dependency time, seeds, C0 and C3 | True | Each measure defined on the board, "The setting" before the pictures, "None (C0)" and "Five (C3)" on the charts |
| Stall falls under crashes: why? | True, and the report answers it | The report's sentence on noise under the chart |
| "14 of 14" against "10 seeds" | True | "The ten of the headline and four earlier ones" |
| "Every run finished" against 40 of 48 | Not a contradiction, but it read as one | The Limitations say what the bench's real crashes hit |
| "Any of them can die" against "not every set" | Allowed by S2, and it read as one | The limit is linked in the opening |
| "Coordination" zero by definition | Partly: planning does call the model | The tile names takeover, routing and recovery |
| The film's tiles against the ten-seed ties | True: one seed, in type too small to read | Cut to the boards, and "One pair is one run on one seed" under it |
| Film text unreadable, dead controls | True | The same cut, and a stacked cut for a phone |
| Setting off the screen on a phone | True, and the worst of them: a claim with no setting | The table became a list |
| Code comments past the edge | True | Comments above the commands |
| The ideal rival loses to a faster one | The result, honestly reported | Nothing |
| A green win on extra cost against "not cheaper" | The win is against one rival, for the reason given | Nothing |
| The in-process reason, three times | True | Nothing: R5 wants it next to its figures |

**What this test teaches:** a table is a layout for one width. The Setting column carried the conditions of each claim, and on a phone it was the first thing to go.
