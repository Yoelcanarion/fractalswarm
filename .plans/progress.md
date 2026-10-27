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
- Done: HF access requested for `meta-llama/Llama-Prompt-Guard-2-22M`; approval may still be pending.
- Pending: put `MODEL_API_KEY` (and `HF_TOKEN`, a Read token) in `C:\Users\yogar\.fractalswarm\.env`. This file is outside the repo and shared by every worktree. The Meta key is created under API keys on dev.meta.ai.
- Credits: requested on Day 2 through Meta's "Model API Credit Claims" form. Once applied, they show on dev.meta.ai under Billing → Free credits; on Day 2 they were not showing yet. The account has Yoel's card on file, so until then every real call is charged to the card.
- Days 2–3 can run without the key or the credits, on the fake LLM. The first real run on Day 4 (Thu 29 Oct) needs both, so they must be in place by Wednesday night.
- Pending: merge `Yoelcanarion/Inicio-plan` into `master` before opening the Day 2 bootstrap worktree.

**Next:** Day 2 afternoon, in a new chat: `.plans/days/day-02-bootstrap.md`.
