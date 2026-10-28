# Rules for every Phase 2 worker

These rules come from the coordinator and apply to every worker (W1–W5). They repeat the hard rules of your brief and add how we talk. Where they and your brief disagree, ask the coordinator.

## Money and evidence
- **No real Meta API calls, ever.** The key sits in the shared `~/.fractalswarm/.env`, so this rule is behavioural: never pass `--backend real` or `--confirm-real-spend`, and never build a real backend. The coordinator makes every paid call.
- **Scratch dirs for anything you record.** The shared env now points `FRACTALSWARM_RUNS_DIR` at `~/.fractalswarm/runs`, which holds the project's evidence. Before any `fractalswarm run`, `bench` or `replay` of your own runs, set `FRACTALSWARM_RUNS_DIR` and `FRACTALSWARM_LEDGER_PATH` to a dir in your scratchpad (tests use tmp dirs already). Never write to `~/.fractalswarm/runs`, never touch `~/.fractalswarm/ledger.sqlite`, and never write to `~/.fractalswarm/private` from tests.
- You may **read** the recorded runs in `~/.fractalswarm/runs` and `demo/` (e.g. to test an API on real data).

## Files and git
- Edit only the files your brief gives you. For anything else, ask the coordinator first.
- Never edit `.plans/progress.md`. Your notes go to `.plans/notes/arena-<name>.md` (done, deviations, issues, open questions, and the shapes other workers need), committed on your branch.
- Commit on your own branch only, ending each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No merge, push or rebase unless the coordinator asks. Never use bare `git stash` (the stash is shared by every worktree): make a WIP commit instead.
- The working tree is CRLF (`core.autocrlf=true`). Write scripts that contain backslash escapes with the Write tool, not through a shell heredoc.

## The machine: 15 GB of RAM for everyone
- **Don't spawn subagents** (no Agent tool, no Explore or Plan agents). Each one is another Claude process, and the machine ran out of memory at 10. `/hard-task` is fine: it changes your model, not your process count.
- **Heavy commands need a slot.** Before a full `uv run pytest`, a bench matrix or sweep, a Playwright recording, or starting a dev server, ask the coordinator with your preamble's `ask` command, for example `SLOT: full pytest`, and wait for `GO`. When it ends, send a `status` message `DONE: full pytest`. Targeted tests (one file, or a `-k` selection), `ruff`, `tsc`, `vitest` and single fake runs need no slot.
- **HOLD and RELEASE.** When the coordinator sends `HOLD`, stop at once any suite, bench, build, dev server or browser you are running, reply with a `status` message `HOLD ack`, and start none until `RELEASE`. A hold usually means a paid or live-clock run is about to start, and CPU load causes false deaths in it.
- Read your messages at every checkpoint (before a new file, after a test run): `check --terminal <your handle>` from your preamble.

## Talking to the coordinator
- **A question that blocks you:** `ask`. A blocked worker wastes the day, so ask early.
- **A merge point** (your brief marks them): `send --type merge_ready` with the report in `--body`: branch, commit, test counts, the reference comparison result, done and not done, deviations, open questions, and the event or API shapes other workers need. Then go on with your next step; the coordinator reviews and merges in parallel, and tells you if something must change.
- **Blocked beyond a question:** `send --type escalation`.
- **`worker_done`** only once, when your whole brief is finished or the coordinator tells you to stop, with an honest `--outcome`.

## The $0 reference comparison
Committed in Phase 0:
- `scripts/refs/record_refs.ps1` records the default-path runs (swarm, central, single and pipeline on T2 at C0, kill-half and C3, the T1, T3 and attack smokes, and the 32-cell fake matrix) into a dir you choose;
- `scripts/refs/compare_refs.py` diffs two recordings event by event, ignoring the hash chain.

Record `before` at your branch point and `after` at your HEAD. A difference must be explained and gated, or fixed. Known and accepted: **adding a role to `config/roles.yaml` changes `run.started` of every new run** (the roles snapshot). The Phase 0 merge did it once (the LangGraph `supervisor` role); old runs replay from their own snapshot. Report it if you do it again.
