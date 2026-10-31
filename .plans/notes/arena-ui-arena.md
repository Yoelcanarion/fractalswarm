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
