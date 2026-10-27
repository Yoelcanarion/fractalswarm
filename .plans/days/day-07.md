# Day 7 — Sun 1 Nov — Demo surface + backup bundle

Paste this into a **new Claude Code chat**. Branch/worktree: `day-07-ui`, from `master`.

## Read first
- `CLAUDE.md`
- `.plans/fractalswarm-spec.md` §0.1, §16, §17, §23
- `.plans/progress.md` (last entry)

## Goal
Build the screens the video needs, make `demo --verify` work for judges (no API key, no Node), and **record the backup demo bundle**: a real T2 run with "kill half the brains".

## Tasks (in order)
1. The API, in `api/app.py` and `api/ws.py`.
   - REST: tasks, runs, approve, chaos, budget, halt, escalations, bench results.
   - A WebSocket event stream with `from_seq`, for live runs and replays.
2. The `web/` app: Vite + React + TS, with @xyflow/react, recharts and zustand, and an event-store client.
3. **Fractal tree graph.**
   - Re-wiring animation on `tree.adopted`, and a red ✕ when a node dies.
   - Ownership colors and animated message edges.
   - A "coordination tokens: 0" counter.
4. **T2 schedule grid**: rooms × slots × day, colored by squad. Collisions flash, then show their resolution and the arbiter. A violations badge.
5. **Chaos controls.**
   - "Kill half the brains", which runs the C3 schedule.
   - Kill agent.
   - API storm.
   - Network faults.
6. **Replay**: a timeline scrubber (1–20×) and a "Replay verified ✓" badge, backed by the verify call.
7. **Charts page**: the hero chart, from the bench JSON.
8. New task form and plan approval (MVI).
9. Build the web app and copy the assets into `src/fractalswarm/api/static/`. `fractalswarm demo --verify` must work from a clean checkout, using the bundled run in `demo/`.
10. **Backup bundle.**
    - A real Standard T2 run at depth 2 with the C3 kill-half schedule.
    - Record it, redact it, and verify it.
    - Save it to `demo/backup/` and commit it.

## Exit criteria
- [ ] The demo flow works live and in replay.
- [ ] `demo --verify` works from a clean checkout with no API key.
- [ ] The backup bundle is committed and verified.
- [ ] Spend today ≤ $5.

## Allowed fallbacks today
- Plan approval → a read-only plan view.
- New task form → YAML upload.

## Out of scope today
Supporting panels (market, breakers, memory, escalations), safety.

## End of day
- Tests, lint and the web build green.
- Append to `.plans/progress.md`.
- Commit.
- Ask before merging into `master` or pushing.
