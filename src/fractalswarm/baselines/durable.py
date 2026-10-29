"""The durable rivals' view of their own calls (arena spec §A, backend-design §1).

``durable-max`` and ``durable`` are the central baseline with workers that outlive their
coordinator: a crash stops nobody, and what the workers and the board send while it is down
is in the log, where the restarted coordinator adopts it (``orchestrator._recover``). What
the handler cannot see is its own calls: ``View`` lists no effects in flight. ``OwnEffectsView``
is the reducer that does, for the three kinds of call a coordinator makes itself:

- ``plan|<goal>|<attempt>``: planning, decomposing and writing contracts (LLM);
- ``judge|<goal>|<contract>|<attempt>``: the judge's verdict on a result (LLM);
- ``scan|<goal>|<source>``: the firewall scan of an attachment.

It answers two questions about a call, named by the actor that made it and its tag:
``in_flight`` (started, neither completed nor cancelled) and ``completion`` (the stored
``effect.completed`` event, which ``_planned`` and ``_scanned`` take unchanged). Both are
facts of the log, so a replay rebuilds the same answers.
"""

from typing import Any

from fractalswarm.kernel.events import ENV, Event, Payload, register

DURABLE_MODES = ("durable-max", "durable")
OWN_TAG_PREFIXES = ("plan|", "judge|", "scan|")


@register("supervisor.adopted")
class SupervisorAdopted(Payload):
    """What a restarted durable supervisor took from the log instead of paying for it again.

    Emitted at each restart, right after ``baseline.restarted``. Work keys are ``goal/contract``;
    own calls are named by their tag. ``waiting`` is what the restart leaves running: the
    workers' contracts whose agent is alive, and (``durable-max``) its own calls still in flight.
    """

    coordinator: str
    crash: int
    results: list[str] = []  # contracts whose agent result reached the log during the outage
    verdicts: list[str] = []  # contracts whose judge verdict reached the log
    plans: list[str] = []  # goals whose planning (or scan) completion reached the log
    bookings: list[str] = []  # contracts whose booking outcome reached the log
    waiting: list[str] = []


class OwnEffectsView:
    name = "own"

    def __init__(self) -> None:
        self._open: dict[str, tuple[str, str]] = {}  # effect id -> (actor, tag), in start order
        self._done: dict[tuple[str, str], Event] = {}  # (actor, tag) -> its effect.completed

    # -- queries --------------------------------------------------------------------------

    def in_flight(self, actor: str, tag: str) -> bool:
        return any(found == (actor, tag) for found in self._open.values())

    def completion(self, actor: str, tag: str) -> Event | None:
        return self._done.get((actor, tag))

    def tags_in_flight(self, actor: str) -> list[str]:
        """The actor's own calls in flight, in the order they started."""
        return [tag for who, tag in self._open.values() if who == actor]

    # -- the reducer ----------------------------------------------------------------------

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        if event.type == "effect.started":
            tag = event.payload.get("tag") or ""
            if tag.startswith(OWN_TAG_PREFIXES):
                self._open[event.payload["effect_id"]] = (event.actor, tag)
                self._done.pop((event.actor, tag), None)  # a call started again supersedes
        elif event.type == "effect.completed":
            tag = event.payload.get("tag") or ""
            found = self._open.pop(event.payload["effect_id"], None)
            if found is None and tag.startswith(OWN_TAG_PREFIXES) and event.actor != ENV:
                found = (event.actor, tag)  # refused by a budget: completed without starting
            if found is not None:
                self._done[found] = event
        elif event.type == "effect.cancelled":
            self._open.pop(event.payload["effect_id"], None)
