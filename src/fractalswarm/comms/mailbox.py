"""The blackboard mailbox (spec §8): where an open channel breaker sends what may not pass.

The sender puts a message's envelope in the receiver's box (``mailbox.put``, a raw send to
the blackboard actor). The blackboard tells the receiver that mail is waiting
(``mailbox.notify``, at most once per ``renotify_ms``), and the receiver pulls it in batches
(``mailbox.poll`` -> ``mailbox.items``), backing off while the box is empty: the receiver
sets the pace, which is the point of the breaker. Only the normal and low lanes land here, so
the box is at-most-once: when it is full the oldest message is dropped and counted in the next
``mailbox.delivered``.
"""

from collections import deque
from dataclasses import dataclass, field
from typing import Any

from fractalswarm.kernel.events import Payload, register

MAILBOX_ACTOR = "board"  # the blackboard actor (actors/board.py BOARD)
MAIL_PUT = "mailbox.put"
MAIL_POLL = "mailbox.poll"
MAIL_ITEMS = "mailbox.items"
MAIL_NOTIFY = "mailbox.notify"


@register("mailbox.delivered")
class MailboxDelivered(Payload):
    owner: str
    count: int
    remaining: int
    dropped: int = 0  # messages lost to a full box since the last delivery


@dataclass
class Mailbox:
    """The boxes, one FIFO per receiver. Pure: the blackboard actor keeps it in its state."""

    capacity: int = 1024
    renotify_ms: int = 1000
    boxes: dict[str, deque[dict[str, Any]]] = field(default_factory=dict)
    notified: dict[str, int] = field(default_factory=dict)  # owner -> when it was last told
    lost: dict[str, int] = field(default_factory=dict)  # owner -> dropped since last delivery

    def put(self, owner: str, envelope: dict[str, Any], now: int) -> bool:
        """Store a message; returns whether the owner should be told that mail is waiting."""
        box = self.boxes.setdefault(owner, deque())
        was_empty = not box
        box.append(envelope)
        if len(box) > self.capacity:
            box.popleft()
            self.lost[owner] = self.lost.get(owner, 0) + 1
        last = self.notified.get(owner)
        if was_empty or last is None or now - last >= self.renotify_ms:
            self.notified[owner] = now
            return True
        return False

    def take(self, owner: str, limit: int) -> tuple[list[dict[str, Any]], int, int]:
        """The oldest ``limit`` messages, how many remain, and how many were dropped since."""
        box = self.boxes.get(owner)
        items = [box.popleft() for _ in range(min(limit, len(box)))] if box else []
        remaining = len(box) if box else 0
        dropped = self.lost.pop(owner, 0) if items else 0
        return items, remaining, dropped

    def depth(self, owner: str) -> int:
        return len(self.boxes.get(owner, ()))
