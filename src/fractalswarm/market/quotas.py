"""Rate-limit quotas by AIMD (spec §6.1): additive increase, multiplicative decrease.

The provider's rate limit is per team and per model, so the run holds one share of it per
model: ``fraction`` of the RPM and TPM limits. The root market adapts the share once per
epoch from what the log shows:

- a rate-limited call since the last epoch (a 429, or retries) multiplies it by 0.7;
- a clean epoch adds 5 points of the limit;
- it never goes above 80% of the limit, and never below 5%, so the run keeps moving.

The share is then sliced among the children like any resource (``market/auction.py``): the
slices are ``rpm:<model>`` and ``tpm:<model>``. Everything is pure: the same pressure gives
the same quota.
"""

from pydantic import BaseModel, ConfigDict, Field

DECREASE = 0.7
INCREASE = 0.05
CEILING = 0.8
FLOOR = 0.05
START = 0.5


class Quota(BaseModel):
    model_config = ConfigDict(frozen=True)

    model: str
    limit_rpm: int = Field(ge=0)
    limit_tpm: int = Field(ge=0)
    fraction: float = START

    @property
    def rpm(self) -> int:
        return int(self.limit_rpm * self.fraction)

    @property
    def tpm(self) -> int:
        return int(self.limit_tpm * self.fraction)


def adapt(quota: Quota, pressure: int) -> tuple[Quota, str]:
    """The quota for the next epoch and what changed: decrease, increase or hold.

    ``pressure`` counts the rate-limited calls seen since the last epoch.
    """
    if pressure > 0:
        fraction = max(quota.fraction * DECREASE, FLOOR)
        change = "decrease"
    elif quota.fraction < CEILING:
        fraction = min(quota.fraction + INCREASE, CEILING)
        change = "increase"
    else:
        return quota, "hold"
    return quota.model_copy(update={"fraction": round(fraction, 6)}), change


def rate_limited(result: dict) -> bool:
    """Did an LLM call meet the rate limit? A final 429, or a call that needed retries."""
    return result.get("http_status") == 429 or int(result.get("attempts") or 1) > 1
