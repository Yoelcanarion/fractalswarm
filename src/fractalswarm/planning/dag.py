"""A plan DAG: nodes with dependencies, readiness (stigmergy) and the critical path."""

from collections.abc import Iterable, Mapping


class DagError(ValueError):
    pass


class Dag:
    def __init__(self, deps: Mapping[str, Iterable[str]], cost: Mapping[str, float] | None = None):
        self.deps = {node: sorted(set(parents)) for node, parents in deps.items()}
        self.cost = dict(cost or {})
        for node, parents in sorted(self.deps.items()):
            unknown = [parent for parent in parents if parent not in self.deps]
            if unknown:
                raise DagError(f"{node} depends on unknown nodes {unknown}")
            if node in parents:
                raise DagError(f"{node} depends on itself")
        self.order = self._topological()

    def _topological(self) -> list[str]:
        remaining = {node: set(parents) for node, parents in self.deps.items()}
        order: list[str] = []
        while remaining:
            ready = sorted(node for node, parents in remaining.items() if not parents)
            if not ready:
                raise DagError(f"cycle among {sorted(remaining)}")
            for node in ready:
                order.append(node)
                del remaining[node]
            for parents in remaining.values():
                parents.difference_update(ready)
        return order

    def ready(self, done: Iterable[str], busy: Iterable[str] = ()) -> list[str]:
        """Nodes whose dependencies are all done and that are neither done nor busy."""
        done, busy = set(done), set(busy)
        return [
            node
            for node in self.order
            if node not in done and node not in busy and all(p in done for p in self.deps[node])
        ]

    def dependents(self, node: str) -> list[str]:
        return [other for other in self.order if node in self.deps[other]]

    def critical_path(self) -> list[str]:
        """The longest path by cost (1 per node when no cost is given)."""
        best: dict[str, tuple[float, list[str]]] = {}
        for node in self.order:
            here = self.cost.get(node, 1.0)
            options = [best[parent] for parent in self.deps[node]]
            length, path = max(options, key=lambda option: (option[0], option[1]), default=(0, []))
            best[node] = (length + here, [*path, node])
        if not best:
            return []
        return max(best.values(), key=lambda option: (option[0], option[1]))[1]
