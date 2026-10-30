# W5 `ui-arena`, round 3: the final pairs, and the arena polished

Your first brief (`.plans/arena/w5-ui-arena.md`) and your notes (`.plans/notes/arena-ui-arena.md`) still hold. Merge `Yoelcanarion/arena` into your branch first. Arena spec §M and `.plans/arena/handoff.md` are newer than your brief.

## What changed since you stopped

- `#/` is now the home page (W6, W7). The app shell is a lazy chunk. Every other route still works.
- W4 is polishing the shell and every page except `web/src/arena/` (outside `helps/`) and `web/src/director/`. Those two are yours.
- The final pairs are swarm against `central` and swarm against `durable-max`, with the arena's default failure plan: on the sample text first, then on Yoel's own text for the final take (handoff, item 2). A pair on his text is private: nothing of it goes into git, so `sources.json` and the static showcase cannot name it. For those, the coordinator records the same two pairs on the T2 fixture. The coordinator gives you the run ids.
- Yoel picks in the edit between the two pairs (spec §M.5), so the director must play either.

## 1. The final pairs in the director

Follow your notes, "Tuning the scenes on the final pair":
- `web/src/director/sources.json` and `"real": true`, in one commit.
- Tune s4 and s6 from the real lengths, and every scene's timings, `crash:N` indexes and call picks.
- `scenes.real.test.ts` plays every scene on the final logs.
- One recorder slot per pass (the coordinator gives slots). Check the clips yourself: read frames, not only logs.
- `s1-arena-open` and `s6-fair-fight` must work on both pairs: a source per pair, or a parameter, whichever is simpler. Tell the coordinator which.

## 2. The arena, polished

A juror arrives from the home page's menu and must understand the arena in ten seconds.
- **Fit:** 1920×1080 and 1366×768, dark and light. Nothing clipped; both sides equal.
- **First look:** one line on what is happening, and what the rival is, with its assumptions always visible. An arena opened with no pair lands on something useful: the recorded final pairs first, not an empty picker.
- **The clock:** one shared clock, crash markers on the shared timeline, a band while a supervisor is down. Play, pause, seek and speed feel exact. Keyboard: space to play, arrows to step, Home and End.
- **The end of a pair:** when both runs finish, the counters settle into a plain summary: both finished, what each lost, and a link to `#/helps` for where this holds. Wording only from `docs/claims.md`, with the setting named. A single pair is one run on one seed: say so, and never turn it into a general claim.
- **Both rivals read correctly.** `central`: workers die, calls are cancelled and redone, and the counters show it. `durable-max`: workers survive, the board pauses for 5 s per crash.
- **The recovery chip and verify badges** on both sides; `/takeover` now answers 501 for a supervisor's run, so the chip shows the recovery report there.
- **Empty, loading and error states** with a way out, in the shared components (`PageHeader`, `EmptyState`, `Tooltip`, `Term` from W4).
- **Static showcase (W8):** the arena replays from files there; every control that needs a server is off, and says why.
- **Performance:** two boards side by side on a real log. Measure, and keep both moving at 20x.

## Rules

- Everything in `.plans/arena/worker-rules.md`. No real calls.
- Web only: `web/src/arena/**` except `helps/`, `web/src/director/**`, `scripts/record_scenes.*`, and your notes. Anything else: ask.
- Slots as in the other briefs: browsers, dev servers and builds run only in a RELEASE window; on HOLD keep to code, `tsc`, and vitest on one worker. Your dev server's port is 5177.
- `merge_ready` at each working step.

## Acceptance

Typecheck and vitest green, `demo --verify --no-serve --no-browser` MATCH, `scenes.real.test.ts` on the final logs, screenshots at both sizes in both themes (read them yourself), a frame-time reading, and a clip per scene with no warning in its take.
