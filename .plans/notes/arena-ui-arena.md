# W5 `ui-arena` — notes

Branch `Yoelcanarion/arena-ui-arena` (from the arena tip `52db68e`; arena `b66098b` merged in on the coordinator's
word, and arena `7e64957` on Oct 29 for W1's per-rival keys). This file is the coordinator's reference for what W5
built and which shapes it relies on. It is updated at each merge point.

## Status

| Step | State |
|---|---|
| 1. Arena `#/arena/<left>/<right>` (two stores on one clock, shared timeline, counters, caption, picker) | built; seen in a browser at 1920×1080 on the $0 reference pair and on a pair launched from the intake page (Oct 29) |
| 1b. Supervisor recovery chip on W1's `GET /api/runs/{id}/recovery` | done, tested on real report JSON, seen in a browser |
| 2. "Where it helps" panel `#/helps` on `GET /api/bench/honesty` | done, follows `docs/claims.md` after the gate, tested; seen in a browser with W1's per-rival columns |
| 3. Intake and review UI `#/new` | built (`web/src/intake`), tested on real W2 bodies; **driven end to end in a browser** (sample, practice reader, review, approve, start the arena pair) with no console error |
| 4. Ablation view `#/ablation` | built (`web/src/ablation`), tested on real W3 bodies; **seen in a browser** on a run it started itself |
| 5. Director mode `#/director/<scene>` | built and committed (`web/src/director`), 8 scene scripts, 180 tests; **seen in a browser** through the recorder, first look: see "Director mode" |
| 6. `scripts/record_scenes.*` | written and committed: PNG sequences at 1920×1080, 60 fps; an H.264 mp4 per take now that ffmpeg is on the machine (Gyan.FFmpeg 9.0.2, on PATH); six takes recorded outside the repo on Oct 31, see "The recorder slot" |

The two final T2 pairs ship in `demo/` since arena `d20f64f` (see "Round 3"); before that the arena ran on scratch
pairs made with the fake LLM at $0.

## Round 3 (Oct 31): the arena for a stranger, and the director on the two real pairs

Merged arena `d20f64f`, then `8a98acf` (W4's phone work: the pair shown whole at 390 px, "Trade-offs", the sideways tree).
The test held to is `redesign.md`'s: a person who has never heard of orchestrators understands the page and can use it, with no
explanation. HOLD was on all through: code, `tsc` and `vitest` on one worker; **no build, no server, no browser, so nothing
here has been looked at yet** (the list for the slot is at the end).

### The arena for a stranger (`web/src/arena`)

- **First look.** The lead is `FractalSwarm, on the left, and a rival, on the right, do the same job under the same
  failures, each at about the same point of the work.` (it said "while the same coordinators are killed" until the review of `8c4ae3a`: the
  two sides lose different ones; "each at about the same point of the work" came with the review of `96b24af`: the kills are points of the
  work, not of time) and, once a pair is open, a second sentence from `rivalSentence(assumptions)` (assumptions.ts), in the
  words of `docs/claims.md`: in-process "…one program runs the workers, so when it crashes they stop with it." (R5); ideal durable
  "…its workers survive a crash, and it is back after 5 s." (R2); durable; swarm; single; pipeline; a default. The assumptions pill
  under it stays always on. `#/arena` alone already opens the first public pair, which on a clean clone is the durable-max one.
- **The plain end of a pair** (`PairEnd.tsx`, text in the pure `pairEndText.ts`): a card between the boards and the scoreboard, shown
  only once both runs have played out (`!live` and the cursor at the end of each log) and never in a director frame (`bare`).
  "Both runs finished." / "Only one of the two runs finished." / "Neither run finished." (a log that stops without `run.completed` is
  "did not finish"); one or two sentences per side from its log (the swarm's lost coordinators and no call paid twice; an in-process
  supervisor's workers stopping with it each time and the calls paid again; a durable one's board pausing for the detection and
  restart time); then the scope: "This is one run of each, on one seed, under one failure plan, with the rival noticing a crash after
  X s and restarting after Y s: it shows what happened here, not what usually happens.", with links to `#/helps` (Trade-offs) and
  `#/evidence`. No sentence says who is ahead or uses simpler, cheaper, more reliable, better (a test checks those words). The
  scoreboard's note ("One pair is one run on one seed under one failure plan…") carries the same two links while the pair plays; at
  the end the card's scope replaces it (the review of `8c4ae3a`, below).
- **A way out of the load error** (`EmptyState` tone bad: Try again, Open the runs), and **Home/End** with space and the arrows
  (`keys.ts`, pure, tested).
- **390 px and 1366 px.** The verify badge moved from the head's top row to the proof row (`.side__proof`, which wraps: the chip
  and the badge side by side, or the badge under the chip, the same on both sides so the boards still start at one height). The
  chip sits in `.side__chip` and the scenes' `swarm-proof` / `rival-proof` regions are that now, so s8's tooltips still read the
  chip's `title`. At ≤700 px: less padding, the assumptions as a block, the badge's text may wrap, the end card in one column;
  the scoreboard's numbers two across, one at ≤480 px. The picker at 390 px is W4's (the whole name shown wrapped, the select
  laid over it unseen); I dropped my own picker rules in the merge. No container queries.
- **Not seen yet.** I do not know how the head, the card and the numbers look at 1920x1080, 1366x768 and 390 px, dark and light;
  the CSS is written from the rules. The run page's `?details=` addresses and the controls count of the first view are not
  checked either.

### The director on the two real pairs

- **Which pair: a parameter.** `sources.json` has the first pair (`demo-pair-durable-max-swarm` / `-rival`), `run: "demo-final"`
  for the run scenes (s4, s5), `ablation: null` and `"real": true`, in one commit. The in-process pair is the same scenes with
  `?swarm=demo-pair-central-swarm&rival=demo-pair-central-rival` (the address wins over the manifest; the recorder takes
  `--swarm`/`--rival`). One manifest and an address was simpler than two manifests, and s1, s6 and s8 run on both pairs unchanged
  (tested on both).
- **The sides do not crash at the same second**, because each plan fires at a fraction of its own run's progress. Durable pair:
  the swarm's root at 40.7 s, the rival's supervisor at 46.3 s (its runs end at 90.1 s and 111.8 s). In-process pair: 46.8 s and
  45.9 s (runs end at 119.6 s and 154.1 s). So there are two new moments, `rival-crash:N` and `rival-recovered:N` (time.ts;
  `TimeContext.rivalCrashes`, taken by the surface from the rival's own log); `crash:N` is still the swarm's (the rival's when the
  swarm has none).
- **Retimed from the real lengths** (the clip times are those of a take on the fake page and replay, which is the take's own clock
  and does not depend on the browser):

| scene | now | on the real logs |
|---|---|---|
| s1 (32 s) | from 14 s before the swarm's first crash at 1x, ring on the fallen root, `wait until rival-crash:1`, ring on the rival's board for 5 s, hold; the 0.5x slow-down is gone (the later rival crash would have outlasted it) and the replay is not paused at the end | the first crash is at 20.0 s on both pairs; the rival's board is ringed at 25.6 s on the durable pair, exactly its 5 s pause, and from 20.0 s on the in-process pair (its pause was 45.9-51.0 s of the replay, so the ring covers its last 4 s); last step at 31.1 s / 25.5 s |
| s6 (30 s) | from 5 s before the rival's first outage; rings on the rival's status and the swarm's first fallen for 5 s; 10x to the end of the longer log; the counters | the ring at 5.0 s; the end of the log at 16.4 s (111.8 s of replay) / 20.7 s (154.1 s); last step at 22.9 s / 27.2 s. 6x as before would not reach 154 s in 14 s |
| s4 (18 s) | 15x until `call-end:spark`, pause, the lens on Spark's call then Wonder's, the meter | the first Spark work call of `demo-final` is `o3.1.a1`, 50.9-52.5 s of the replay: 3.5 s of clip, and 0.8 s before the first outage (53.3 s); Wonder's root plan (2.3-33.0 s) is a finished call by then; last step at 16.5 s |
| s5 (22 s) | unchanged | o2.1 (63.5 s, heir o2.2), then o0 (53.3 s, heir o1; the root holder after 58.8 s); last step at 21.5 s |

  A scene that points at the Muse meter has its fold open (`pointsAtRegion`; the meter sits under "What the models cost" now). The
  other run-page anchors the director uses are W4's kept ones; `.counters`, `.run__grid`, `.run__side` are no scene's target.
- **Unchanged and why.** s2 is live; s3 waits for an ablation on a person's own text, so `sources.ablation` stays null and the
  scene says it needs one (the recorder reports it and goes on); s7 is "Trade-offs" with W4's unchanged `[data-helps]` anchors; s8
  and s9. No scene says anything about arbitration (no real Wonder dispute).
- **Tests.** `scenes.real.test.ts` is rewritten for the final logs: the arena scenes on both pairs (the outages and their order,
  the actors on the side they point at, every step inside the duration with no warning, s1's ring inside the rival's first outage
  with the first crash at 20 s, s6's ring at its first outage and the counters at the end of the longer log, s8 at the end) and
  the run scenes on the final run (its outages, the heirs, s4's picks against `lib/fixtures/lens-demo-final.json`, which is the
  server's `GET /api/runs/demo-final/calls` taken in-process, s4 pausing after the call and before the first outage, s5's four
  rings). The `demo/backup` tests are gone (backup is no longer a source). Hand mutants: 12 of the director step, 11 caught, the
  survivor (s4 at 25x instead of 15x) is an equivalent one: it still pauses on the first frame after the call, and the fastest
  speed the director allows (40x) cannot step over the 0.8 s to the first outage.

### For the slot (the recorder, and a look)

1. Done on Oct 31 (the next section): one scratch build and a scratch server, then shots of `#/arena` on the first pair at
   1920x1080, 1366x768 and 390 px in dark and light, at the start and at the end (the end card).
2. Done on Oct 31 (second slot, "The recorder slot" below): `s1`, `s6`, `s4`, `s8` on the durable pair, then `s1` and `s6` on the in-process
   pair. The idle seconds I predicted from the logs (s1 in-process 6.5 s, s6 durable 7 s) were wrong for s1 (no still frame at its end) and close for s6
   (5.85 s); the measured numbers are below.
3. Done: the frame-time reading with two boards at 20x (59 fps, nothing over 50 ms): see "The recorder slot".


### The look at the arena (Oct 31, the first slot: a scratch build, a scratch server, no model called)

Two passes at below-normal priority, because a paid sweep was live: `vite build --outDir` into the scratchpad (never `api/static`),
`fractalswarm serve` on 8791 with scratch runs and ledger directories and a dummy key, a static server on 5191 that passes `/api`
on, and headless Chromium. 15 pages in the first pass and 18 in the second, each a viewport shot plus the whole content area:
`#/arena` (the first pair, `demo-pair-durable-max`), its end (`?at=end`), a frame in the middle (`?t=48`) and the in-process pair's
end, at 1920x1080, 1366x768 and 390x844, dark and light, with the guide shown (first visit) and dismissed. The page was measured as
well (sideways scroll, where each board starts, what sticks out of a side, the controls in the first view). Everything closed after
each pass: ports 8791 and 5191, the browsers, `git status` and `api/static` untouched.

Seen and fixed:
- The two boards started at different heights while one side still said "Checking takeover...": a settled chip is 36 px tall and
  the pending one 29 px, so the proof row (`.side__proof`) was 3-4 px shorter on that side. The row is now as tall as a settled
  chip (`min-height: 36px`); the board tops are equal at 1920 and 1366, both themes, before and after the verdicts arrive.
- At 390 px a line broke between a number and its unit ("restarting after 5 / s", "0 / s restart" in the rival chip).
  `secondsText` (the arena's own) now joins them with a no-break space. The tests read the text with it as a plain space, and one
  more pins the character.

Seen and fine: no sideways scroll in any shot; the end card on both pairs at all three sizes (its two columns at 1920 and 1366, one
column at 390); the scoreboard (7 cards in a row at 1920, 4 and 3 at 1366, 2 columns at 390); the replay bar and its lanes; the
order at 390 (lead, Play, pair, rival chip, swarm board, rival board, card, scoreboard, replay bar); the first screen of a returning
visitor at 1366x768 (both trees and the top of the scoreboard) and at 390 (the lead, Play, the picker, the chip and the swarm's
board); the light theme at all three sizes.

Not mine, for the coordinator:
1. The first-visit guide band (W4's) is 540 of 844 px at 390, so a first visit on a phone opens on the guide and "Got it", and at
   1366x768 it pushes the boards to y=517. It is the explanation, so I left it.
2. The verify chips ("Checking takeover...", "Replaying from the log...") stay pending for several seconds when the machine is busy
   (below-normal priority beside a paid sweep). That is timing, not a layout fault.
3. The hidden bubbles of the tooltips on those chips are wider than the viewport in the measurement, but they cause no scroll.

### The review of 8c4ae3a (Oct 31): six items, and the look at them (a scratch stack, no model called)

The coordinator's review of `8c4ae3a` (three wrong statements, the first crash, the timeline), done in its order of harm. Code and
tests first (`8d56ee2` items 1-3, `2881db4` item 6), then the look after RELEASE, at below-normal priority: `fractalswarm serve` on
8791 (scratch directories, a dummy key) and a Vite dev server on 5177 that passes `/api` to it (a script of my own through Vite's
API, so the repo's config, which points at 8765, was not touched), and headless Chromium. Everything closed afterwards.

1. **The lead** says "do the same job under the same failures": the two sides lose different coordinators (the durable pair's swarm
   loses o0, o3.1, o2.1, o3.2 and o3.3, and its rival's o0 five times).
2. **One run, two costs.** The row is "Cost, pre-registered basis" once both numbers are the metrics' (`cost_usd`, which estimates
   the calls a crash cancelled) and "Cost so far" while a number is still the fold of the log, which is the spend (the run page's
   number). Where the scored number is more than the spend, a line under the card's bars says "$0.605 spent, $0.180 estimated for 27
   cancelled calls": `official.costUsd`, the fold's `costUsd` (the sum of `budget.settled`) and `official.cancelledCalls`, none of
   them typed. Nothing while the run plays, where the two agree at three decimals, or where the log holds no spend. Seen on the
   real pairs: durable swarm $0.406 (Swarm: $0.401 spent, $0.005 estimated for 2 cancelled calls), durable rival $0.455 (no line),
   in-process swarm $0.504 (no line), in-process rival $0.785 (Rival: $0.605 spent, $0.180 estimated for 27 cancelled calls). The
   tooltip says it in a sentence, and that the run page shows the spend alone.
3. **The end of a side.** Once a side has played out its status line says "Finished, lost 5 coordinators" (swarm) and "Finished,
   supervisor crashed 5 times" (rival), "Did not finish, ..." in the danger tone for a log that stops without `run.completed`; an
   outage the log never closed is still said first. `sideStatus` has a fifth parameter, `finished` (default false, so nothing else
   changed), from the shared `playedOut()` (`playedOut.ts`), which the scoreboard and the end card use as well.
4. **"Watch the first crash"** is the main action, as on the run page: both sides to 3 s before the earlier of the two first
   coordinator kills (about 37.7 s on the durable pair), played at 1x, with "Play both from the start" beside it (the main one
   where no coordinator is killed). While it plays the button is Pause and the clock (`t = 42.3 s / 111.8 s`, written per frame
   through `useClockFrame`) sits beside it; stopped midway it says Carry on. Only the playhead moves (`play.ts`, `ArenaPlay.tsx`;
   the seek comes first, because playing a clock that stands at its end starts it at 0). Seen: 4.5 s after the click the swarm
   says "o0 down for 1.5 s - not noticed yet" with its red cross, at 1366, 1920, 1280 and 390.
5. **The timeline is pinned** to the bottom of the view (`.tl { position: sticky; bottom: 0 }`, z-index `--z-sticky`, the page's
   colour as a ring so that what scrolls behind it stays out of its rounded corners), a little more compact (padding, a 36 px
   play button). To make room: the lead's `max-width` is 82ch (two lines, and the two buttons beside it instead of under it), the
   assumptions pill shares the picker row (two lines beside it at 1366), `.side`'s `min-height: 420px` is gone, and the board's
   height is capped to the window (`--arena-chrome: 552px`, floor 190 px), so the frame is drawn smaller to fit: the tree is 0.64
   of its frame's size at 1366x768 (0.76 before). Measured, page y of the sides and of the bar: 1366x768 186..576 and 591..768;
   1440x900 184..627 and 723..900; 1536x864 184..647 and 687..864; 1920x1080 184..725 and 903..1080 (the scoreboard fits above
   it); 1280x720 the boards end 7 px under the bar's top, inside the panel's padding; at a 650 px window the work bars are under
   it; the bar is not pinned under 620 px high or under 761 px wide; at 1100 px the sides stack, as before. The director's frames
   keep both as they were (`.dir__stage .board` and `.dir__stage .tl` in director.css): a frame is 1920x1080 whatever the window
   it is previewed in, and the camera pans it.
6. **Small ones.** A click on a band or a mark of the timeline only moves the playhead (the run page's way; dragging the scrubber
   still pauses); seen: still Pause after a jump. The end card gives the run page's reason beside "Lost 5 coordinators" when the
   takeover check counts more hand-overs: "The takeover check counts 7 hand-overs for those 5 coordinators: one coordinator's root
   duties and its subtree are two hand-overs, so there can be more of them than crashes." (read from the store's takeover report,
   so it shows once the check has answered). The one-run caveat is said once at the end: the end card's, which has the rival's
   setting, replaces the scoreboard's (`caveat` on `Scoreboard`; a director's frame has no end card and keeps its own). The picker
   lists the pairs that ship first and the private ones under a divider (`<optgroup label="Private, made here">`), the mark
   staying in their names because a closed select shows only the chosen option.

Not mine, for the coordinator:
1. The first-visit guide band (W4's) was 143 px at 1366x768 that morning, so a first visit had the boards half under the pinned bar until
   "Got it" was pressed. W4 has made it a short band (55 px since): see the review of `96b24af` below, which also supersedes item 5's
   thresholds, floor and numbers.
2. The chip's hover text (`describeTakeover`, lib/takeover.ts: "7 hand-overs: the heir of each, recomputed from the log, is the
   one the run used.") does not carry the reason for 5 coordinators and 7 hand-overs; the run page's Counters hint does. The end
   card has it now; a clause in that file would put it on the chip as well (outside my files, so I did not touch it).
3. `--arena-chrome` is a constant: the height of what the page keeps around the boards at 1366x768. If a bar above them grows or
   shrinks, the number moves with it.

### The review of 96b24af (Oct 31, second round): the verdict behind the bar, the laptop window, the lead

Five items, in the coordinator's order of harm. `Yoelcanarion/arena` merged in first (a fast-forward onto `1581f9f`: W4's short guide band and
`bringRunIntoView`, W7's hero, the chip's reason for more hand-overs than crashes). The look was the same scratch stack (API on 8791, a dev
server on 5177, no model), at normal priority since the coordinator freed browser passes.

1. **The verdict behind the pinned bar.** Once both runs have played out the arena carries the class `arena--played-out` (`ArenaView`,
   from the same `playedOut` the end card uses) and the bar is `position: static`: the end card sits right under the boards (1366x768:
   boards end at 606, the card starts under them) and the bar is the last thing on the page. A press on Watch, or on the bar's play,
   takes the class off and pins the bar again; a pair that plays through to its end gets it back (seen at 20x: sticky while it plays,
   static at the end). Seen on both real pairs at 1366x768 with `?at=end`: the card, its verdict and the one caveat are in the first
   view and the numbers are under them.
2. **A laptop's window.** The bar is pinned only where it fits with two boards above it: wider than 1100 px (the same 1100 as the
   stacking, and a test pins that they agree) and at least 701 px high. Narrower or shorter, the page is a page that scrolls, the
   bar at its end and the top Pause with its clock carrying the play. The board's cap lives in that window only (a stacked or short
   page has its boards whole). The room is measured, not guessed: `room.ts` writes the height of the page's scroll area, which is the
   window less the app's bars and the guide band while it is open, into `--arena-room` (a `ResizeObserver` on `.content`), so the
   band and its "Got it" move the cap with no reload (seen at 1366x768: 661 px to 716 px, the boards 364 to 400 px tall).
   `--arena-chrome` is 490 px of that room. The third line of the lead costs 20 px, so the bar gives 30 back: in a laptop window it
   is 147 px, not 177 (padding, 30 px buttons, a 20 px scrubber, 16 px marks); a director's frame keeps the 177 px it was made with
   (`.arena--bare`). Measured, boards then bar (page y), a returning visitor / a first visit with the 55 px band:
   1366x768 206..606, 621..768 / 261..625 (4 px under the bar: the panel's padding); 1440x790 196..618, 643..790 / 251..618 (clear);
   1536x864 204..667, 717..864; 1920x1080 204..745, 933..1080; 1280x720 206..570, 573..720 / 261..625 (the talks row and the foot of
   the drawing are under the bar until "Got it"); 1536x730 first visit 251..615 against a bar at 583 (the talks row is under it).
   Unpinned: 1366x650 the boards whole (0.76) and the bar at the end of the page; 1024x768 the boards stacked, 284..847 and 859..1421.
   The tree is drawn at 0.67 at 1366x768 (0.59 before the bar was tightened, 0.64 in the first round).
3. **The first kill lands on one side only.** The lead is "...do the same job under the same failures, each at about the same point of
   the work." (the failure plan's crash points are points of the work, not of time: the coordinator read the first kills at 40.7 and
   46.3 s on the durable pair and at 46.8 and 45.9 s on the in-process one; "about" because the durable pair's fourth crash fired one step
   apart in the logs). The header is three lines at 1366 (70 px, it was 50).
4. **The phone's Watch.** `bringBoardIntoView` (`play.ts`): on a phone (`PHONE_QUERY`), a press on Watch, Play both, Carry on or the
   bar's play scrolls the first board to the top of the window once the page is drawn, as `bringRunIntoView` does for the run page's
   state row, with the same reduced-motion rule. `bringRunIntoView` takes no target and is in W4's file, so the arena has its own six
   lines. Seen at 390x664: the first board goes from 414 px to 0 in the scroll area, the status line says "o0 down for 1.6 s - not
   noticed yet" and the whole tree is in view.
5. **Small ones.** The clock is shown beside the main action only where the bar is not pinned (`display: none` in a laptop window
   until the pair has played out): at 1366x650 it reads "Pause t = 42.3 s / 111.8 s" at the top, at 1366x768 only the bar has one.
   Keyboard: the main action is one `<button>` whatever it says (Watch, Pause, Carry on), so the focus stays on it when it swaps, and
   a press on the second button, which goes away, hands the focus to it (a flag and an effect in `ArenaPlay.tsx`). Seen at 1366x768
   and 1440x790: Enter on Watch leaves the focus on Pause, and Space then pauses (Carry on, the focus still on it).

Not mine, for the coordinator:
1. `bringRunIntoView()` (components/PlayAction.tsx) could take a selector and the arena could use it instead of its six lines.
2. The first-visit band is a short 55 px now, so the first visit clears the boards at 1366x768 and 1440x790. At 1280x720 and
   1536x730 the talks row (and at 1280x720 the foot of the drawing) is under the bar until "Got it", as the coordinator accepted.

### The recorder slot (Oct 31): six takes, what I watched, what changed, the frame-time reading

The coordinator gave the recorder slot after the review of `96b24af` (arena merged in first: a fast-forward onto `364a52d`). No model was called.
The takes come from my own scratch stack, not 8765: a production bundle built from my working tree into the scratchpad (never `api/static`),
a Vite preview on 5191 that passes `/api` to a scratch `fractalswarm serve` on 8791 (scratch runs and ledger directories, a dummy key), and
`RECORD_TOOLS` pointing at the scratchpad's `playwright-core@1.48.2`. ffmpeg is on this machine now (winget, Gyan.FFmpeg 9.0.2, on PATH), so
the recorder encoded each take itself (H.264, 60 fps, yuv420p, crf 12). Each take is 1920x1080 at 60 fps and took about 3.5 min per 30 s.

**Where they are** (outside the repo): `C:\Users\yogar\.fractalswarm\takes\rehearsal-1031\`
- `durable\` s1-arena-open (32 s), s6-fair-fight (30 s), s4-lens (18 s), s8-proof (10 s): the mp4, the PNG sequence in the folder of the same name
  and the sidecar `.json`, on `demo-pair-durable-max-swarm` and `-rival`;
- `central\` s1-arena-open and s6-fair-fight on `demo-pair-central-swarm` and `-rival` (the in-process rival);
- `sheets\` a 3x4 contact sheet per take (twelve frames, evenly spaced) for a quick look; `dry\` is the dry run's leftovers.
Every sidecar has `flags: []`, and every frame was captured (1920, 1800, 1080, 600, 1920, 1800).

**What I watched**, with the stillness measured on the PNGs (a frame byte-identical to the one before), not by eye:
- **s1, durable and in-process:** the title card "Same input · same models · same failures" is on over the arena at its start; the ring on both heads
  fades at 3.5 s and nothing moves until 6.0 s (a still stretch of 2.5 s, the scene's own `wait`), then the replay is put 14 s before the first crash
  and plays at 1x (the card stays on for the first second of it). The swarm's first crash is ringed on o0 exactly (durable, frame 1320 at 22 s: the
  ring is on the `o0 ✕` node, "o0 down for 2.0 s · not noticed yet", the rival's supervisor still up), then the rival's board is ringed
  ("o0 down for 2.4 s · 8 agents waiting for it" on the durable rival; "o0 down for 3.6 s · 12 workers stopped with it", every worker dot
  red, on the in-process one). The two assumptions captions at the top are never covered. No still frames at the end.
- **s6, durable:** plays to the first crash at 1x, rings the rival's status and the swarm's o0, goes to 10x; both are finished when
  the camera takes the scoreboard (ringed), then the idle-agent-seconds counter (46.3 against 62.5), then home at 24.1 s. **Still from 24.1 s to the
  end, 5.85 s.** **In-process:** the rival runs on to 154.1 s, so the same script reaches the end later; **still for 1.6 s at the end.**
- **s4, durable:** the meter's fold is open at the first frame and the totals fill in (Spark $0.0615, Wonder $0.0515, 81% of input tokens from
  the cache); the replay stops at 52.5 s (event 4698 of 8771, the "▶" shows it paused), the lens drawer opens on the Spark "Extract" call of
  o3.1.a1 (50.9 to 52.5 s, 2,973 in, 312 out, $0.0039, the model's own words legible at 1080p), then on Wonder's root plan (o0 ringed and in view),
  closes, and the meter is ringed with "Carry on" showing. No still stretch of a second anywhere. One thing to know: the drawer covers the right third of the page, so
  o3.1.a1 is under it during the first call (the drawer is the app's own, over the tree).
- **s8, durable:** see the fix below. Both tooltips are the chips' own words and legible at 1080p.

**What I changed** (both in my scope, both in this commit):
1. `web/src/director/surface.ts`, `titleOf`: it reads the words of a hint's bubble (`[role="tooltip"]` under the target) when the target has no
   `title`; `surface.test.ts` pins the order (a title on it, a title under it, the hint's words, else none). Why: W4's keyboard work turned the
   chips' native `title` into `Hint` (components/ui/Hint.tsx, `a488c11` and `75db2e4`), which has no `title`, so s8's tooltip steps found no hover
   text: the dry run said "a tooltip's target has no hover text (it began at 1.40 s)" and the first s8 take, on the committed bundle, was flagged and drew no
   tooltip (the director skips one with no words). **The static
   bundle at `48d3754` has this bug: s8 on 8765 needs a rebuild after this merge.**
2. `web/src/director/scenes/s8-proof.json`: the tooltips are on screen 3.2 s and 3.6 s (they were 2.4 s and 1.8 s: a 70-word paragraph for 1.8 s), the
   rings follow them (4.6 s and 5.0 s), and the script now ends at 9.6 s of the 10 s (it ended at 7.4 s: 2.8 s of the take was a still frame).
   The scene's length is unchanged (a test pins it). Re-recorded: no flag, 0.4 s still at the end.

**Not changed, for the coordinator** (the video script's pacing is not mine to move):
- s6 on the durable pair holds its end state 5.85 s, on the in-process pair 1.6 s. The script waits for the replay's end and then has a fixed tail, so
  the pair's length sets the hold. If the durable pair is the video's, the two scoreboard close-ups could take 1.5 s each from it; the in-process
  pair would then run about 1.4 s over its scene (a flag). I left it.
- The sidecar's `real` field is the `--real` flag (false here), while the frame says "real" through `sources.json`'s `"real": true`: the note in the
  same sidecar ("Replay of two real recorded runs") is the truth.

**The frame-time reading** (two boards at 20x, a real log played to its end; Chromium 130 headless, 1920x1080, DPR 1, the production bundle,
a fresh page per run, three runs each; software drawing and main-thread bound here, so the numbers compare pages and builds, not a GPU browser):

| page, 20x to the end of the log | wall | fps | median / p95 / max frame | frames over 50 ms | long tasks | speed got |
|---|---|---|---|---|---|---|
| arena, nothing playing (6 s) | 6 s | 60 | 16.7 / 16.8 / 17 ms | 0 | 0 | |
| arena, durable pair (111.8 s log) | 5.7-5.9 s | 59.1-59.5 | 16.7 / 16.8 / 33 ms | 0 | 0 | 19.8-20x |
| arena, in-process pair (154.1 s log) | 7.8-8.0 s | 59.6-59.9 | 16.7 / 16.8 / 33 ms | 0 | 0 | 19.7-20x |
| run page, one tree (the durable swarm) | 4.6 s | 53.0-53.5 | 16.7 / 33.3-33.4 / 50 ms | 0 to 0.4% | 1 (60-70 ms) | 19.9-20x |

Both boards move: in samples every 250 ms the left board showed 11 to 12 distinct states and the right one 13 to 14 of 22 to 23 on the durable pair
(14 and 21 to 22 of 31 to 32 on the in-process pair). The arena at 20x drops a frame now and then (59.1 to 59.9 of 60 fps), each one a single skipped frame of 33 ms at most;
nothing is over 50 ms. The run page with its one tree is the heavier page here. The scripts are in the scratchpad, not the repo (`frame_time.mjs`, `still_runs.py`, `stack.ps1 -Action preview`).

### The review of the takes (Oct 31, evening): the scoreboard that never falls back, s6 on the voice, s4 on its sentence, s1 on its order, s8 a check a line

Six items from the coordinator, on top of the s4 mail (`1fd453c`). Arena was merged in first (a fast-forward onto `d55bcd3`, with the new video script).
No model was called. The takes are in `C:\Users\yogar\.fractalswarm\takes\rehearsal-1031\durable-b\` (s1, s4, s6, s8) and `central-b\` (s6 on the
in-process pair), each with its mp4, its PNG sequence, its sidecar and a 3x4 contact sheet in `sheets\`. The old takes were not touched. Every sidecar has `flags: []`.

1. **The first card no longer falls back** (`web/src/arena/rows.ts`, `Scoreboard.tsx`). I did the fallback, not the live rule: **the idle row shows a dash until its
   side is scored.** Why: the scored rule (`bench/recovery.py`, `_idle`, the "session reading") needs the wait intervals clipped to each goal's down span, each
   agent's held spans, its lifetime and the sessions it served. `lib/recovery.ts` ports only cdt and dup (its own comment says idle is not ported), and the parity
   fixture has no prefix numbers for it. Porting it is about 150 lines and a Python run that needs a slot, which is not a small change. The row's definition says
   "Shown once the run is scored: ..." so the dash explains itself. `lib/arena.ts` is untouched (its fold of every free agent while something is down still exists;
   nothing reads it for the card now). **Reassignments:** the live row is "Contracts sent again" (a `liveLabel`, as the cost card has), the scored one "Unnecessary
   reassignments", and its definition now names the three cases. **The note** "A worker a crash stopped is not idle: see coordinator-dependency time." is under the
   idle card of a side where a crash stopped a worker, once that side is scored (the in-process rival: "Rival: ..."); the durable pair has none.
2. **s6 rings the whole board and no card.** The idle ring and its wait are gone, and a lower third in the voice's words, "Ten seeds: tied on stall time and extra
   cost", comes on when both logs have played out and stays to the last frame (durable: 16.62 s to 30.00 s; in-process: 20.90 s to 30.00 s). It covers the last 5.9 s
   you named and the seconds before them, because the board is final from there and the lower third is what keeps it from arguing with the voice.
3. **s6's camera:** the fit on the scoreboard is gone (no camera step is left in the scene), so there is no shrunken page and no dark band.
   **A consequence:** the durable take's end is one still stretch of 10.1 s (19.9 s to 30 s: the board, ringed 3.5 s, then the board with the lower third), where it was 5.85 s,
   because the idle ring and the fit were the only motion left there. The in-process take is still for 5.8 s at its end. If the tail should move, the 1x lead-in before the 10x is the
   place to give seconds to.
4. **s4:** committed earlier as `1fd453c` (Wonder's root plan, then Spark's call with the sentence, then the meter; o3.1.a1 ringed beside the drawer; the tree pane narrows
   beside an open drawer in a take, `director.css`). **The drawer's words at the pause** (replay t 59.0 s, event 5357 of 8771; o0 dead since 53.3 s, o1 holds the root):
   Spark 1.3, EFFORT LOW, WORK; "Extract track-hci/d1/extract · step 2"; "Made by o3.1.a1 (agent) · started at 52.5 s · ended at 59.0 s"; input 3,311 (2,929 cached, 88%), reasoning 507,
   output 2,396, cost $0.0111, latency 6.5 s; "Facts, next to the sentence they came from 15"; the first, `speaker:S01:availability`, "day 1: all day; day 2: all day; prefers afternoon",
   published to the board, from "E01 EMAIL Lars Sato", with AVAILABLE "I'm flexible: both days are fine, any time." and PREFERENCE "If you can, put me in the afternoon." marked.
5. **s1:** the third step is 8500 ms: the first crash is at 22.5 s and the rival's at 28.1 s, the rival's board is ringed to 31.7 s (3.6 s, it was 5), and the left's re-wire (o1 took over, o0 down 5.9 s)
   is on screen from about 28.4 s. **Decided differently: the caption and the ring moved.** With the voice reordered (the problem to about 0:11, "On the right", "On the left", "Same task, same
   models, same failures", then "Now we kill half the brains" on the crash), the lower third and the ring at 0 to 7 s were ten seconds early. Now: the arena at rest to 8.5 s (one still stretch,
   your 8500 ms), a ring on the rival's head at 11.3 s ("On the right"), on the swarm's head at 15.2 s ("On the left"), the lower third at 18.7 s to 23.0 s (on at the crash, 18.88 to 22.80 s measured). The
   times are from 74 words in 32 s; a slower voice moves them, and each is one number in `s1-arena-open.json`.
6. **s8:** the director's hover text keeps its line breaks (`.dir__tip { white-space: pre-line }`), so the rival's five checks are one a line under "Checked on the finished log:". Nothing a check says was
   shortened. **In the app:** the rival's chip is a native `title` (`RecoveryChip.tsx`) whose text already has a check a line (`lib/recovery.ts` joins them with a newline), which a browser's own tooltip
   shows as lines; no `Hint` is on that chip. The `Hint` bubble itself (`.tip__bubble`, `styles/ui.css`, not mine) wraps text and cannot break a line: `white-space: pre-line` there would let it.
   The rival's tooltip is on 4.2 s (it was 3.6) and the swarm's 2.6 s (3.2), the rings follow them; the script still ends at 9.6 s of 10.

**What I saw** (frames, by index at 60 fps): s6 durable, 12.0 s (playhead 67.5 s): both idle cards "—", "Contracts sent again" live; 17.5 s: the board ringed at full size, no dark band, the lower third on; 29.5 s: idle
46.3 / 62.5, the last frame's numbers, never lower than what was shown before. s6 in-process, 20.0 s (playhead 147.1 s): the finished swarm reads 15.9 ✓, the rival's idle is "—" and "Contracts sent again" 0 / 25; last frame: 15.9 ✓ / 0.0 ✓
with the crash note under the card, "Unnecessary reassignments" 0 / 0, the lower third on. s1: the rings and the lower third at the moments above; the first crash ringed on o0 at 22.67 s with the lower third still on.
s4 and s8 as in items 4 and 6.

**For the coordinator:** (a) the replay pill's "real cost" on the in-process pair now reads $0.6047 for the rival where the old take read $0.7846: that is `09c6427` (the frame says what the run spent), while the cost card
keeps the scored basis ($0.785, with $0.180 estimated for 27 cancelled calls). (b) The durable s6 ends in the long still stretch of item 3. (c) `tsc --noEmit` is clean and the whole web suite is
151 files, 2511 tests, green on one worker; pytest and the $0 reference comparison were not run (web only, nothing under `src/` or `scripts/refs` changed).

### s6's tail, and s5 and s7 watched against the voice (Oct 31, night)

The coordinator's short slot, after merging `445ce36` (arena fast-forwarded onto `eae3f5c` first). No model was called. Takes in
`C:\Users\yogar\.fractalswarm\takes\rehearsal-1031\`: `durable-b\` s5-recovery (22 s), s6-fair-fight (30 s), s7-where-it-helps (12 s) and `central-b\` s6-fair-fight (30 s, the
in-process pair), each with mp4, PNG sequence, sidecar (`flags: []`, recorded with `--strict`) and a contact sheet in `sheets\`. My own earlier files of those scenes were replaced; the old takes were not touched.

1. **s6's tail.** Step 6 (the wait after the two rings) went from 5000 to **11000 ms**, so the replay stays at 1x for about 15 s (durable: playhead 42.6 s to 57.7 s on the sheet, the rival's first band
   and the swarm's first takeover in it) before the ramp to 10x. I picked the number from a probe that played the scene on both real pairs with the fake clock (a throwaway vitest file, deleted):
   5000 ms ends the replay at 16.4 s (durable) and 20.7 s (in-process); 9000: 20.0 and 24.3; 10000: 20.9 and 25.2; **11000: 21.8 and 26.1, 11 of 11 steps on both**; 12000: 22.7 and 27.0, but the in-process
   script then runs 10 of 11 steps (it is longer than its scene, which `--strict` flags). So 11000 is the largest round number where both pairs hold, with the closing ring and wait (3500 ms) untouched.
   **Measured on the real takes:** durable, the lower third is on from 22.02 s to 30.00 s and the last change is at 25.32 s: **4.67 s still at the end** (the target was at most about 6.5 s). In-process: the replay ends
   inside 30 s with no flag, the lower third is on from 26.30 s, the last change is at 29.60 s (0.38 s still), so its final board and lower third are on for 3.7 s. The tests now read: both logs have played out at least 3 s
   before the clip ends, a frame later than the rival's first outage plus 11.5 s is at 10x, and what follows the closing ring (the still stretch) is 0 to 6.5 s, on either pair.
2. **s5 (`s5-recovery.json`).** What it shows, seen on the sheet and the frames: it opens on the tree after the root fell (the video script says s5 opens on the tree s4 ends on: o0 as a dead node below the tree, o1 ROOT, o2 and o3
   "adopted by o1"); o2.1 crashes and o2.2 takes it over (its two agents "adopted by o2.2"); the replay then goes back to just before the root's first death and shows it: the intact tree, "o0" ringed with its ROOT badge, dashed, then o1 takes the
   badge, o0 drops below the tree as a dead node, and o2 and o3 hang under o1 ("adopted by o1", dotted lines). **The colours hold:** a subtree keeps its colour when it is adopted (blue o1, orange o2, green o3 under the blue root).
   **What I changed** (voice at 140 wpm: "When one stops sending heartbeats" from 6.0 s, "computes the same heir" to 12.0 s, "Even the root can die" from 21.4 s): the first half runs at 0.5x until the first outage, so **the first ✕ lands at
   6.0 s** (it was 3.0 s) and the tree is slowed, as the script says, instead of a frozen frame; back to 1x at the crash, so the heir takes over 5.4 s later (11.4 s) and "heir = highest hash(goal, member)" is on from there for 3.5 s,
   through "with one rule, so there is no election" and across the jump back; the lower third comes on at 3.2 s with "Every coordinator reads the same log" (measured 3.18 s to 7.80 s); the ring on the first heir ends with the jump
   (it used to outlast the seek by 0.7 s and sit on a node of the rewound tree); the jump is to 1 s before the root's first death (was 2 s). Now: the root's ✕ at about 14.6 s, its heir ringed from about 20.1 s to 21.9 s, the script ends at 21.6 s of 22 s
   (before: 13.2 s, 18.7 s, 21.5 s). **Not matched, for you:** (a) the root's ✕ is 6.8 s before the voice says "Even the root can die"; its heir takes over 1.3 s before it. (b) The voice is about 23 to 24 s at 140 wpm for the 22 s scene.
   (c) o1, the root at that moment, crashes 2 s after o2.1 in the real run, so the first half shows a second root ✕ (not ringed) and the layout in flux for about a second when o2 takes the root at replay 69.9 s
   (nodes over each other under the overlay): that is the app's own re-layout, which I left alone. (d) The overlay sits over the right half of the status line for 3.5 s ("... 3 coordinators [overlay] crashed so far").
   `scenes.real.test.ts` has a new s5 test for the moments above.
3. **s7: the table was never open.** The scene pointed the camera at `table`, but the table (wins, ties and losses) is under "The full count", closed on the page, so the take never showed it and the `table` and `process` cameras
   gave the same view (a 4.4 s still tail). `HelpsPage` already had an `unfold` prop for exactly this ("for a director's scene that points at the table"); the director did not use it. **Fix** (mine): `HelpsStageView` takes `tableOpen`, and
   `DirectorPage` gives it `pointsAtRegion(scene, "table")`, the same way `meterOpen` works for s4; `scenes.test.ts` pins that for s7 and no other scene. **The scene now** follows the voice (140 wpm): a ring on the regime map at 0.4 s to 4.4 s
   ("helps when a supervisor is slow to restart": the green dots in the restart rows); at 4.7 s the camera and a ring on the opened table to 6.9 s ("ties": the line "All H1 to H6" reads 42 / 141 / 33 against the ideal durable supervisor); at 6.9 s the
   camera and a ring on the per-process line to 9.9 s ("loses": "Time to recover 47.3 s against 5 s, Supervisor lower", the one red card); at 9.9 s the camera back to the top and a ring on the outcome to 11.9 s ("false alarms": its last
   sentence, "The swarm's failure detector also produces false deaths (1.25-2.25 per run at C2-C3), the supervisors none", is legible at 1080p). No still stretch of a second (last change at 11.88 s of 12), flags `[]`. **Not done:** "a fast external restart"
   is the red row of the regime map, which has no region to ring (rows are not in the closed table), so the per-process line stands in for it; a region for the row would be one `data-helps` attribute in `RegimeMap.tsx` (not mine) and one entry in `targets.ts`.
   `scenes.real.test.ts` has a new s7 test (the four rings at the voice's moments, the script inside the scene).

**Tests:** `tsc --noEmit` clean; the whole web suite is 151 files, 2530 tests, green on one worker (the director's ten files: 232). pytest and the $0 reference comparison were not run (web only).

### Nine items from the review of the seven takes (Oct 31, night)

Arena fast-forwarded onto `275b695` first. No model was called. Takes in `C:\Users\yogar\.fractalswarm\takes\rehearsal-1031\durable-c\` (new folder; the older ones are untouched): s1, s4, s5, s6, s7, s8 on the
durable pair, mp4 + PNG sequence + sidecar each, all recorded with `--strict` (`flags: []`), contact sheets in `sheets\`. The strict dry run on the six was clean first. No s6 on the in-process pair was recorded.

1. **s5 runs forward only, and the camera fit is gone.** One seek (`crash:2-3s`), 0.5x to the second outage (**o2.1's ✕ at 6.00 s**, frame 360), then 0.25x with the ring on it; the overlay "heir = highest hash(goal, member)" at 9.5 s for 4.5 s; `wait until crash:3`
   (the root's ✕ at **14.13 s**, frame 848: the first word of "Even the root can die" is at 14.14); back to 1x with the ring on o1; `recovered:2` (68.9 s) at 17.5 s rings the first heir for 1.1 s; the root's ring from 18.55 s to 21.55 s; paused at 21.55 s of 22.
   **Done differently:** the last wait is `recovered:3-950ms`, not `recovered:3`. In `demo-final` the second outage of o1 ends at 70.9 s (its second adoption, o3 taking track-data), one second after the root moved to o2 at 69.9 s,
   so `recovered:3` would ring the new root at 19.5 s with 2.5 s left; at 18.55 s the ring is on the badge as it has moved, and `$root` is o2 from 69.92 s (a test pins it). The lower third is 3.18 to 7.80 s as before. The tree is at its own size, nothing cut at the edges.
2. **s4 no longer holds a frozen glide.** `speed 25, play, wait until recovered:1-500ms, speed 1, wait until call-end:spark, wait 300, pause`. **Done differently:** `-500ms`, not `-300ms`. At 25x a frame is 0.42 s of replay, so the first frame at or after `recovered:1-300ms`
   can land up to 0.12 s past the adoption (58.78 s) and the glide would have 0.42 s at 1x before the pause, under its 450 ms; at `-500ms` the landing is always before it (58.28 to 58.70 s) and the glide has at least 0.52 s. The pause is at replay 59.3 s whatever the
   landing; in the clip it is **3.0 to 3.35 s** by the frame grid, measured **about 3.3 s** (the clock reads 59.3 s / event 5361 from frame 196), and the lens steps are exact offsets from it. The fit on `lens-call` now includes the card of o3.1.a1 (mid-tree, at the left): the zoom is
   lower than before but the email is still the size of the page's own text, "Hi all, Thanks for accepting ..." and the two marked sentences read at 1080p (frame 660).
3. **s4's voice, from the pause (t = 0 at the pause):** Wonder's lens and its ring 2.0 s; Spark's call and the ring on o3.1.a1 3.3 s; the camera fit with no ring 4.95 s; the ring on the sentence 2.6 s (to 16.0 s of the clip, on "and the sentence behind the decision" 13.3 to 15.9);
   camera home, the lens closed, the ring on the meter 2.4 s (to 18.4 s). The scene is 19 s. Pinned in `scenes.real.test.ts` to 40 ms of the pause.
4. **s6's guard.** A scene may say `"rival": "durable-max"` (`scene.rival`, a system kind, arena scenes only). The page compares it with the rival's own `run.started` scenario (`controller.rival()`, read with `systemKind`) and a take against another rival gets a warning
   in `window.__director.warnings`, which `flagsOf` turns into a flag, as it does for a real take with no cost: "written for the ideal durable supervisor (durable-max), but the rival run is the in-process supervisor (central)". `--strict` refuses it (and its help line says so).
   **Checked:** s6 on `demo-pair-central-*` with `--dry --strict` flags it and exits 1; s1 on the same pair is clean (no `rival` on s1: the script says Yoel may pick the in-process rival for s1). s6 on the durable pair is clean.
5. **s8:** the supervisor's report first (camera, ring and its tooltip from 1.4 s to 6.1 s), then the swarm: camera at 6.1 s, ring to the end, **its tooltip from 7.5 s to 11.9 s**, which is "recomputed from the log, is the one the run used" over "a checker recomputes every heir" (8.1 to 11.6 s). One tooltip at a time.
6. **s7: no camera, four rings.** Restart or failover time 0.3 to 4.7 s, Gate · T2 conference to 7.3 s, Fast external restart to 10.0 s, the outcome box to 13.0 s. Three regions in `targets.ts` (`restart-row`, `gate-row`, `fast-restart-row`) by a `data-helps="row:<axis>:<task>"` on
   each `.map__row` in `RegimeMap.tsx`; a test over the real sample pins that each finds one row with the title the voice says. **Taken out:** `HelpsStageView`'s `tableOpen`, the `DirectorPage` wiring and its test. **Left, because `helps/` is not mine:** the `unfold` prop of
   `HelpsPage` and `WhereItHelps` (and the test that pins it): nothing in the director uses it now. The first screen holds all three rows and the outcome box; the last row of the map ("Coordination density") is cut by the frame's bottom, below the rings.
7. **s1 moves from its first frame:** one seek to `crash:1-22.5s`, then play; the crash is still at 22.5 s (**frame 1351 = 22.52 s**); the rival's board is ringed 2.0 to 6.9 s; the rings on the heads at 11.3 s and 15.2 s and the lower third at 18.7 s are as before (the lower third is on 18.88 to 22.80 s measured).
8. **Lengths:** s1 33, s4 19, s5 22, s6 31, s7 13, s8 12, as the slots say; s9's scene stays a 10 s title card (its slot is 18 s with the terminal capture, which is not a scene). The extra second of s6 sits in the still tail (its steps are the ones of the last round).
9. **Small:** the ring takes the ROOT badge in (`selectorsOf` adds `.react-flow__node[data-id=...] .actor__duty` to a no-side actor target: the badge is outside the card's box); the statement overlay is a solid box (`var(--surface-1)`) and, on the run page, sits in the strip's empty middle at 32 px
   (x 668 to 1250, y 40 to 96), clear of the state line, which now reads whole: "Replaying: at 64.5 s of 121.2 s, 0 of 48 talks placed, 2 coordinators crashed so far."

**What I saw, against the voice at 140 wpm** (frames at 60 fps): **s1** the arena is moving from frame 1 (the clock and the cost counters), the ring on the rival's board while the voice says "on one coordinator ... checks the work", the heads at "On the right" and "On the left", the lower third on
"Same task, same models, same failures", the root's ✕ with its ring on "Now we kill half the brains", the rival's band and its ring at 28.1 s on "a standby takes over". **Not fixed, for you:** the boards themselves stand still from 8.4 s to 11.27 s (the run is quiet there: 26.6 to 29.5 s of the swarm's log; the clock, the playhead and the rings
move); everything else in the first 11 s changes. Starting the replay earlier and faster (for example `seek start` at about 1.8x to the crash) would show the tree being built, but the order was one seek to `crash:1-22.5s`. **s4** the lens on Wonder at 3.3 s, Spark's call at 5.3 s with the ring on o3.1.a1, the fit on the call at 8.5 s
(model, effort, tokens and cost on screen on "the model, the tokens, the cost"), the ring on the two marked sentences from 13.5 s, the meter from 16.1 s. **s5** ✕ on o2.1 at 6.00 s with its ring ("stops sending heartbeats"), the creeping replay under the overlay, the root's ✕ and its ring including the badge at 14.13 s, the first heir's adoption at 17.5 s,
the root's badge on o2 inside its ring at 18.55 s, still from 21.55 s. **s6** as last round (the ring on the rival's status at 5.0 s, 1x to 16 s, 10x, the board at its end at about 21.2 s) and the lower third on from 22.0 s, **one second after the voice has said "tied ... extra cost" (16.3 to 21.0 s)**; if you want it with the voice it
would have to come on at 16 s over the running board, and the scene's step order would change. **s7** each ring on its row with the voice, the outcome box ringed from 10.0 s on "false alarms". **s8** the supervisor's checks while "replays bit for bit from a hash-chained log" is said, the swarm's chip from 7.5 s.

**Tests:** `tsc --noEmit` clean; the whole web suite is 151 files, 2541 tests, green on one worker (the director's ten files: 243). New: the scene's `rival` (parse, the unit `rivalProblems`, `controller.rival()` on a durable and an in-process log, the scenes that carry it), the row regions on the real sample, the ROOT badge in the ring, the statement's CSS,
and the pins of s1, s4, s5, s7, s8 in `scenes.real.test.ts` (s4 and s5 to the second of the voice; s5 never moves the replay back). pytest and the $0 reference comparison: not run (web only; `scripts/record_scenes.mjs` changed one help line).

### The closing card, the blink on the cut to s5, and the candidate takes (Oct 31)

Arena fast-forwarded onto `9b89dc9` first (S6's limitation on s5, the colour fix `f70db44`). No model was called. Takes in `C:\Users\yogar\.fractalswarm\takes\candidate-1031\` (new folder): s1, s4, s5, s6, s7, s8 and s9 on the durable pair (the manifest's, `demo-final` for the run scenes), each
mp4 + PNG sequence + sidecar, all recorded with `--strict` (`flags: []`); contact sheets in `sheets\` (and two strips of s5 around the root's hand-over). The strict dry run on the seven was clean first.

1. **The closing card.** `s9-close.json` now says the tagline as the title in two lines, broken after "brains." (`"Kill half the brains.\nIt still finishes."`, and `.dir__card-title { white-space: pre-line }`), then three lines under it, a line each:
   `FractalSwarm`, `Built on Muse Spark, Muse Wonder and Llama PromptGuard 2`, `github.com/Yoelcanarion/fractalswarm`. **Seen at full size** (frame 300): the title is 96 px, "Kill half the brains." from x 515 to 1402 and "It still finishes." under it, centred; the built-on line is
   one line from x 318 to 1602 of 1920 (it does not wrap at "Llama"); the block is centred on the frame (y 305 to 780); nothing moves for the 10 s (frame 0 and frame 300 are identical). `scenes.test.ts` still finds every card line in `docs/video-script.md` (the tagline in its title card
   line, the name and the built-on line in the one under it, the address) and now pins the card to these four texts; `director.ui.test.ts` pins the title's line break in the markup and the `pre-line` in the css. "FractalSwarm" is set as the other lines are (secondary colour, `--fs-display`): the order was yours and I did not restyle it.
2. **The blink on the cut from s4 to s5: fixed on the page, not in the recorder, for every scene that opens on a seek.** Cause: the first seek of a scene was made at the take's first frame, so the page's first paint was the state at t = 0 and the cards changed colour over the first 15 frames
   (o1's border from blue to white, the crossed o0 from white to red). The driver already holds the take for a pre-roll of 45 frames (0.75 s of the take's own clock, which is what the page's animations run on in a recording) so that what animates on its own settles; the seek was only made after it.
   **Now `Take.restart()` makes the seeks the scene opens with** (`Program.opening()`: the `seek` steps at the very start, once; the first frame goes on from the step after them) before the pre-roll, so the pre-roll settles on the picture they lead to and the first frame is that picture. The recorder needs no change (its pre-roll loop already runs
   those frames; a wait of 300 ms in real time would not have moved anything, because a recording's transitions follow the virtual clock). It is general: s1, s5, s6 and s8 open on a seek; the key `r` of the preview starts over the same way.
   **Measured on s5, frame 0 against frame 30** (`frame_diff`, mean absolute difference over the frame, 0 to 255): **0.1067 before, 0.0246 now.** The largest change of a pixel over frames 1 to 30 against frame 0: the o1 card's border **92 (top) and 94 (right) before, 0 and 4 now**; the crossed o0 **76 before, 0 now**; the ROOT badge 3 before, 0 now. What is left in frame 0 against 30 is the dashes of the moving lines, the
   state line ("at 60.5 s ...") and the timeline's clock, which should move. In s1, s6 and s8 the numbers are the same before and after (0.0331, 0.150, and s8's 10.98 is the camera's own move): the arena's boards had no first-frame transition, so nothing changed there.
   **For you, about the cut itself:** s4 ends at replay 59.3 s and s5 starts at 60.5 s (`crash:2-3s`). The tree is the same on both sides, with one difference on the card the eye is on: the crossed o0 chip is pulsing on the last frames of s4 (on its last frame it is at the dim end of the pulse) and is steady from s5's first frame. I put it down to the "suspected" pulse
   (`.actor--suspected`, 0.9 s) that ends when the detector declares o0 dead, somewhere between those two replay times; I did not check the log for it. At the cut it shows as a pop of brightness on one small chip, not as an animation over frames. I left it: starting s5 where s4 stops (59.3 s) would move its first ✕ off the voice's 6.0 s unless its speed changed too.
3. **What I saw in the candidate takes.** **s5, the o3 flash: gone.** Frame by frame over 1100 to 1139 (the root's hand-over) o3, o3.1 and o3.2 stay green on every frame and keep "adopted by o2"; in `durable-c` the same frames show the whole o3 subtree turn orange. o1.1 and o1.2 turn from blue to green when o3 adopts them (the app's rule: the colour is the subtree the actor belongs to). **The lower third's new sentence is on one line**
   ("Shared log, not shared brain. The log is a central component.", frame 300: the box from x 97 to 1088, 991 px of its 1280 max). The root's ring includes the ROOT badge (frame 1200). s1, s4, s6, s7, s8: the sheets match the ones of `durable-c` (the moments, the rings, the lower thirds); nothing regressed with the merge.

**Tests:** `tsc --noEmit` clean; the whole web suite is 151 files, 2548 tests, green on one worker (the director's ten files: 249). New: `Program.opening()` (two), `Take.restart()` with and without an opening seek (two), the title's line break and css (one), the s9 card (one). pytest and the $0 reference comparison: not run (web only).

### The first card counts live what is scored (Oct 31)

Arena fast-forwarded onto `82e28eb` first. No model was called: the Python side is `bench/recovery.py analyze()` on prefixes of the logs, read-only ($0, no run; the slot was given for it).

1. **The port.** `web/src/lib/recovery.ts` now carries `idle_agent_s`, the primary reading too (`_idle`, `_held`, `_lifetimes` and `serves` in `analyze`; the own and wide readings are not used by the card). Per outage, each wait interval is cut to the down span of its goal. Per agent that served a session (the assignee of a contract when it is created, or of a dispatch of it), the waits of its sessions are cut to the agent's lifetime (its spawn to its stop, else the end of the run), the spans in which it holds an attempt are taken out (a dispatch to the result it sends, or to its stop), and what is left, merged, is its idle time. The figure is the sum over agents and outages: `Recovery.idleMs`, read with `recoveryAt(rows)` like the other two. `Recovery.crashStopped` says whether a crash has stopped workers *so far* (it was a scan over every event of the log, per frame, in `Scoreboard`).
2. **The playhead is no longer an input.** Every interval ends at an event, so the end of the run (where an outage, an agent's life or an attempt that is still going ends) cuts none of them: the figures are a function of the kept events alone. `recoveryAt(rows, playhead?)` keeps the argument for its callers and ignores it (a test reads the same log at 60 s and at an hour). The result is kept per `Recorded` (a `WeakMap`): **a frame that brings no new kept event costs a lookup; a frame that brings some costs one analysis of the kept log.** It no longer keeps the whole `Log` (it held it for the per-frame outage pass), so a snapshot the scrubber holds is a handful of numbers.
3. **Parity.** `lib/fixtures/recovery-official.json` has `idle_prefixes` (`[events, idle_ms]`, from `analyze()` on the first `events` events: 1979 points over nine logs, 181 to 238 a log, thick where something happens: the faults, the hand-overs, the stops, and the events that end a wait) and, new, the five logs the site ships (`demo/final` and the four `demo/pair-*`) with the fields the others have. The generator checked first that `analyze()` still gives every number the fixture already held (the whole-log figures and every stored prefix): it does, nothing moved under the old numbers. `arena.parity.test.ts` (103 tests) checks on each log that the idle figure at the last event is the scored one **to the millisecond**, and every stored prefix is `analyze()` of that prefix and never steps back.
   **At the end of each log, port = scored: final 16.622 s, backup 9.438, durable pair 46.250 (swarm) and 62.498 (rival), central pair 15.906 and 0.000; the three Phase 1 logs too (swarm-c3 26.564, central 0, pipeline 0).** Besides the fixture, a scratch sweep (not in the repo): the port against `analyze()` at every 5th prefix of the nine logs, **11,728 prefixes, 0 different, 0 steps back**. A mutation check on the port (scratch): six mutants (the held spans ignored, the lifetime ignored, a contract's assignee not counted as serving, a wait not cut to the down span, one outage only, an attempt that ends at its dispatch) each make 4 to 10 of the 146 tests of the three files fail.
4. **The card.** `rows.ts`: the idle row is `live: seconds(idleMs)`; its label and its sentence are the ones it had ("Idle agent-seconds", "Agent time spent idle because the coordinator they answer to was down."), and the `liveNote` that explained the dash is gone. `Scoreboard.tsx` reads `idleMs` and `crashStopped` from the same cached analysis as the counters. A side's number moves when a wait ends (the dependency card's rule), and the last frame is the scored number, so there is no count-up at the end and no fallback. In a window at 20x on the durable pair (a probe through the page, every 250 ms): 0.0 / 0.0 until the rival's first wait ends, then 15.3 → 25.2 → 26.9 → 41.5 → 62.5 for the rival and 12.8 → 21.5 → 46.3 for the swarm, to the ✓ at 46.3 and 62.5; no console error.
5. **The in-process rival** (the central pair). A crash stops its workers, so its scored idle is 0.000 and so is the live number, from the first frame to the last: a worker that is gone is not idle. The line under the number, "A worker a crash stopped is not idle: see coordinator-dependency time.", used to wait for the scored number; it now shows as soon as a crash has stopped a worker of that side (`note` decides for itself, and `crashStopped` is "so far"), so the 0.0 is never on the card without it. In the window: the note is absent at t = 37.3 s, there at 48.3 s (once the crash has stopped the rival's workers) and stays to the end; the swarm of that pair reads 0.0 → 1.4 → 15.9 ✓. **The definition is unchanged** (it is true: it is what the swarm's number is) and the line is the part of it the rival's number leaves out; I did not reword either, and the rival's 0.0 is not shown as an advantage by anything but the number.
6. **Frame times, two boards at 20x** (headless Chromium 1920×1080, the scratch stack, `frame_time.mjs`, three reps a case; the coordinator's last reading was 59 fps, p95 16.8 ms):

   | case | before (earlier today, the tree at `82e28eb`) | after (this change) |
   |---|---|---|
   | arena-durable | 54.9 to 55.4 fps, median 16.7, p95 33.3 ms | 58.2 to 59.0 fps, median 16.7, p95 16.8 ms |
   | arena-central | 54.8 to 55.9 fps, median 16.7, p95 33.3 ms | 59.4 to 59.6 fps, median 16.7, p95 16.7 to 16.8 ms |
   | idle-arena | 60 fps, p95 16.7 to 16.8 ms | 60 fps, p95 16.7 ms |

   No long task and no frame over 50 ms in any rep, either side. The "before" was taken earlier the same day while other sessions' python processes were up; I did not build the old tree again to measure it, so I do not credit the change with the 55 to 59: the reading to take is that **the change costs no frames: with it, both pairs are at your last reading.** What it costs, measured where it can be isolated: one analysis of the whole kept log is **0.6 to 0.8 ms in steady state on the shipped logs (1.4 ms on the 14k-event Phase 1 log; the first, cold call in a fresh process 6 to 14 ms, once; measured in node, not in the page)**, against a 16.7 ms frame; and the board's counters read every 20 events through a log (offline, `counters_probe.ts`) cost a mean 0.05 ms before and after (p95 0.22 to 0.33 ms before, 0.27 to 0.51 ms after; the one log where the mean moved is the central rival's, 0.14 to 0.19 ms). So the fold is **not incremental**: an incremental one would save under 1 ms on the frames that carry events and would be a second implementation of what `analyze()` does, which is what the parity test pins. Say if you want it anyway.
7. **The older fold is gone (the coordinator's order, second commit).** `lib/arena.ts` (W4's) no longer folds the display count of the free agents under a coordinator that is out: `ArenaState.idleAgentMs`, `idleNow` and `lastTs` (read only by that fold), `ArenaCounters.idleAgentMs` and `idleAgentsNow`, `idleAgents()` and its helpers. The comment of the file says where the idle agent-seconds are now (`recoveryAt(...).idleMs`). Its tests went with it: five of `arena.test.ts`, two of `arena.real.test.ts`, the old-fold case of each of the first four logs in `arena.parity.test.ts`; the false-death test stays, on the fact that is not about idle (no coordinator crash is counted). The scored idle figure of every log stays pinned by the parity test (end of the log to the millisecond, and every stored prefix). **Every other counter is as it was:** a probe of `arenaCounters` (every field but those two), the outage windows, the contracts sent again, the lost work and the recovery figures, at about 120 prefixes of each of the nine logs and at three playheads for each (3,351 readings), is byte for byte the same before and after. `foldArena` keeps its third argument, unused now (`_after`), because its one caller is `reducer.ts`, outside the grant: dropping it is a one-token change there. `lib/recovery.test.ts` (new `describe("idle agent-seconds")`, 8 tests) was outside my first list; the coordinator said it is fine.
8. **The takes.** s1 and s6 recorded again on the durable pair into `candidate-1031` (the two folders, mp4 and json replaced; `sheets\s1-arena-open.png` and `sheets\s6-fair-fight.png` redrawn), from the scratch build with this change, `--strict`, `flags: []`, every frame captured (s1 1980 frames = 33 s, s6 1860 frames = 31 s). The strict dry run of both was clean first. **s1:** the first card reads 0.0 and 0.0 from the first frame to the last (t = 51.2 s). The first wait to end in this pair (the rival's) lands between 51.2 and 52.7 s, just after the scene's last frame, so the dash became a live zero, the same as the dependency card beside it, which reads 0.0 s in the same frames under the banner "9 agents waiting for it". That is the rule (a wait counts once it has ended) and it is true at the last event, but on s1's last frame it reads as "nothing idle" next to a banner saying nine agents wait. The coordinator said to leave s1 as it is. **s6:** the board settles on **idle 46.3 s / 62.5 s, time to recover 6.1 s / 5.0 s, coordinator-dependency 23.1 s / 31.2 s, cost $0.406 / $0.455, duplicated work 5 / 4 calls, 0 / 0 reassignments and violations** (the scored numbers of the pair), and the lower third "Ten seeds: tied on stall time and extra cost" is over the timeline in the last frames. **On the voice's tie:** this one seed does not read as a tie (idle and dependency are 0.74 of the rival's for the swarm; time to recover is 1.1 s longer for the swarm; cost is lower), and the lower third does not say it does: it speaks of ten seeds and names stall time and extra cost, which `docs/claims.md` R2 and R6 allow, the line under the cards says one pair is one seed and nothing more, and R4's own ten-seed ratio for idle is 0.70 and "a tie, the seeds disagree". The idle card is now the one that leans most to the swarm on that seed, and a viewer will see it; the caption does not claim it. **No ring was added to the idle card**; the scene's own highlight (the scoreboard region) is unchanged.

**Tests:** `tsc --noEmit` clean; the whole web suite is 151 files, 2609 tests, green on one worker (2548 before the first commit, 2620 with it, and 11 fewer once the older fold's tests were gone). New: the idle port (8 in `recovery.test.ts`: the free agents of a session that waited, nothing when no outage held anything up, a busy agent not counted, counted only while alive, only the agents that served the session, the playhead ignored, `crashStopped` so far, one analysis per change of the log), the card (3 in `rows.test.ts`: idle counted as scored, a busy or crash-stopped agent not counted, the note live), the parity cases (five logs, the end-of-log idle to the millisecond, the prefixes). pytest and the $0 reference comparison: not run (web only; the generator and the sweep are scratch and call `analyze()` read-only).

### s7's lower third on the right (Oct 31)

Arena fast-forwarded onto `ee5e9f8` first. s7 was recorded on it, and the frames showed the lower third over a ringed row; the coordinator said to move it to the right.

1. **What I measured on that take** (the mp4, pixel by pixel: the ring's blue at x 960 and the lower third's bar at x 99). Rings: the restart row 0.38 to 2.87 s, the gate row 5.28 to 7.18 s, the fast restart row 7.38 to 10.20 s, the outcome box 10.38 to 12.87 s (the scene's 0.3 to 3.0, 5.2 to 7.3, 7.3 to 10.3 and 10.3 to 13.0 s, less the 160 ms fades). The lower third is at full strength from 3.3 to 7.5 s and gone at 7.8 s. At the left (`left: 96px; bottom: 72px`) it is x 96 to 1085, y 913 to 1008, which is the "Fast external restart" row (its ring is y 890 to 1015): the row's chips, its description and most of its label are behind it from 3.0 s, and for 0.5 s (7.3 to 7.8 s) the voice is on that row, ringed, with the chips under the third. The gate ring (y 427 to 546) and the restart ring (y 780 to 905) never meet it.
2. **The change.** A `caption` step takes an optional `align: "left" | "right"` (`script.ts`; the default is `"left"`, so every other scene is as it was, and a lower third's class stays `dir__lower`). `"right"` is for a lower third only: an overlay is centred, and a scene that gives one a side is refused, with the path. `Caption.align` (`overlay.ts`), passed on by `take.ts`; `OverlayLayer.tsx` adds `dir__lower--right` (`left: auto; right: 96px`, `director.css`); `s7-where-it-helps.json` says `"align": "right"` on its one caption. The third is then x about 835 to 1824, the same height and size: the right half of every row of the regime map is empty background at that height (the chips end at x 540), and the fast ring's outline (y 890 and 1014, x 35 and 1885) stays in view round it, so on every frame from 3.0 to 7.8 s it hides nothing.
3. **Tests.** Three new: the step's reading (the default, the right, an overlay with a side refused, a side that is not one), the rendered class and the stylesheet's seat for it, and s7's caption being on the right (`scenes.real.test.ts`). The two expectations and the two caption literals that spell a caption out in `director.test.ts` carry the new field. `tsc --noEmit` clean; the whole web suite is 151 files, 2614 tests, green on one worker, every suite read from the JSON report (no file without tests, none skipped or todo). pytest and the $0 reference comparison: not run (web only).

## Design

The arena layout, the board and the director's design ran under `/hard-task`. The decisions that are not obvious
from the code:

- **One clock, two stores.** `createPairSession` (session.ts) makes both stores from `createRunStore()` and aligns
  them at `run.started`, so one scrubber and one speed control move both boards. The swarm is always on the left.
- **SVG boards, not DOM.** `ArenaBoard` lays the tree out in `board.ts` (pure, tested) and draws it as SVG, so a
  screenshot at 1920×1080 is the same on every machine. Agents are dots under the coordinator they answer to; a
  rival's workers are dots under its supervisor.
- **Live counters on W4's fold, official numbers at the end.** `Scoreboard` counts from each log up to the
  playhead with W4's `Stat`; a ✓ marks a number that `GET /api/runs/{id}/metrics` has scored, which is where the
  count ends up. The caption under the strip says so.
- **The assumptions caption is always visible** (`assumptions.ts`, from the run params of both logs).
- **The root tag** is on whoever holds the `root` key: the reducer's `rootHolder` (W4's, lib/reducer.ts). Until W4's
  merge on Oct 29 (ea40fa0) it counted the `board` and `net` actors (spawned without a parent, like the root) and
  ignored a real root takeover, which is an `ownership.remapped` of the key `root` with no `duties`, so the arena had
  its own `rootOf`; W4 fixed the reducer, my function and its callers (the board, the director's `$root`) are gone and
  my tests of the tag now run on `rootHolder`.

## The panel `#/helps`

Reads `GET /api/bench/honesty` (W1's route, `bench/results/honesty.json` as committed) and nothing else:

- **No bundled fallback and no "Sample data" chip** (coordinator, msg_e0f80ba4c62f): a 404 is a plain empty state
  that names the file and the command that writes it; a failed request, or a file this panel cannot read, says so
  with the reason. The 360 KB `fixtures/honesty.sample.json` is a vitest fixture only; the app does not import it.
  It is W1's regenerated file at 48601df (with the per-rival keys); re-sync it when 38bad89 is in arena.
- **Every number comes from the file; the panel adds nothing up.** The per-rival "All H1 to H6" row and the
  "locality holds at 7 settings, ties at 18 and fails at 2" line are shown from `tally_by_rival` and
  `locality_by_rival` (W1, 48601df), and only when the file has them. The committed file in arena (code 3e723a8)
  does not have them yet, so the panel shows no totals until W1's 38bad89 merges. Counts that are not whole numbers
  are refused with their path (a loss that read as 0 would be a loss hidden; the real file has none).
- **Axes are named as `bench/PREREG.md` §5 names the assumption each checks:** Failure detection, Restart or
  failover time, Fast external restart, Coordination density, Width; the default point is "the gate".
- **Every row names its failure model** (`models.ts`): a "Per crash" tag on the outcome, the head of the map, each
  map row ("Per crash · 5 crashes (C3)" for a sweep), the head of the table, each hypothesis row and the total, and
  a "Per process" tag on the per-process section. The tag's hint says what the model is (PREREG §6).
- **The regime map is a matrix of strips**, one row per axis and one cell per setting, because the data are 1-D
  sweeps from the default point and two assumptions are never varied together (like W1's `regime.png`). A cell is
  a shape (filled holds, hollow ties, a cross fails) plus the cdt ratio, so it never rests on colour; the heavy
  outline marks the cells that decide the outcome (the gate's default settings and the plausible region).
- **Losses are not hidden:** each count is a button that lists the settings behind it; the per-process loss on time
  to recover is drawn as a loss in its own section.
- **Claims follow `docs/claims.md`** (`claims.ts` is generated from its cells; `claims.test.ts` holds the two
  together, so a status the file changes fails the test until `claims.ts` is regenerated). After the gate (Oct 29):
  R1 "not claimed (outcome B)", R2 "allowed at $0; the real rows are to be added", R3 "allowed, always with R2".
  The strip shows a claim only when the file allows it: it quotes R2 with R3 next to it, never R1 while it is not
  claimed, and for an outcome with no allowed headline it says "No headline claim is allowed for outcome X
  (docs/claims.md)". A claim still `pending` is drawn as "Placeholder wording, pending the decision gate".
  **My addition, say if it should come out:** each shown claim carries "Status in docs/claims.md: <the file's note>"
  (so R2 reads "allowed at $0 …; the real rows are to be added"). Every number R3 quotes was checked against
  `honesty.json` (0.279/0.191, 13.197/5.713, per-process 0.902, false deaths 1.25/2.25).
- **Static definitions that are not in the file** stay and are cited to PREREG: the crash plans (C1/C2/C3 = 1/3/5
  crashes, §6). The coordinator said both defaults are right (msg_be3029d7a885).

## The intake page `#/new` (tab "New task (live)")

`web/src/intake/*`; the address names the reading, `#/new/<intake id>`, so a reload or a link lands on it.

- **The phases are the server's states** (`flow.ts`): the form; reading (`GET /api/intake/{id}` polled every 1 s, and
  asked again every 2 s up to 20 times when the server cannot be reached); review (`proposed`); approved; stopped
  (`refused` with the firewall's reason, `failed` with the schema errors, `interrupted`), each with a way back to the
  form with the text still there. A state the server gave about another reading is ignored.
- **Strict reading of the proposal** (`proposal.ts`): exactly the fields of `intake/proposal.py`, whose rows are all
  `extra="forbid"`, so the page never sends a field the server does not know; a wrong field is refused by its path.
- **Highlighting** (`highlight.ts`): finds each quoted sentence with the server's own test (`present()`: spacing and
  case aside). The sample repeats sentences (the "Track: HCC track" line sits under nine of twelve submissions, a
  speaker's preference sentence under seven of nine), so each is placed at the occurrence nearest its row's abstract
  or email; a mark is never put on another row's text. A sentence not found in the text gets a dashed chip with "?"
  and the pane says "Muse reworded it": nothing is marked in a wrong place. The row that is picked also shows its
  abstract or email; the one sentence picked stands out.
- **Provenance** (`provenance.ts`): Muse, Edited by you (with "Muse read …" for the fields changed), Added by you.
  `diffProposal` mirrors the server's `diff`; two tests hold it to the server's own `edits` for a simple and a mixed
  set of edits (`fixtures/approve.*.json`). Rows taken out are listed with "Put back". An added row takes an id no row
  of the reading has ever had. A speaker who still has a talk cannot be taken out. A speaker's availability cannot be
  emptied (the server reads an empty list as "nothing stated").
- **Approval blocks only on what the server refuses too** (`validate.ts`, limits held to `intake/shape.py` by a test):
  fewer than 8 titled talks, a talk with no speaker or track, a speaker with no name. More than 15 talks, a track
  with fewer than 2 talks, a talk with no title and a speaker with no talk are advice (the server rebalances and
  warns). Muse's own `warnings` are shown ("Muse's notes"); its `errors` are not, because the server recomputes them.
- **Approve sends the person's proposal**, not `{}`, so the server's `edits` list is exact; 409 (already approved)
  refetches and shows the approved state. After approval `GET /api/intake/{id}` still returns *Muse's* proposal, so
  the page keeps its own working copy; a page reopened on an approved reading shows Muse's rows with the server's
  edits list above and says so (open item: there is no endpoint for the approved version).
- **The run panel** opens on the arena pair against `durable-max`, "half the brains", the simulated clock and the
  practice LLM (free). Bodies: pair `{spec, rival, chaos, clock, speed?, backend}`, one run `{spec, scenario, chaos,
  clock, speed?, backend}`, spec `{goal: "Program the live conference", task: "t2_conference", inputs: {intake: id},
  seed: "1"}`. After the launch the page goes to `#/arena/<left>/<right>` or `#/run/<id>`.
- **Real spend** is W2's two steps. Muse (billed) is offered only where `GET /api/capabilities` says `real`. A
  preflight (`/api/intake/preflight`, `/api/arena/preflight`, `/api/tasks/preflight`) is priced for the exact body;
  the page shows the worst case, the caps, and any refusal, and only then the word, which must equal the server's
  `confirm_word` exactly. The token is tied to the canonical body (a changed setting means check again), expires,
  and is spent after one launch. **Every launch goes through `requestFor`** (`launch.ts`), which decides from the body
  itself: a body that does not plainly say `backend: "fake"` leaves only through an open gate, with its token and word.
- **Private text** stays in memory for as long as the page is open (leaving for another tab does not lose it; a reload
  or "Clear" does). `ui.test` reads the sources and refuses `localStorage`/`sessionStorage`/`indexedDB`/cookies,
  `innerHTML`, and any `fetch` outside `api.ts` (every POST sends `Content-Type: application/json`).
- **Fixtures** (`intake/fixtures`): real bodies, captured at $0 with a TestClient, the fake reader and scratch
  runs/ledger/private dirs; no real backend was built. The preflight bodies in tests are written from `api/spend.py`
  (a real preflight needs the server flag and a key).
- **Not covered by a test:** the click handlers and effects of `IntakeFlow` (polling timers, the approve and launch
  sequences) run only in a browser; their decisions are in pure functions that are tested and mutation-checked.

## The ablation `#/ablation` (tab "Ablation")

`web/src/ablation/*`, on W3's `GET /api/ablation/{run_id}` (poll until the status is not `running`) and
`POST /api/ablation`.

- **Headline** "parser N of M · Muse K of M" from `result.parser`/`result.muse`; the server's sentence is its tooltip.
  Before the result exists the line is the notes scored so far, labelled "So far" (counted from the notes, the only
  number the page tallies itself; a test checks that it ends where the server's tallies do).
- **The caveats the result says apply** (`applies: true`) sit under the headline in the server's words, with a
  short label (Generated notes / The reference / Practice backend). None are shown before the result. On a $0 run the
  `fake` caveat says the practice Muse is the parser itself, so the two agree by construction.
- **By kind** (emails: understood, cells exact, preference, mean Jaccard; abstracts: understood, mean error) and the
  split both / only Muse / only the parser / neither, from `result` and `result.agreement`; the definitions are
  tooltips.
- **Per note:** the note as text (untrusted: never markup), the approved reading, and each reader's reading with a
  ✓/✗ plus words, the parts it has wrong struck through (`compare` cuts the reading's words at "; " and checks each
  part against the approved reading), the parts it lacks listed, and how it scored. The notes in `result.differences`
  are marked; filters by who understood or where they differ (disabled until the result is there).
- **A run that did not finish** says so: running (with progress), halted, failed (with the error), interrupted, or
  cut by its deadline (`result.complete: false`); there is no result then.
- **The launcher** (`#/ablation`) starts the generator's notes on the practice backend at no cost
  (`emails`/`abstracts` 0 to 200, not both 0, `seed`) and lists the ablations on record (`GET /api/runs`, those whose
  scenario is the ablation's). It never sends `backend: "real"` (the route answers 501; the coordinator starts a
  billed run from the CLI, then the page reads it by id) and it takes no free text: W3 notes that the route does not
  keep live input private. An ablation of live notes waits for W2's `source: "approved"`.
- **`docs/claims.md` has no ablation claim**, so the view states the numbers and the caveats and claims nothing.
- **Fixtures** (`ablation/fixtures`): `ablation.sample.json` is W3's hand-written approved sample with the Muse they
  *script* per note (recorded with their own test helpers, read through the real route): it shows the view with a
  difference and measures nothing. `ablation.generator.json` is the generator's 16 notes through `POST /api/ablation`
  on the fake backend (parser = Muse by construction). `ablation.running.json` is a real mid-run read (6 of 16);
  `ablation.interrupted.json` is the sample's log cut after three notes and read through the route; plus the error
  bodies and the runs listing.
- The API caller is shared with the intake page (`caller` in `intake/api.ts`, and the strict readers in
  `intake/strict.ts`).

## Director mode `#/director/<scene>`

A scene is a strict JSON script (`web/src/director/scenes/<scene id>.json`, one per scene of `docs/video-script.md`
except `s2-intake`, which is recorded live). `#/director` lists them with what each still needs. The frame is a
logical 1920×1080 box with no app chrome, scaled to the window (scale 1 at exactly 1920×1080).

- **Steps:** `seek`, `play`, `pause`, `speed`, `wait` (a time, or `until` an anchor), `camera` (fit a region, an actor
  or a subtree, with padding and easing), `highlight`, `tooltip` (the hover text an element carries, drawn next to
  it: it has no words of its own, so a scene never retypes the UI), `caption` (lower third or overlay statement),
  `lens` (open or close a call), `panel` (show or hide). Moments are anchors read from the log (`crash:N`, `recovered:N`,
  `call:NAME`, `end`, with an offset like `crash:2-3s`); actors are ids, `$root`, `$crashed:N`, `$heir:N`.
- **A take is a count of frames of 1/60 s**, not a wall clock: the take's clock is W4's fixed-step clock, so the same
  scene shows the same moment of the run on the same frame, on any machine. A pre-roll of 45 frames lets what animates
  by itself settle before frame 1.
- **The runs are not in the scenes.** The final pair is recorded after the scenes were written, so a scene names no
  run: `sources.json` (the coordinator fills it) or the address (`?swarm=&rival=`, `&run=`, `&ablation=`) gives them.
  `&real` (or `"real": true` in `sources.json`) declares that the runs were recorded with the real model.
- **The frame's note.** The video script wants "Replay of a real recorded run · real cost $X" on every replay. A log
  does not say which model wrote it, and a practice run prices its tokens like a real one (the $0 reference pair shows
  a cost of about $0.3 a side), so "real" appears only on a take that declares it, and only with a cost the server
  gave; otherwise it says "practice model, no cost". A declared-real take with no cost is flagged.
- **Captions** are checked by a test to be lines of `docs/video-script.md` (the claims come from `docs/claims.md`
  through the script). The arena's assumptions caption is never touched by a scene.
- **`window.__director`** is what a recorder reads: `ready`, `state`, `frame`, `frames`, `done`, `steps`, `position`,
  `warnings`, `problem`, `note`, `go()`, `restart()`. `&hold` waits for `go()`. `&hud` shows the take's clock.

First look in a browser (Oct 29, on the $0 pair, so every number is a practice number): all eight scenes load, run
their whole script and stop on their last frame; the title card, the helps and ablation scenes and the arena scenes
look right. Found on that look, fixed the same day: the replay note sat over the arena's assumptions caption (it now
takes the empty left of the arena's top bar: `.dir[data-stage="arena"] .dir__note`), and a highlight right after a
`lens open` raised a false "target not on the page" because React had not drawn the drawer yet (a ring now gets
`RING_GRACE_MS` = 500 ms, and still warns if its target is missing after that or when its time is up).

MP2 (commit e5a7fed; written while the machine was held for the paid blocks, so **not yet looked at in a browser**: the
slot for that is queued behind the second paid block):

1. the arena had the frame's height but its content ran about 60 px past it, so its timeline was cut: in a take the
   arena now has the frame's height and its boards shrink to fit (`.dir__stage--fit .arena`, a one-row grid, `min-height: 0`);
2. the camera is kept inside the stage (`within`, camera.ts; the stage's size is the camera element's layout size), so a
   fit near an edge shows no black; a view larger than the stage is centred;
3. the `tree` region is the nodes, not the panel, so a camera on it fills the frame with the tree (s5's pad of 0.02 may
   need to grow if the tree re-lays out after an adoption: look at it on the final pair);
4. on the run page the note covered the **verify badge** at the right end of the strip, not only a few pixels of the
   takeover chip as first thought: the run stage now starts under a 36 px band that holds the note;
   the first look in a browser (below) found that the stage's own minimum height is the whole frame, so under the band it
   was still 1080 px and the page's timeline ran 36 px out of the bottom: the run stage resets it;
5. the `tooltip` step, used by s8 on both proof chips (`swarm-proof`, `rival-proof`); the coordinator's answer to the
   question about the hover was yes, with exactly the title words, which is why the words are read off the page.
6. a verdict chip has no hover text until its check has come back, and on a long log that is not at once: the page does
   not start a take whose tooltips point at a chip that says nothing yet. It waits for the text, up to 30 s after
   everything else is ready (`TIP_WAIT_POLLS`), and then starts anyway: the take warns "has no hover text" and the
   recorder flags it in the sidecar.

First look at the MP2 sources in a browser (Oct 29, 21:27, slot, fake pair `t2-swarm-killhalf` / `t2-central-killhalf`, a
sample of s1, s4, s5, s6 and s8, no flag in any sidecar): the arena fits the frame with its timeline (s1, s6, s8); the
camera stays inside the stage (s8's rival head, at the right edge); both tooltips of s8 are drawn under their chips with
the chips' own words, the swarm's ("6 hand-overs: the heir of each, recomputed from the log, is the one the run used.")
and the rival's (the recovery report's three checks); s5's tree fills the frame at pad 0.02 with 38 px left and right,
the heir and the root rings land on the right nodes; the note sits in the run page's band and covers nothing. One
thing was wrong and is fixed in the sources, to be seen again: the run stage's minimum height (above).

Second and third look (Oct 29, 21:40 and 21:52, the same fake pair): after the min-height reset the run page fits under the note's band with its
whole timeline (s4, s5 at the home camera); the flow stages (s3, s7) and the title card (s9) are right under the camera clamp
(it only keeps the camera inside the stage; a pan the scene asks for within the stage is not touched); and, on the bundle built
from the merged sources (arena at ea40fa0 in, 0da4bfb), s1, s6, s8, s4 and s5 show the arena counters on W4's fold: at 73 s of
the fake pair the dependency row reads 5.0 s for the swarm and 25.0 s for the rival (contract-seconds, the scored definition;
it was 5.0 and 5.0 as the outage length), duplicated work 0 and 6 calls. `demo --verify --no-serve --no-browser`: MATCH, backup,
8177 events, head b052b4bc33cfe1b54c7b6ceb2872de26. No flag in any sidecar of any of the three slots.

Rule from the coordinator (Oct 29): `real` is flipped to `true` in `sources.json` in the same commit that points
it at the final real pair, when the run ids are handed over; never before, and never by hand in a take.

Every scene's timings, `crash:N` indexes and call picks are first drafts, to be tuned on the final pair.

### The recorder `scripts/record_scenes.mjs`

Node and `playwright-core@1.48.2` (the build that matches Playwright's `chromium-1140` here), installed in a scratch
directory outside the repo (`RECORD_TOOLS`, default `%LOCALAPPDATA%\fractalswarm-record`). **Frames mode** (default):
a shim (`record_scenes.shim.js`) replaces `requestAnimationFrame` and `performance.now` and holds the CSS animations,
so the recorder grants the page one frame of 1/60 s, screenshots it, and goes on: the clip has exactly the frames the
scene says, however slowly the machine draws them. Output: a PNG sequence per scene in `video/clips/` (gitignored),
a sidecar JSON with the take's flags, and an mp4 only if ffmpeg is on the machine (`FFMPEG` or the path); without it
the exact command is printed. **Video mode** records in real time (Playwright's `recordVideo`, a webm at 25 fps) for a
quick look at the choreography. `--dry` runs the frames without screenshots; `--from/--to/--every` record a window or
a sample; `--real` declares the runs real. A take with a page error, a scene warning or a script longer than its scene
is flagged and, with `--strict`, fails. Measured on this machine: 1920 frames of an arena scene take about 20 s
without screenshots.

### Tuning the scenes on the final pair (what I do when the coordinator hands me its run ids)

1. In one commit: `web/src/director/sources.json` gets `swarm`, `rival`, `run` (the swarm's unless another) and, only for a
   real pair, `"real": true` (the coordinator's rule); `ablation` when W3's real ablation is on record.
2. A SLOT, the scratch server on 8791 with the fake LLM and a dummy key (it only replays; it never calls a model), and
   `node scripts/record_scenes.mjs all --every 60 --no-encode` (a frame a second of each scene, about 5 minutes).
3. Read each sidecar's `flags` first: a scene warning names the step (`step 7: the run has no "crash:2"` means the pair
   has one crash fewer than the scene assumes), a script shorter or longer than its scene says the waits no longer fit.
   Then look at the frames: s1 (the first crash on both sides at the same second, nothing covering the assumptions
   caption), s5 (`$crashed:N` and `$heir:N` are the coordinators of the real pair, the camera on the tree), s6 (the
   rival's caption always on, the counters moving), s8 (the tooltip's words are the chip's, the badge is not covered).
4. What is tuned lives in the scene JSON only: `crash:N` indexes, the `-Ns` offsets around them, the `wait` lengths, the
   `calls` picks of s4 (`model`, `purpose`, `role`), the camera paddings. The code does not change for a pair; if it
   has to, that is a bug in the director, and it gets a test.
5. A real pair has its root dying first, a practice pair may not: the arena's `root` tag follows the heirs (W4's
   `rootHolder`), so `$root` after a takeover is the heir, not o0.
6. Every scene must last the seconds the video script gives it (a test pins them); a retime of the script is a change of
   `duration_ms` and of the waits together.
7. Before the slot, without a browser: `scenes.real.test.ts` plays every scene on the demo's real log (the committed
   `demo/backup`, with the lens rows of `lib/fixtures/lens-demo-backup.json`). It pins the five outages (o0 at 44.5 s,
   o2.1 55.4, o1 56.7, o3.2 65.9, o2 76.9; the log ends at 118.6 s), the actors the scenes name (`$crashed:1` o0, `$heir:1`
   o1, `$crashed:2` o2.1, `$heir:2` o2.2, `$root` the heir once it has taken over), that every actor a scene points at is in
   the log (the fake page puts any target somewhere, so only this test sees a missing one), s4's two picks and that
   every take runs all its steps with no warning. For the final pair, the same context from its logs in a throwaway
   test (crashes, calls, end) gives the fake replay's log and the playhead every 2 s of each scene: the pair-dependent
   numbers can be set before the slot and the slot only confirms them. What the real shape shows already: s4 plays at
   10x for 3.5 s, so it stops at 35 s of the replay, 6 s before the first Spark call of purpose work (41.2 s; Wonder's
   root plan is at 3.4 s to 18.0 s), and opens that call from the lens anyway; and s6 plays at 6x for 12 s from
   `crash:1+5s` to about 126 s, past the swarm's end but short of a rival that runs longer (a central baseline of the c3
   plan ends at 170 s), where it warns "the replay did not reach the moment in time" and goes on: the speed of that step
   is the number to set (about 10x for 170 s).

## Shapes I rely on

- `GET /api/pairs`, `GET /api/runs/{id}/metrics` (top-level `recovery`), `GET /api/runs/{id}/takeover`: W2/W1, as in
  arena since `0025e22`.
- `GET /api/runs/{id}/recovery` (W1, fb7df39): `{run_id, events, system, supervised, metrics, restarts[], checks[{name,
  title, applies, detail, violations[], ok}], ok}`; 409 until the run completes. The chip says "Recovery OK ✓ N
  restarts" when `ok` and `supervised`, "Recovery check failed: <rules>" otherwise, and never "OK" for a run with no
  supervisor crash. A report whose `ok` its checks do not add up to is not trusted. A server without the route
  (404, 405, 501, 409) gets the log's own count, labelled as that. `fixtures/recovery.*.json` are real output of
  W1's `check_run` over my scratch runs.
- `GET /api/bench/honesty` (W1, fb7df39): the committed file; 404 when missing. `schema_version` 1.
- W2's intake API (api/jobs.py, api/spend.py, intake/service.py): `GET /api/capabilities` `{tasks, chaos, approve,
  budget, halt, real}`; `GET /api/intake/sample?seed=1`; `POST /api/intake` (202 `{intake_id, job_id, state, private,
  billed, warnings}`); `GET /api/intake/{id}` (`state` reading | proposed | approved | refused | failed |
  interrupted, `texts`, `proposal`, `scans`, `refused`, `failed`, `approved`); `POST /api/intake/{id}/approve` `{proposal}`
  (422 when it still has errors, 409 when already approved); `POST /api/tasks` and `POST /api/arena` (bodies above);
  the three `…/preflight` routes share one body (`ok, token, expires_in_s, confirm_word, kind, runs, calls_per_run,
  estimate_usd_per_run, run_cap_usd, worst_case_usd, standing, refusals`). Every POST must be JSON (415 otherwise).
- W3's ablation API: see the notes `arena-meta.md` ("Endpoint shapes (for W5)"); I read only the fields I show.
- The Vite dev proxy in `web/vite.config.ts` is hardcoded to `127.0.0.1:8765`. For a second stack I used an
  untracked scratch config (not committed). An env override in `vite.config.ts` would be a one-line change for W4.

## Collisions found and resolved

W4's `styles.css` is global and already has `.chip` (a pill button), `.cell` (a schedule grid cell) and `.mark`
(a timeline tick); `lens.css` has `.source` and `.run*`; `styles.css` has `.grid` and `.run*`. My board chips are
`coord`, the panel's cells `rcell` and its shapes `locality`; the intake page's source pane is `srcpane*`, its
availability grid `avail*`, its run panel `runit*`; the ablation's classes are all `abl*`. The arena timeline reuses
W4's `.mark`, `.btn`, `.speeds`, `.badge`, `.empty` and `.stat` on purpose. `assumptions.ts` gained an exported
`systemName(system)`. A script over the CSS checks every class of the intake and ablation pages against the others.

## Open items

1. (Closed Oct 29: W4's merge fixed `rootHolder`; the arena uses it.)
2. The "Talks placed" meter on a board stays at 0 until the final integration, so it only moves at the very end.
   It could count contracts completed instead; I left it until the video needs it.
3. **W4's `components/NewTaskForm.tsx` posts the bare TaskSpec to `/api/tasks`**, but W2's `TaskRequest` needs
   `{spec: {...}, scenario, chaos, clock, backend, …}` with `extra="forbid"`, so its "Submit for planning" gets a 422.
   Not touched (not my file); the intake page posts the right shape.
4. W1's per-rival keys (`tally_by_rival`, `locality_by_rival`) arrived with the arena merge `7e64957`: the panel shows
   a column per rival (screenshot `helps.png`) and its tests pass on the merged `bench/results/honesty.json`.
5. **Seen in a browser at MP1 (Oct 29), on the scratch server with the key neutralised:** the arena at three points,
   the panel, the intake page from the sample text to the approved reading to "Start the arena pair" (the pair ran and
   opened in the arena), and the ablation (it started its own fake run). No console error, page error or HTTP error in
   any of them. Two things found and fixed on the way: a long run id (a launched pair's) wrapped the title of a side
   and misaligned the two boards (the title stays on one line and the id is truncated, with the full id on hover);
   and, in the director, the run stage waited for a tree node that does not exist at the start of a run.
   Known and left: a hash change to the same pair with a new `?t=` is not a load, so the seek applies only when the
   pair opens (as the page comment says); at 1080 the arena page scrolls inside the content area by about 230 px (the
   timeline is below the fold), which the director works around with a camera.
5b. The practice pair's cost is not zero (about $0.3 a side): the practice model prices its tokens like the real one.
   Anything that says "real cost" must come from a declaration, not from a cost above zero (see the director's note).
6. After approval the server returns Muse's proposal, not the approved one. A reopened page shows Muse's rows plus the
   edits list. An endpoint (or the approved proposal in `GET /api/intake/{id}`) would let it show what was approved.
7. The status note under each claim in the panel ("Status in docs/claims.md: …") is my addition; it can come out.
8. The static `GET /api/ablation` caveat labels (Generated notes / The reference / Practice backend) are mine; the
   text next to them is the server's.
9. ffmpeg was not on this machine on Oct 29 and is now (winget, Gyan.FFmpeg 9.0.2, on PATH): the recorder encodes the mp4 itself and
   keeps the PNG sequences (`<out>/<scene>/f00001.png`, 60 fps) next to it. Without it the recorder still prints the exact command.
10. `docs/video-script.md` s8 mentions hovering a takeover chip ("the heir of each, recomputed from the log, is the one
    the run used"). That text is a native `title`, which a headless screenshot does not draw: the director's `tooltip`
    step draws it (answered yes by the coordinator).
11. The recorder is a browser: every run of it needs a SLOT (the MP1 GO covered one browser, and I used it for the
    screenshots and for a sparse sample of every scene). A full recording of all eight scenes is about 5 minutes of
    one browser. The final pair comes after the handler freeze, which may be the night of Oct 29, not Nov 2.
12. The server refuses `backend: real` without an approval gate, and I additionally ran my scratch server with a dummy
    `MODEL_API_KEY` and an empty `HF_TOKEN`; no real call was possible from any of my runs.
13. (Done Oct 29, after W4's merge ea40fa0 was merged into this branch.) W4 had told me that the live "Coordinator-dependency
    time" was the outage length and not the scored `cdt_s`, and the live "Duplicated work" undercounted `dup_calls`; it
    ported W1's definitions into the fold (`lib/recovery.ts`, parity test on four real logs and 413 prefixes). The
    coordinator's answer was: no liveNotes for those two rows. Now: the "dependency" row reads `counters.dependencyMs`
    (it was `coordinatorDownMs`), the "duplicated" row already read `duplicatedCalls`, which is the scored count now; the
    two definitions read like W1's ("contract-seconds, added up over the contracts that waited"; the three ways a call is
    duplicated). The live figure moves when a wait ends, not while it goes on, as the scored one is defined; so the three
    tests that expected the down time to grow got a fixture with a contract that waits (`ready`, `sent` in
    `arena/testing.ts`), and the open-outage test now reads the "time to recover" row, which does grow. The live idle
    agent-seconds no longer counts an agent a crash stopped (a worker `killed` with reason `crash`): the "idle" row is as
    before. A change of the dependency figure on a real pair (not only on logs of W4's four) is for the headline runs to show.

## Tests

`npm --prefix web test` runs vitest in node: the pure modules, and the components drawn on the server
(`renderToStaticMarkup`). The panel's tests run over the bench's own `honesty.json`; the recovery tests over real
`check_run` output; the intake tests over real W2 bodies; the ablation tests over real W3 bodies. At MP2 (the branch with arena merged in, W4's ea40fa0) the whole web suite was 72 files and 1136 tests, green on one
worker in 21 s (the arena's are 203 in 17 files, the director's 189 in 9); `scenes.real.test.ts` (13 tests, the scenes on the
demo's real log, 6 hand mutants all caught) came after that count. `tsc --noEmit` clean. Mutation-checked, each reverted: the panel (flipping a
claim's placeholder, hiding the loss counts, dropping the row model, toning down the per-process loss); the intake
page (20 mutants: a billed launch without the gate, a wrong or lower-case word, a stale or expired token, the approval
not blocked, frozen inputs editable, a wrong provenance, browser storage, a sentence marked that is not in the text,
…); the ablation view (17 mutants: a swapped headline, caveats hidden or not filtered, a flipped mark, the split read
wrong, a lacking part not said, the real backend sent, a note as markup, …). Every one was caught.
The director (54 mutants, vitest only: the waits and their timeouts, the moments and their offsets, which actor a scene
means, the camera's maths and its clamp, the overlay's fades, the take's frames and warnings, the driver's phases, the
note and the sources, the targets, the drawn tooltip): a first, interrupted pass found a padding test that only
covered the limiting side (the width of a wide rectangle and the height of a tall one are pinned now); the full pass
caught 53 of the 54, and the survivor, a seek past the end of the run, is now a test. Every mutant is caught.
