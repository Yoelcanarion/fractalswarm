# Day 8 slice: safety core, kill switch, audit, economy MVI

Branch `Yoelcanarion/day-08-safety-economy`, based on `b6abd07`. This slice is the part of Day 8 that does not need the Day 4 planner. It was built in parallel with the planning/actors stream. Merge this entry into `.plans/progress.md` when the slice lands.

## Done
- **`safety/scanners.py`**: regex scanners for PII and secrets.
  - PII: email, phone, IBAN (mod-97 check), card (Luhn check), DNI/NIE (control-letter check).
  - Secrets: Meta `LLM_` keys, Bearer tokens, `hf_` tokens, `sk-` keys, AWS and GitHub tokens, private keys and password assignments.
  - `redact_findings` hides each match in logs and the UI.
  - **The Contributor gate** (`contributor_gate`) fails closed. It is wired into `LLMClient.build`: a request with `contributor=True` stays on the Standard model if the scanners flag its instructions or input.
  - **Cassette redaction** now imports `SECRET_PATTERNS` and `redact_secrets` from here. The patterns are the same, in the same order. Golden HEADs are unchanged, and a test pins the pattern list.
- **`safety/firewall.py`**: `Firewall` gives one interface over four surfaces: `intake`, `attachment`, `external` and `fact`.
  - Backends:
    - `PromptGuardBackend` runs PromptGuard 2 22M through llamafirewall's `PromptGuard` loader. It loads lazily, once per process, runs in a worker thread, and scores long texts in 1500-character windows.
    - `HeuristicBackend` is the deterministic fallback: a set of instruction-override patterns.
    - `default_backend()` picks PromptGuard when the extra and the model are available.
  - Decisions: a score ≥ 0.9 quarantines attachments and external content, and blocks intake and facts. A secret in a fact always blocks its promotion.
  - The scan runs as a `firewall` effect, so its verdict enters the log as the effect's completion. Replay reuses the recorded verdict, because no replayer recomputes it.
  - `spotlight()` wraps untrusted text in delimiters. A content-derived tag on the delimiters, plus neutralising any delimiter inside the text, prevents forged or premature closing markers. `SPOTLIGHT_RULE` is the static prompt text that explains the delimiters.
- **`safety/policy.py`**: the intake policy classifier.
  - `policy_request()` builds an `llm` effect request. Role `safety_classifier` resolves to Spark at effort minimal.
  - The schema is strict: `additionalProperties: false` and every property required. It covers the 10 spec hazard categories, with decisions allow, constrain or refuse.
  - The task text is spotlighted in the input, never put in the instructions.
  - `parse_policy` fails closed: an error, invalid JSON or an unknown category all mean refuse. Tested with the fake LLM only.
- **`safety/scope_check.py`**: the deterministic scope check, as a pure data model.
  - `ApprovedPlan` holds the nodes; each node lists its writes, tools and data categories. `scope_token` is the order-independent hash of the plan.
  - `check_scope(plan, subgoal, approvals)` checks the subgoal's token, its node mapping, and that its writes, tools and data categories stay inside the envelope. A new subgoal is checked against the union of the plan's nodes.
  - Data categories are the declared ones plus those inferred from the objective text (`pii.contact`, `pii.identity`, `pii.financial`, `pii.health`, `secret`). An undeclared drift is still caught.
  - A `scope.approval` is bound to the subgoal's digest and must come from an ancestor. **Sensitive categories (`pii.*`, `secret`) need `approver == "human"`.**
  - `ScopeDecision.violation_payload()` builds the `scope.violation` event.
  - **`test_task_splitting_blocked`** exists twice:
    - a unit test in `tests/unit/test_scope_check.py`;
    - an end-to-end version in `tests/integration/test_task_splitting.py`. There, the polite email passes the firewall (score 0.0), its drifted subgoal gets `scope.violation` with evidence `{source_id, firewall_decision, score, branch}`, `audit_log` passes, and replay matches. The explicit-override variant is quarantined, and the scope check still blocks it when forced through.
- **`safety/events.py`** registers these audit event types: `security.scanned`, `security.quarantined`, `security.policy`, `security.routed`, `tool.denied`, `scope.approval`, `scope.violation`.
- **`safety/capabilities.py`**: deny-by-default tool grants per contract. Each denial builds a `tool.denied` payload.
- **`safety/fetch_policy.py` and `tools/fetch.py`**: the fetch policy.
  - Provenance: the task or `web_search` hits. URLs are normalised and the fragment is dropped.
  - Only http/https on ports 80/443, and no credentials in the URL.
  - SSRF: every resolved address must be public. Blocked: loopback, private, link-local, CGNAT, multicast, reserved, unspecified, and IPv4 embedded in IPv6 (mapped, 6to4, Teredo).
  - DNS rebinding: the host is resolved twice and must give the same answer both times.
  - Redirects: every hop is checked again, with at most 3 redirects.
  - robots.txt: a 404 allows; 401/403/5xx or a network error disallows.
  - Limits: GET only, text/html or text/plain only, 2 MB (streamed), and 10 s for the whole fetch.
  - `Fetcher.effect()` provides the `fetch` effect.
  - All tests use `httpx.MockTransport` and a fake resolver. There is no real network.
- **`tools/web_search.py`**: `search_request()` builds an `llm` effect with the hosted `web_search` tool. It checks the capability, and the reservation includes the query price. `parse_hits()` reads `web_search_call` results and `url_citation`s. `register_hits()` feeds the provenance, and `spotlight_hits()` wraps the hits.
- **Kill switch**: `run.halted` and `Runtime.halt()`.
  - `Runtime.halt()` drops queued deliveries, cancels in-flight effects and releases their reservations, then stops every actor.
  - The drivers poll a `control` callback between steps. The live driver also polls every 0.2 s while it waits on effects.
  - `record_run` polls `runs/<id>/control/*.json`.
  - `fractalswarm halt RUN [--reason]` writes the request there.
  - Replay re-applies `run.halted` at its recorded position.
- **Budget shock**: `budget.shock` and `Runtime.shock()` set a new cap mid-run. The shock is delivered to every live actor so they can force an epoch. `fractalswarm budget RUN --usd X [--level --key]` requests one. Replay handles it.
- **`verify/audit.py` and `fractalswarm audit verify RUN [--replay]`**:
  - Checks: the hash chain, the HEAD file when one exists, a reason on every security decision, a scan before every quarantine, and that nothing starts, completes, sends or spawns after `run.halted`. With `--replay`, it also replays the run.
  - It lists the security decisions with one-line summaries, which the UI security view can reuse.
- **Economy MVI** (`market/`, pure and covered by the determinism lint):
  - `allocation.py`: `allocate_proportional` works in integer micro-dollars and assigns leftovers by largest remainder, so conservation is exact. Reserve: 15% at the root, 10% below. Tested with hypothesis: conservation, independence from input order, proportionality.
  - `ladder.py`: thresholds come from `defaults.yaml` (80/90/95). `ladder_state` gives flags: speculative, scale_down, critical_only, stop. `degrade(roles, role, level)` returns the role's model and effort for that level. `run_ladder(ledger, run)` reads committed spend from the in-run book, so a shock that lowers the cap moves the level at once. Tested with hypothesis for monotonicity.
  - `spend_breaker.py`: the global spend breaker as an immutable state. It opens when the burn over 60 s of virtual time exceeds 20% of the remaining budget, pauses new contracts for 30 s, then recovers on its own. Tested with hypothesis.
- **Tests:** 215 passed, up from 88. The PromptGuard test (`@pytest.mark.promptguard`) runs the real 22M model on CPU, takes about 8 s, and skips when the extra or the model is missing. Ruff check and format are green.

## Deviations
- **The scope check lives in `safety/scope_check.py`**, as a pure model, instead of `planning/scope.py`, because `planning/` belongs to the Day 4 stream. `planning/scope.py` should wrap it:
  - build `ApprovedPlan` from the approved DAG;
  - stamp `scope_token` on contracts;
  - emit `scope.violation` and `scope.approval`.
- **New modules not in the spec §18 layout:** `safety/events.py`, `safety/capabilities.py`, `market/allocation.py`, `market/ladder.py` and `market/spend_breaker.py`. They are kept separate from `auction.py` and `comms/breakers.py`, which belong to other streams.
- **Firewall verdicts are effects.** Replay reuses the recorded result and does not re-score it, as api-notes recommends.
- **PromptGuard does not flag the polite poisoned email** (score about 0.001). Only the explicit-override wording is quarantined. The attack clip relies on the scope check either way.
- **Halt and budget shock are outside (`@env`) events.** They enter the log at the point the driver applies them, like effect completions. `run.completed` gained no `halted` field, which keeps the golden hashes unchanged.
- **The control channel is a file inbox in the run directory**, because the CLI runs in another process. The API (Day 9) can call `Runtime.halt` and `Runtime.shock` directly.
- **The spend breaker is not wired into the kernel.** It is a pure value that orchestrators keep in their state and consult before starting contracts. Wiring it is Day 4/9 work.
- **DNS pinning limitation:** httpx resolves the host once more when it connects. The double check catches rebinding between our two lookups, but not an answer served only to httpx. This is documented in `tools/fetch.py`.

## Spend
$0. No real Meta Model API calls; fake LLM only. PromptGuard ran from the local model copy.

## Issues
- The worktree was created at `2440cc6`. The branch was reset to the stated base `b6abd07`, which has the one-call golden.
- The torch `jit.script` FutureWarning appears when PromptGuard loads. It is harmless.

## What remains of Day 8 after this slice lands
- **Wire into the planner** (needs Day 4 `planning/` and `actors/`):
  - `planning/scope.py` wraps `scope_check`;
  - contracts carry `scope_token`;
  - every replan runs `check_scope`;
  - the `scope.approval` flow goes through the escalation inbox;
  - AlignmentCheck runs on tool actions when r ≥ 0.7, using our own prompt with role `alignment_check`.
- **Wire the firewall** into intake, as `security.policy` plus a PromptGuard intake scan, and into attachment ingestion (T2 emails), external content (web_search and fetch effects) and fact promotion in `memory/`. Emit `security.routed` for every Contributor routing decision.
- **The T2 poison flag:** `t2_conference --poison 1` in the T2 generator (bench stream). The email wording must be chosen: polite (scope check only) or explicit (PromptGuard and scope check).
- **The attack clip:** record the poisoned-email run (Standard, short), redact it, run `audit verify --replay`, and save it to `demo/attack/`.
- **The UI security view** (web stream): highlight the poisoned email, show the drifted subgoal as BLOCKED, and show the audit entry with its reason. It can use `verify/audit.py` entries.
- **Budget shock through the API and UI:** `POST /runs/{id}/budget` and `POST /runs/{id}/halt` should call `Runtime.shock` and `Runtime.halt`.
- **The auction epoch on a shock:** orchestrators react to the `budget.shock` delivery and use `allocate_proportional` until the full auction exists.
- **Overnight runs:** the final matrix and the scaling sweep, both in Contributor mode.
