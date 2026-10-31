# FractalSwarm

> **Kill half the brains. It still finishes.**

FractalSwarm is a runtime for teams of LLM agents. Its coordinators form a tree, any of them can die mid-run, the root included, and the survivors take over the work with no election. Zero LLM tokens spent on coordination. Every run this repository ships replays bit for bit from a hash-verified log.

Built on Muse Spark, Muse Wonder and Llama PromptGuard 2 for the Meta Global AI Developer Hackathon.

Clone it and run one command. [uv](https://docs.astral.sh/uv/) installs the rest, Python included.

```sh
uv run fractalswarm demo --verify    # no API key needed
```

## The problem

A team of LLM agents often depends on one coordinator: it plans, assigns and checks the work. When it crashes, the team waits, or does the work again.

In the simplest setup the workers run inside the coordinator's process and die with it, so their calls are paid for twice. A durable supervisor fixes that: its workers survive and a standby takes over. But then you run a supervisor, a standby and something to watch them.

**Can a team recover without one?**

## The idea: shared log, not shared brain

Ten small coordinators form a tree: one root, three tracks, six sessions, leading twelve agents. All of them read and write one hash-chained event log.

```mermaid
flowchart TB
    root((root))
    root --> t1((track))
    root --> t2((track))
    root --> t3((track))
    t1 --> s1((session))
    t1 --> s2((session))
    t2 --> s3((session))
    t2 --> s4((session))
    t3 --> s5((session))
    t3 --> s6((session))
    s1 --> a1[2 agents]
    s2 --> a2[2 agents]
    s3 --> a3[2 agents]
    s4 --> a4[2 agents]
    s5 --> a5[2 agents]
    s6 --> a6[2 agents]
    log[("the log: every event carries the hash of the one before")]
    a1 -.-> log
    a6 -.-> log
```

When a coordinator stops sending heartbeats:

1. **Every survivor sees the same thing.** Membership lives in the log, so all of them agree on who is dead.
2. **Every survivor computes the same heir.** For each piece of work, the heir is the live member with the highest `hash(goal, member)`, a rule known as highest random weight (HRW).
3. **The heir adopts the work,** and every result already in the log. The dead coordinator's children re-attach to it.
4. **The root is not special.** When the root dies, its duties move by the same rule.

"No separate recovery mechanism: every survivor computes the same heir from the log with one rule (HRW), so there is no election." Takeover makes no LLM call.

The log is still a central component. We remove the coordinator as a single point of decision, not every single point of failure.

## Why Meta's models matter

The hard part of the demo task, planning a conference from messy emails, is reading people.

- **Muse Spark** turns human language into constraints, each linked to its source sentence. It reads the emails, places the talks, checks the work and writes the blurbs.
- **Muse Wonder** writes the root plan. Arbitration between agents is built and tested on the fake model; the real runs we checked had no dispute to settle.
- **Llama PromptGuard 2** runs locally and screens each email and pasted input before an agent reads it. It screened all 32 inputs of every recorded demo and pair run. The bench's runs, runs on the fake LLM and an install without it use a pattern scanner instead.

Every Muse token goes to the problem. "Zero LLM tokens spent on coordination" is a property of the design, measured in every real run of the swarm: takeover, routing and recovery are code. Planning and judging do call the model, and they count as work ([`bench/REPORT.md`](bench/REPORT.md) §2). The rivals we built spend none either, because their supervisors are code too; the LangGraph rows do, because that pattern routes through the model (about 3% of its tokens).

## The evidence

We built the strongest rival we could implement fairly, and ran everything under the same failures on the real model. The rules, the rival's assumptions and every comparison are in [`bench/REPORT.md`](bench/REPORT.md); the hypotheses were committed in [`bench/PREREG.md`](bench/PREREG.md) before any run against that rival. Every claim here maps to its runs in [`docs/claims.md`](docs/claims.md).

**The headline, outcome B of the preregistration:** "Resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism."

Below, T2 is the conference task, C0 a run with no failures, and C3 the harshest failure profile: five coordinator crashes, half the agents killed, 20% API faults, 20% message loss and a network partition. The ideal durable supervisor is one coordinator whose agents keep working through a crash; it is back after 5 s and loses nothing.

- **Against the ideal durable supervisor (`durable-max`):** a tie on preserved work, extra cost, time to recover, duplicated spend and stall time, and a loss on false deaths (1.90 per run against none), over ten seeds. All 80 runs completed and 79 are valid (T2, C0 and C3, seeds 1–10, recorded after the handler freeze); the exception is the swarm at C0 on seed 5, one wrong model reading with no crash.
- **Locality:** "On the real model, at the headline point (T2, C3: five coordinator crashes, half the agents killed), locality against the ideal durable supervisor tied over ten seeds: the swarm's coordinator-dependency time, blast radius and idle agent-seconds were 0.57, 0.43 and 0.70 of its values, and at or below half on 4, 7 and 6 of the ten seeds." At the $0 gate, on the fake model, locality tied at C2 and C3 too.
- **Against a realistic durable supervisor (`durable`):** "Per crash, on the real model, at the headline point (T2, C3: five coordinator crashes, half the agents killed), against a realistic durable supervisor, which loses its own in-flight plan and judge calls and redoes them after the restart, the swarm's coordinator-dependency time was 11.4 s against 50.3 s and a crash held up 9.0% of the sessions against 37.3%, at or below half on each of the ten seeds." Per process the two are comparable. Stall time and extra cost tie, and false deaths are a loss, as against the ideal one.
- **Where it does not:** against an external supervisor that detects and restarts within 0.5–1 s while the swarm keeps its 5 s detection, locality fails, at 13.2 and 5.7 times the supervisor's dependency time. Per process, with each coordinator process failing at the same rate, the two are comparable, and the supervisor recovers sooner. The swarm's failure detector also produces false deaths; the supervisors have none.
- **Against an in-process supervisor (`central`), whose workers die with it,** the swarm at C3 stalled 11.2 s against 42.8 s, with +2.4% extra cost against +67.0% on the pre-registered basis (which estimates the cost of cancelled calls), or −1.1% against +29.2% on completed calls only (real model, T2, 10 seeds). Most of that gap comes from the rival's design, so it is no evidence against a well-built supervisor.
- **Also on the real model, two seeds each, descriptive only:** LangGraph's hierarchical-teams pattern (`bench/REPORT.md` §4.10.8) and a scaling sweep from 1 to 16 agents (§8).

![Stall time and extra cost against coordinators killed, on the real model](bench/results/headline-10/hero-t2_conference.png)

**What we do not claim:** "simpler", "cheaper" or "more reliable". Having no supervisor is not, by itself, evidence for any of them.

## Verify it yourself

Replay proves that this code produces the recorded run from the recorded model outputs. It does not prove where those outputs came from.

```sh
uv run fractalswarm demo --verify                 # replays a real recorded run, opens the UI
uv run fractalswarm replay demo/final --verify    # MATCH or MISMATCH, with the head hash
uv run fractalswarm takeover demo/final           # recomputes every heir from the log
```

The numbers need no model and no key either. These commands only print:

```sh
uv run fractalswarm bench verdicts bench/results/rivals-gate bench/results/sweeps   # outcome B, by the rules of bench/PREREG.md
uv run fractalswarm bench verdicts bench/results/headline-10    # the ten seeds, seed by seed; the outcome reads pending here, the gate decides it
uv run python scripts/completed_calls.py                        # the extra cost on both bases
```

## Run it

Python 3.12 through [uv](https://docs.astral.sh/uv/), which downloads it if needed.

```sh
uv sync
uv run fractalswarm serve                                     # the UI on http://127.0.0.1:8765
uv run fractalswarm run tasks/examples/t2-conference.yaml     # a run on the fake LLM, $0
```

`uv sync --extra safety` adds PromptGuard 2 for real runs: it needs `HF_TOKEN`, with access to the gated model. Without it, a real run says so and a pattern scanner screens its inputs.

Real runs need a key (`MODEL_API_KEY`, see [`.env.example`](.env.example)) and an explicit flag. They reserve budget before each call and stop at hard caps:

```sh
uv run fractalswarm run tasks/examples/t2-conference.yaml --backend real --confirm-real-spend --clock live --chaos kill-half
uv run fractalswarm spend
```

The web app lives in `web/` (Vite, React, TypeScript): `npm --prefix web install`, `npm --prefix web run dev`.

## Safety

- External content is data, never instructions: emails, pages and pasted text are scanned, wrapped in delimiters and kept out of system prompts.
- Tool capabilities are denied by default. `fetch` only accepts URLs with provenance.
- A plan's scope is approved and recorded. Work an email tries to add is logged as a request and blocked, which stops task splitting even when the classifier misses a polite injection.
- Every real call reserves budget first and settles after, with hard caps per contract, squad, run and project.

## Limitations

- A kill is an actor crash inside one Python process, and the chaos is injected. The log is centralized.
- The baselines run on this runtime with the failure semantics in the report; they are not the original frameworks' deployments, except LangGraph.
- Recovery after the whole Python process dies is an opt-in feature (`fractalswarm resume`, [`docs/resume.md`](docs/resume.md)), and it is not part of the demo.
- More in [`bench/REPORT.md`](bench/REPORT.md) §6.

## Repository

| Path | What it holds |
|---|---|
| `src/fractalswarm/kernel`, `coord`, `market`, `actors` | The deterministic runtime: pure handlers, HRW takeover, the tree, the market |
| `src/fractalswarm/llm`, `safety`, `verify` | The model layer, the firewall and scope checks, replay and takeover checkers |
| `src/fractalswarm/api`, `web/` | The API and the web app |
| `bench/` | Matrices, preregistration, results and the report |
| `demo/` | Recorded runs, with their cassettes |
| `docs/` | Claims, the video script, the submission drafts |

## License

MIT
