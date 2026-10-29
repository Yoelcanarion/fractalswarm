# Claims

Every public claim about FractalSwarm, mapped to the evidence behind it (arena spec §C.5, §C.7).
The video script (`docs/video-script.md`), the README and the submission form
(`docs/submission.md`) quote only claims marked **allowed** here, in the wording given here.

A claim names its evidence: the run ids, the metric and its value, the failure model it holds in,
and the command that reproduces it. A claim whose evidence is not recorded yet is **pending**.
Claims the rules forbid are listed under "Not claimed", with the reason, so that nobody makes
them by accident.

**Status:** decision gate held with Yoel on Thu Oct 29 (`bench/PREREG.md` §7): **outcome B**
accepted. R2 is the comparison headline, with R3 next to it; R1 is not claimed. The tagline is
settled once the real runs exist. The real-model evidence is pending.

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
| S5 | "Every run replays bit-for-bit from a hash-verified log; `fractalswarm demo --verify` needs no API key." | `demo --verify` and `replay RUN --verify` MATCH at the release commit, on runs recorded after the handler freeze (Sun Nov 1). The Phase 1 real runs verify at 8fddeba, not at HEAD (8ac7536 changed the email scan and the takeover keys; progress, Day 10), so they are not evidence for this claim. Run ids: TBD | pending |
| S6 | "Shared log, not shared brain." | Description of the design; the log is a central component (stated limitation, `bench/REPORT.md` §6) | allowed, always with the limitation |

## Against the rivals (decision gate, Thu Oct 29: outcome B)

The $0 evidence: `fractalswarm bench verdicts bench/results/rivals-gate bench/results/sweeps`
prints `bench/results/verdicts.txt` (PREREG sha 25d4a75919b3, code 3e723a8; 574 cells, fake LLM,
simulated clock), and `bench/results/honesty.json` holds every comparison.

| # | Claim, as worded | Allowed when | Evidence | Status |
|---|---|---|---|---|
| R1 | "Recovery stays local to the affected subtree." | Outcome A, with the measured blocking time and blast radius, and the failure model named | Locality ties against `durable-max` at the gate (T2, C2 and C3) | **not claimed** (outcome B) |
| R2 | "Resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism." | Outcome B, or A | At the six gate points, stall time and extra cost tie with `durable-max`; every run of every workflow completes. Real rows: pending | **allowed** at $0 (gate, Oct 29); the real rows are to be added |
| R3 | The conditions, stated next to R2: against `durable-max` on T2 at C3, locality holds when the supervisor needs 1–3 s more to restart a coordinator (coordinator-dependency time 0.28 and 0.19 of the supervisor's); it ties at the default assumptions (both detect a failure in 5 s, no extra restart) and when both detect in 1–10 s; it fails when an external supervisor detects and restarts within 0.5–1 s while the swarm keeps its 5 s detection (13.2 and 5.7 times the supervisor's). Per process, each coordinator process failing at the same rate, the two are comparable (ratio 0.90), and the supervisor recovers sooner. The swarm's failure detector also produces false deaths (1.25–2.25 per run at C2–C3), the supervisors none. | Always, next to R2 | `honesty.json`, the regime map (`bench/results/regime.png`), `bench/REPORT.md` §4.5–4.9 | **allowed**, always with R2 |

## Decided at the gate

- **The tagline** ("Kill half the brains. It still finishes — without stalling or paying twice")
  is settled from the real runs (Yoel, Oct 29), not before. At $0 it holds against the
  in-process supervisor (`central`; T2 at C3: stall 1.2 against 34.3 s, extra cost −1.0% against
  +66.6%), not against `durable-max` (ties), and not literally: on T1 at C3 the swarm stalls
  14.8 s on average, and it pays a little twice (T2 at C3: $0.015 per run). Until then neither
  the tagline nor the Phase 0 headline is quoted.

## Not claimed

| Claim | Why not |
|---|---|
| "Simpler" | It cannot be measured here. Use S3 instead, when true. |
| "Cheaper" | Only if extra cost is measurably lower against the same rival under the same failures (H2 a win). Against `durable-max` a tie is expected. |
| "More reliable" | Not beyond the failure modes actually tested; the log remains a central component. |
| "First" | Show it, don't claim it. |
