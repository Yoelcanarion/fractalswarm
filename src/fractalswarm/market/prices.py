"""The price table (``config/prices.yaml``, spec §7.1) and cost arithmetic.

Billing rules (docs/api-notes.md): cached tokens are a subset of the input tokens and bill at
the cached-input rate; reasoning tokens are a subset of the output tokens and bill at the
output rate; web search bills per query on top of the tokens.
"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

from fractalswarm.config import CONFIG_DIR
from fractalswarm.kernel.ids import canonical_json

# A conservative input estimate: real text averages about 4 characters per token.
CHARS_PER_TOKEN_UPPER_BOUND = 2


class Usage(BaseModel):
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    searches: int = 0


class ModelPrice(BaseModel):
    input: float
    cached_input: float
    output: float


class PriceTable(BaseModel):
    unit_tokens: int
    models: dict[str, ModelPrice]
    web_search_usd_per_1k: float

    @classmethod
    def from_yaml(cls, data: dict[str, Any]) -> "PriceTable":
        return cls(
            unit_tokens=data["unit_tokens"],
            models=data["models"],
            web_search_usd_per_1k=data["tools"]["web_search"]["usd_per_1k_queries"],
        )

    @classmethod
    def load(cls, path: Path = CONFIG_DIR / "prices.yaml") -> "PriceTable":
        return cls.from_yaml(yaml.safe_load(path.read_text(encoding="utf-8")))

    def price(self, model: str) -> ModelPrice:
        try:
            return self.models[model]
        except KeyError:
            raise ValueError(f"no price for model {model!r}") from None

    def cost(self, model: str, usage: Usage) -> float:
        price = self.price(model)
        uncached = max(usage.input_tokens - usage.cached_tokens, 0)
        tokens = (
            uncached * price.input
            + usage.cached_tokens * price.cached_input
            + usage.output_tokens * price.output
        )
        return tokens / self.unit_tokens + usage.searches * self.web_search_usd_per_1k / 1000

    def worst_case(
        self, model: str, body: dict[str, Any], max_output_tokens: int, searches: int = 0
    ) -> float:
        """An upper bound for a call: generous input estimate, full output, every search."""
        input_tokens = len(canonical_json(body)) // CHARS_PER_TOKEN_UPPER_BOUND + 1
        usage = Usage(input_tokens=input_tokens, output_tokens=max_output_tokens, searches=searches)
        return self.cost(model, usage)
