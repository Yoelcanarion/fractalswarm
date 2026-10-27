# Day 10 — Wed 4 Nov — Freeze, README, video, submit

Paste this into a **new Claude Code chat**. Branch/worktree: `day-10-ship`, from `master`.

## Read first
- `CLAUDE.md`
- `.plans/fractalswarm-spec.md` §0.1 (positioning and honest claims), §12 (limitations), §15.2 (fairness), §23 (video script and checklist)
- `.plans/progress.md` (last entry)

## Goal
Ship. The deadline is **Nov 4, 21:00 ET = Nov 5, 03:00 CET**; the target is to have submitted by **20:00 CET**.

## Tasks (in order)
1. **12:00 CET: feature freeze.** After that, bug fixes only.
2. If the LangGraph rows landed late, regenerate the final chart.
3. **README.md.**
   - The hook, with a GIF from the replay.
   - "Shared log, not shared brain."
   - How takeover works at every level, the root included.
   - The fairness rules.
   - Quickstart: `uv run fractalswarm demo --verify`, which needs no API key.
   - The results charts.
   - Safety and ethics, including the task-splitting attack.
   - Honest limitations.
   - How to run live.
   - An architecture diagram.
4. **Video (3:00), following §23.**
   - Source: the replays (the final bundle; otherwise the backup bundle plus the attack clip).
   - English voice-over.
   - On screen: "Replay of a real recorded run — real cost $X".
   - Upload it (e.g. unlisted YouTube) and link it from the README.
   - Show only work built during the event.
5. **Final checks.**
   - Fresh clone in a temp dir → `uv run fractalswarm demo --verify` works.
   - The repo opens in a logged-out browser.
   - `fractalswarm spend` is under $150.
6. **Submit** on the CV platform (`cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit`) with the video link and the repo link, by 20:00 CET.

## Exit criteria
- [ ] Submission confirmed.
- [ ] Video and repo links checked logged-out.

## End of day
- Append a final entry to `.plans/progress.md`.
- Commit, and ask before merging or pushing.
