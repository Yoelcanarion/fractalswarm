"""Stable ids and hashing: identical in every process, unlike the built-in hash()."""

import os
import subprocess
import sys

import pytest

from fractalswarm.kernel.ids import (
    GENESIS_HASH,
    canonical_json,
    chain_hash,
    digest,
    stable_hash,
    stable_id,
)


def test_canonical_json_ignores_key_order_and_whitespace() -> None:
    assert canonical_json({"b": 1, "a": [1, 2]}) == canonical_json({"a": [1, 2], "b": 1})
    assert canonical_json({"a": "é"}) == '{"a":"é"}'


def test_canonical_json_refuses_nan() -> None:
    with pytest.raises(ValueError):
        canonical_json({"x": float("nan")})


def test_digest_and_ids_are_stable() -> None:
    assert digest({"a": 1}) == digest({"a": 1})
    assert digest({"a": 1}) != digest({"a": 2})
    assert stable_id("eff", 3, "x").startswith("eff-")
    assert len(stable_id("eff", 3, "x")) == len("eff-") + 12


def test_chain_hash_depends_on_the_previous_hash() -> None:
    row = {"seq": 1}
    assert chain_hash(GENESIS_HASH, row) != chain_hash("1" * 32, row)


def test_stable_hash_is_the_same_in_another_process() -> None:
    code = "from fractalswarm.kernel.ids import stable_hash; print(stable_hash('m', 'S1', 7))"
    outputs = set()
    for seed in ("1", "2"):
        env = os.environ | {"PYTHONHASHSEED": seed}
        result = subprocess.run(
            [sys.executable, "-c", code], capture_output=True, text=True, env=env, check=True
        )
        outputs.add(result.stdout.strip())
    assert outputs == {str(stable_hash("m", "S1", 7))}
