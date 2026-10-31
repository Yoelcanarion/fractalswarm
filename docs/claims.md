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
handler freeze), and its extension to ten seeds with `central` (`bench/results/headline-10`,
`bench/matrix-headline-10.yaml`, arena spec §M: 80 runs, the 18 among them). R2, R4, R5 and R6 and
the counts in S4 and S7 are written from the ten-seed reading (`bench/REPORT.md` §4.10.7); R4's
three-seed wording is withdrawn. R7 (Oct 31) adds what the same ten seeds measured against `durable`, which R4's evidence already
held and no public text said.

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
| S1 | "No separate recovery mechanism: every survivor computes the same heir from the log with one rule (HRW), so there is no election." | By construction (`coord/hrw.py`, `coord/membership.py`); checked per run by `verify/takeover.py` (`GET /api/runs/{id}/takeover`). Recorded on the final bundle: `fractalswarm takeover demo/final` (run `final-kill-half-1`) recomputes all seven remaps from the log, the three root successions among them, with no violation | **allowed** |
| S2 | "Any orchestrator can die mid-run, the root included, and the run still finishes." | The kill-half demo bundle `demo/final` (run `final-kill-half-1`, recorded at 568b261, after the freeze): five coordinators crashed, three of them while they held the root (o0, o1, o2), 18 of 18 contracts verified, 48 of 48 talks placed, 0 hard violations, 0 duplicated calls. `fractalswarm takeover demo/final` prints the kills, successions and adoptions | **allowed** |
| S3 | "No process manager, standby or election service." | By construction: recovery is the HRW rule over the membership in the log | allowed by construction |
| S4 | "Zero LLM tokens spent on coordination." | Coordination tokens as defined in `bench/REPORT.md` §2 (calls made to coordinate: roles `coordinator`, `supervisor`, `router`, `recovery`, or effect tags `coord:*`; planning and judging are work). 0 in every one of the 176 real runs: the 96 of `bench/results/v1` and the 80 of `bench/results/headline-10`, which hold the 18 of `bench/results/headline` (`metrics.coordination_tokens` in each cell). The rivals we built spend none either, because their supervisors are code too. The LangGraph rows do (`bench/results/langgraph`, 8 runs on Oct 31, not among the 176): the pattern's supervisors route through the model, about 10,700 tokens a run, 3% of the total (`bench/REPORT.md` §4.10.8) | **allowed** as a property of the design, never as an advantage over the rivals |
| S5 | "Every run replays bit-for-bit from a hash-verified log; `fractalswarm demo --verify` needs no API key." | `demo --verify` and `replay RUN --verify` MATCH at the release commit, on the runs the repository ships. The Phase 1 real runs verify at 8fddeba, not at HEAD (8ac7536 changed the email scan and the takeover keys; progress, Day 10), so they are not evidence for this claim. Neither do three private intakes on the build machine replay at HEAD: 180829f lengthened the intake schema, so their budget reservation differs. They are not in git and back no claim, but one was recorded after the freeze, so "every run" needs the scope "this repository ships" when the row is lifted. Run: `final-kill-half-1` (`demo/final`); it matches now, and the row is lifted by the check at the release commit (`coord/verify_all.ps1` sweeps every run a server lists) | pending |
| S6 | "Shared log, not shared brain." | Description of the design; the log is a central component (stated limitation, `bench/REPORT.md` §6) | allowed, always with the limitation |
| S7 | The tagline: "Kill half the brains. It still finishes." Only that sentence (Yoel, Oct 30). | C3 crashes five of the swarm's ten orchestrators and kills half of its agents (`bench/PREREG.md` §5). Every real swarm run at C3 completed with a valid result: 4 of 4 in `bench/results/v1` (T1 and T2, seeds 1–2) and 10 of 10 in `bench/results/headline-10` (T2, seeds 1–10, after the freeze; its first three are the 3 of 3 of `bench/results/headline`). Every real run of every workflow completed (176 of 176), so finishing does not set the swarm apart: what it shows is that losing half its brains does not stop it. One real run is not valid, the swarm at C0 on seed 5 (no crash; one wrong model reading, `bench/REPORT.md` §4.10.7), so validity is claimed for the runs at C3 and for no other setting | **allowed**. The measured numbers go under it as a subtitle, each with its rival named (R2, R3), never as part of the tagline |

## The models

| # | Claim, as worded | Evidence | Status |
|---|---|---|---|
| M1 | "In the recorded demo run, 65% of input tokens were served from cache." | `GET /api/runs/demo-final/models` on `demo/final` (run `final-kill-half-1`): `cache_hit_share` 0.651, 139,264 of 215,208 input tokens | **allowed** |
| M2 | "96 real benchmark runs for about $17." | `bench/results/v1`: `metrics.cost_usd` over its 96 cells sums to $16.74, on Contributor routing, with the estimate for cancelled calls counted (`bench/REPORT.md` §2) | **allowed** |

## Against the rivals (decision gate, Thu Oct 29: outcome B)

The $0 evidence: `fractalswarm bench verdicts bench/results/rivals-gate bench/results/sweeps`
prints `bench/results/verdicts.txt` (PREREG sha 25d4a75919b3, code 3e723a8; 574 cells, fake LLM,
simulated clock), and `bench/results/honesty.json` holds every comparison.

| # | Claim, as worded | Allowed when | Evidence | Status |
|---|---|---|---|---|
| R1 | "Recovery stays local to the affected subtree." | Outcome A, with the measured blocking time and blast radius, and the failure model named | Locality ties against `durable-max` at the gate (T2, C2 and C3) | **not claimed** (outcome B) |
| R2 | "Resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism." | Outcome B, or A | At the six gate points, stall time and extra cost tie with `durable-max`; every run of every workflow completes. Real rows (Oct 30): the ten-seed headline (`bench/results/headline-10`: T2 at C0 and C3, seeds 1–10, whose first three seeds are the pre-registered `bench/results/headline`, recorded at e307ca1 after the handler freeze; `fractalswarm bench verdicts bench/results/headline-10`) ties with `durable-max` on preserved work, extra cost (+2.4% against +8.1%), time to recover, duplicated spend and stall time (11.2 against 21.9 s), and on locality (R4), under the pre-registered per-seed rule. It loses on false deaths (H5): 1.90 per run against none for `durable-max` and `durable` (R3). All 80 runs completed and 79 are valid, the exception being the swarm at C0 on seed 5 (one wrong model reading, no crash). The 96 runs of `bench/results/v1` (2 seeds, descriptive) read the same way | **allowed** (gate, Oct 29; real rows, Oct 30, re-read at ten seeds) |
| R3 | The conditions: against the ideal durable supervisor on the conference task, with five coordinator crashes and half the agents killed, locality holds when the supervisor needs 1–3 s more to restart a coordinator (coordinator-dependency time 0.28 and 0.19 of the supervisor's); it ties at the default assumptions (both detect a failure in 5 s, no extra restart) and when both detect in 1–10 s; it fails when an external supervisor detects and restarts within 0.5–1 s while the swarm keeps its 5 s detection (13.2 and 5.7 times the supervisor's). Per process, each coordinator process failing at the same rate, the two are comparable (ratio 0.90), and the supervisor recovers sooner. The swarm's failure detector also produces false deaths (1.25–2.25 per run at three and five crashes), the supervisors none. | Always, next to R2 | `honesty.json`, the regime map (`bench/results/regime.png`), `bench/REPORT.md` §4.5–4.9 | **allowed**, always with R2 |
| R4 | "On the real model, at the headline point (T2, C3: five coordinator crashes, half the agents killed), locality against the ideal durable supervisor tied over ten seeds: the swarm's coordinator-dependency time, blast radius and idle agent-seconds were 0.57, 0.43 and 0.70 of its values, and at or below half on 4, 7 and 6 of the ten seeds." | Always with its setting (real model, T2 at C3, 10 seeds), and next to the $0 gate, where locality tied at C2 and C3. Never as R1, the general claim. The three-seed wording of Oct 30 ("below half of `durable-max`'s on every seed") is withdrawn and is not quoted | `bench verdicts bench/results/headline-10` (PREREG sha 25d4a75919b3): against `durable-max`, H4a, H4b and H4c are ties and the seeds disagree (coordinator-dependency time 11.4 against 20.2 s; blast radius 9.0 against 21.0% of sessions; idle agent-seconds 13.9 against 20.0). Seeds 1–3 are below half on all three measures and seeds 4–10 are not (ratios of the seed means 0.69, 0.50 and 0.93, against 0.31, 0.29 and 0.29). Against `durable`, H4a and H4b are wins on every seed and H4c is a tie (ratios 0.23, 0.24 and 0.26); against `central`, H4a and H4b are wins (0.08 and 0.10). H5 is a loss: 1.90 false deaths per run, the supervisors none. `bench/REPORT.md` §4.10.7 | **allowed with its setting** (Oct 30, re-read at ten seeds) |
| R5 | "Against an in-process supervisor, whose workers die with it, the swarm at C3 stalled 11.2 s against 42.8 s, with +2.4% extra cost against +67.0% on the pre-registered basis (which estimates the cost of cancelled calls), or −1.1% against +29.2% on completed calls only." | Always with the rival named as an in-process supervisor (`central`), the setting (real model, T2 at C3, 10 seeds) and the reason next to it: most of the gap comes from that design, so it is no evidence against a well-built supervisor (`bench/REPORT.md` §1) | `bench/results/headline-10` (T2, C0 and C3, seeds 1–10; `fractalswarm bench verdicts bench/results/headline-10`): H1, H2, H4a, H4b, H6 and stall time are wins on every seed against `central`, and the figures are means over the seeds. The pre-registered basis is the cells' `cost_usd` (`extra_cost_pct`), which counts an estimate for the calls a crash cancels; completed calls only is computed from the run logs (`bench/REPORT.md` §4.10.7: the estimate is $0.105 a run for `central`, more than half of its extra cost). The 2 seeds of `bench/results/v1` (descriptive) read the same way: 14.6 against 92.6 s on T2 and 8.2 against 62.6 s on T1 | **allowed with its setting** (Oct 30, re-read at ten seeds) |
| R6 | "On the real model, with five of its ten coordinators crashed and half its agents killed, every run finished with a valid result. It stalled 11.2 s against 42.8 s for an in-process supervisor, and tied an ideal durable supervisor on stall time and extra cost." | The short form of S7's evidence, R5 and R2 for a subtitle, always with a visible link to R2 and R3 on the same page | S7, R5, R2. All 14 real swarm runs at C3 finished with a valid result (4 in `bench/results/v1`, 10 in `bench/results/headline-10`); the figures of the second sentence are those of R5 and R2 (T2, 10 seeds) | **allowed with its link** (Oct 30, re-read at ten seeds) |
| R7 | "Per crash, on the real model, at the headline point (T2, C3: five coordinator crashes, half the agents killed), against a realistic durable supervisor, which loses its own in-flight plan and judge calls and redoes them after the restart, the swarm's coordinator-dependency time was 11.4 s against 50.3 s and a crash held up 9.0% of the sessions against 37.3%, at or below half on each of the ten seeds." | Always with its setting (real model, T2 at C3, 10 seeds, per crash) and this rival named, next to R2 and R3 or with a visible link to them on the same page, as R6. Never as R1: Outcome A is defined against `durable-max`, and this is not that rival. Never "less waiting" or "less stall": stall time and idle agent-seconds tie with this rival, and the seeds disagree. Short forms: for the video, the lower third "Realistic durable supervisor · 5 crashes · 10 seeds" over "Real model: a crash held up 9.0% of sessions, against 37.3%", with the voice's "loses its in-flight calls"; for the submission, "Against a realistic durable supervisor, which loses its in-flight calls, a crash held up 9.0% of the sessions against 37.3% (real model, T2 at C3, 10 seeds)." | `bench verdicts bench/results/headline-10` (PREREG sha 25d4a75919b3) and its `results.csv`: against `durable`, H4a and H4b are wins on every seed (11.42 against 50.31 s, no seed above 0.47 of the rival's; 9.00 against 37.33% of the sessions, no seed above 0.46) and H4c is a tie (13.92 against 53.90 idle agent-seconds; the seeds reach 0.72), so locality holds at this point by the rule of PREREG §4, which the verdict tool applies to each rival. Preserved work, extra cost, time to recover, duplicated spend and stall time (11.17 against 21.89 s; two seeds above the rival's) tie, and H5 is a loss: 1.90 false deaths per run, the rival none. The rival is defined in `bench/REPORT.md` §1 and with `durable-max` bounds the realistic range. Two limits. Per process the two are comparable (ratio 0.84, §4.7). On the $0 crash-time sweep (§4.6.1, exploratory) locality against it holds at 0 and ±5 points and ties at ±10 and ±15 | **allowed with its setting** (Oct 31) |

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
