"""Running T3: the task's params, and the ``fetch`` tool a run needs (spec §13).

A run records its inputs in ``run.started`` (``corpus``), so it replays without the fixture.
The ``fetch`` effect is the tool of ``tools/fetch.py`` with its whole policy. A $0 run points
it at the canned web, with the scripted model that plays over the same pages; a real run points
it at the network. Replay reuses the recorded completions, so it needs neither.
"""

from pathlib import Path
from typing import Any

import httpx

from fractalswarm.bench.tasks.t3_report.canned import CannedWeb
from fractalswarm.bench.tasks.t3_report.fake import make_t3_script
from fractalswarm.bench.tasks.t3_report.task import CONTRACTS_PER_LEAF
from fractalswarm.kernel.effects import EffectFn
from fractalswarm.llm.client import Backend
from fractalswarm.planning.taskspec import REPO_ROOT, TaskSpec
from fractalswarm.safety.fetch_policy import Provenance
from fractalswarm.tools.fetch import Fetcher

DEFAULT_FIXTURE = REPO_ROOT / "tasks" / "fixtures" / "t3" / "databases"


def corpus(spec: TaskSpec) -> dict[str, Any]:
    """The report's inputs and the run's total work (contracts), for the chaos progress clock."""
    inputs = spec.inputs
    if not inputs.subjects or not inputs.criteria:
        raise ValueError("a t3_report TaskSpec needs inputs.subjects and inputs.criteria")
    return {
        "subjects": list(inputs.subjects),
        "criteria": dict(inputs.criteria),
        "sources": list(inputs.sources),
        "expected_work": len(inputs.subjects) * len(inputs.criteria) * CONTRACTS_PER_LEAF,
    }


def web_run(spec: TaskSpec, llm: Backend, *, fake: bool) -> tuple[Backend, dict[str, EffectFn]]:
    """The model and the extra effects of a T3 run: ``fake`` is the $0 run on the canned web."""
    if not fake:
        return llm, {"fetch": Fetcher(httpx.AsyncClient(), Provenance()).effect()}
    from fractalswarm.bench.workflows import fake_backend

    web = CannedWeb.load(Path(spec.inputs.fixture or DEFAULT_FIXTURE))
    fetcher = Fetcher(
        httpx.AsyncClient(transport=web.transport()), Provenance(), resolver=web.resolve
    )
    return fake_backend(make_t3_script(web)), {"fetch": fetcher.effect()}
