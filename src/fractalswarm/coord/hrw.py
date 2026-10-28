"""Bounded-load rendezvous hashing (HRW) within a sibling group (spec §5.3).

``owner(k) = argmax over live members of H(k‖member)``, with a load bound: keys are taken in
``(priority desc, key)`` order and each goes to its highest-ranked member whose load is below
``ceil((1 + ε) · K / N)``. Every member computes the same answer from the same inputs, so
assignment needs no election and no messages.

``remap`` is the takeover form: survivors keep their keys and only the orphans move.
"""

import math
from collections.abc import Iterable, Mapping, Sequence

from fractalswarm.kernel.ids import stable_hash

EPSILON = 0.25


def score(key: str, member: str) -> int:
    return stable_hash("hrw", key, member)


def rank(key: str, members: Iterable[str]) -> list[str]:
    """Members from most to least preferred for ``key`` (ties by member id)."""
    return sorted(set(members), key=lambda member: (-score(key, member), member))


def capacity(keys: int, members: int, epsilon: float = EPSILON) -> int:
    if members <= 0:
        raise ValueError("no members to assign to")
    return max(1, math.ceil((1 + epsilon) * keys / members))


def _ordered(keys: Mapping[str, int] | Sequence[str]) -> list[str]:
    priorities = keys if isinstance(keys, Mapping) else dict.fromkeys(keys, 0)
    return sorted(priorities, key=lambda key: (-priorities[key], key))


def assign(
    keys: Mapping[str, int] | Sequence[str],
    members: Iterable[str],
    epsilon: float = EPSILON,
) -> dict[str, str]:
    """Key -> owner. ``keys`` is a list, or a mapping of key -> priority."""
    pool = sorted(set(members))
    ordered = _ordered(keys)
    bound = capacity(len(ordered), len(pool), epsilon)
    load = dict.fromkeys(pool, 0)
    owners: dict[str, str] = {}
    for key in ordered:
        owner = next(member for member in rank(key, pool) if load[member] < bound)
        owners[key] = owner
        load[owner] += 1
    return dict(sorted(owners.items()))


def remap(
    owners: Mapping[str, str],
    alive: Iterable[str],
    priorities: Mapping[str, int] | None = None,
    epsilon: float = EPSILON,
) -> dict[str, str]:
    """Move only the keys of dead owners; survivors keep theirs (minimal remap)."""
    pool = sorted(set(alive))
    if not pool:
        raise ValueError("no live members to remap to")
    priorities = priorities or {}
    bound = capacity(len(owners), len(pool), epsilon)
    kept = {key: owner for key, owner in owners.items() if owner in pool}
    load = dict.fromkeys(pool, 0)
    for owner in kept.values():
        load[owner] += 1
    orphans = {key: priorities.get(key, 0) for key in owners if key not in kept}
    for key in _ordered(orphans):
        ranked = rank(key, pool)
        owner = next((member for member in ranked if load[member] < bound), ranked[0])
        kept[key] = owner
        load[owner] += 1
    return dict(sorted(kept.items()))
