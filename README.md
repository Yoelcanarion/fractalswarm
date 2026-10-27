# FractalSwarm

> **Kill half the brains. It still finishes — without stalling or paying twice. Verify it yourself.**

FractalSwarm is a multi-agent LLM runtime in which orchestrators form a fractal tree (root → tracks → sessions). Any orchestrator can die mid-run, the root included: the survivors re-own its work by deterministic hashing, with no election and zero coordination tokens. Every run replays bit-for-bit from a hash-verified log. It is built on Meta Model API (Muse Spark / Muse Wonder) and LlamaFirewall.

Work in progress for the Meta Global AI Developer Hackathon (Indie track, "Push the Frontier").

## Development

Requires [uv](https://docs.astral.sh/uv/). The project pins Python 3.12, which uv downloads if needed.

```sh
uv sync
uv run pytest
uv run ruff check
uv run fractalswarm --help
```

Secrets (`MODEL_API_KEY`, `HF_TOKEN`) are read from `~/.fractalswarm/.env`, outside the repo. See `.env.example`.

## License

MIT
