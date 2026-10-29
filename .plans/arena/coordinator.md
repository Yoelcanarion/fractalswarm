# Phase 2 coordinator brief — "Arena"

You coordinate Phase 2 of FractalSwarm, from Oct 28 to the submission on Nov 4.
- **Where:** the Orca workspace `arena` (`C:\Users\yogar\orca\workspaces\work-orquestrator\arena`), branch `Yoelcanarion/arena`, which started from `Yoelcanarion/day-09` (b07fa0c).
- **Model:** Opus 5.5 at max effort.
- **Language:** you talk to Yoel in Spanish; everything you write to the repo is in English.
- **You are already in your workspace.** Do not create another worktree or branch for yourself.

## Read first
1. `CLAUDE.md`. It is binding.
2. `.plans/arena-spec.md`, all of it. It is the source of truth for this phase.
3. The last two entries of `.plans/progress.md`: Day 9 (paused at 20:31), and "Phase 2 plan".
4. `bench/REPORT.md` §1, the fairness rules.
5. The orchestration guide: run `orca skills get orchestration` and follow it for runs, workers, messages, gates and waits. Its flags win over the examples in this brief.

## Your job
- Do Phase 0 yourself (spec §K).
- Start the workers, answer their questions, review their branches and merge them into `Yoelcanarion/arena`.
- Run every paid run yourself, in a quiet window.
- Run the experiment protocol (spec §C) and take the decision gate to Yoel.
- Own the evidence and the story: `docs/claims.md`, `bench/REPORT.md`, `docs/video-script.md`, `docs/submission.md` and the README.
- Keep `.plans/progress.md` current, with one entry per day (done, deviations, spend, issues, next), and send Yoel the daily spend report.

Use `/hard-task` thinking for the parts that need judgment: merges with semantic conflicts, the gate analysis, the claims and the script. Your own model is already Opus; workers escalate with `/hard-task` themselves.

## Binding rules

### Money
- **Cap:** $50 for everything left in the phase. At the start, settled spend was $11.8194, with $2.9458 reserved. **Hard stop: settled project spend at $61.8.**
- Run `uv run fractalswarm spend` before and after every real run. Log both numbers in the progress entry.
- **Runs that need no extra OK:** the runs in the spec §J table, each within 1.5× its estimate, after their gate (real rival runs come only after the §C.4 decision gate).
- **Runs that need Yoel's OK first:**
  - anything outside the table;
  - a run likely to exceed 1.5× its estimate;
  - anything that would cross $61.8 settled.
- Tests and development use the fake LLM. Workers never make real calls. They don't even hold the key in their environment on purpose: `~/.fractalswarm/.env` is shared, so the rule is behavioural. Repeat it in every dispatch.

### Machine
The machine has 15 GB of RAM and 16 logical CPUs. On Oct 28 it ran out of memory with 10 Claude processes, Firefox, Discord and Orca open.
- **Workers:** at most 4 at the same time. A fifth starts only when another has been released and free memory is above about 4 GB:
  `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"`
- **Heavy commands** (full pytest, web builds, `bench` sweeps): at most 2 test suites at the same time across all agents, and one dev server.
- **Quiet window for paid or live-clock runs:**
  1. `orca orchestration send` a HOLD to every active worker: no test suites, builds, dev servers, browsers or bench sweeps until you release it.
  2. Wait for their acks.
  3. Ask Yoel to close heavy apps if memory is low.
  4. Run.
  5. Send RELEASE.

  Day 9 showed that live-clock runs at high speed on a loaded machine produce false suspicions, and a worker that read the hold late ran a suite during a recording.
- Release each worker's terminal (`worker-release`) as soon as its branch is merged.
- No browser automation during paid runs.

### Git
- **You may, without asking:**
  - merge worker branches into `Yoelcanarion/arena`;
  - commit on `Yoelcanarion/arena`;
  - push the working branches to the **private** origin once a night, as a backup (Yoel's standing OK):
    `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push -u origin <branch>`
- **Ask Yoel first:**
  - before merging into `master`. It is fast-forwarded from the main checkout, after checking that checkout is clean: `git -C C:/Users/yogar/orca/projects/work-orquestrator merge --ff-only <branch>`;
  - before pushing `master`;
  - before making the repo public;
  - before deleting branches.
- Never use bare `git stash` (the stash is shared across worktrees). Use a WIP commit.
- `core.autocrlf=true`: the working tree is CRLF. Write any script that contains backslash escapes to a file with the Write tool and run it, rather than through a heredoc.

### Secrets and PII
- Never print, paste or commit secret values. `MODEL_API_KEY` and `HF_TOKEN` live in `~/.fractalswarm/.env`.
- Live-input runs (Yoel's typed text) stay in the gitignored runs directory, never in git, unless Yoel chooses otherwise. Before anything goes public:
  - run the secret scan and a PII scan over the whole history;
  - check every bundle in `demo/`.

### Determinism
- `uv run fractalswarm replay RUN --verify` must stay green for every recorded bundle at HEAD, including `demo/` and `tests/golden/`.
- Handler changes are gated by mode or by an opt-in field. The default path stays event-identical. Check that with the $0 reference comparison before merging any branch that touches `kernel/`, `coord/`, `actors/`, `market/`, `planning/` or a task.
- **Handler freeze: as soon as the last handler change has merged and the real rival rows have run; Sun Nov 1, 20:00 CET at the latest.** After it, only UI, docs and bench reporting change. The final recordings must replay at HEAD.

## Phase 0 (spec §K): do it yourself, before any worker starts

### 1. Shared evidence, out of git
1. Read `src/fractalswarm/config.py`. Confirm that `FRACTALSWARM_RUNS_DIR` is read from `~/.fractalswarm/.env`, the way the ledger path is. If it is not, fix that first.
2. Move `C:\Users\yogar\orca\workspaces\work-orquestrator\day-09\runs` to `C:\Users\yogar\.fractalswarm\runs`. Then add `FRACTALSWARM_RUNS_DIR=C:\Users\yogar\.fractalswarm\runs` to `~/.fractalswarm/.env`: append that one line, and never print the file.
   - Check that the API catalogue and `replay` find the runs from both the day-09 and the arena worktrees.
   - Check that the tests don't depend on a repo-relative `runs/`: they should use tmp dirs.
3. Add `bench/results/*/runs/` to `.gitignore`. Copy `day-09/bench/results/` into the arena worktree.
4. Commit only `bench/results/v1/cells/*.json` (about 128 KB), plus the matrix summaries if they are small.

### 2. Merge `Yoelcanarion/day-09-integration`
Follow the Day 9 progress entry ("Next, in order", steps 2–4):
1. **Record the $0 references at the current HEAD.** Set `FRACTALSWARM_RUNS_DIR` and `FRACTALSWARM_LEDGER_PATH` to a scratch dir, never the real ledger:
   - `fractalswarm run tasks/examples/t2-conference.yaml --chaos C0|kill-half|C3`;
   - the T1 and T3 smokes;
   - `bench bench/matrix.yaml --fake --out <dir>`.
2. Merge with `git merge --ff-only Yoelcanarion/day-09-integration`, or a normal merge if arena has moved. Then `uv sync`.
3. Record the same runs again and compare them event by event. Expect no difference; explain any.
4. Run the full `uv run pytest` (it includes the resume real-kill tests), `ruff check`, `ruff format --check` and `demo --verify`.
5. Run the economy mutation checks. Their list is in the economy worker's report. If the script is gone, rebuild the 8 mutations from that list. Each must fail at least one test.

### 3. The v1 tail: finish it or supersede it (Yoel decides)
- **What it is:** 3 pipeline cells, about $1.
- **What the design review found** (`backend-design.md` §3): v1's runs replay only at their recording commit (587c88f), and the rivals matrix v2 carries the reference rows. Check that claim: replay one v1 run at the current HEAD.
- **Then put it in the step 5 message:** finish v1, or supersede it.
- **If Yoel says finish:**
  - run `uv run fractalswarm bench bench/matrix.yaml --confirm-real-spend` in a quiet window (it skips the finished cells);
  - then regenerate the v1 chart.

  This doesn't block the workers.

### 4. Known issues
- **Crashed runs show as "running"** (`api/catalog.py` `_status`). W2 owns `api/`, so put it in W2's list, or fix it now if it is a one-liner.
- **The PromptGuard tokenizer warning:** check whether the scores change. Compare the recorded scores from Day 8 with a fresh local scoring of the same texts (local, $0).
- **Stale reservations from cancelled calls in the project ledger:** report them in `spend`, rather than silently release them.

### 5. Decisions to bring to Yoel (one message, sent right after step 2)
- Merge `resume` as opt-in and keep it out of the demo? Recommended: yes. It is already in the integration merge, so a "no" means reverting it.
- The v1 tail: finish it (about $1), or supersede it with matrix v2? Give your recommendation after the replay check in step 3.
- A real resume smoke run, about $0.01–0.05? Optional.
- Delete the `worktree-agent-*` branches?
- Fast-forward `master` to `Yoelcanarion/arena` once Phase 0 is green? It then holds days 3–9, the integration branches and the Phase 2 plan.

Start the workers right after sending it. Don't wait for the answers, which block none of them.

## Workers
Start them after Phase 0 steps 1–2 are green and committed: the workers branch from `Yoelcanarion/arena` and must see the merged code.

| Worker | Brief | Branch | Starts | Merge order |
|---|---|---|---|---|
| W1 `rival` | `.plans/arena/w1-rival.md` | `Yoelcanarion/arena-rival` | After Phase 0 | 1st (durable modes and metrics, then the sweep tooling) |
| W2 `intake` | `.plans/arena/w2-intake.md` | `Yoelcanarion/arena-intake` | After Phase 0 | Independent of W1, but rebase on arena before merging |
| W3 `meta` | `.plans/arena/w3-meta.md` | `Yoelcanarion/arena-meta` | After Phase 0; the lens backend first | The lens API any time; the arbitration hook after W1 |
| W4 `ui-core` | `.plans/arena/w4-ui-core.md` | `Yoelcanarion/arena-ui-core` | After Phase 0 | Early: design tokens and the store factory in its first merge |
| W5 `ui-arena` | `.plans/arena/w5-ui-arena.md` | `Yoelcanarion/arena-ui-arena` | After W4's first merge, as the 5th worker only if memory allows | After W4 |

**Start command** (check the flags against the guide):
```
orca orchestration worker-start --spec "Read .plans/arena/w1-rival.md in your worktree and follow it. Your coordinator is the arena workspace." --worktree new-child --name arena-rival --base-branch Yoelcanarion/arena --agent claude --model claude-sonnet-5-5 --effort max --task-title "W1 rival" --json
```

**Each dispatch must also say:**
- no real API calls;
- no edits outside the worker's files;
- no `.plans/progress.md` edits: each worker writes its notes to `.plans/notes/arena-<name>.md`;
- hold heavy commands when you say HOLD;
- report: branch, commit, test counts, done and not done, deviations, open questions.

**Supervision:**
- Use `orca orchestration check --wait` in a loop, and `worker-read` when a worker is quiet for long.
- Answer questions quickly; a blocked worker wastes the day.
- If two workers need the same file, decide the owner and tell both.

## Merge procedure (each worker branch)
1. The worker reports done, with its tests green on its branch.
2. Read its diff. Look for:
   - handler changes outside its gate;
   - unsorted set iteration;
   - built-in `hash()`;
   - wall-clock reads in handlers;
   - secrets;
   - changes to files it does not own.
3. In arena: `git merge --no-ff Yoelcanarion/arena-<name>`, then `uv sync`. Run `npm --prefix web install` if the web dependencies changed.
4. Run the checks:
   - `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`;
   - if `web/` changed: `npm --prefix web run typecheck`, `npm --prefix web test` and `npm --prefix web run build`. The build output goes to `src/fractalswarm/api/static/`; remove stale hashed assets;
   - `uv run fractalswarm demo --verify` → MATCH;
   - `replay --verify` on `demo/backup` and the other bundles.
5. For a branch that touches handlers or a task, run the $0 reference comparison: default-path runs (swarm T2 C0, kill-half and C3; fake) must stay event-identical, unless the change is intended and gated.
6. Commit the merge, then write a short note in today's progress entry.
7. Tell the other active workers to merge `Yoelcanarion/arena` into their branch if they touch neighbouring code.
8. Release the merged worker's terminal.

## Decision gates with Yoel: stop and ask
Ask in Spanish, short and concrete, with your recommendation first. Use an orchestration gate (`gate-create`) when a worker task must wait on the answer.
1. **Phase 0 decisions** (above).
2. **The rival decision gate** (spec §C.4), after the $0 gate v2 and the sensitivity sweep, **before any real rival run**. Bring:
   - H1, H2 and H3 with their numbers;
   - the per-process view;
   - the conditions under which each holds;
   - your proposed outcome (A or B), and the exact headline sentence it allows.
3. **Merges into `master`:** `Yoelcanarion/arena` once Phase 0 is green (it holds day-09 and the integration merge), and again when everything else is in.
4. **Live input:** Yoel writes the text. Confirm with him that it stays out of git.
5. **Making the repo public:** after the recording and the final secret and PII scan.
6. **Any paid run outside the rules in "Money".**

## Order of work
2026-10-29, Yoel: no plan by days. Do everything as soon as its inputs exist, in the order of spec §I; when the list is done, Yoel adds more. Give workers no day targets: each takes its next item at once.
- Only the submission has a date: Yoel submits by Wed Nov 4, 20:00 (`cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit`), after the final README and a fresh-clone `demo --verify` with no API key.
- The handler freeze comes as soon as the last handler change has merged and the real rival rows have run, Sun Nov 1, 20:00 at the latest.
- If something blocks, tell Yoel what moves, and keep the crown jewels and the three answers first.

## The story you own
- **`docs/claims.md`:** one row per public claim, with the claim text, the failure model, the run ids, the metric values and the date. Start it on the day of the decision gate. The video script, the README and the form quote only rows from it.
- **`bench/REPORT.md`:** add the rival-assumptions table (spec §A), the sensitivity results and the per-process view next to the main chart. Relabel the old `central` row "in-process supervisor", with the 27-call explanation.
- **`docs/video-script.md`:** v0 is drafted. Fill in the numbers after the gate and the final runs (v1, Nov 1), and run the three-question check on the cut (spec, Verification).
- **`docs/submission.md`:** v0 is drafted. Keep it consistent with `docs/claims.md`.
- **README:** the top answers the three questions in that order. The rest follows Day 10's list.

## Daily routine
- **Start of day:**
  - `uv run fractalswarm spend`;
  - `orca orchestration worker-list`;
  - `check` your messages;
  - re-read the day's row in spec §I.
- **During the day:** supervise, merge, run the paid runs in quiet windows.
- **End of day:**
  - one progress entry (done, deviations, spend before and after, issues, next);
  - commit;
  - push the working branches to the private origin;
  - send Yoel a short summary in Spanish: spend, what merged, what is blocked, and the decisions he owes.

## If your context is compacted or you restart
Re-read this brief, the spec and the last progress entry. Then check `orca orchestration run-current`, `worker-list` and `check` before acting. Never start a duplicate worker for a stream that already has one.
