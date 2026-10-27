"""Re-record the golden toy run in tests/golden/toy (fake LLM, sim clock, $0).

Only needed when the kernel's event format changes on purpose. test_replay_verify checks
that the committed bundle still replays and that a fresh run reproduces its head hash.
"""

import asyncio
import shutil
import tempfile
from pathlib import Path

from fractalswarm.llm.fake import FakeBackend
from fractalswarm.runs import record_run

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = ROOT / "tests" / "golden" / "toy"
RUN_ID, SEED = "golden-toy", "42"


async def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        result = await record_run(
            "toy", run_id=RUN_ID, run_dir=Path(tmp) / RUN_ID, backend=FakeBackend(), seed=SEED
        )
        GOLDEN.mkdir(parents=True, exist_ok=True)
        for name in ("events.jsonl", "cassette.jsonl"):
            shutil.copyfile(result.paths.root / name, GOLDEN / name)
        (GOLDEN / "HEAD").write_text(result.head_hash + "\n", encoding="utf-8")
    print(f"{GOLDEN}: {result.events} events, head {result.head_hash}")


if __name__ == "__main__":
    asyncio.run(main())
