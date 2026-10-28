# ruff: noqa: E501 - an evidence script: its report lines are long on purpose
"""Takeover evidence from a recorded run's log alone (not from what the actors say of themselves).

Usage (repo root): uv run python demo/backup/evidence/analyze_takeover.py demo/backup OUT_DIR
Writes OUT_DIR/takeover.json and prints a summary. Exit 1 if any violation is found.
"""

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from fractalswarm.bench.scoring import load_events
from fractalswarm.coord.hrw import score
from fractalswarm.coord.membership import MembersView
from fractalswarm.coord.tree import TreeView, candidates, heir

run, out = Path(sys.argv[1]), Path(sys.argv[2])
events = load_events(run)
violations: list[str] = []
ms = lambda e: round(e.ts_virtual / 1000, 3)  # noqa: E731 - seconds since the run started


def request_hash(request: dict) -> str:
    return hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:16]


# -- 1. kills and proof of death ---------------------------------------------------------------
kills = []
for e in events:
    if e.type != "chaos.injected" or e.payload.get("fault") != "kill_coordinator":
        continue
    target = e.payload.get("target")
    stop = next(
        (
            s
            for s in events
            if s.seq > e.seq and s.type == "actor.stopped" and s.payload.get("actor_id") == target
        ),
        None,
    )
    after = [x for x in events if stop is not None and x.seq > stop.seq and x.actor == target]
    kills.append(
        {
            "target": target,
            "progress": e.payload.get("progress"),
            "seq": e.seq,
            "t_s": ms(e),
            "skipped": bool(e.payload.get("detail", {}).get("skipped")),
            "stopped_seq": stop.seq if stop else None,
            "stop_reason": stop.payload.get("reason") if stop else None,
            "events_by_target_after_stop": len(after),
            "topics_sent_to_target_after_stop": dict(
                Counter(
                    x.payload.get("topic")
                    for x in events
                    if stop is not None
                    and x.seq > stop.seq
                    and x.type == "msg.sent"
                    and x.payload.get("to") == target
                )
            ),
            "msgs_sent_to_target_after_stop": sum(
                1
                for x in events
                if stop is not None
                and x.seq > stop.seq
                and x.type == "msg.sent"
                and x.payload.get("to") == target
            ),
        }
    )
    if e.payload.get("detail", {}).get("skipped"):
        violations.append(f"kill of {target} at {e.payload.get('progress')} was skipped")
    if stop is None:
        violations.append(f"{target}: chaos.injected without actor.stopped")
    if after:
        violations.append(f"zombie: {len(after)} events by {target} after its stop")
killed_at = {k["target"]: k["seq"] for k in kills}

# -- 2..5: fold the views once, checking as we go -----------------------------------------------
members, tree = MembersView(), TreeView()
remaps = [e for e in events if e.type == "ownership.remapped"]
batch_start: dict[int, int] = {}
for r in remaps:
    batch_start[r.causation_id] = min(batch_start.get(r.causation_id, r.seq), r.seq)
pending = {seq for seq in batch_start.values()}
snapshots: dict[int, dict] = {}  # batch start seq -> {gid: (owner, parent, heir, pool, scores)}
root_owner_at_kill: dict[str, str | None] = {}
fenced_mismatch = []
for e in events:
    if e.seq in pending:  # the state the heir decided on: everything before its batch
        batch = [r for r in remaps if batch_start[r.causation_id] == e.seq]
        snap = {}
        for r in batch:
            gid = r.payload["key"]
            record = tree.goals.get(gid)
            if record is None:
                snap[gid] = {"error": "goal unknown to the tree view"}
                continue
            pool = candidates(record.owner, members)
            snap[gid] = {
                "owner_before": record.owner,
                "parent": record.parent,
                "pool": pool,
                "heir": heir(tree, gid, members),
                "scores": {m: score(gid, m) % 10**6 for m in sorted(pool)},
            }
        snapshots[e.seq] = snap
    if e.type == "chaos.injected" and e.payload.get("target") in killed_at:
        root_owner_at_kill[e.payload["target"]] = (
            tree.owner_of("root") if "root" in tree.goals else None
        )
    fence = e.payload.get("fence") if isinstance(e.payload, dict) else None
    if fence and e.type != "ownership.remapped" and e.type != "tree.adopted":
        resource = fence.get("resource")
        if resource in tree.goals and tree.goals[resource].owner != e.actor:
            fenced_mismatch.append(
                {
                    "seq": e.seq,
                    "type": e.type,
                    "actor": e.actor,
                    "resource": resource,
                    "owner": tree.goals[resource].owner,
                }
            )
    members.apply(e)
    tree.apply(e)

succession = []
for r in remaps:
    snap = snapshots[batch_start[r.causation_id]].get(r.payload["key"], {})
    row = {
        "seq": r.seq,
        "t_s": ms(r),
        "goal": r.payload["key"],
        "previous": r.payload["previous"],
        "owner": r.payload["owner"],
        "written_by": r.actor,
        "works": r.payload.get("works", []),
        "adopted_results": r.payload.get("adopted_results", 0),
        "recomputed_heir": snap.get("heir"),
        "pool": snap.get("pool"),
        "hrw_scores_mod_1e6": snap.get("scores"),
        "owner_before": snap.get("owner_before"),
    }
    row["heir_matches"] = row["recomputed_heir"] == row["owner"]
    succession.append(row)
    if not row["heir_matches"]:
        violations.append(
            f"remap of {row['goal']} went to {row['owner']}, HRW says {row['recomputed_heir']}"
        )
    if r.actor != r.payload["owner"]:
        violations.append(
            f"remap of {row['goal']} written by {r.actor}, not by the heir {r.payload['owner']}"
        )
pairs = Counter((r.payload["key"], r.payload["previous"]) for r in remaps)
for gid, prev in pairs:
    owners = {
        r.payload["owner"]
        for r in remaps
        if (r.payload["key"], r.payload["previous"]) == (gid, prev)
    }
    if len(owners) > 1:
        violations.append(f"split brain: {gid} from {prev} taken by {sorted(owners)}")
for m in fenced_mismatch:
    violations.append(
        f"write by non-owner: seq {m['seq']} {m['type']} by {m['actor']} on {m['resource']} (owner {m['owner']})"
    )

# -- verdicts ----------------------------------------------------------------------------------
verdicts = []
for e in events:
    if e.type != "member.dead":
        continue
    member = e.payload.get("member")
    kill_seq = killed_at.get(member)
    true = kill_seq is not None and kill_seq < e.seq
    kill_t = next((k["t_s"] for k in kills if k["target"] == member), None)
    verdicts.append(
        {
            "member": member,
            "by": e.payload.get("by"),
            "seq": e.seq,
            "t_s": ms(e),
            "missed": e.payload.get("missed"),
            "true": true,
            "delay_after_kill_s": round(ms(e) - kill_t, 3) if true and kill_t is not None else None,
        }
    )
false_verdicts = [v for v in verdicts if not v["true"]]
rejoins = [
    {"member": e.payload.get("member"), "seq": e.seq}
    for e in events
    if e.type == "member.joined"
    and any(v["member"] == e.payload.get("member") and v["seq"] < e.seq for v in verdicts)
]
for k in kills:
    if not any(v["member"] == k["target"] and v["true"] for v in verdicts):
        violations.append(f"nobody declared {k['target']} dead")

# -- adoption ----------------------------------------------------------------------------------
adoptions = [
    {
        "seq": e.seq,
        "t_s": ms(e),
        **{k: e.payload.get(k) for k in ("dead", "adopter", "goal_id", "children", "duties")},
    }
    for e in events
    if e.type == "tree.adopted"
]

# -- lost work ---------------------------------------------------------------------------------
created = {
    e.payload.get("work") or f"{e.payload.get('goal_id')}/{e.payload.get('contract_id')}"
    for e in events
    if e.type == "contract.created"
}
verified = {e.payload.get("work") for e in events if e.type == "contract.verified"}
dispatches = Counter(
    (e.payload.get("work"), e.payload.get("attempt"))
    for e in events
    if e.type == "contract.dispatched"
)
work_of = lambda p: p.get("work") or f"{p.get('goal_id')}/{p.get('contract_id')}"  # noqa: E731
completions = Counter(
    (work_of(e.payload), e.payload.get("attempt")) for e in events if e.type == "contract.completed"
)
goals = {gid for gid in tree.goals}
completed_goals = {e.payload["goal_id"] for e in events if e.type == "goal.completed"}
result = next((e.payload for e in events if e.type == "task.result"), None)
lost = sorted(w for w in created if w not in verified)
if lost:
    violations.append(f"contracts never verified: {lost}")
if goals - completed_goals:
    violations.append(f"goals never completed: {sorted(goals - completed_goals)}")
same_attempt_twice = {f"{w}#{a}": n for (w, a), n in dispatches.items() if n > 1}
if same_attempt_twice:
    violations.append(f"same contract attempt dispatched twice: {same_attempt_twice}")
done_twice = {f"{w}#{a}": n for (w, a), n in completions.items() if n > 1}
if done_twice:
    violations.append(f"same contract attempt completed twice: {done_twice}")
report = (result or {}).get("report", {})
if (
    not result
    or result.get("status") != "ok"
    or report.get("placed") != report.get("expected")
    or report.get("hard_violations")
):
    violations.append(
        f"task.result not clean: {result and {k: report.get(k) for k in ('placed', 'expected', 'hard_violations')}}"
    )

# -- duplicate calls ---------------------------------------------------------------------------
started = {
    e.payload["effect_id"]: e
    for e in events
    if e.type == "effect.started" and e.payload.get("kind") == "llm"
}
completed_ok = [
    e for e in events if e.type == "effect.completed" and e.payload.get("kind") == "llm"
]
cancelled = [e for e in events if e.type == "effect.cancelled" and e.payload.get("kind") == "llm"]
by_request = defaultdict(list)
for e in completed_ok:
    by_request[request_hash(started[e.payload["effect_id"]].payload["request"])].append(
        e.payload["effect_id"]
    )
duplicates = {h: ids for h, ids in by_request.items() if len(ids) > 1}
if duplicates:
    violations.append(
        f"identical LLM requests completed more than once: {list(duplicates.values())}"
    )
redone = []
for c in cancelled:
    h = request_hash(started[c.payload["effect_id"]].payload["request"])
    later = [i for i in by_request.get(h, []) if started[i].seq > c.seq]
    redone.append(
        {
            "effect_id": c.payload["effect_id"],
            "actor": started[c.payload["effect_id"]].actor,
            "role": started[c.payload["effect_id"]].payload["request"].get("role"),
            "redone_identically": len(later),
        }
    )
    if len(later) > 1:
        violations.append(f"cancelled call {c.payload['effect_id']} redone {len(later)} times")
idem = Counter(e.idem_key for e in events if e.type == "effect.started")
idem_reuse = {k: n for k, n in idem.items() if n > 1}
if idem_reuse:
    violations.append(f"idem keys reused by effect.started: {idem_reuse}")
cassette_ids = [
    json.loads(line).get("effect_id")
    for line in (run / "cassette.jsonl").read_text(encoding="utf-8").splitlines()
    if line.strip()
]
cassette_dupes = {k: n for k, n in Counter(cassette_ids).items() if n > 1}
completed_ids = {e.payload["effect_id"] for e in completed_ok}
if cassette_dupes:
    violations.append(f"cassette entries repeated: {cassette_dupes}")
missing_in_cassette = sorted(completed_ids - set(cassette_ids))
if missing_in_cassette:
    violations.append(f"completed LLM effects without a cassette entry: {missing_in_cassette[:5]}")

# -- costs and other invariants ----------------------------------------------------------------
roles = {k: v.payload["request"].get("role") for k, v in started.items()}
settled_role, settled_actor, reserved = defaultdict(float), defaultdict(float), {}
settled = peak = 0.0
for e in events:
    if e.type == "budget.reserved":
        reserved[e.payload["effect_id"]] = (e.payload["usd"], e.actor)
    elif e.type == "budget.settled":
        usd, actor = reserved.pop(e.payload["effect_id"], (0.0, "?"))
        settled += e.payload["actual_usd"]
        settled_role[roles.get(e.payload["effect_id"], "?")] += e.payload["actual_usd"]
        settled_actor[actor] += e.payload["actual_usd"]
    peak = max(peak, settled + sum(u for u, _ in reserved.values()))
refused = sum(e.type == "budget.refused" for e in events)
if refused:
    violations.append(f"{refused} calls refused by the budget")
counts = Counter(e.type for e in events)

evidence = {
    "run": run.name,
    "events": len(events),
    "kills": kills,
    "root_owner_when_each_kill_landed": root_owner_at_kill,
    "verdicts": verdicts,
    "false_verdicts": len(false_verdicts),
    "rejoins": rejoins,
    "succession": succession,
    "adoptions": adoptions,
    "fenced_writes_rejected": counts.get("write.fenced", 0),
    "writes_by_non_owner": fenced_mismatch,
    "contracts": {
        "created": len(created),
        "verified": len(verified),
        "never_verified": lost,
        "dispatches": sum(dispatches.values()),
        "rejected": counts.get("contract.rejected", 0),
        "same_attempt_dispatched_twice": same_attempt_twice,
    },
    "goals": {"total": len(goals), "completed": len(completed_goals & goals)},
    "task_result": {
        "status": result and result.get("status"),
        **{k: report.get(k) for k in ("placed", "expected", "hard_violations", "soft_score")},
    },
    "llm_calls": {
        "started": len(started),
        "completed": len(completed_ok),
        "cancelled_in_flight": len(cancelled),
        "identical_requests_completed_twice": duplicates,
        "cancelled_and_redone": redone,
        "idem_keys_reused": idem_reuse,
        "cassette_entries": len(cassette_ids),
        "cassette_entries_repeated": cassette_dupes,
    },
    "costs": {
        "settled_usd": round(settled, 6),
        "peak_committed_usd": round(peak, 6),
        "open_reservations_at_end_usd": round(sum(u for u, _ in reserved.values()), 6),
        "refused": refused,
        "settled_by_role": {k: round(v, 6) for k, v in sorted(settled_role.items())},
        "settled_by_actor": {k: round(v, 6) for k, v in sorted(settled_actor.items())},
    },
    "violations": violations,
}
out.mkdir(parents=True, exist_ok=True)
(out / "takeover.json").write_text(
    json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)

print(f"run {run.name}: {len(events)} events")
for k in kills:
    print(
        f"  kill {k['target']:5} at {k['progress']:.4f} (t={k['t_s']}s, seq {k['seq']}) stopped seq {k['stopped_seq']}"
        f" | events by it after: {k['events_by_target_after_stop']} | msgs to it after: {k['topics_sent_to_target_after_stop']}"
    )
print(f"  root goal owner when each kill landed: {root_owner_at_kill}")
for v in verdicts:
    print(
        f"  verdict {v['member']:5} by {v['by']:5} t={v['t_s']}s missed {v['missed']} true={v['true']} delay={v['delay_after_kill_s']}s"
    )
print(f"  false verdicts: {len(false_verdicts)}, rejoins: {len(rejoins)}")
for s in succession:
    print(
        f"  remap {s['goal']:14} {s['previous']:5} -> {s['owner']:5} (recomputed {s['recomputed_heir']}, pool {s['pool']}) works {len(s['works'])} adopted_results {s['adopted_results']}"
    )
for a in adoptions:
    print(
        f"  adopted: {a['adopter']} takes {a['dead']}'s {a['goal_id']} children {a['children']} duties {a['duties']}"
    )
print(f"  contracts {evidence['contracts']}")
print(f"  goals {evidence['goals']}, result {evidence['task_result']}")
llm = evidence["llm_calls"]
print(
    f"  llm: started {llm['started']} completed {llm['completed']} cancelled {llm['cancelled_in_flight']} "
    f"dup-completed {len(llm['identical_requests_completed_twice'])} idem-reuse {len(llm['idem_keys_reused'])} cassette {llm['cassette_entries']}"
)
print(f"  cancelled and redone: {llm['cancelled_and_redone']}")
print(
    f"  costs {evidence['costs']['settled_usd']} settled, peak committed {evidence['costs']['peak_committed_usd']}, refused {refused}, fenced rejected {evidence['fenced_writes_rejected']}"
)
print("VIOLATIONS:" if violations else "no violations", *violations, sep="\n  ")
sys.exit(1 if violations else 0)
