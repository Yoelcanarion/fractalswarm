# FractalSwarm — Progress log

Append one entry per day, newest last. Keep each entry short: done, decisions and deviations, spend, issues, next.

## Day 2 — Tue 27 Oct 2026 — Spec
**Done.** In-depth interview, which produced:
- `.plans/fractalswarm-spec.md` (v1.2);
- `CLAUDE.md`;
- the day prompts in `.plans/days/`.

**Key decisions:**
- **Hook:** "Kill half the brains. It still finishes — without stalling or paying twice. Verify it yourself." "Swarm" is never the headline.
- **Centralization:** "shared log, not shared brain" (Kubernetes analogy). The root is killable.
- **Topology:** fractal tree at depth 2 (root → 3 tracks → 6 sessions, 2 agents each). Bounded-load HRW ownership. Leaderless takeover with subtree adoption and root succession.
- **Determinism:** deterministic protocol plus record/replay. `replay --verify` and `demo --verify` work without an API key.
- **Tasks:** T2 (conference program from messy inputs) is the demo and headline task. T1 (extraction) is the secondary benchmark. T3 (web report) is a generic example.
- **Hero chart:** stall time and extra cost vs C0, against coordinators killed (0/1/3/5).
  - Baselines: single, central, pipeline, LangGraph, all with a best-case supervisor (restart 5 s after a crash, which equals our own detection latency; completed work preserved).
  - A $0 fake-LLM gate on Day 6 comes before any paid run.
- **Models:** Meta Model API. muse-wonder-1.0 plans and arbitrates; muse-spark-1.3 does the work; Contributor mode only with opt-in plus the PII gate. Benchmarks run in Contributor mode on synthetic tasks.
- **Supporting features:** internal market (epoch auction over $ + RPM/TPM), autoscale, breakers, LlamaFirewall safety. The task-splitting attack is in the video.
- **Process:** backup demo bundle on Day 7, attack clip on Day 8, repo public on the morning of Day 9.

**Spend:** $0.

**Environment:**
- Python 3.14 is installed; the project pins 3.12 via uv.
- uv 0.12.19, Node 24.22.1, npm 11.19.1, gh 2.103.2 (not logged in).
- No Docker. No git remote. The default branch is `master`.

**Status of Yoel's setup:**
- Done: `gh auth login`, as Yoelcanarion with the `repo` scope. The private repo is created by the bootstrap chat.
- Done: HF access to `meta-llama/Llama-Prompt-Guard-2-22M` granted on Day 2.
- Pending: put `MODEL_API_KEY` (and `HF_TOKEN`, a Read token) in `C:\Users\yogar\.fractalswarm\.env`. This file is outside the repo and shared by every worktree. The Meta key is created under API keys on dev.meta.ai.
- Credits: requested on Day 2 through Meta's "Model API Credit Claims" form. Once applied, they show on dev.meta.ai under Billing → Free credits; on Day 2 they were not showing yet. The account has Yoel's card on file, so until then every real call is charged to the card.
- Days 2–3 can run without the key or the credits, on the fake LLM. The first real run on Day 4 (Thu 29 Oct) needs both, so they must be in place by Wednesday night.
- Pending: merge `Yoelcanarion/Inicio-plan` into `master` before opening the Day 2 bootstrap worktree.

**Next:** Day 2 afternoon, in a new chat: `.plans/days/day-02-bootstrap.md`.

## Day 2 (afternoon) — Tue 27 Oct 2026 — Bootstrap + API spike
**Done:**
- **Project.** uv project pinned to Python 3.12.14, with `src/fractalswarm/` and the package folders of spec §18. Core deps plus a dev group. CLI `fractalswarm version`.
- **Settings.** `config.py` loads `~/.fractalswarm/.env` first, then a local `.env`. Empty values count as unset, and secrets are `SecretStr`.
- **Config.** `config/prices.yaml`, checked against the docs' pricing page: it matches spec §7.1, with no changes. Also `roles.yaml` and `defaults.yaml`.
- **Tests.** Smoke (imports, CLI, config consistency), settings precedence, and the determinism lint. 40 tests; pytest and ruff are green.
- **Repo hygiene.** `.gitignore`, `.env.example`, MIT `LICENSE` (holder: Yoelcanarion), README stub.
- **API spike script.** `scripts/spike_api.py`:
  - about 45 probes, covering every §24 item;
  - a budget guard (worst case $0.20, cap $0.50);
  - redacted evidence written to `runs/spike/`;
  - `--mock` mode, tested end to end at $0.

  It has **not run live**, because there is no `MODEL_API_KEY` yet (Yoel chose to leave it pending).
- **API notes.** `docs/api-notes.md` gives every §24 item from the official docs (dev.meta.ai/docs). Each item has a **Live** line, pending.
- **LlamaFirewall.** The `safety` extra installs on Windows (torch CPU, semgrep with a Windows wheel). PromptGuard 2 22M runs on CPU at about 40 ms per scan: `scripts/spike_promptguard.py`.
- **GitHub.** Private repo `Yoelcanarion/fractalswarm` created as `origin`. `master` (fast-forwarded to this branch) and `Yoelcanarion/day-02-bootstrap` are pushed.

**API facts that change the spec:**
1. **`web_search` exists only on the Responses API**, and the docs recommend Responses for agents. The LLM layer should therefore use Responses, statelessly: `store: false`, with the encrypted reasoning items replayed as input. Chat Completions stays as a fallback. (§14 did not fix the protocol.)
2. **Wonder has no Contributor variant on pay-as-you-go.** In Contributor bench runs (§15.6, §20), the root planner and the arbiter still pay Standard Wonder prices, unless the bench maps them to Spark Contributor at high effort. Decide on Day 6.
3. **`tool_choice` accepts only `"auto"`.** The agent loop (§10) cannot force a tool call, so it must handle a plain text reply at every step.
4. **`max_output_tokens` covers reasoning and visible output together.** `roles.yaml` leaves room for the reasoning. A truncated call comes back as `status: "incomplete"`.
5. **PromptGuard 2 does not flag the §13 poisoned email as worded** (score 0.0009). A variant with an explicit "ignore your previous instructions" scores 0.9978. Step 2 of the attack scenario therefore needs that wording; otherwise the clip relies on the scope check alone. Decide on Day 8.
6. **openai 3.40 runs on `httpx2`, not `httpx`.** The fault-injection transport (§14) should be an `httpx2` transport.
7. **Long non-streaming calls can return 504.** Wonder at high effort may need streaming or background mode.

**Deviations:**
- The `safety` extra pins `transformers<5` and `huggingface-hub<1`. llamafirewall 1.0.3 imports `HfFolder`, which huggingface-hub 1.0 removed, and transformers 5 needs huggingface-hub ≥ 1.31.
- llamafirewall's scanner hard-codes the 86M model, so the 22M model loads through a subclass.
- `LlamaFirewall.scan()` reloads the model on every scan and calls `asyncio.run`, so it does not fit the runtime. On Day 8, keep one PromptGuard instance and score in a worker thread.
- `roles.yaml` separates the arbiter from the root planner and the auditor from the judge, and adds `collision_check` (§6.2). Its `max_output_tokens` values are first guesses, to be tuned from the Day 4 cassettes.
- The determinism lint is AST-based and broader than spec §19's three patterns:
  - **Spec patterns:** `time.time`, `random.*` (except `random.Random`) and `hash(`.
  - **Also flagged:** other clock reads, `uuid1`/`uuid4`, `os.urandom` and `secrets`.
  - **Exception:** a line that must touch the real world (the live clock, the effect runner) carries `# determinism: allow`.

**Spend:** $0. No real API calls were made.

**Issues:**
- `MODEL_API_KEY` is empty in `~/.fractalswarm/.env`, and the credits do not show in Billing yet. The live spike must run before the first real call, which is Day 3 item 13 or the Day 4 run at the latest.
- The PromptGuard model takes 2 × 279 MB on disk: the HF cache plus llamafirewall's own re-saved copy.

**Next:**
- Day 3: kernel, verifiable replay and LLM layer (`.plans/days/day-03.md`).
- As soon as the key and the credits are in place:
  1. Run `uv run python scripts/spike_api.py` (at most $0.20).
  2. Fill in the **Live** lines of `docs/api-notes.md`.
  3. Record the spend here.

## Day 3 — Tue 27 Oct 2026 (brought forward from Wed 28) — Kernel + verifiable replay + LLM layer
**Done:**
- **Kernel** (`kernel/`):
  - `ids.py`: canonical JSON, blake2b helpers, `stable_hash` (identical across processes, tested with different `PYTHONHASHSEED`s), chain hash.
  - `events.py`: the §5.1 envelope and a type registry; every payload is validated before it enters the log.
  - `store.py`: SQLite WAL, append-only, hash chain, `idem_key` UNIQUE, `verify_chain()` naming the first bad seq, JSONL export/import.
  - `clock.py`: `live`, `sim` and `replay` clocks, plus Lamport helpers.
  - `scheduler.py`: actor registry, one queue ordered by `(vtime, lamport, seq)`, commands `Emit`, `Send`, `StartEffect`, `SetTimer`, `Spawn`, `Stop`, plus `Cancel` and `SetCap`.
  - `effects.py`: the effect runner (asyncio tasks) with a live driver (arrival order) and a sim driver (virtual completion order).
  - `replay.py`: generic replay with a first-divergence report.
- **LLM layer** (`llm/`):
  - `client.py`: Responses API, stateless (`store: false`); role routing; retries on 429/500/503 and transport errors, with backoff, seeded jitter and `Retry-After`; rate-limit header parsing; cost from usage.
  - `cassette.py`: one entry per call with every attempt; secrets redacted before writing (headers, `LLM_…` keys, `hf_…` tokens, bearer tokens, the configured secret values).
  - `fake.py`: a scripted, deterministic fake that returns Responses-shaped JSON, with a `LatencyModel` hook for Day 5.
  - `roles.py`.
- **Market** (`market/`):
  - `ledger.py`: the in-run `Ledger` (caps per contract, squad, run and project) and the persistent `ProjectLedger` (atomic `BEGIN IMMEDIATE` reserve).
  - `prices.py`.
- **Wiring and CLI.**
  - `runs.py` records a run directory (`events.sqlite`, `events.jsonl`, `cassette.jsonl`) and replays one.
  - CLI: `fractalswarm toy`, `replay RUN [--verify]`, `spend`.
- **Toy scenario** (`actors/toy.py`): a hub and two workers, two rounds of fake LLM calls, seeded timers, progress pings, a judge merge and a cancelled deadline timer: 56 events. `ONE_CALL` is ready for the real-call golden.
- **Tests:** 87 green; ruff green.
  - `tests/integration/test_replay_verify.py`:
    - the golden bundle (`tests/golden/toy`) replays to its recorded head;
    - a fresh run reproduces the golden head;
    - a live-clock run with racing completions replays;
    - retries and errors replay;
    - an edited log is caught by the chain;
    - a resealed forgery (valid chain, forged LLM answer) is caught by replay;
    - an edited cassette is caught;
    - the CLI exit codes are checked.
  - Hash-chain tamper tests.
  - Ledger property tests: hypothesis over reserve/settle sequences, and 8 threads racing on the SQLite project ledger.
  - The real backend is tested against an in-process `httpx2.MockTransport` (auth sent, not recorded).
  - The determinism lint now covers the real kernel and market code.

**Exit criteria:**
- Tests: all green.
- `replay --verify`: MATCH for the toy scenario. The real-call golden is pending (item 13).
- Spend: $0.

**Deviations:**
- **Handlers return `(new_state, commands)`**, not just `commands`, so that state changes stay pure and explicit.
- **`ts_virtual` is an integer in milliseconds.**
- **Three clock modes.** The added `sim` mode is a discrete-event clock: fake runs take no wall time, and their latencies still produce meaningful virtual stall times. Day 6 needs this.
- **Replay recomputes LLM completions from the cassette.** It does not copy them from the log. The cassette must hold the exact request the replayed actor makes, so replay checks the handlers, the cassette and the response parsing together. The recorded log supplies only the position and timestamp of each outside event. Timers take their payload from the log.
- **Config snapshot.** `run.started` stores the role and price tables. Recorded runs therefore keep replaying after `roles.yaml` is tuned on Day 4.
- **Budget in two layers.**
  - The run book (contract, squad, run, plus a snapshot of the project remainder) lives in the kernel, so `budget.reserved`, `budget.refused` and `budget.settled` are logged and replayed.
  - The persistent project ledger is checked inside the LLM client, for real backends only.
  - A real call that is cancelled or crashes leaves its project reservation open on purpose, in case it was billed.
- **The project ledger lives at `~/.fractalswarm/ledger.sqlite`**, not at `runs/ledger.sqlite`. Each day has its own worktree, so a per-worktree ledger would lose spend history. `FRACTALSWARM_LEDGER_PATH` overrides it.
- **Additions:**
  - the `Cancel` command and the `effect.cancelled` event;
  - `runs.py`, which is not in the §18 layout;
  - the `fractalswarm toy` command;
  - the fake LLM works at the backend level, so fake and real calls share parsing, cost and cassette code.
- **Token-count endpoint not used** (api-notes item 8). Reservations use a local upper bound of `len(canonical_json(body)) / 2` input tokens plus the full `max_output_tokens`.

**Spend:** $0. No real API calls were made: Yoel asked for none today, and `MODEL_API_KEY` is still empty.

**Issues and pending:**
- **Item 13 is pending:** one real, tiny recorded Spark call, replayed hash-identically, and stored as a golden fixture. The code path is ready: `fractalswarm toy --scenario one-call --backend real --confirm-real-spend`, then `replay <run> --verify`, then copy the bundle to `tests/golden/one-call/`. It needs the key, the credits in Billing and Yoel's go-ahead. Worst case is about $0.01.
- **The live spike** (`scripts/spike_api.py`) is still pending, for the same reasons.

**Next:** Day 4 (`.plans/days/day-04.md`). Before its first real run:
1. The key and the credits must be in place.
2. Run the live spike.
3. Do item 13.

### Day 3 addendum (Tue 27 Oct, evening): first real calls
- Yoel set `MODEL_API_KEY` and confirmed the $150 credits in Billing.
- **Item 13 done.** One real Spark call (`toy --scenario one-call --backend real --clock live`, run `golden-one-call`) cost $0.0005 (15 input, 115 output tokens of which 105 reasoning, 2.6 s). `replay --verify` gives MATCH. The bundle is in `tests/golden/one-call/` and `test_real_spark_call_replays_to_its_recorded_hash` guards it. The key appears nowhere in the cassette or log.
- **Live spike done:** `scripts/spike_api.py --yes`, about 45 probes, $0.0454. Evidence in `runs/spike/spike-20261027T214932Z-live.{json,md}` (gitignored). The spike does not go through the project ledger, so its spend was entered by hand as reservation `spike-20261027T214932Z`.
- **Spend so far:** $0.0459 of $150 (`fractalswarm spend`).
- From here on, the work runs as parallel streams, each in its own worktree; see the next entries.
