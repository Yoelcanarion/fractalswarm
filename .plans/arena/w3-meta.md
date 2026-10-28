# Worker brief W3 — `meta`

- **Branch:** `Yoelcanarion/arena-meta`. The coordinator created it from `Yoelcanarion/arena` as a child worktree, and you are already in it: do not create another worktree or branch.
- **Model:** Sonnet 5.5 at max effort. Invoke `/hard-task` for the arbitration design (disputes, the LCA and recovery through heirs).
- **Setup:** run `uv sync` first.

## Why this matters
The jury must see that Meta's models carry the value, and that FractalSwarm is not just a framework around them. You make that visible in three ways, in this order:
1. **The Muse lens:** every call's model, effort, tokens, cost and latency, and the sentence behind each decision.
2. **The ablation:** a hand-written parser against Muse Spark, on the same notes.
3. **Wonder arbitration at the lowest common ancestor (LCA):** a semantic conflict between two agents, settled by Wonder with the emails as evidence.

## Read first
- `CLAUDE.md` (binding): the determinism and security rules. External text is untrusted: spotlight it, and never put it in a system prompt.
- `.plans/arena-spec.md`: §0, §1 and §E.
- `.plans/arena/backend-design.md`: §0, §6 and §7. **This is your design.**
- The code:
  - `llm/{client,roles,cassette,fake}.py`;
  - `config/roles.yaml`, which already has `arbiter`, `collision_check`, `safety_classifier` and `alignment_check`, none of them called yet;
  - `bench/scoring.py`, which recomputes models from the `run.started` snapshot;
  - `api/{app,catalog}.py`;
  - `actors/board.py`;
  - `actors/orchestrator.py`: `_reconcile`, the central tick and `_dispatch`;
  - `bench/tasks/t2_conference/{task,fake}.py`, for `parse_email` and `parse_attendance`;
  - `safety/` (`read_blocks` and the spotlighting).
- **What the log already holds:**
  - `effect.started` keeps the full prompt;
  - `effect.completed` keeps the model, usage, cost and output;
  - `security.routed` records the Contributor routing.

## Your files
See backend-design §7.
- **You own:**
  - new `api/lens.py` (the lens and ablation routes);
  - new `bench/tasks/t2_conference/ablation.py`;
  - new `actors/arbitration.py`;
  - new `bench/tasks/t2_conference/arbitration.py`;
  - `actors/board.py`.
- **Light edits, which the coordinator reconciles:**
  - the orchestrator hooks (`_reconcile`, the central tick, `_dispatch`);
  - the `params.arbitration` flag in the TaskSpec;
  - one line in `api/app.py` that includes your router.
- **Not yours:**
  - the durable modes, metrics and `bench/*` (W1);
  - intake, the TaskSpec beyond the flag, the jobs API and the kernel (W2);
  - `web/`. W4 builds the lens UI on your endpoints; W5 builds the ablation UI.

## Replay-safety rules (backend-design §0)
- **Never add a field to an existing event payload model.** New event types only: `arbitration.requested`, `arbitration.ruled`, and the `DisputesView` inputs.
- **Arbitration is gated by `params.arbitration`,** which old logs don't have. With it off, every event is identical to today's: check this with the $0 reference runs before you report.
- **Don't change the prompts or schemas of existing roles.** A new field in the extract schema would change `effect.started` for every new run, the default path included. Where the lens needs the source sentence for a fact, find it by deterministic matching in the API, not in the model.
- **Determinism:**
  - no `hash()`;
  - no unsorted set iteration;
  - no wall clock in handlers;
  - all model output enters as effect completions.

## Your job, in order

### 1. The Muse lens API (backend-design §6): start here
`api/lens.py`, with these routes:
- `GET /api/runs/{id}/calls`, one row per LLM effect:
  - role, level, model, effort and max tokens (recomputed with `LLMClient.build` from the `run.started` snapshot);
  - Contributor routing;
  - usage, with the cached and reasoning token counts;
  - cost, latency, attempts (from the cassette) and the cancel cause.
- `GET /api/runs/{id}/calls/{effect_id}`, the same plus:
  - the prompt, split into DATA and UNTRUSTED blocks (`read_blocks`);
  - the output;
  - **the decision it caused:** the events whose `causation_id` is its completion;
  - for extraction calls, each fact next to its source sentence (deterministic matching).
- `GET /api/runs/{id}/models`, which feeds the "Muse meter":
  - $ and tokens by model;
  - the share of input tokens served from cache;
  - coordination tokens and recovery tokens. Both should be 0; compute them from the tags, don't hard-code them.

**Requirements:**
- It must work on the recorded runs that exist today: `demo/backup` and the real runs in the shared runs dir.
- It adds nothing to the events, so it carries no replay risk.
- Write the response shapes in your notes for W4.

**Tests:** on `demo/backup` and on a fake run, with exact numbers from the log.

**→ First merge: the lens API.** Tell the coordinator; W4 builds the UI on it.

### 2. Ablation (backend-design §6)
1. **The `ablation` scenario on an approved intake:**
   - per email: the regex `parse_email` against one Muse extraction that uses the extract guide;
   - per abstract: `parse_attendance` against Muse.
2. **Scoring,** against the approved reference: exact cells, Jaccard, preference, and attendance within ±10 %.
3. **The summary for the UI:** "the parser understood N of M notes, Muse K of M", with the differences per note.
4. **Two caveats,** written into the result payload:
   - run it on generator emails too, where the regex wins by construction;
   - Muse seeds the reference, and a human approves it.
5. **Until W2's approved intake merges,** develop on generator emails and on a hand-written approved sample in your tests.
6. **The endpoint:** `POST /api/ablation` (fake by default) and its result route, in `api/lens.py`.
7. **The $0 path:** with the fake backend. The coordinator runs the real one with Yoel's OK.

### 3. Wonder arbitration at the LCA (after W1 merges; backend-design §6)
Rebase on `Yoelcanarion/arena` once W1's durable modes have merged. Arbitration must work in the swarm **and** in the durable supervisors.
1. **Detection:**
   - the board sees a publish to a key that already holds another contract's different value (canonical JSON);
   - it marks the fact `disputed` and emits `collision.detected{kind: "semantic"}`;
   - a new `DisputesView` reducer tracks the open disputes.
2. **Arbitration:**
   - on its tick (the swarm's `_reconcile`, the central tick), the owner of the dispute's LCA goal runs the `arbiter` role: same track → the track goal; otherwise the root;
   - the call is Wonder at effort high, tagged `arbitrate|key|n`, with the disputed values and the source emails as spotlighted evidence;
   - it emits `arbitration.requested` and `arbitration.ruled` (the winner, a short reason, the confidence and the evidence ids), plus `collision.resolved`, and sends `fact.resolve` to the board;
   - confidence below 0.6 → `escalation.opened`. It is answered through `control.injected` if W2's stretch merged, or else left to the timeout.
3. **Effect on the work:** `_dispatch` holds a place contract whose speaker is disputed (30 s timeout), then overlays the arbitrated value.
4. **Recovery:** arbitration is log-driven, so an heir (swarm) or a restarted o0 (supervisors) picks an open dispute up. Test both.
5. **The $0 test:** a fake script variant forces a dispute. Then check:
   - the ruling;
   - replay MATCH;
   - a crash of the arbitrating orchestrator between `requested` and `ruled`, with the heir finishing the arbitration.
6. **A deadline.** It is priority 4 in the spec. If it is not merged by **Sun Nov 1 at 14:00**, tell the coordinator and drop it before the handler freeze at 20:00.

**→ Second merge: ablation and arbitration**, as separate commits, so the coordinator can take one without the other.

## Hard rules
- **No real Meta API calls.** Fake LLM and recorded runs only. The coordinator runs every paid call.
- **Never touch `~/.fractalswarm/ledger.sqlite` or `~/.fractalswarm/private` from tests:** use tmp dirs.
- **When the coordinator sends HOLD,** stop test suites and builds until RELEASE.
- **Don't edit `.plans/progress.md`.** Write your notes to `.plans/notes/arena-meta.md`: done, deviations, issues, open questions, and the response shapes of every route.

## End of each merge step
- Green: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `uv run fractalswarm demo --verify` (MATCH).
- The reference comparison is clean when arbitration is off.
- Commit on your branch. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't merge or push.
- Report to the coordinator: the branch and the commit, the test counts, done and not done, deviations, and the route shapes.
