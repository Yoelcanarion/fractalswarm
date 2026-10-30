# Claims

Every public claim about FractalSwarm, mapped to the evidence behind it (arena spec §C.5, §C.7).
The video script (`docs/video-script.md`), the README and the submission form
(`docs/submission.md`) quote only claims marked **allowed** here, in the wording given here.

A claim names its evidence: the run ids, the metric and its value, the failure model it holds in,
and the command that reproduces it. A claim whose evidence is not recorded yet is **pending**.
Claims the rules forbid are listed under "Not claimed", with the reason, so that nobody makes
them by accident.

**Status:** decision gate held with Yoel on Thu Oct 29 (`bench/PREREG.md` §7): **outcome B**
accepted. R2 is the comparison headline, with R3 next to it; R1 is not claimed. The tagline was
settled by Yoel on Fri Oct 30 from the real rows (S7). The real-model rows are recorded:
`bench/results/v1` (96 runs, 2 seeds) and `bench/results/headline` (18 runs, 3 seeds, after the
handler freeze). The 10-seed extension with `central` (`bench/matrix-headline-10.yaml`, arena
spec §M) is to be added next to them.

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
| S4 | "Zero LLM tokens spent on coordination." | Coordination tokens as defined in `bench/REPORT.md` §2 (calls made to coordinate: roles `coordinator`, `supervisor`, `router`, `recovery`, or effect tags `coord:*`; planning and judging are work). 0 in every one of the 96 real runs of `bench/results/v1` and the 18 of `bench/results/headline` (`metrics.coordination_tokens` in each cell). The rivals spend none either, because their supervisors are code too | **allowed** as a property of the design, never as an advantage over the rivals |
| S5 | "Every run replays bit-for-bit from a hash-verified log; `fractalswarm demo --verify` needs no API key." | `demo --verify` and `replay RUN --verify` MATCH at the release commit, on runs recorded after the handler freeze (Sun Nov 1). The Phase 1 real runs verify at 8fddeba, not at HEAD (8ac7536 changed the email scan and the takeover keys; progress, Day 10), so they are not evidence for this claim. Run ids: TBD | pending |
| S6 | "Shared log, not shared brain." | Description of the design; the log is a central component (stated limitation, `bench/REPORT.md` §6) | allowed, always with the limitation |
| S7 | The tagline: "Kill half the brains. It still finishes." Only that sentence (Yoel, Oct 30). | C3 crashes five of the swarm's ten orchestrators and kills half of its agents (`bench/PREREG.md` §5). Every real swarm run at C3 completed with a valid result: 4 of 4 in `bench/results/v1` (T1 and T2, seeds 1–2) and 3 of 3 in `bench/results/headline` (T2, seeds 1–3, after the freeze). Every real run of every workflow completed (114 of 114), so finishing does not set the swarm apart: what it shows is that losing half its brains does not stop it | **allowed**. The measured numbers go under it as a subtitle, each with its rival named (R2, R3), never as part of the tagline |

## Against the rivals (decision gate, Thu Oct 29: outcome B)

The $0 evidence: `fractalswarm bench verdicts bench/results/rivals-gate bench/results/sweeps`
prints `bench/results/verdicts.txt` (PREREG sha 25d4a75919b3, code 3e723a8; 574 cells, fake LLM,
simulated clock), and `bench/results/honesty.json` holds every comparison.

| # | Claim, as worded | Allowed when | Evidence | Status |
|---|---|---|---|---|
| R1 | "Recovery stays local to the affected subtree." | Outcome A, with the measured blocking time and blast radius, and the failure model named | Locality ties against `durable-max` at the gate (T2, C2 and C3) | **not claimed** (outcome B) |
| R2 | "Resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism." | Outcome B, or A | At the six gate points, stall time and extra cost tie with `durable-max`; every run of every workflow completes. Real rows (Oct 30): the headline runs (`bench/results/headline`: T2 at C0 and C3, seeds 1–3, recorded at e307ca1 after the handler freeze; `fractalswarm bench verdicts bench/results/headline`) tie with `durable-max` on preserved work, extra cost (−6.6% against +7.5%), time to recover, duplicated spend and stall time (10.3 against 32.0 s), under the pre-registered per-seed rule; all 18 runs complete and are valid. The 96 runs of `bench/results/v1` (2 seeds, descriptive) read the same way | **allowed** (gate, Oct 29; real rows, Oct 30) |
| R3 | The conditions, stated next to R2: against `durable-max` on T2 at C3, locality holds when the supervisor needs 1–3 s more to restart a coordinator (coordinator-dependency time 0.28 and 0.19 of the supervisor's); it ties at the default assumptions (both detect a failure in 5 s, no extra restart) and when both detect in 1–10 s; it fails when an external supervisor detects and restarts within 0.5–1 s while the swarm keeps its 5 s detection (13.2 and 5.7 times the supervisor's). Per process, each coordinator process failing at the same rate, the two are comparable (ratio 0.90), and the supervisor recovers sooner. The swarm's failure detector also produces false deaths (1.25–2.25 per run at C2–C3), the supervisors none. | Always, next to R2 | `honesty.json`, the regime map (`bench/results/regime.png`), `bench/REPORT.md` §4.5–4.9 | **allowed**, always with R2 |
| R4 | "On the real model, at the headline point (T2, C3: five coordinator crashes, half the agents killed), recovery stayed local: the swarm's coordinator-dependency time, blast radius and idle agent-seconds were below half of `durable-max`'s on every seed." | Always with its setting (real model, T2 at C3, 3 seeds), and next to the $0 gate, where locality tied at C2 and C3. Never as R1, the general claim | `bench verdicts bench/results/headline` (PREREG sha 25d4a75919b3, code e307ca1): H4a, H4b and H4c are wins against `durable-max` (coordinator-dependency time 6.94 against 22.27 s; blast radius 6.67 against 23.33% of sessions; idle agent-seconds 7.18 against 24.38; ratios of the seed means 0.31, 0.29 and 0.29) and against `durable` (ratios 0.14, 0.17 and 0.13). H5 is a loss: 2.0 false deaths per run, the supervisors none | **allowed with its setting** (Oct 30). The 10-seed extension re-reads it before the video or the README use it; whatever it shows is reported |
| R5 | "Against an in-process supervisor, whose workers die with it, the swarm at C3 stalled 8.2 s (T1) and 14.6 s (T2) against 62.6 and 92.6 s, with +2.6% and +6.6% extra cost against +37.7% and +75.6%." | Always with the rival named as an in-process supervisor (`central`), the setting (real model, C3, 2 seeds) and the reason next to it: most of the gap comes from that design, so it is no evidence against a well-built supervisor (`bench/REPORT.md` §1) | `bench/results/v1/hero-t2_conference.json` for T2, the T1 cells of `bench/results/v1` (2 seeds, descriptive). The 10-seed extension re-reads T2 | **allowed with its setting** (Oct 30) |
| R6 | "On the real model, with five of its ten coordinators crashed and half its agents killed, every run finished with a valid result. It stalled 14.6 s against 92.6 s for an in-process supervisor, and tied an ideal durable supervisor." | The short form of S7's evidence, R5 and R2 for a subtitle, always with a visible link to R2 and R3 on the same page | S7, R5, R2. The 10-seed extension re-reads the numbers | **allowed with its link** (Oct 30) |

## Decided at the gate

- **The tagline** ("Kill half the brains. It still finishes — without stalling or paying twice")
  is settled from the real runs (Yoel, Oct 29), not before. At $0 it holds against the
  in-process supervisor (`central`; T2 at C3: stall 1.2 against 34.3 s, extra cost −1.0% against
  +66.6%), not against `durable-max` (ties), and not literally: on T1 at C3 the swarm stalls
  14.8 s on average, and it pays a little twice (T2 at C3: $0.015 per run). Until then neither
  the tagline nor the Phase 0 headline is quoted.
- **Settled on Fri Oct 30 (Yoel, 01:50 CET), from the real rows:** the tagline is the first
  sentence only, "Kill half the brains. It still finishes." (S7). The real rows read like the
  $0 ones: against `central`, at C3 the swarm stalled 8.2 s (T1) and 14.6 s (T2) against 62.6 and
  92.6 s, with +2.6% and +6.6% extra cost against +37.7% and +75.6% (`bench/results/v1`, 2 seeds);
  against `durable-max` and `durable` it ties within the noise of two or three seeds. "Without
  stalling or paying twice" is therefore not quoted. The comparison goes under the tagline, with
  its rival named.

## Not claimed

| Claim | Why not |
|---|---|
| "Simpler" | It cannot be measured here. Use S3 instead, when true. |
| "Cheaper" | Only if extra cost is measurably lower against the same rival under the same failures (H2 a win). Against `durable-max` a tie is expected. |
| "More reliable" | Not beyond the failure modes actually tested; the log remains a central component. |
| "First" | Show it, don't claim it. |
