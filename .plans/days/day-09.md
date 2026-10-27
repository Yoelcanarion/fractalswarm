# Day 9 — Tue 3 Nov — Publish first, then supporting work

Paste this into a **new Claude Code chat**. Branch/worktree: `day-09-publish`, from `master`.

## Read first
- `CLAUDE.md`
- `.plans/fractalswarm-spec.md` §0.2 (fallbacks), §7.2, §7.3, §8, §11, §12, §15.6, §16 (supporting panels), §22
- `.plans/progress.md` (last entry, including the overnight run status)

## Goal
Make the repo public safely, finish the final chart with LangGraph, record the **final demo bundle**, then add supporting features in priority order. Each one is time-boxed; when the box runs out, it drops to its fallback.

## Tasks (strictly in this order)
1. **Morning — publish.**
   - Run a secret scan over the full git history (for example `uvx gitleaks detect`, or grep for key patterns).
   - Check that every cassette in `demo/` and `tests/golden/` is redacted.
   - **Ask Yoel to confirm**, then make the repo public.
   - Check it in a logged-out browser.
2. Check the overnight results, regenerate the charts, commit.
3. `baselines/langgraph_teams.py`: hierarchical teams via `langgraph` + `langchain-openai`, pointed at Muse.
   - Same tools, the shared fault transport, and a checkpointer as its native persistence.
   - **Time-box: 3 h.**
   - Then run its matrix rows in Contributor mode and regenerate the final chart.
4. Headline Standard runs: swarm vs central, T2 at C3, 3 seeds.
5. **Final demo bundle**: T2 kill-half with the poisoned email. Record, redact and verify it, then save it to `demo/`. `demo --verify` should now point to it.
6. Supporting work, each item time-boxed, else its fallback:
   1. full epoch auction (§7.2) and AIMD quotas;
   2. `autoscale`;
   3. channel breakers (ping-pong and storm detection);
   4. cross-squad audit;
   5. risk score and feasibility report;
   6. T3 web example;
   7. supporting UI panels: market and budget, rate limits, breakers, memory, collisions, escalations, results.

## Exit criteria
- [ ] The repo is public and verified logged-out.
- [ ] The final demo bundle is committed and verified.
- [ ] The final chart is committed, or v1 plus partial results with the gap noted.
- [ ] Spend today ≤ $12.

## Allowed fallbacks today
All the supporting fallbacks in spec §0.2. The backup bundle from Day 7 and the attack clip from Day 8 remain the video sources if step 5 slips.

## End of day
- Tests, lint and the web build green.
- Append to `.plans/progress.md`.
- Commit.
- Ask before merging into `master` or pushing.
