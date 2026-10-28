"""Determinism lint for the handler code: kernel/, coord/, market/, the swarm actors, planning,
memory, the contract checks and judge, the T2 and T3 tasks and baselines/ (spec §3 and §19).

Replay must rebuild the log bit for bit, so code in these packages must not read the wall
clock, draw unseeded randomness or call the built-in ``hash()``, which is salted per process.
The only allowed RNG is a seeded ``random.Random(f"{run_seed}:{actor_id}:{purpose}")``, and
stable hashes come from the blake2b helpers in ``kernel/ids.py``.

A line that must touch the real world here (the live clock, the effect runner) carries
``# determinism: allow`` followed by the reason.
"""

import ast
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[2] / "src" / "fractalswarm"
LINTED_DIRS = (
    "kernel",
    "coord",
    "market",
    "actors",
    "planning",
    "memory",
    "bench/tasks/t2_conference",
    "bench/tasks/t3_report",
    "baselines",
)
# verify/ also holds code of other streams; lint the files the swarm's handlers call.
LINTED_FILES = ("verify/checks.py", "verify/judge.py")
ALLOW_PRAGMA = "# determinism: allow"

CLOCK_FUNCTIONS = {
    "time",
    "time_ns",
    "monotonic",
    "monotonic_ns",
    "perf_counter",
    "perf_counter_ns",
}
FORBIDDEN_NAMES = (
    {f"time.{name}" for name in CLOCK_FUNCTIONS}
    | {
        f"{prefix}{name}"
        for prefix in ("datetime.", "datetime.datetime.")
        for name in ("now", "utcnow", "today")
    }
    | {"date.today", "datetime.date.today", "os.urandom", "uuid.uuid1", "uuid.uuid4"}
)
FORBIDDEN_IMPORTS = {"time": CLOCK_FUNCTIONS, "os": {"urandom"}, "uuid": {"uuid1", "uuid4"}}


def dotted_name(node: ast.expr) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def is_builtin_hash(node: ast.expr) -> bool:
    return isinstance(node, ast.Name) and node.id == "hash"


def problems_in(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Attribute):
        name = dotted_name(node)
        if name in FORBIDDEN_NAMES:
            return [f"{name} is a wall-clock read or unseeded entropy"]
        if name and name.split(".")[0] == "random" and name.split(".")[1] != "Random":
            return [f"{name} is unseeded; use a seeded random.Random instance"]
        if name and name.split(".")[0] == "secrets":
            return [f"{name} is unseeded entropy"]
    if isinstance(node, ast.Call):
        values = [node.func, *node.args, *(keyword.value for keyword in node.keywords)]
        if any(is_builtin_hash(value) for value in values):
            return ["built-in hash() is salted per process; use the blake2b helpers"]
    if isinstance(node, ast.Import):
        return [f"import {a.name} is unseeded entropy" for a in node.names if a.name == "secrets"]
    if isinstance(node, ast.ImportFrom) and node.level == 0:
        module = node.module or ""
        names = {alias.name for alias in node.names}
        if module == "random":
            names -= {"Random"}
        elif module != "secrets":
            names &= FORBIDDEN_IMPORTS.get(module, set())
        return [f"from {module} import {name}" for name in sorted(names)]
    return []


def find_violations(source: str, filename: str = "<snippet>") -> list[str]:
    lines = source.splitlines()
    violations = []
    for node in ast.walk(ast.parse(source, filename)):
        for problem in problems_in(node):
            lineno = getattr(node, "lineno", 1)
            if ALLOW_PRAGMA not in lines[lineno - 1]:
                violations.append(f"{filename}:{lineno}: {problem}")
    return violations


def test_linted_packages_exist() -> None:
    for directory in LINTED_DIRS:
        assert (PACKAGE / directory / "__init__.py").is_file(), directory


def test_handler_code_is_deterministic() -> None:
    paths = [path for d in LINTED_DIRS for path in sorted((PACKAGE / d).rglob("*.py"))]
    paths += [PACKAGE / name for name in LINTED_FILES]
    violations = []
    for path in paths:
        source = path.read_text(encoding="utf-8")
        violations += find_violations(source, path.relative_to(PACKAGE).as_posix())
    assert not violations, "\n".join(violations)


@pytest.mark.parametrize(
    "snippet",
    [
        "import time\nnow = time.time()",
        "import time\nnow = time.time_ns()",
        "import time\nstarted = time.monotonic()",
        "from time import perf_counter",
        "import datetime\nnow = datetime.datetime.now()",
        "from datetime import datetime\nnow = datetime.utcnow()",
        "from datetime import date\ntoday = date.today()",
        "import random\nx = random.random()",
        "import random\nrandom.shuffle(members)",
        "import random\nrandom.seed(7)",
        "import random\nrng = random.SystemRandom()",
        "from random import choice",
        "owner = hash(key)",
        "ranked = sorted(members, key=hash)",
        "import uuid\nrun_id = uuid.uuid4()",
        "from uuid import uuid4",
        "import os\nsalt = os.urandom(8)",
        "import secrets",
        "from secrets import token_hex",
    ],
)
def test_lint_flags(snippet: str) -> None:
    assert find_violations(snippet)


@pytest.mark.parametrize(
    "snippet",
    [
        'import random\nrng = random.Random(f"{run_seed}:{actor_id}:{purpose}")\nx = rng.random()',
        "from random import Random\nrng = Random('seed')",
        "import hashlib\ndigest = hashlib.blake2b(data, digest_size=16).hexdigest()",
        "def stable_hash(data):\n    return data\n\nkey = stable_hash(b'k')",
        "prev = event.hash\nrow = {'hash': prev}",
        "from datetime import datetime\ndeadline = datetime(2026, 11, 5, 3)",
        "import time\nnow = time.time()  # determinism: allow (live clock)",
    ],
)
def test_lint_allows(snippet: str) -> None:
    assert find_violations(snippet) == []
