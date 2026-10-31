"""The README's pictures: what is on the page exists, and GitHub will show it."""

import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")
ASSETS = ROOT / "docs" / "assets"
SVGS = sorted(ASSETS.glob("*.svg"))
FILMS = [path for path in SVGS if "@keyframes" in path.read_text(encoding="utf-8")]
USED = set(re.findall(r'(?:src|srcset)="docs/assets/([^"]+)"', README))


def test_every_picture_of_the_page_exists() -> None:
    assert USED
    assert sorted(name for name in USED if not (ASSETS / name).is_file()) == []


def test_every_picture_has_words() -> None:
    images = re.findall(r"<img\b[^>]*>", README)
    assert images
    assert [image for image in images if not re.search(r'\balt="[^"]+"', image)] == []


def test_no_picture_is_left_behind() -> None:
    kept = {"social-preview.png"}  # uploaded by hand in the repository's settings
    assert sorted(path.name for path in ASSETS.iterdir() if path.name not in USED | kept) == []


@pytest.mark.parametrize("path", SVGS, ids=lambda path: path.name)
def test_an_svg_holds_everything_it_needs(path: Path) -> None:
    svg = path.read_text(encoding="utf-8")
    ET.fromstring(svg)
    assert len(svg.encode("utf-8")) < 100_000
    marks = re.sub(r"base64,[A-Za-z0-9+/=]+", "", svg)
    assert not re.search(r"<script|<foreignObject|<image|<use|\bhref=|\bon\w+=", marks)
    # the namespace is the one address a picture may name; everything else would be blocked
    assert not re.search(r"https?://", marks.replace("http://www.w3.org/2000/svg", ""))


def test_there_are_films_to_check() -> None:
    assert {path.name for path in FILMS} >= {"hero.svg", "takeover.svg", "terminal.svg"}


@pytest.mark.parametrize(
    "path",
    [path for path in FILMS if not path.stem.endswith("-still")],
    ids=lambda path: path.name,
)
def test_a_reader_who_asked_for_no_motion_gets_none(path: Path) -> None:
    """Chromium does not tell the SVG inside an <img>, so the page itself picks the still first."""
    still = f"{path.stem}-still.svg"
    assert "prefers-reduced-motion:reduce" in path.read_text(encoding="utf-8")
    text = (ASSETS / still).read_text(encoding="utf-8")
    assert "prefers-reduced-motion" not in text
    assert "*{animation:none!important}" in text
    assert still in USED
    assert README.index(f'srcset="docs/assets/{still}"') < README.index(
        f'="docs/assets/{path.name}"'
    )


@pytest.mark.parametrize("name", ["arena-same-second", "arena-same-second-phone"])
def test_the_film_loads_on_a_slow_line_and_has_a_still(name: str) -> None:
    assert (ASSETS / f"{name}.webp").stat().st_size < 3_000_000
    assert README.index(f'srcset="docs/assets/{name}.png"') < README.index(
        f'="docs/assets/{name}.webp"'
    )
