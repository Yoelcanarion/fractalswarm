"""Strict JSON schemas for structured output and function tools (docs/api-notes.md §4, §5).

The Meta Model API's strict mode needs: a plain object root, ``additionalProperties: false``
on every object, every property listed in ``required``, and no ``allOf``/``oneOf``. Pydantic
schemas are converted here: ``$ref`` is inlined, titles and defaults are dropped.
"""

from typing import Any

from pydantic import BaseModel

DROP = {"title", "default", "examples", "discriminator"}


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    raw = model.model_json_schema()
    defs = raw.pop("$defs", {})
    return _strict(raw, defs)


def _strict(node: Any, defs: dict[str, Any]) -> Any:
    if isinstance(node, list):
        return [_strict(item, defs) for item in node]
    if not isinstance(node, dict):
        return node
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        return _strict(defs[name], defs)
    if "allOf" in node and len(node["allOf"]) == 1:
        return _strict(node["allOf"][0], defs)
    out = {key: _strict(value, defs) for key, value in node.items() if key not in DROP}
    if out.get("type") == "object" or "properties" in out:
        out["type"] = "object"
        out["properties"] = out.get("properties", {})
        out["required"] = sorted(out["properties"])
        out["additionalProperties"] = False
    return out


def text_format(name: str, model: type[BaseModel]) -> dict[str, Any]:
    """A Responses ``text.format`` block."""
    return {"type": "json_schema", "name": name, "schema": strict_schema(model), "strict": True}


def function_tool(name: str, description: str, params: type[BaseModel]) -> dict[str, Any]:
    """A flat Responses function tool."""
    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": strict_schema(params),
        "strict": True,
    }


# Structured-output models by schema name: a contract's ``produces`` names one, and the
# agent asks for it as its final answer, and the ``schema:<name>`` check validates it.
OUTPUT_MODELS: dict[str, type[BaseModel]] = {}


def register_output(name: str, model: type[BaseModel]) -> None:
    if OUTPUT_MODELS.get(name, model) is not model:
        raise ValueError(f"output schema {name!r} is already registered")
    OUTPUT_MODELS[name] = model
