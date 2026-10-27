# Day 2 (afternoon) — Tue 27 Oct — Bootstrap + API spike

Paste this into a **new Claude Code chat**. Branch/worktree: `day-02-bootstrap`, from `master`.

## Read first
- `CLAUDE.md`
- `.plans/fractalswarm-spec.md` §0, §7.1, §14, §18, §19 (lint test), §20, §24
- `.plans/progress.md` (last entry)

## Goal
Build the project skeleton, and replace assumptions with **verified facts** about Meta Model API and LlamaFirewall, so every later day builds on facts.

## Tasks (in order)
1. **uv project.** Pin Python 3.12 (`uv python pin 3.12`). Create the src layout `src/fractalswarm/` with the package folders from §18 (empty `__init__.py` files). In `pyproject.toml`:
   - core deps now: openai, pydantic, pydantic-settings, httpx, typer, rich, pyyaml;
   - dev group: pytest, pytest-asyncio, hypothesis, ruff;
   - heavy deps (fastapi, llamafirewall/torch, langgraph, langchain-openai, matplotlib, trafilatura) are added on the day they are needed.
2. **Repo hygiene.**
   - `.gitignore`: `.env`, `.venv/`, `runs/`, `__pycache__/`, `web/node_modules/`, `web/dist/`.
   - `.env.example`: `MODEL_API_KEY=`, `HF_TOKEN=`, `FRACTALSWARM_PROJECT_CAP_USD=150`. It only documents the variables; the real values already live in `~/.fractalswarm/.env`.
   - `LICENSE`: MIT. Ask Yoel which name to use as copyright holder.
3. **Config skeletons** in `config/`:
   - `prices.yaml`, from §7.1;
   - `roles.yaml`, mapping each role to (model, effort, max_output_tokens), from §7.4;
   - `defaults.yaml`: caps, heartbeat 1 s, dead after 5 missed, epoch timing, breaker thresholds from §8.
4. **CLI and settings.**
   - `src/fractalswarm/cli.py`: a typer app with a `version` command and the console script `fractalswarm`.
   - `config.py`: pydantic-settings (`MODEL_API_KEY`, `HF_TOKEN`, caps). It loads `~/.fractalswarm/.env` first, because that file is shared by every worktree and already holds Yoel's keys, then a local `.env` if one exists. Never print or log the values.
5. **Tests.**
   - `tests/unit/test_smoke.py`.
   - `tests/unit/test_determinism_lint.py`: forbids `time.time`, `random.` and `hash(` in `kernel/`, `coord/` and `market/`. It passes on the empty dirs.
6. **API spike.** Write `scripts/spike_api.py`, outside the package. Using tiny prompts, it verifies **every item of spec §24** against `https://api.meta.ai/v1`:
   - mainly muse-spark-1.3, plus 1 tiny muse-wonder-1.0 call and 1 contributor call;
   - **total spend ≤ $0.50**.

   Record the exact findings in `docs/api-notes.md`:
   - request and response shapes;
   - the reasoning-effort parameter name;
   - the structured-output format;
   - tool-calling shape and parallel calls;
   - whether `web_search` works on Chat Completions or only on the Responses API;
   - usage fields (cached and reasoning tokens);
   - the rate-limit headers actually seen;
   - 429 behaviour;
   - the token-count endpoint;
   - evidence about prompt caching.

   Correct `config/prices.yaml` if the docs differ.

   **Before running it, ask Yoel to confirm that the hackathon credits show on dev.meta.ai under Billing → Free credits.** Until they do, every call is charged to the card on file. **If `MODEL_API_KEY` is not set yet, or the credits are not there yet:** write the script anyway, make it exit with a clear message when the key is missing, and mark every §24 item as pending in `docs/api-notes.md`. Run it as soon as both are in place.
7. **LlamaFirewall install test.** Add `llamafirewall` as an optional `safety` dependency group, and try PromptGuard 2 22M on one benign string and one injection string, recording latency on CPU. HF access was granted on Day 2. Authenticate with `HF_TOKEN` from the settings. `huggingface_hub` reads the token only from the environment or a saved login, never from our settings object, so export it to `os.environ` before LlamaFirewall loads the model. If `HF_TOKEN` is still missing, record that and the fallback plan (spec §13) in `docs/api-notes.md`, and move on.
8. **Git.** Commit.
   - If Yoel has run `! gh auth login`, create the **private** GitHub repo `fractalswarm`, add it as `origin`, and push `master` and this branch. Ask before pushing.
   - If gh is still not logged in, leave this step pending in the progress log.

## Exit criteria
- [ ] `uv run pytest` and `uv run ruff check` are green.
- [ ] `uv run fractalswarm --help` works.
- [ ] `docs/api-notes.md` answers every §24 item, or marks it unknown with a plan.
- [ ] `config/prices.yaml` is verified.
- [ ] The PromptGuard status is recorded.
- [ ] The private repo exists, or is pending on Yoel's login.
- [ ] Spend ≤ $1.

## Out of scope today
Kernel, actors, planning, UI.

## End of day
- Tests and lint green.
- Append to `.plans/progress.md`: done, the API facts that change the spec (if any), spend, issues, next.
- Commit.
- Ask before merging into `master` or pushing.
