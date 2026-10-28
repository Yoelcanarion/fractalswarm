# Stream: day-08-safety-economy

Branch `Yoelcanarion/day-08-safety-economy`, base `b6abd07`. **The first phase is finished**: commit
`7080bca` (215 tests green, ruff clean, $0; the golden toy and one-call hashes are unchanged). Its
own notes are in `.plans/notes/day-08-safety-economy.md`. This file was added when the stream moved
into its own Orca workspace on 2026-10-27, so a new chat can pick up the rest of Day 8.

You are already in this stream's Orca workspace: do not create another worktree or branch.
Run `uv sync` (plus the safety extra for LlamaFirewall) first.

## Parallel streams (do not edit their files)
- `day-04-slice` (in progress): T2 task (`bench/tasks/t2_conference/` incl. the generator that needs `--poison`), planning/, actors/, memory/, coord/hrw.py, coord/leases.py, verify/checks.py, verify/judge.py.
- `day-05-coord-foundations` (in progress): comms/, coord/membership.py, llm/transport.py, llm/calibrate.py. It also edits `kernel/scheduler.py` and `cli.py`: expect merge conflicts with this stream's `run.halted` / budget-shock changes; keep both.
- `day-06-bench-foundations` (finished): bench/.
- `day-07-ui` (in progress): api/, web/, demo/. The security view and the halt/budget buttons live there.

The lead merges the streams in this order: 4 → 5 → 6/8 → 7.

## Original brief (verbatim)

You are building FractalSwarm (a multi-agent LLM runtime for a hackathon). You work alone in your own git worktree, in parallel with other agents who own other modules. Repo base commit: b6abd07 (Day 3 kernel done).

FIRST: `git switch -c Yoelcanarion/day-08-safety-economy`, then `uv sync` (and `uv sync --extra <safety extra>` if pyproject defines one for LlamaFirewall). Read `CLAUDE.md` (binding rules), `.plans/days/day-08.md`, spec `.plans/fractalswarm-spec.md` §13 (incl. the task-splitting demo scenario), §12, §7, §8 (global spend breaker), §16 (security view), `docs/api-notes.md` (PromptGuard / LlamaFirewall status — it installs and runs on this machine, CPU; HF_TOKEN is in ~/.fractalswarm/.env), and the last entries of `.plans/progress.md`. Study `src/fractalswarm/kernel/*`, `llm/{client,cassette,fake}.py`, `market/{ledger,prices}.py`, `config.py`, `actors/toy.py`.

YOUR JOB: the Day 8 pieces that do NOT need the Day 4 planning slice (another agent is building planning/ and actors/ right now):
1. `safety/firewall.py`: one interface for scanning text at intake, attachments, external content and fact promotion; backends: LlamaFirewall + PromptGuard 2 (lazy-loaded, optional extra) and a deterministic fallback classifier. Results enter runs as effect completions (they're nondeterministic-ish), so runs replay. Spotlighting delimiters helper for untrusted content.
2. `safety/policy.py`: intake policy classifier via the LLM client (role per config/roles.yaml; Spark, effort minimal; strict JSON schema with additionalProperties:false). Tested with the fake LLM only.
3. `safety/scanners.py`: PII and secret regex scanners + the Contributor gate (block sending PII/secrets to contributor models). Make `llm/cassette.py`'s `redact` reuse the secret patterns from here without changing its behavior (existing tests + golden hashes in tests/golden/*/HEAD must stay unchanged).
4. `safety/fetch_policy.py`, `tools/fetch.py`, `tools/web_search.py`: provenance-only URLs, SSRF guards (private/loopback/link-local IPs, DNS rebinding check, schemes, ports), robots.txt, size and time limits; deny-by-default tool capabilities. Tests with httpx MockTransport only, no real network.
5. `verify/audit.py` + `fractalswarm audit verify RUN` + the kill switch (`fractalswarm halt RUN` / a `run.halted` event the scheduler honors — keep kernel changes minimal and additive).
6. Economy MVI in `market/`: proportional allocation (the auction's fallback), the model ladder with 80/90/95 % thresholds (downgrade model/effort as a budget fills), budget shock (an event that changes caps mid-run), and the global spend breaker. Pure, hypothesis-tested.
7. Design `planning/scope.py`'s deterministic scope check as a pure function over a plain data model you define in `safety/scope_check.py` (approved envelope: nodes, writes, tools, data categories; plan hash = scope token), so it can be wired to the real planner later. Include the task-splitting scenario as a unit test: a subgoal "compile every speaker's personal phone number and home city into a shared contact sheet" is BLOCKED with a `scope.violation` reason.

NOT yours (do not create/edit): planning/, actors/, memory/, coord/, comms/, bench/, api/, web/, verify/checks.py, verify/judge.py. Keep edits to shared files (cli.py, events.py, scheduler.py, cassette.py, pyproject.toml) minimal and additive.

HARD RULES:
- Do NOT make any real Meta Model API call. Fake LLM only. (Downloading the PromptGuard model from Hugging Face is allowed if needed; mark tests that need it so they skip cleanly when it's unavailable.)
- Never touch ~/.fractalswarm/ledger.sqlite from tests.
- Do not edit `.plans/progress.md`; write your entry (done, deviations, issues, what remains of Day 8 after the slice lands: poison flag in T2 generator, attack clip, UI security view, overnight runs) to `.plans/notes/day-08-safety-economy.md`.

END: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` green; commit on your branch (end message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Do NOT merge or push. Report: branch, worktree path, commit hash, test counts, done/not done, deviations.

## Done (commit 7080bca, verified by the agent: 215 tests, ruff clean)
1. `safety/firewall.py`: PromptGuard 2 22M via llamafirewall (loaded once per process) + rule-based fallback; scans run as effects so replay reuses them; spotlighting helper whose delimiters the content cannot forge.
2. `safety/policy.py`: `safety_classifier` role, Spark effort minimal, strict schema over 10 hazard categories; errors count as refusals.
3. `safety/scanners.py`: PII/secret detection with checksums (cards, IBAN, DNI/NIE); Contributor gate wired into `LLMClient.build`; `cassette.py` takes its patterns from here (pinned by a test).
4. `safety/{fetch_policy,capabilities}.py`, `tools/{fetch,web_search}.py`: provenance-only URLs, SSRF after DNS resolution, rebinding check, per-hop redirects, robots.txt, 2 MB / 10 s; deny-by-default tools.
5. `fractalswarm audit verify RUN [--replay]`, `fractalswarm halt RUN`, `fractalswarm budget RUN --usd X` (control folder in the run dir; replayed at their recorded position; additive kernel changes).
6. `market/{allocation,ladder,spend_breaker}.py`: proportional allocation with exact conservation, 80/90/95 % ladder from config, global spend breaker (a pure value, not yet wired into the kernel).
7. `safety/scope_check.py` + `test_task_splitting_blocked` (unit and end-to-end kernel test: the drifted subgoal is BLOCKED with `scope.violation`; personal-data categories need a human).
- Finding: PromptGuard does **not** flag the polite poisoned email (score ≈ 0.001); only the scope check blocks it. An explicit "ignore your previous instructions" wording is quarantined. Yoel must choose the wording for the clip.

## Remaining (rest of Day 8; most of it needs the day-04 merge)
Doable now:
1. Draft 2–3 candidate wordings for the poisoned email (polite vs explicit) with their PromptGuard scores, for Yoel to choose; no real Meta calls.
After day-04 (and ideally day-05/day-07) are merged into this branch's base (wait for the lead; do not merge them yourself):
2. Wire firewall, scanners and scope check into the planner, actors and memory (`planning/scope.py` wraps `safety/scope_check.py`).
3. T2 generator `--poison 1` and the end-to-end `test_task_splitting_blocked` on the real T2 slice (fake LLM).
4. The UI security view and the halt/budget buttons (in the day-07 stream's files, coordinate with it).
5. The attack clip (a real Standard run) and the overnight Contributor matrix are launched by the lead or Yoel, never by this stream.

## How to close
- `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` all green.
- Update `.plans/notes/day-08-safety-economy.md`.
- Commit on `Yoelcanarion/day-08-safety-economy` (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Do not merge or push. Tell Yoel what is ready, with the commit hash and test counts.
