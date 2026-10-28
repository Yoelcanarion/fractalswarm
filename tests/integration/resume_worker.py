"""Test-only launcher for test_resume_kill.py: the real ``fractalswarm`` CLI in a child process,
with a counting fake LLM and hooks that freeze the process at a chosen point so the parent
can kill it there (``Popen.kill()``, which is ``TerminateProcess`` on Windows).

    python resume_worker.py run tasks/examples/t2-conference.yaml --run-id r1 ...
    python resume_worker.py resume r1 ...

The hooks are environment variables, so the same launcher runs the first process and the
resumed one:

- ``RESUME_COUNTER``: every request the fake LLM receives is appended to this file as one JSON
  line, and fsynced, before the request is answered. It is what the provider would have seen;
- ``RESUME_HOLD_AT=n``: the n-th request this process receives is counted and then never
  answered: sent, no reply (class (c));
- ``RESUME_FREEZE_AFTER_RECORD=n``: the process stops dead right after the n-th cassette record,
  before the completion reaches the log (class (b));
- ``RESUME_FREEZE_AFTER_EVENT=type:n[:kind]``: the process stops dead right after the n-th
  event of that type (of that effect kind, for effect events) is appended to the log, with
  the rest of its reaction unwritten: a torn tail;
- ``RESUME_SIGNAL``: a file created when a hold or a freeze starts;
- ``RESUME_LEDGER``: a project ledger (SQLite) to use with the fake LLM, for the cost tests.
"""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any


def append_line(path: str, line: dict[str, Any]) -> None:
    with open(path, "a", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(line) + "\n")
        out.flush()
        os.fsync(out.fileno())


def signal(kind: str, **info: Any) -> None:
    path = os.environ.get("RESUME_SIGNAL")
    if path:
        tmp = Path(path).with_suffix(".tmp")
        tmp.write_text(json.dumps({"kind": kind, **info}), encoding="utf-8")
        tmp.replace(path)


class CountingBackend:
    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.received = 0
        self.hold_at = int(os.environ.get("RESUME_HOLD_AT", "0"))

    async def send(self, effect_id: str, body: dict[str, Any], sleep: Any) -> Any:
        self.received += 1
        counter = os.environ.get("RESUME_COUNTER")
        if counter:
            append_line(counter, {"effect_id": effect_id, "n": self.received, "pid": os.getpid()})
        if self.hold_at and self.received == self.hold_at:
            signal("held", effect_id=effect_id)
            await asyncio.sleep(3600)
        return await self.inner.send(effect_id, body, sleep)


def install_hooks() -> None:
    from fractalswarm.bench import workflows
    from fractalswarm.llm.client import LLMClient

    fake_backend = workflows.fake_backend
    workflows.fake_backend = lambda: CountingBackend(fake_backend())

    freeze_after = int(os.environ.get("RESUME_FREEZE_AFTER_RECORD", "0"))
    if freeze_after:
        record = LLMClient._record
        recorded = 0

        def freezing_record(self: Any, entry: Any) -> Any:
            nonlocal recorded
            result = record(self, entry)
            recorded += 1
            if recorded == freeze_after:
                signal("recorded", effect_id=entry.effect_id)
                time.sleep(3600)  # the cassette has the reply; the log does not
            return result

        LLMClient._record = freezing_record  # type: ignore[method-assign]

    freeze_event = os.environ.get("RESUME_FREEZE_AFTER_EVENT")
    if freeze_event:
        from fractalswarm.kernel.store import EventStore

        event_type, nth, *kind = freeze_event.split(":")
        append = EventStore.append
        appended = 0

        def freezing_append(self: Any, draft: Any) -> Any:
            nonlocal appended
            event = append(self, draft)
            wanted = event.type == event_type and self.path != ":memory:"
            if wanted and (not kind or event.payload.get("kind") == kind[0]):
                appended += 1
                if appended == int(nth):
                    signal("appended", event_type=event_type, seq=event.seq)
                    time.sleep(3600)  # the rest of the reaction is never written
            return event

        EventStore.append = freezing_append  # type: ignore[method-assign]

    ledger_path = os.environ.get("RESUME_LEDGER")
    if ledger_path:
        from fractalswarm import resume, runs
        from fractalswarm.market.ledger import ProjectLedger

        ledger = ProjectLedger(ledger_path, 100.0)
        record_run, resume_run = runs.record_run, resume.resume_run

        async def with_ledger_record(*args: Any, **kwargs: Any) -> Any:
            return await record_run(*args, **kwargs | {"project_ledger": ledger})

        async def with_ledger_resume(*args: Any, **kwargs: Any) -> Any:
            return await resume_run(*args, **kwargs | {"project_ledger": ledger})

        runs.record_run = with_ledger_record  # type: ignore[assignment]
        resume.resume_run = with_ledger_resume  # type: ignore[assignment]


if __name__ == "__main__":
    install_hooks()
    from fractalswarm.cli import app

    app(prog_name="fractalswarm")
