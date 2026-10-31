"""A run that is starting has made its file and not its table yet: it reads as an empty log."""

from pathlib import Path

from fractalswarm.api.catalog import Catalog
from fractalswarm.api.lens import read_caused_by, read_typed


def test_a_file_with_no_table_is_an_empty_log(tmp_path: Path) -> None:
    run = tmp_path / "runs" / "starting"
    run.mkdir(parents=True)
    (run / "events.sqlite").touch()  # EventStore connects first and writes its schema after
    catalog = Catalog(tmp_path / "runs")
    entry = catalog.get("starting")
    assert catalog.read(entry) == []
    assert catalog.page(entry, 1, 10) == ([], 0)
    assert catalog.last(entry) is None
    assert not catalog.halted(entry)
    assert catalog.listing(entry)["status"] == "empty"
    assert catalog.summary(entry)["events"] == 0
    assert read_typed(catalog, entry, ("run.started",)) == []
    assert read_caused_by(catalog, entry, 1) == []
