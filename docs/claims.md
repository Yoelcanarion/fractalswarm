# Claims

Every public claim about FractalSwarm, mapped to the evidence behind it (arena spec §C.5, §C.7).
The video script (`docs/video-script.md`), the README and the submission form
(`docs/submission.md`) quote only claims marked **allowed** here, in the wording given here.

A claim names its evidence: the run ids, the metric and its value, the failure model it holds in,
and the command that reproduces it. A claim whose evidence is not recorded yet is **pending**.
Claims the rules forbid are listed under "Not claimed", with the reason, so that nobody makes
them by accident.

**Status:** skeleton, Thu Oct 29. The comparison claims wait for the decision gate on Fri Oct 30
(`bench/PREREG.md` §7). Until then, nothing in the comparison section may be quoted.

## Rules

- "Needs no supervisor" does not mean simpler, cheaper or more reliable. Each of those is a
  separate claim that needs its own evidence, or it is not made.
- A result that holds only at one setting of the rival's assumptions is stated with that setting,
  never as a general claim.
- A claim about locality names its failure model: per crash or per process (`bench/PREREG.md` §6).
- The fairness rules (`bench/REPORT.md` §1) are never revisited to rescue a result.
- Replay proves that this code produces the recorded run from the recorded model outputs. It does
  not prove where those outputs came from. Say exactly that.
- Show it, don't claim "first".

## The system itself

| # | Claim, as worded | Evidence | Status |
|---|---|---|---|
| S1 | "No separate recovery mechanism: every survivor computes the same heir from the log with one rule (HRW), so there is no election." | By construction (`coord/hrw.py`, `coord/membership.py`); checked per run by `verify/takeover.py` (`GET /api/runs/{id}/takeover`). Run ids: TBD | allowed by construction; pending the recorded check on the final bundle |
| S2 | "Any orchestrator can die mid-run, the root included, and the run still finishes." | The kill-half demo bundle: kills, successions and adoptions from its takeover report. Run ids: TBD | pending |
| S3 | "No process manager, standby or election service." | By construction: recovery is the HRW rule over the membership in the log | allowed by construction |
| S4 | "Zero LLM tokens spent on coordination." | Coordination tokens per run, `bench/REPORT.md` §4 (secondary table). Run ids: TBD | pending |
| S5 | "Every run replays bit-for-bit from a hash-verified log; `fractalswarm demo --verify` needs no API key." | `demo --verify` and `replay RUN --verify` MATCH on the final bundle. Run ids: TBD | pending |
| S6 | "Shared log, not shared brain." | Description of the design; the log is a central component (stated limitation, `bench/REPORT.md` §6) | allowed, always with the limitation |

## Against the rivals (decision gate, Fri Oct 30)

| # | Claim, as worded | Allowed when | Evidence | Status |
|---|---|---|---|---|
| R1 | "Recovery stays local to the affected subtree." | Outcome A, with the measured blocking time and blast radius, and the failure model named | `bench verdicts --prereg` on the gate and the sweeps (`honesty.json`). Run ids: TBD | pending gate |
| R2 | "Resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism." | Outcome B, or A | as R1 | pending gate |
| R3 | The conditions where the gap shrinks or reverses: per-process view, fast external restart, short detection | Always, next to R1 or R2 | the regime map and the per-process ratio | pending gate |

## To decide at the gate

- The Phase 0 headline, "FractalSwarm finishes without a supervisor, and without stopping the
  world or paying twice for lost work", measures stall time and extra cost against the
  in-process supervisor. Against the durable supervisors, which also keep their workers running,
  it is not a comparison claim. Its wording is settled at the gate, from the stall and duplicate
  cost the gate measures.

## Not claimed

| Claim | Why not |
|---|---|
| "Simpler" | It cannot be measured here. Use S3 instead, when true. |
| "Cheaper" | Only if extra cost is measurably lower against the same rival under the same failures (H2 a win). Against `durable-max` a tie is expected. |
| "More reliable" | Not beyond the failure modes actually tested; the log remains a central component. |
| "First" | Show it, don't claim it. |
