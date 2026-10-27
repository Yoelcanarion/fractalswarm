"""Virtual clocks and Lamport helpers.

Virtual time is an integer number of milliseconds since the run started. Three modes:

- ``live``: follows the wall clock, optionally sped up; timers and effects really wait.
- ``sim``: a discrete-event clock that jumps to the next completion, so fake-LLM runs take
  no wall time and still produce meaningful stall times.
- ``replay``: takes every timestamp from the recorded log.

Only effect completions read the clock. Events that handlers produce take the virtual time
of the event being handled, so the clock never leaks into a handler.
"""

import time
from typing import Literal, Protocol

ClockMode = Literal["live", "sim", "replay"]


class Clock(Protocol):
    mode: ClockMode

    def now(self) -> int: ...


class LiveClock:
    mode: ClockMode = "live"

    def __init__(self, speed: float = 1.0) -> None:
        if speed <= 0:
            raise ValueError("speed must be positive")
        self.speed = speed
        self.started = time.monotonic()  # determinism: allow (live clock)

    def now(self) -> int:
        elapsed = time.monotonic() - self.started  # determinism: allow (live clock)
        return int(elapsed * 1000 * self.speed)

    def wall_seconds(self, virtual_ms: int) -> float:
        """How long to really wait for ``virtual_ms`` of virtual time."""
        return virtual_ms / 1000 / self.speed


class ManualClock:
    """The sim and replay clock: time moves only when the runtime advances it."""

    def __init__(self, mode: ClockMode = "sim", start: int = 0) -> None:
        self.mode = mode
        self.current = start

    def now(self) -> int:
        return self.current

    def advance_to(self, virtual_ms: int) -> None:
        self.current = max(self.current, virtual_ms)


def lamport_tick(local: int) -> int:
    """A local event, or a send."""
    return local + 1


def lamport_receive(local: int, remote: int) -> int:
    return max(local, remote) + 1
