# Video script — v0.3 (3:00, English voice-over)

**Status:** draft v0.3, with the ten-seed claims. The decision gate (Oct 29, with Yoel) chose **outcome B**, so Act 3 has only version B; version A is removed.
- Every `{{placeholder}}` left is filled from `docs/claims.md` once the final runs exist.
- Every number and claim must have a row in `docs/claims.md` before recording.
- The tagline is settled (Yoel, Oct 30; `docs/claims.md` S7): "Kill half the brains. It still finishes." Only that sentence. Numbers go under it, each with its rival named, never as part of it.
- Yoel picks the rival of `s1` and `s6` in the edit: `central` for the contrast, `durable-max` for the honest tie (arena spec §M.5). This draft is written for `durable-max`, and a `central` take cannot go with this voice: its frame says a crash stops its workers, and the voice says its workers survive.

**The story:** three questions, in this order.
1. What problem does FractalSwarm solve?
2. Why do Meta's models matter?
3. What evidence shows that recovery works?

Anything that doesn't answer one of them stays out of the video.

**Reading pace:** about 140 words per minute. The voice-over below is about 400 words, which leaves room to breathe. Read slowly, and cut words rather than rush.

**Recording:**
- The scenes come from director mode (`#/director/<scene-id>`), captured by `scripts/record_scenes.*` at 1920×1080.
- **Exceptions:** `s2-intake` is recorded from the real live session, and `s9-close` is a real terminal capture (OBS, or Win+Alt+R).
- Record the voice per scene. Light editing joins the clips.
- **On-screen notes:** whenever a replay is shown, the frame says "Replay of a real recorded run · real cost $0.4783" (`demo/final`: what the run spent, read from the end of its log; another run shows its own cost).

---

## Act 1 — The problem (0:00–0:32)

### s1-arena-open (0:00–0:32)
**On screen:**
- The arena, opening on the "half the brains" plan.
- **Left:** FractalSwarm's tree (10 coordinators, 12 agents).
- **Right:** the ideal durable supervisor, with the same 12 agents.
- **Lower third:** "Same input · same models · same failures".
- **At about 0:22, on "Now we kill half the brains":** the first crash. The root dies on both sides. The right side's whole board pauses; on the left, the tree re-wires.

**Voice-over (≈ 74 words):**
> Teams of AI agents often depend on one coordinator. It plans, assigns and checks the work. When it crashes, the team waits, or does the work again.
> On the right: the strongest supervisor we could build. On the left: FractalSwarm, ten small coordinators in a tree. Same task, same models, same failures.
> Now we kill half the brains.
> A better supervisor helps: its workers survive, and a standby takes over. Can a team recover without one?

**Key points:** agent teams depend on one coordinator · the strongest rival we could build, against ten small coordinators · same task, models and failures · kill half the brains · a better supervisor helps · can a team recover without one, over the two sides reacting.

---

## Act 2 — Why Meta's models matter (0:32–1:22)

### s2-intake (0:32–0:52) — recorded live
**On screen:**
- Yoel types or pastes a small conference in plain English, sped up: talks, and speakers' emails such as "I land at noon on day two".
- Clicks **Read with Muse**.
- The review table fills in: talks, tracks and constraints, each with its source sentence highlighted.
- Clicks **Approve**.

**Voice-over (≈ 45 words):**
> The input is real, and messy. I type a small conference in plain English: talks, speakers, and emails like "I land at noon on day two".
> Muse Spark turns it into constraints, each linked to the sentence it came from. I check them and approve.

**Key points:** real, messy input · Spark turns it into constraints · each constraint links to its source sentence · a human approves.

### s3-ablation (0:52–1:04)
**On screen:**
- The ablation view: regex parser on the left, Muse Spark on the right, with ✓/✗ per note.
- **Headline:** "parser {{ablation_parser}} of {{ablation_total}} · Muse {{ablation_muse}} of {{ablation_total}}".

**Voice-over (≈ 28 words):**
> Is the model doing real work here? We ran the same notes through a hand-written parser. It understood {{ablation_parser}} of {{ablation_total}}. Muse understood {{ablation_muse}}.

**Key points:** same notes, parser against Muse · the parser's score, then Muse's.

### s4-lens (1:04–1:22)
**On screen:**
- The run plays and the tree grows.
- The lens opens on Wonder's root plan.
- Then on a Spark extraction (`o3.1.a1`, the first call that publishes facts): "muse-spark-1.3 · effort low · 3,311 in (2,929 cached) · $0.0111 · 6.5 s", with the fact next to its highlighted email sentence. The root has already fallen at this point of the run, and the tree shows it: `s1` has shown the kill, and `s5` opens on the same tree.
- **The Muse meter**, opened from "What the models cost" in the strip: "coordination tokens 0 · recovery tokens 0".

**Voice-over (≈ 43 words):**
> Then the team works. Muse Wonder plans. Muse Spark agents read the emails, place the talks and check the results.
> Click any call to see the model, the tokens, the cost, and the sentence behind the decision. Zero LLM tokens spent on coordination.

**Key points:** Wonder plans; Spark reads, places and checks · every call is inspectable · zero LLM tokens spent on coordination.
**Not said here:** that Wonder settles disputes. Arbitration is built and tested on the fake model, but no real run has a dispute: each fact has one contract (log of `demo/final` and of the 20 swarm cells of `bench/results/headline-10`).

---

## Act 3 — The evidence (1:22–2:36)

### s5-recovery (1:22–1:44)
**On screen:**
- The tree, slowed down. A coordinator dies (✕), and its heartbeats stop.
- After 5 s, every survivor computes the same heir. A brief overlay: "heir = highest hash(goal, member)".
- The subtree re-wires to the heir, and the heir picks up the results already in the log.
- Then the root dies, and the root's duties move.
- **Lower third:** "Shared log, not shared brain."

**Voice-over (≈ 52 words):**
> How does a team without a boss recover? Every coordinator reads the same log. When one stops sending heartbeats, each survivor computes the same heir from the log, with one rule, so there is no election.
> The heir adopts the dead coordinator's work, and every result already in the log. Even the root can die.

**Key points:** one shared log · the same heir computed everywhere · no election · the heir adopts the work and the logged results · even the root.

### s6-fair-fight (1:44–2:14)
**On screen:**
- The arena, mid-run, with crash markers on the shared timeline.
- **Right:** at each crash, a band for 5 s, in the UI's words: "o0 down for 3.7 s · 8 agents waiting for it".
- **Left:** only one subtree pauses.
- **Face-to-face counters:** idle agent-seconds, time to recover, cost, duplicated work and reassignments.
- **Caption, always visible:** "Rival: ideal durable supervisor — 5 s detection · 0 s restart · workers survive · same log".
- **Lower third, over the full board:** "Ten seeds: tied on stall time and extra cost". The board is one seed; the lower third keeps it from arguing with the voice.

**Voice-over (outcome B; ≈ 68 words):**
> Is that better than a good supervisor? We built the strongest rival we could implement fairly: its workers survive, it loses nothing, and it restarts the moment it detects the crash.
> Under the same failures, over ten seeds, it tied with us on stall time and on extra cost. So our claim is narrower, and still useful: resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism.

**Key points:** the strongest rival we could implement fairly · it tied on stall time and extra cost · the claim, in R2's words (`docs/claims.md`).
**Not said here:** that recovery stays local, or that the swarm waits less (R1 is not claimed under B). The on-screen run may show one subtree pausing, which is what that run did; the voice-over does not generalize it.

### s7-where-it-helps (2:14–2:26)
**On screen:** the Trade-offs panel: the regime map (detection latency × coordination density), the wins/ties/losses table, and the per-process line.

**Voice-over (outcome B; ≈ 30 words):**
> It helps when a supervisor is slow to restart a coordinator. It ties in our main setting. It loses to a fast external restart, and its detector raises false alarms.

**Key points:** helps when the supervisor restarts slowly · ties in the main setting · loses against a fast external restart · false deaths · both failure models shown (`docs/claims.md` R3).

### s8-proof (2:26–2:36)
**On screen:**
- The verify badge, "Replay verified ✓", with a short hash.
- The takeover chip, as the UI words it: "Takeover OK ✓ 7 hand-overs" (`demo/final`), and its hover, "the heir of each, recomputed from the log, is the one the run used" (swarm).
- The recovery report (supervisor).

**Voice-over (≈ 25 words):**
> And you don't have to trust us. Every run we ship replays bit for bit from a hash-chained log, and a checker recomputes every heir from it.

**Key points:** bit-for-bit replay · hash-chained log · every heir recomputed by a checker.

---

## Close (2:36–3:00)

### s9-close (2:36–3:00) — a real terminal capture, then a title card
**On screen:**
- A terminal: `uv run fractalswarm demo --verify` → MATCH.
- **Title card:** "Kill half the brains. It still finishes." Under it: "FractalSwarm — built on Muse Spark, Muse Wonder and Llama PromptGuard 2 · github.com/Yoelcanarion/fractalswarm".

**Voice-over (≈ 44 words):**
> Clone the repo and run one command. No API key needed: it replays a real recorded run and checks every hash.
> Kill half the brains. It still finishes. FractalSwarm, built on Muse Spark, Muse Wonder and Llama PromptGuard 2.

**Key points:** one command, no key · replays and checks every hash · the tagline · built on Spark, Wonder and PromptGuard 2.

---

## Placeholders to fill (all from `docs/claims.md`)

| Placeholder | Source |
|---|---|
| `{{ablation_parser}}`, `{{ablation_muse}}`, `{{ablation_total}}` | The ablation result on the live input |

## Checks before recording
- [x] The outcome has been decided with Yoel (B, Oct 29), and only that version is in the script.
- [ ] Every placeholder is filled and matches a row of `docs/claims.md`.
- [ ] No "simpler", "cheaper" or "more reliable" appears without its own row in `docs/claims.md`.
- [ ] The rival's assumptions are on screen in `s6`.
- [ ] Nothing says that every run was valid: one real run was not (`swarm__t2_conference__C0__s5`, `.plans/progress.md`). The tagline's evidence (S7) speaks of C3.
- [ ] Each scene's voice-over fits its time when read slowly.
- [ ] **The three-question check:** someone who has not seen the project watches the cut and can say what problem it solves, why Meta's models matter and what the evidence is.
