# Final bundle: a real run that kills the root three times and finishes

`demo/final/` is one real recorded run of T2 (conference scheduling) at depth 2 on the Meta Model API, in Standard mode with the `kill-half` schedule: five coordinators crashed and half the agents killed. It is the run the home page and `fractalswarm demo` read.

```
uv run fractalswarm demo --verify --no-serve      # replays the bundle and checks its HEAD
uv run fractalswarm replay demo/final --verify    # the same check, by path
uv run fractalswarm takeover demo/final           # recomputes every heir from the log
```

## What ran

- **Code:** commit `568b261` on `Yoelcanarion/arena`, after the handler freeze (`code.json`).
- **Command, spec, chaos plan, cap and retry policy:** `config.json`.
- **Run id:** `final-kill-half-1`, Oct 30, 2026, 20:43 to 20:45 CET.
- **Run cap:** $0.75. **Retries:** `--no-paid-retries` re-sends only the rejections the API does not bill.

## Result

| check | value |
|---|---|
| task result | `ok`: 48 of 48 talks placed, 0 hard violations, soft score 0.9444 |
| replay | `replay.txt` |
| takeover check | `TAKEOVER OK: no violation` (`takeover-check.txt`, `.md`, `.json`) |
| cost | $0.478279 settled for 77 paid LLM calls, peak committed $0.500280 of the $0.75 cap, 0 reservations left open |

## What the log shows

- **Kills:** o0, o2.1, o1, o3.2 and o2, at 22, 44, 50, 67 and 83% of the work. Each was declared dead between 4.39 and 4.76 s later, with 5 true verdicts and 0 false ones.
- **Root:** o0 -> o1 -> o2 -> o3. Three of the five crashed coordinators held the root when they died.
- **Takeovers:** 7 remaps, each recomputed from the log; 7 adoptions, 2 orphan results adopted.
- **Work lost:** none. 18 of 18 contracts verified, 10 of 10 goals ok, 0 paid calls duplicated. One call was cancelled by a kill, and the same request was redone once.
