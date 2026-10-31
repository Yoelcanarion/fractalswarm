"""The mutation check of the any_survivor tests. Run it on a throwaway copy of the repo.

Each mutation changes one line of the repair and must turn the tests red. A mutant the tests
hang on counts as caught.

    python scripts/any_survivor_mutations.py <copy of the repo>
"""

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(sys.argv[1])
TESTS = [
    "tests/unit/test_any_survivor.py",
    "tests/integration/test_any_survivor.py",
    "tests/unit/test_bench_knobs.py",
]

ORCH = "src/fractalswarm/actors/orchestrator.py"
MEMB = "src/fractalswarm/coord/membership.py"
TREE = "src/fractalswarm/coord/tree.py"
TAKE = "src/fractalswarm/verify/takeover.py"
SWRM = "src/fractalswarm/actors/swarm.py"
SPEC = "src/fractalswarm/planning/taskspec.py"
REGI = "src/fractalswarm/bench/registry.py"

MUTATIONS = [
    ("ring off", ORCH, "        peers |= _ring(me, members)\n", "        pass\n"),
    (
        "ring one-sided",
        ORCH,
        "return {alive[at - 1], alive[(at + 1) % len(alive)]}",
        "return {alive[(at + 1) % len(alive)]}",
    ),
    (
        "ring from the start",
        ORCH,
        "if me not in alive or not members.dead(role=ROLE):",
        "if me not in alive:",
    ),
    (
        "ring for the dead too",
        ORCH,
        "if me not in alive or not members.dead(role=ROLE):",
        "if not members.dead(role=ROLE) or not alive:",
    ),
    (
        "ring without the param",
        ORCH,
        'if state["any_survivor"] and members is not None:',
        "if members is not None:",
    ),
    (
        "child group: dead not named",
        ORCH,
        'return members.dead(role=ROLE, group=entry["group"]) or [state["id"]]',
        'return [state["id"]]',
    ),
    ("child group without the param", ORCH, 'if alive or not state["any_survivor"]:', "if alive:"),
    (
        "reconcile ignores the flag",
        ORCH,
        'new_owner = heir(tree, gid, members, state["any_survivor"])',
        "new_owner = heir(tree, gid, members)",
    ),
    (
        "detector limit off",
        ORCH,
        "        det.isolation_limit_ms = ISOLATION_LIMIT_MS\n",
        "        pass\n",
    ),
    (
        "detector limit always",
        ORCH,
        '    if args.get("any_survivor"):\n        det.isolation_limit_ms',
        "    if True:\n        det.isolation_limit_ms",
    ),
    (
        "opt-in dropped",
        ORCH,
        'names = ("audit", "feasibility", "arbitration", "any_survivor")',
        'names = ("audit", "feasibility", "arbitration")',
    ),
    ("heard does not count", MEMB, "    det.last_contact = now\n", "    pass\n"),
    ("isolation never lifted", MEMB, "        isolated = False\n", "        pass\n"),
    (
        "limit is strict",
        MEMB,
        "now - det.last_contact >= limit",
        "now - det.last_contact > limit + 1000",
    ),
    (
        "last resort off",
        TREE,
        "if not pool and any_survivor and record.parent is None:",
        "if False:",
    ),
    (
        "last resort without the param",
        TREE,
        "if not pool and any_survivor and record.parent is None:",
        "if not pool and record.parent is None:",
    ),
    (
        "last resort below the root",
        TREE,
        "if not pool and any_survivor and record.parent is None:",
        "if not pool and any_survivor:",
    ),
    (
        "checker ignores the param",
        TAKE,
        'last_resort = bool(started and (started[0].payload.get("params") or {})'
        '.get("any_survivor"))',
        "last_resort = False",
    ),
    (
        "root does not get it",
        SWRM,
        '            args["any_survivor"] = True\n',
        "            pass\n",
    ),
    (
        "rivals get it",
        SWRM,
        'if self.mode == "swarm" and params.get("any_survivor"):',
        'if params.get("any_survivor"):',
    ),
    ("param not recorded", SPEC, '        params["any_survivor"] = True\n', "        pass\n"),
    ("no knob", REGI, '"any_survivor"', '"any_survivor_"'),
]

env = dict(
    os.environ,
    PYTHONPATH=str(ROOT / "src"),
    PYTHONDONTWRITEBYTECODE="1",
    MODEL_API_KEY="",
    HF_TOKEN="",
)


def run() -> tuple[bool, str]:
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "pytest",
            *TESTS,
            "-x",
            "-q",
            "-p",
            "no:cacheprovider",
            "--no-header",
            "--tb=no",
            "--deselect",
            "tests/unit/test_bench_knobs.py::test_the_jitter_sweep_is_a_matrix_of_its_own_outside_the_preregistered_sweeps",
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        out, _ = process.communicate(timeout=150)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
        else:
            process.kill()
        process.wait()
        return False, "the tests hung: the mutant runs for ever"
    tail = [line for line in out.splitlines() if line.strip()][-3:]
    return process.returncode == 0, " | ".join(t[:110] for t in tail)


started = time.time()
ok, tail = run()
print(f"baseline green={ok} {tail} ({time.time() - started:.0f} s)", flush=True)
for name, rel, old, new in MUTATIONS:
    path = ROOT / rel
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    crlf = "\r\n" in text
    plain = text.replace("\r\n", "\n")
    if old not in plain:
        print(f"NOT APPLIED {name}", flush=True)
        continue
    changed = plain.replace(old, new, 1)
    path.write_bytes((changed.replace("\n", "\r\n") if crlf else changed).encode("utf-8"))
    try:
        started = time.time()
        ok, tail = run()
        print(
            f"{'SURVIVED' if ok else 'killed  '} {name:34s} {time.time() - started:4.0f} s  {tail}",
            flush=True,
        )
    finally:
        path.write_bytes(raw)
print("mutation check done", flush=True)
