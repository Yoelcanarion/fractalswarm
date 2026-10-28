"""Bus lanes and the topic registry (spec §5.4).

Every topic has a default lane. The critical lane is at-least-once (acked, retried with
backoff); the normal and low lanes are at-most-once. Topics may also name a pydantic model
for their payload, which ``bus.send`` validates before anything leaves the actor.
"""

from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel


class Lane(StrEnum):
    CRITICAL = "critical"
    NORMAL = "normal"
    LOW = "low"


@dataclass(frozen=True)
class Topic:
    name: str
    lane: Lane
    payload: type[BaseModel] | None = None
    reply: bool = False  # a request/reply topic


TOPICS: dict[str, Topic] = {}


def register_topic(
    name: str, lane: Lane, payload: type[BaseModel] | None = None, *, reply: bool = False
) -> Topic:
    topic = Topic(name, lane, payload, reply)
    if TOPICS.get(name, topic) != topic:
        raise ValueError(f"topic {name!r} is already registered differently")
    TOPICS[name] = topic
    return topic


def lane_of(topic: str) -> Lane:
    known = TOPICS.get(topic)
    return known.lane if known else Lane.NORMAL


def validate(topic: str, payload: dict) -> dict:
    known = TOPICS.get(topic)
    if known is None or known.payload is None:
        return payload
    return known.payload.model_validate(payload).model_dump(mode="json")


# Pub/sub topics (spec §5.4).
ARTIFACT_READY = register_topic("artifact.ready", Lane.CRITICAL)
FACT_VERIFIED = register_topic("fact.verified", Lane.CRITICAL)
REPLAN_NOTICE = register_topic("replan.notice", Lane.CRITICAL)
COLLISION_DETECTED = register_topic("collision.detected", Lane.CRITICAL)
BUDGET_EPOCH = register_topic("budget.epoch", Lane.NORMAL)
MEMBERSHIP_CHANGED = register_topic("membership.changed", Lane.NORMAL)

# Request/reply topics.
AUDIT_REQUEST = register_topic("audit.request", Lane.CRITICAL, reply=True)
ARBITRATION_REQUEST = register_topic("arbitration.request", Lane.CRITICAL, reply=True)
TOPUP_REQUEST = register_topic("topup.request", Lane.CRITICAL, reply=True)
SCOPE_APPROVAL = register_topic("scope.approval", Lane.CRITICAL, reply=True)

# Heartbeat gossip: liveness plus load summaries. A lost heartbeat is never resent.
HEARTBEAT = register_topic("member.heartbeat", Lane.LOW)
