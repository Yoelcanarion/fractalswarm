"""The ``toy`` stand-in: the kernel's toy scenario as a bench workflow and task.

It lets the harness run end to end (fake LLM, $0) before the real workflows exist. The toy
ignores the chaos profile, so its chart is flat by construction: it tests the plumbing, not
the claim.
"""

from collections.abc import Sequence
from typing import Any

from fractalswarm.bench.registry import (
    Cell,
    CellContext,
    TaskDef,
    register_task,
    register_workflow,
)
from fractalswarm.bench.scoring import Outcome
from fractalswarm.kernel.events import Event
from fractalswarm.runs import record_run

ROUNDS = 2
WORKERS = ("worker-a", "worker-b")


class ToyWorkflow:
    name = "toy"
    tasks = frozenset({"toy"})

    async def run(self, ctx: CellContext) -> None:
        await record_run(
            "toy",
            run_id=ctx.cell.id,
            run_dir=ctx.run_dir,
            backend=ctx.backend,
            seed=ctx.cell.seed,
            params={"rounds": ROUNDS, "workers": list(WORKERS)},
            clock="sim" if ctx.clock == "sim" else "live",
            run_cap_usd=ctx.run_cap_usd,
            project_ledger=ctx.project_ledger,
            secrets=ctx.secrets,
        )

    def preflight(self, cell: Cell, contributor: bool) -> list[dict[str, Any]]:
        # The toy scenario never asks for Contributor routing, so the opt-in changes nothing.
        agent = [
            {"role": "agent", "input": f"Summarize item {n} for {worker}."}
            for n in range(1, ROUNDS + 1)
            for worker in WORKERS
        ]
        merged = "\n".join(f"r{n}:{w}: " + "x" * 40 for n in range(1, ROUNDS + 1) for w in WORKERS)
        return [*agent, {"role": "judge", "input": f"Merge these results:\n{merged}"}]


def toy_checker(events: Sequence[Event]) -> Outcome:
    done = next((event for event in events if event.type == "toy.done"), None)
    if done is None:
        return Outcome(completed=False, valid=False, detail="no toy.done")
    results = done.payload["results"]
    expected = ROUNDS * len(WORKERS)
    good = sum(1 for text in results.values() if text and not text.startswith("<"))
    return Outcome(
        completed=True,
        valid=good == expected,
        score=good / expected,
        detail=f"{good}/{expected} results",
    )


register_workflow(ToyWorkflow())
register_task(TaskDef(name="toy", checker=toy_checker, description="kernel toy scenario"))
