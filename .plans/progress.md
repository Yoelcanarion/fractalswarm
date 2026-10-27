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
