# Submission form — draft v0

**Status:** draft v1 (Oct 31, with the ten-seed claims). Yoel edits it, and the coordinator keeps it consistent with `docs/claims.md`. The final version is due on Nov 4, before 20:00 CET.
- **Form:** `cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit`.
- **Placeholders:** every number is a `{{placeholder}}` until it has a row in `docs/claims.md`.
- **Wording:** no "simpler", "cheaper" or "more reliable" without its own evidence row.

---

## Team Name
FractalSwarm *(suggested; Yoel confirms)*

## Team Members
Yoel Garcia (GitHub: Yoelcanarion)

## Which track?
*Yoel picks it from the form's list on Nov 4.* The project spec assumed the Indie track, "Push the Frontier".

## Which problem statement?
*Yoel picks it from the form's list on Nov 4.*

## Most Viral X post (optional)
Skipped.

## Project Description
> FractalSwarm is a runtime for teams of LLM agents. Any orchestrator can die mid-run, the root included, and the run still finishes. No process manager, standby or election service.
>
> **The problem.** Most agent systems depend on one coordinator. When it dies, the team waits, or redoes the work. In the simplest setup its workers die with it, and their calls are paid for twice.
>
> **How it works.** Coordinators form a fractal tree (root → tracks → sessions) over one hash-chained event log. When a coordinator stops sending heartbeats, every survivor computes the same heir from the log with one rule (HRW), so there is no election. The heir adopts the work, and every result already in the log. Zero LLM tokens spent on coordination. Every run this repository ships replays bit for bit, and a checker recomputes every takeover from the log.
>
> **The evidence.** We built the strongest supervisor we could implement fairly: its workers survive, its results are kept, and it restarts with no delay after detection. We ran both under the same failures, on ten seeds. On the real model, with five of its ten coordinators crashed and half its agents killed, every run finished with a valid result. It stalled 11.2 s against 42.8 s for an in-process supervisor, whose workers die with it, so most of that gap comes from that design. It tied an ideal durable supervisor on stall time and extra cost. So the claim is narrow: resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism.
>
> **Where it does worse.** Its failure detector declares live coordinators dead, 1.90 times per run; the supervisors never do. A supervisor that detects and restarts within a second beats it. The log remains a central component.
>
> **Meta's models do the understanding.** Muse Spark turns messy human input into constraints and does the agents' work. Muse Wonder plans and arbitrates. Llama PromptGuard 2 screens every input.
>
> **Try it:** `uv run fractalswarm demo --verify`. No API key is needed.

## Public GitHub Repository
https://github.com/Yoelcanarion/fractalswarm (it becomes public on Nov 3, after the final secret and PII scan).

## 3-Minute Demo Video
{{video link}} (unlisted YouTube or similar; it is also linked from the README).

## Describe your use of Meta products
> - **Muse Spark 1.3** (Meta Model API, Responses API), used for:
>   - intake: messy text in, a structured problem out, with strict `json_schema` outputs;
>   - reading speakers' emails;
>   - placing talks;
>   - judging contracts;
>   - writing blurbs.
>
>   We use tool calling (with parallel calls), a reasoning effort per role, and prompt caching with one `prompt_cache_key` per role: in the recorded demo run, 65% of input tokens were served from cache.
> - **Muse Spark 1.3 Contributor** runs the benchmark matrix at about 1/20 of the Standard price, behind a PII gate. Calls that read emails stay on Standard.
> - **Muse Wonder 1.0** writes the root plan of every run{{, and arbitrates semantic conflicts between agents at their lowest common ancestor}}.
> - **Llama PromptGuard 2 (22M)** runs locally through LlamaFirewall. Every email and pasted input is scored before an agent reads it. The score is logged, so replays never recompute it.
> - **The API's usage fields** (cached and reasoning tokens) feed a per-call cost ledger and budget reservations. Its rate-limit headers drive our adaptive quotas.

## Why are Meta's models important to your solution?
> - **Understanding.** The input is human language: emails, notes, abstracts. On the same notes, a hand-written parser understood {{ablation_parser}} of {{ablation_total}}, and Muse Spark understood {{ablation_muse}}. Without the model, there is no problem to schedule.
> - **Planning and judgment.** Wonder breaks the conference down into tracks and sessions{{, and settles disagreements between agents with the evidence}}. Spark agents check each other's work.
> - **Cost.** Prompt caching and Contributor pricing make it affordable to run a dozen agents per run, and a full benchmark: 96 real benchmark runs for about $17.
> - **Safety.** PromptGuard 2 runs locally on every input.
> - **The tokens go to the problem.** Zero LLM tokens spent on coordination: takeover is a deterministic hash over the log.

## Feedback on Meta products
*Drafted from `docs/api-notes.md` (the Day 2 live spike) and later runs. Yoel edits it.*

**What worked well:**
- **Strict structured outputs** worked on both the Responses API and Chat Completions, and a bad schema failed fast with a clear message.
- **Prompt caching works immediately and per key.** On a repeated 3.6k-token prompt, 98 % was cached on the second call, an 84 % saving.
- **The stateless Responses round trip** (encrypted reasoning items plus `function_call_output`) and parallel tool calls worked out of the box.
- **The token-count endpoint** is fast and free, and a safe upper bound for budget reservations.
- **Contributor pricing** made a full benchmark matrix affordable.
- **The rate-limit headers** (`x-ratelimit-remaining-*`) are on every response.

**What could be better:**
- **`max_output_tokens` covers reasoning and visible output together.** `max` effort spent the whole 2,048-token cap on a trivial prompt and returned `incomplete`. A separate reasoning budget, or a clear warning in the docs, would help.
- **The default effort is not cheap:** 127 reasoning tokens for "say OK". Please document the default level.
- **`tool_choice: "required"` returns 400**; only `auto` is accepted.
- **No rate-limit reset header**, so clients have to guess their back-off.
- **Long non-streaming calls can return 504.**
- **Web search:** `usage` has no web-search counter, and no `url_citation` annotations came back in our probe.
- **`reasoning.summary`** returned empty summaries.
- **The docs say Contributor doesn't accept `max` effort,** but it does. There is no Wonder Contributor model.
- **LlamaFirewall:**
  - the scanner hard-codes the 86M PromptGuard model;
  - `scan()` reloads the model and calls `asyncio.run` on every call;
  - llamafirewall 1.0.3 imports `HfFolder`, which huggingface-hub 1.0 removed;
  - the PromptGuard 2 tokenizer logs an "incorrect regex pattern" warning.
- **PromptGuard 2 scored a politely worded injection email at 0.0009,** so it did not flag it. Only an explicit "ignore your previous instructions" scored high. That is expected from a jailbreak classifier, but worth stating in the docs. Our scope check caught the polite version.

## Feedback on partner technologies
*TBD: check the form's list of partners.*
- **Hugging Face Hub:** the gated PromptGuard 2 weights; access was granted quickly.
- {{others, if any}}
