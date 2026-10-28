# Backup bundle: a real run that kills the root, twice more, and finishes

`demo/backup/` is one real recorded run of T2 (conference scheduling) at depth 2 on the Meta Model API. It ran in Standard mode with the `kill-half` schedule: 5 of the 10 orchestrators are killed while the run works, the root first. Everything below can be checked from the bundle alone, with no API key:

```
uv run fractalswarm demo --verify --no-serve      # replays the bundle and checks its HEAD
uv run fractalswarm replay demo/backup --verify   # the same check, by path
```

## What ran

- **Code:** commit `15b1e1f` on `Yoelcanarion/day-09`, with no tracked changes (`code.json`).
- **Command:** in `config.json`, with the recorded spec, chaos plan, run cap and retry policy.
  ```
  uv run fractalswarm run tasks/examples/t2-conference.yaml --backend real --confirm-real-spend --clock live --firewall auto --chaos kill-half --budget-usd 0.75 --no-paid-retries --run-id t2-real-killhalf-seed1
  ```
- **Run cap:** $0.75.
- **Retries:** `--no-paid-retries` re-sends only 429 and 503, which are rejections the API does not bill. A request with no reply, or a 500, is never re-sent.
- **When:** 2026-10-28, 17:47:08 to 17:49:45 UTC (`started-utc.txt`, `finished-utc.txt`).

## Result

| check | value |
|---|---|
| task result | `ok`: 48 of 48 talks placed, 0 hard violations, soft score 1.0 (`result.json`) |
| replay | `MATCH 8177 events, head b052b4bc33cfe1b54c7b6ceb2872de26` (`replay.txt`) |
| security audit | `AUDIT OK` (`audit.txt`) |
| cost | $0.494767 settled for 79 LLM calls. The peak committed (settled plus open reservations) was $0.516. 0 calls refused, 0 reservations left open (`costs.json`, `spend-before.txt`, `spend-after.txt`) |

## What the log shows (`takeover.json`, `takeover-check.*`)

These facts come from the log, not from what the actors say about themselves. Each heir was recomputed: the members and tree views were rebuilt from the events before the takeover, then `coord.tree.heir` was called on them.

Two independent analyses agree:
- `analyze_takeover.py`, run as `uv run python demo/backup/evidence/analyze_takeover.py demo/backup OUT_DIR`;
- the read-only checker `uv run fractalswarm takeover demo/backup --replay` (`verify/takeover.py`, with its own tests), which prints `TAKEOVER OK: no violation`.

**The root really died.**
- o0 was killed at 22 % of the contracts dispatched (t = 44.5 s, seq 4025), and the kernel stopped it at seq 4027.
- No event was written by o0 after that.
- The only messages addressed to it afterwards were 16 heartbeats, which went undelivered.

**The kill hit the root's owner every time.** When each kill landed, the owner of the root goal was:
- o0, when o0 was killed;
- o1, when o1 was killed;
- o2, when o2 was killed.

So the root goal lost its owner three times in one run.

**Detection.** Every death was declared by a survivor after 5 missed heartbeats, 4.1 to 5.1 s after the kill. There were no false verdicts and no rejoins.

| killed | at | declared dead by | after |
|---|---|---|---|
| o0 (root) | 22 % | o3 | 5.1 s |
| o2.1 (session) | 39 % | o2 | 4.4 s |
| o1 (track lead, root's heir) | 50 % | o3 | 4.1 s |
| o3.2 (session) | 67 % | o3 | 4.9 s |
| o2 (track lead, root's second heir) | 83 % | o2.2 | 4.1 s |

**Succession: 7 takeovers.** Every one went to the recomputed HRW heir, was written by that heir itself, and had no split brain.

| goal | from | to | candidates |
|---|---|---|---|
| root | o0 | o1 | o1, o2, o3 |
| track-ai/d1 | o2.1 | o2.2 | o2.2 |
| root | o1 | o2 | o2, o3 |
| track-data | o1 | o3 | o2, o3 |
| track-hci/d2 | o3.2 | o3.1 | o3.1 |
| root | o2 | o3 | o3 |
| track-ai | o2 | o3 | o3 |

Each root heir also adopted the dead root's child group, together with its duties: final integration and top-level arbitration (`tree.adopted`).

Choosing an heir costs nothing: there is no election and no LLM call. In one takeover reaction (seq 6369), the heir o3.1 also started the judge call for the orphan `place` result it had just adopted. That is the call the dead owner would have made anyway, not an extra one.

For comparison, the real Standard run of the same task with no kills (`t2-real-seed1b`, earlier the same day) made 80 calls for $0.454. One pair of runs cannot separate the cost of the kills from run-to-run noise, such as booking collisions.

**Orphan results were adopted, not paid for again.** Three results reached owners that were already dead:
- the `extract` result of track-ai/d1 (sent to o2.1);
- the `place` result of track-hci/d2 (sent to o3.2): `adopted_results: 1`;
- the session result of track-ai/d2 (sent to o2).

The heirs took all three from the log, and no contract was dispatched again for the same attempt.

The adopted `place` result of track-hci/d2 then failed its booking, because speaker S13 was already booked by track-data/d2. So o3.1 sent a new attempt, as any owner would. All 5 rejections in the run are of this kind: 4 booking collisions with other sessions and 1 judge verdict on a soft preference.

**No lost work.**
- 18 of 18 contracts were verified and 10 of 10 goals completed.
- There were 23 dispatches: the 18 first attempts plus 5 retries after booking collisions, a normal part of T2.

**No duplicate calls.**
- 79 LLM calls started, 79 completed and 0 were cancelled in flight: no victim had a call in flight when it was killed.
- No two completed calls sent the same request.
- No `idem_key` was used twice.
- The cassette holds 79 entries, one per call.

**Invariants.**
- The hash chain replays bit for bit.
- 0 writes came from an actor that was not the goal's owner at that moment.
- 0 fenced writes were rejected, and the audit trail verifies.

## What this does not show

- **A kill is an actor crash inside one Python process.** The kernel stops the actor, so its memory and in-flight calls are gone and it never writes again. But the kernel and its log keep running. Recovering after the whole Python process dies (spec §8, process crash) is a separate, open piece of work. It is not claimed here.
- **The log is centralized** (spec §12). The orchestrators coordinate without a leader, but they share one hash-chained log.
- **No call was in flight at any kill in this run**, so it does not exercise "cancelled and redone". The fake-LLM tests and the C3 runs do.
- **The machine was not idle.** Another agent's full test suite (fake LLM, sim clock) ran on the same machine from about 18:45 to 18:53 CET, which overlaps this recording (18:47 to 18:50 CET). The log shows no sign that the run was starved of CPU:
  - the 13 suspicions were all about members that had been killed;
  - no death verdict was false;
  - no live member's heartbeats were more than 1.08 s apart (the period is 1 s).

  The detection delays and the run's timing can still carry some noise from that load.
- **The `encrypted_content` blobs** in `events.jsonl` and `cassette.jsonl` are opaque reasoning state returned by the API. Six of them happen to contain substrings shaped like `hf_…` or `sk-…`. They are not credentials.
