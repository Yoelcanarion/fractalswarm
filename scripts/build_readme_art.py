"""Write the pictures of the README into ``docs/assets``.

They hold no fact of their own. Who dies, who inherits, the hashes, the talks booked and the
verdicts are read from the log of ``demo/final`` and from ``web/src/home/data/story.json``, a figure
that only a claim states must still stand in ``docs/claims.md``, and what the terminal shows is
what the commands print when this script runs them. The timing is the film's: every event comes in
the order of the run, at a pace a reader can follow.

    uv run --with brotli python scripts/build_readme_art.py

CSS keyframes only: no script, because GitHub shows an SVG inside an <img>. The fonts are the app's,
cut down to the letters a picture uses and held inside it. Whatever is out of a keyframe stands at
the end of the film, so with no motion a picture is that end. Each film also comes as a ``-still``
file: Chromium does not tell the SVG inside an <img> that the reader asked for no motion, so the
<picture> in the README has to choose. ``social-preview.png`` is ``hero-still.svg``, on ``BG``.

The arena's film is scene s6-fair-fight of ``scripts/record_scenes.mjs``, cut with ffmpeg to the two
boards, at twice its speed: 25 s of the take, then the last frame for 2.5 s, at 15 fps, as WebP at
quality 86. Laptop: ``crop=1920:694:0:0``, 1440 wide. Phone: the two boards stacked
(``crop=962:694:0:0`` over ``crop=962:694:958:0``), 720 wide. The stills are the last frames.
"""

import base64
import html
import io
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT_DIR = Path(__file__).resolve().parent.parent
DEMO = ROOT_DIR / "demo" / "final"
LOG = DEMO / "events.jsonl"
STORY = ROOT_DIR / "web" / "src" / "home" / "data" / "story.json"
CLAIMS = ROOT_DIR / "docs" / "claims.md"
REPORT = ROOT_DIR / "bench" / "REPORT.md"
HERO_TEXT = ROOT_DIR / "web" / "src" / "lib" / "heroText.ts"
OUT = ROOT_DIR / "docs" / "assets"
FONTS = ROOT_DIR / "web" / "node_modules" / "@fontsource-variable"

INTER = FONTS / "inter" / "files" / "inter-latin-opsz-normal.woff2"
MONO = FONTS / "jetbrains-mono" / "files" / "jetbrains-mono-latin-wght-normal.woff2"

BG = "#070a12"
GLOW = "#16294d"
PANEL = "#0d1524"
LINE = "#223150"
TEXT = "#f5f7fb"
MUTED = "#9db0c9"
NOTE = "#c6d2e4"
FAINT = "#1b2740"
EDGE = "#35558c"
BLUE = "#6aa7ff"
DISC = "#0c1526"
RED = "#ff5a4f"
RED_DARK = "#2a1216"
GOLD = "#ffc964"
MINT = "#5fd7a1"
WHITE_HOT = "#fff3e6"

HERO_LOOP = 20.0
FILM_KILLS = (2.0, 5.0, 6.2, 9.5, 12.5)
FILM_LAST_TAKEOVER = 13.6
FILM_END = 16.0
RESET = 0.5

COMMON_CSS = (
    f"text{{font-family:D,Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;fill:{TEXT}}}"
    ".m{font-family:M,'JetBrains Mono',Consolas,'Liberation Mono',monospace}"
)
STILL = "*{animation:none!important}"
NO_MOTION = f"@media (prefers-reduced-motion:reduce){{{STILL}}}"


def esc(text: object) -> str:
    return html.escape(str(text), quote=True)


def num(value: float) -> str:
    return f"{value:.1f}".removesuffix(".0")


def polar(center: tuple[float, float], radius: float, degrees: float) -> tuple[float, float]:
    angle = math.radians(degrees)
    return center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle)


class Film:
    """Keyframes on one clock."""

    def __init__(self, loop: float) -> None:
        self.loop = loop
        self.rules: list[str] = []

    def pct(self, at: float) -> str:
        return f"{100 * min(max(at, 0.0), self.loop) / self.loop:.2f}%"

    def animate(self, selector: str, stops: list[tuple[float, str]]) -> None:
        ordered = sorted(stops, key=lambda stop: stop[0])
        if ordered[0][0] > 0:
            ordered.insert(0, (0.0, ordered[0][1]))
        if ordered[-1][0] < self.loop:
            ordered.append((self.loop, ordered[-1][1]))
        name = f"a{len(self.rules)}"
        body = "".join(f"{self.pct(at)}{{{css}}}" for at, css in ordered)
        self.rules.append(
            f"@keyframes {name}{{{body}}}"
            f"{selector}{{animation:{name} {self.loop}s linear infinite}}"
        )

    def shown(
        self, selector: str, start: float, end: float | None = None, fade: float = 0.12
    ) -> None:
        """Seen from ``start`` to ``end``, with no start at the head of the film."""
        stops = [(0.0, "opacity:1")]
        if start > 0:
            stops = [(0.0, "opacity:0"), (start, "opacity:0"), (start + fade, "opacity:1")]
        if end is not None:
            stops += [(end, "opacity:1"), (end + fade, "opacity:0")]
        self.animate(selector, stops)

    def veil(self, selector: str, hold: float = 0.7) -> None:
        """A cover over the tail of the film and its head, where everything goes back."""
        self.animate(
            selector,
            [
                (0.0, "opacity:1"),
                (hold, "opacity:0"),
                (self.loop - RESET, "opacity:0"),
                (self.loop, "opacity:1"),
            ],
        )

    def css(self) -> str:
        return "".join(self.rules)


class Ink:
    """The marks of a picture, and the letters they need."""

    def __init__(self) -> None:
        self.parts: list[str] = []
        self.strings: list[str] = []

    def raw(self, markup: str) -> None:
        self.parts.append(markup)

    def text(
        self,
        value: object,
        x: float,
        y: float,
        size: float,
        weight: int = 500,
        fill: str = TEXT,
        anchor: str = "start",
        mono: bool = False,
        cls: str = "",
        extra: str = "",
    ) -> None:
        names = " ".join(name for name in ("m" if mono else "", cls) if name)
        marks = f'class="{names}" ' if names else ""
        self.raw(
            f'<text {marks}x="{num(x)}" y="{num(y)}" font-size="{num(size)}" '
            f'font-weight="{weight}" text-anchor="{anchor}" style="fill:{fill}" {extra}>'
            f"{esc(value)}</text>"
        )
        self.strings.append(str(value))

    def markup(self) -> str:
        return "".join(self.parts)


def font_face(family: str, path: Path, text: str, axes: dict, weights: str) -> str:
    """The font as a data URL, with only the letters of ``text`` and the axes a picture uses."""
    font = TTFont(path)
    options = subset.Options()
    options.layout_features = ["kern"]
    options.hinting = False
    options.notdef_outline = False
    options.name_IDs = []
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    font = instancer.instantiateVariableFont(font, axes)
    font.flavor = "woff2"
    buffer = io.BytesIO()
    font.save(buffer)
    data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return (
        f"@font-face{{font-family:{family};font-weight:{weights};"
        f"src:url(data:font/woff2;base64,{data}) format('woff2')}}"
    )


def fonts_for(strings: Iterable[str]) -> str:
    letters = "".join(strings)
    display = font_face("D", INTER, letters, {"opsz": 32, "wght": (400, 800)}, "400 800")
    return display + font_face("M", MONO, letters, {"wght": (400, 700)}, "400 700")


def picture(
    width: int, height: int, ink: Ink, alt: str, css: str = "", film: Film | None = None
) -> str:
    moving = film.css() + NO_MOTION if film else ""
    style = fonts_for(ink.strings) + COMMON_CSS + css + moving
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" '
        f'height="{height}" role="img" aria-label="{esc(alt)}"><style>{style}</style>'
        f"{ink.markup()}</svg>\n"
    )


@dataclass(frozen=True)
class Run:
    """The recorded run, and what the site says of it."""

    story: dict
    events: list[dict]

    @property
    def tree(self) -> dict:
        return self.story["tree"]

    def bookings(self) -> list[dict]:
        """Each block of talks at the moment it was booked, with the running total."""
        rows, total = [], 0
        for event in self.events:
            if event["type"] == "lease.booked":
                payload = event["payload"]
                cells = sum(key.startswith("cell:") for key in payload["keys"])
                total += cells
                rows.append(
                    {
                        "ms": event["ts_virtual"],
                        "goal": payload["goal_id"],
                        "holder": payload["holder"],
                        "cells": cells,
                        "total": total,
                    }
                )
        return rows

    def event(self, seq: int) -> dict:
        return next(event for event in self.events if event["seq"] == seq)


def load_run() -> Run:
    story = json.loads(STORY.read_text(encoding="utf-8"))
    events = [json.loads(line) for line in LOG.read_text(encoding="utf-8").splitlines()]
    return Run(story, events)


def stated(words: str, source: Path = CLAIMS) -> str:
    """A sentence a picture relies on, which must still stand where it came from."""
    if words not in source.read_text(encoding="utf-8"):
        raise SystemExit(f"{source.name} no longer says: {words}")
    return words


def hero_clock(run: Run) -> Callable[[float], float]:
    """From a moment of the run to a moment of the film."""
    kills = [kill["atMs"] for kill in run.tree["kills"]]
    last = max(round_["atMs"] for round_ in run.tree["rounds"])
    anchors = [
        (0.0, 0.0),
        *zip(kills, FILM_KILLS, strict=True),
        (last, FILM_LAST_TAKEOVER),
        (run.tree["durationMs"], FILM_END),
    ]

    def film(ms: float) -> float:
        for (a, fa), (b, fb) in zip(anchors, anchors[1:], strict=False):
            if ms <= b:
                return fa + (fb - fa) * (ms - a) / (b - a)
        return FILM_END

    return film


@dataclass(frozen=True)
class HeroLayout:
    """Where things stand in one shape of the hero."""

    width: int
    height: int
    center: tuple[float, float]
    radii: tuple[float, float, float]
    scale: float  # of the tree's nodes and labels
    eyebrow: tuple[float, float, float]  # x, baseline, size
    title: tuple[float, float, float]  # x, baseline, size
    tagline: tuple[float, float, float, float]  # x, first baseline, size, line height
    about: tuple[float, float, float, float] | None
    hud: tuple[float, float, float]  # x, top, width of a readout
    hud_sizes: tuple[float, float, float]  # label, value, value's baseline under the top
    bar: tuple[float, float, float]  # x, y, width
    ticker: tuple[float, float, float, float]  # x, top of the window, size, line height
    closing: float  # its size
    anchor: str = "start"


HERO_WIDE = HeroLayout(
    width=1280,
    height=640,
    center=(936, 320),
    radii=(116, 200, 278),
    scale=1.0,
    eyebrow=(63, 50, 15),
    title=(60, 128, 80),
    tagline=(62, 194, 42, 52),
    about=(62, 288, 19, 27),
    hud=(62, 350, 170),
    hud_sizes=(13.5, 42, 58),
    bar=(62, 464, 510),
    ticker=(62, 490, 16.5, 25),
    closing=19.8,
)

HERO_PHONE = HeroLayout(
    width=720,
    height=1100,
    center=(360, 586),
    radii=(104, 180, 250),
    scale=0.92,
    eyebrow=(360, 58, 19),
    title=(360, 146, 94),
    tagline=(360, 216, 50, 60),
    about=None,
    hud=(36, 856, 222),
    hud_sizes=(18, 54, 72),
    bar=(36, 966, 648),
    ticker=(36, 986, 21, 30),
    closing=23,
    anchor="middle",
)

GHOST = 0.13
NODE_RADIUS = {0: 31.0, 1: 26.0, 2: 21.0}
NODE_TEXT = {0: 17.0, 1: 16.0, 2: 14.5}


def stagger(name: str) -> int:
    """A small number that differs from name to name, to keep the agents out of step."""
    return sum((index + 3) * ord(letter) for index, letter in enumerate(name))


def hero(run: Run, layout: HeroLayout) -> str:
    film_of = hero_clock(run)
    film = Film(HERO_LOOP)
    tree = run.tree
    cx, cy = layout.center
    scale = layout.scale
    w, h = layout.width, layout.height

    nodes = {node["id"]: node for node in tree["nodes"]}
    children: dict[str, list[str]] = {}
    for node in tree["nodes"]:
        if node["parent"]:
            children.setdefault(node["parent"], []).append(node["id"])

    # root, three tracks, six sessions and twelve agents, each level at twice the turns of the last
    where: dict[str, tuple[float, float]] = {"o0": layout.center}
    turn: dict[str, float] = {"o0": -90.0}
    for t, track in enumerate(children["o0"]):
        turn[track] = -90 + t * 120
        where[track] = polar(layout.center, layout.radii[0], turn[track])
        for s, session in enumerate(children[track]):
            turn[session] = turn[track] + (s - 0.5) * 60
            where[session] = polar(layout.center, layout.radii[1], turn[session])
            for a, agent in enumerate(children[session]):
                turn[agent] = turn[session] + (a - 0.5) * 30
                where[agent] = polar(layout.center, layout.radii[2], turn[agent])

    level_radius = {0: 0.0, 1: layout.radii[0], 2: layout.radii[1], 3: layout.radii[2]}

    def branch(parent: str, child: str) -> str:
        r0, r1 = level_radius[nodes[parent]["level"]], level_radius[nodes[child]["level"]]
        start = turn[child] if parent == "o0" else turn[parent]
        x0, y0 = where[parent]
        x1, y1 = polar(layout.center, r0 + (r1 - r0) * 0.72, start)
        x2, y2 = where[child]
        return f"M{num(x0)} {num(y0)}Q{num(x1)} {num(y1)} {num(x2)} {num(y2)}"

    def chord(a: str, b: str) -> str:
        x0, y0 = where[a]
        x1, y1 = where[b]
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        qx, qy = mx + (cx - mx) * 0.42, my + (cy - my) * 0.42
        return f"M{num(x0)} {num(y0)}Q{num(qx)} {num(qy)} {num(x1)} {num(y1)}"

    kills = tree["kills"]
    killed_at = {kill["target"]: film_of(kill["atMs"]) for kill in kills}
    end = film_of(tree["durationMs"])

    # the tree, and the lines each takeover wires in
    links: dict[tuple[str, str], tuple[str, float | None]] = {}
    for node in tree["nodes"]:
        if node["parent"]:
            links[(node["parent"], node["id"])] = (branch(node["parent"], node["id"]), None)
    for adoption in tree["adoptions"]:
        born = film_of(adoption["atMs"])
        for child in adoption["children"]:
            links[(adoption["adopter"], child)] = (chord(adoption["adopter"], child), born)

    edges = Ink()
    for index, ((a, b), (d, born)) in enumerate(links.items()):
        dies = min((killed_at[n] for n in (a, b) if n in killed_at), default=None)
        name = f"e{index}"
        faded = f' opacity="{GHOST}"' if dies is not None else ""
        kind = "edge" if born is None else "wire"
        edges.raw(
            f'<g class="{name}"{faded}><path class="{kind}" d="{d}"/>'
            f'<path class="beat" style="animation-delay:{-(index * 0.37) % 2.4:.2f}s" d="{d}"/>'
            "</g>"
        )
        stops = [(0.0, "opacity:1")]
        if born is not None:
            stops = [(0.0, "opacity:0"), (born, "opacity:0"), (born + 0.3, "opacity:1")]
        if dies is not None:
            stops += [(dies, "opacity:1"), (dies + 0.25, f"opacity:{GHOST}")]
        if len(stops) > 1:
            film.animate(f".{name}", stops)

    marks = Ink()
    for node in tree["nodes"]:
        if node["kind"] == "agent":
            x, y = where[node["id"]]
            marks.raw(
                f'<circle class="agent" cx="{num(x)}" cy="{num(y)}" r="{num(8 * scale)}" '
                f'style="animation-delay:{-(stagger(node["id"]) % 31) / 10:.1f}s"/>'
            )

    for node in tree["nodes"]:
        if node["kind"] != "brain":
            continue
        name = node["id"]
        safe = name.replace(".", "_")
        x, y = where[name]
        radius = NODE_RADIUS[node["level"]] * scale
        size = NODE_TEXT[node["level"]] * scale
        died = killed_at.get(name)
        parts = [
            f'<circle class="h{safe}" r="{num(radius * 2.3)}" fill="url(#halo)" '
            f'opacity="{0 if died is not None else 1}"/>',
            f'<circle class="disc" r="{num(radius)}"/>',
        ]
        if died is None:
            parts.append(f'<circle class="done d{safe}" r="{num(radius)}"/>')
            film.shown(f".d{safe}", end + 0.1, fade=0.5)
        marks.strings.append(name)
        parts.append(
            f'<text class="m id" y="{num(size * 0.36)}" font-size="{num(size)}">{name}</text>'
        )
        if died is not None:
            arm = radius * 0.42
            parts.append(
                f'<g class="g{safe}"><circle class="ash" r="{num(radius)}"/>'
                f'<path class="x" d="M{num(-arm)} {num(-arm)}L{num(arm)} {num(arm)}'
                f'M{num(arm)} {num(-arm)}L{num(-arm)} {num(arm)}"/></g>'
                f'<circle class="flash f{safe}" r="{num(radius)}" opacity="0"/>'
                f'<circle class="wave w{safe}" r="{num(radius)}" opacity="0"/>'
            )
            film.animate(
                f".h{safe}", [(0.0, "opacity:1"), (died, "opacity:1"), (died + 0.2, "opacity:0")]
            )
            film.shown(f".g{safe}", died + 0.12, fade=0.1)
            film.animate(
                f".f{safe}",
                [
                    (0.0, "opacity:0"),
                    (died, "opacity:0"),
                    (died + 0.04, "opacity:1"),
                    (died + 0.5, "opacity:0"),
                ],
            )
            film.animate(
                f".w{safe}",
                [
                    (0.0, "opacity:0;transform:scale(1)"),
                    (died, "opacity:0;transform:scale(1)"),
                    (died + 0.04, "opacity:.9;transform:scale(1)"),
                    (died + 1.0, "opacity:0;transform:scale(5)"),
                ],
            )
        marks.raw(f'<g transform="translate({num(x)} {num(y)})">{"".join(parts)}</g>')

    # each takeover: a comet from the dead to its heir, and a ring where it lands
    for index, adoption in enumerate(tree["adoptions"]):
        at = film_of(adoption["atMs"])
        marks.raw(
            f'<path class="comet c{index}" pathLength="100" '
            f'd="{chord(adoption["dead"], adoption["adopter"])}"/>'
        )
        film.animate(
            f".c{index}",
            [
                (0.0, "stroke-dashoffset:30;opacity:0"),
                (at - 0.55, "stroke-dashoffset:30;opacity:0"),
                (at - 0.5, "stroke-dashoffset:30;opacity:1"),
                (at, "stroke-dashoffset:-100;opacity:1"),
                (at + 0.05, "stroke-dashoffset:-100;opacity:0"),
            ],
        )
        x, y = where[adoption["adopter"]]
        ring = NODE_RADIUS[nodes[adoption["adopter"]]["level"]] * scale
        marks.raw(
            f'<circle class="ring r{index}" cx="{num(x)}" cy="{num(y)}" r="{num(ring)}" '
            'opacity="0"/>'
        )
        film.animate(
            f".r{index}",
            [
                (0.0, "opacity:0;transform:scale(1)"),
                (at, "opacity:0;transform:scale(1)"),
                (at + 0.04, "opacity:1;transform:scale(1)"),
                (at + 0.8, "opacity:0;transform:scale(2.4)"),
            ],
        )

    # the role of root stands on whoever holds it, and it is empty from a crash to the takeover
    holders = [("o0", 0.0)]
    holders += [
        (round_["owner"], film_of(round_["atMs"])) for round_ in tree["rounds"] if round_["root"]
    ]
    root_kills = [film_of(kill["atMs"]) for kill in kills if kill["heldRoot"]]
    marks.strings.append("root")
    for index, (owner, start) in enumerate(holders):
        x, y = where[owner]
        last = index == len(holders) - 1
        lift = (NODE_RADIUS[nodes[owner]["level"]] + 15) * scale
        marks.raw(
            f'<g class="pill p{index}" opacity="{1 if last else 0}" '
            f'transform="translate({num(x)} {num(y - lift)})">'
            '<rect x="-23" y="-11" width="46" height="22" rx="11"/>'
            '<text y="5" font-size="13.5">root</text></g>'
        )
        film.shown(f".p{index}", start, None if last else root_kills[index], fade=0.1)

    marks.raw(
        f'<circle class="sweep" cx="{num(cx)}" cy="{num(cy)}" r="{num(layout.radii[2] + 40)}" '
        'opacity="0"/>'
    )
    film.animate(
        ".sweep",
        [
            (0.0, "opacity:0;transform:scale(.05)"),
            (end, "opacity:0;transform:scale(.05)"),
            (end + 0.1, "opacity:.9;transform:scale(.1)"),
            (end + 1.2, "opacity:0;transform:scale(1)"),
        ],
    )

    words = Ink()
    hero_words(run, layout, film, words, film_of, holders, root_kills, end)
    film.veil(".veil")

    orbits = "".join(
        f'<circle class="orbit" cx="{num(cx)}" cy="{num(cy)}" r="{num(r)}"/>' for r in layout.radii
    )
    reach = max(w, h)
    ink = Ink()
    ink.strings += words.strings + marks.strings
    ink.raw(
        "<defs>"
        f'<radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="{num(cx)}" cy="{num(cy)}" '
        f'r="{reach * 0.72:.0f}"><stop offset="0" stop-color="{GLOW}"/>'
        f'<stop offset=".6" stop-color="#0a0f1b"/><stop offset="1" stop-color="{BG}"/>'
        "</radialGradient>"
        f'<radialGradient id="halo"><stop offset=".3" stop-color="{BLUE}" stop-opacity=".44"/>'
        f'<stop offset="1" stop-color="{BLUE}" stop-opacity="0"/></radialGradient>'
        '<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">'
        f'<circle cx="2" cy="2" r="1" fill="{LINE}"/></pattern>'
        f'<radialGradient id="fade" gradientUnits="userSpaceOnUse" cx="{num(cx)}" cy="{num(cy)}" '
        f'r="{reach * 0.62:.0f}"><stop offset=".2" stop-color="#fff"/>'
        '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
        f'<mask id="dotmask"><rect width="{w}" height="{h}" fill="url(#fade)"/></mask>'
        f'<clipPath id="corners"><rect width="{w}" height="{h}" rx="22"/></clipPath>'
        "</defs>"
        '<g clip-path="url(#corners)">'
        f'<rect width="{w}" height="{h}" fill="url(#bg)"/>'
        f'<rect width="{w}" height="{h}" fill="url(#dots)" mask="url(#dotmask)"/>'
        f'<g class="spin">{orbits}</g>{edges.markup()}{marks.markup()}'
        f'<rect class="veil" width="{w}" height="{h}" fill="url(#bg)" opacity="0"/>'
        f"{words.markup()}</g>"
    )
    alt = (
        "FractalSwarm. Kill half the brains. It still finishes. A tree of ten coordinators loses "
        "five of them, the root three times over. Each time a survivor inherits the work, and the "
        f"recorded run ends with {tree['talks']['placed']} of {tree['talks']['expected']} talks "
        "placed."
    )
    css = (
        ".id{text-anchor:middle;font-weight:600;fill:#e8f0ff}"
        f".edge{{fill:none;stroke:{EDGE};stroke-width:1.7}}"
        f".wire{{fill:none;stroke:{GOLD};stroke-width:1.9;opacity:.85}}"
        ".beat{fill:none;stroke:#cfe2ff;stroke-width:2.6;stroke-linecap:round;"
        "stroke-dasharray:7 150;animation:beat 2.4s linear infinite}"
        "@keyframes beat{to{stroke-dashoffset:157}}"
        f".orbit{{fill:none;stroke:{FAINT};stroke-width:1;stroke-dasharray:2 9}}"
        f".agent{{fill:{BLUE};opacity:.85;animation:work 3.1s ease-in-out infinite}}"
        "@keyframes work{50%{opacity:.35}}"
        f".disc{{fill:{DISC};stroke:{BLUE};stroke-width:2.4}}"
        f".done{{fill:none;stroke:{MINT};stroke-width:3}}"
        f".ash{{fill:{RED_DARK};stroke:{RED};stroke-width:2.2}}"
        f".x{{fill:none;stroke:{RED};stroke-width:4;stroke-linecap:round}}"
        f".flash{{fill:{WHITE_HOT}}}"
        ".wave,.ring,.sweep{fill:none;transform-box:fill-box;transform-origin:center}"
        f".wave{{stroke:{RED};stroke-width:3}}"
        f".ring{{stroke:{GOLD};stroke-width:3}}"
        f".sweep{{stroke:{MINT};stroke-width:4}}"
        f".comet{{fill:none;stroke:{GOLD};stroke-width:5;stroke-linecap:round;"
        "stroke-dasharray:30 200;opacity:0}"
        f".pill rect{{fill:{GOLD}}}"
        ".pill text{text-anchor:middle;font-weight:800;fill:#201500}"
        ".spin{transform-box:fill-box;transform-origin:center;animation:spin 90s linear infinite}"
        "@keyframes spin{to{transform:rotate(360deg)}}"
    )
    return picture(w, h, ink, alt, css, film)


def hero_words(
    run: Run,
    layout: HeroLayout,
    film: Film,
    ink: Ink,
    film_of: Callable[[float], float],
    holders: list[tuple[str, float]],
    root_kills: list[float],
    end: float,
) -> None:
    tree = run.tree
    finish = run.story["finish"]
    kills = tree["kills"]
    bookings = run.bookings()
    brains = tree["counts"]["orchestrators"]
    expected = tree["talks"]["expected"]
    anchor = layout.anchor

    x, y, size = layout.eyebrow
    ink.text(
        "A RUNTIME FOR TEAMS OF LLM AGENTS",
        x,
        y,
        size,
        650,
        BLUE,
        anchor,
        extra='letter-spacing="1.5"',
    )
    x, y, size = layout.title
    ink.text("FractalSwarm", x, y, size, 800, anchor=anchor, extra='letter-spacing="-1.6"')
    x, y, size, line = layout.tagline
    ink.text("Kill half the brains.", x, y, size, 700, anchor=anchor)
    ink.text("It still finishes.", x, y + line, size, 700, MINT, anchor)
    if layout.about:
        x, y, size, line = layout.about
        ink.text("Coordinators die mid-run, the root included.", x, y, size, 450, MUTED, anchor)
        ink.text("The survivors take over with no election.", x, y + line, size, 450, MUTED, anchor)

    x, top, tile = layout.hud
    label_size, value_size, value_drop = layout.hud_sizes

    def readout(
        column: int,
        label: str,
        prefix: str,
        values: list[tuple[str, float, float | None, str]],
        tail: str = "",
    ) -> None:
        left = x + column * tile
        ink.text(label, left, top + 14, label_size, 650, MUTED, extra='letter-spacing=".9"')
        for index, (value, start, stop, color) in enumerate(values):
            cls = f"{prefix}{index}"
            last = index == len(values) - 1
            ink.strings.append(value + tail)
            ink.raw(
                f'<text class="m {cls}" x="{num(left)}" y="{num(top + value_drop)}" '
                f'font-size="{num(value_size)}" font-weight="700" opacity="{1 if last else 0}" '
                f'style="fill:{color}">{esc(value)}<tspan font-size="{num(value_size * 0.5)}" '
                f'font-weight="500" style="fill:{MUTED}">{esc(tail)}</tspan></text>'
            )
            film.shown(f".{cls}", start, stop, fade=0.02)

    moments = [film_of(kill["atMs"]) for kill in kills]
    alive = [
        (
            str(brains - index),
            moments[index - 1] if index else 0.0,
            moments[index] if index < len(moments) else None,
            RED if index == len(moments) else TEXT,
        )
        for index in range(len(moments) + 1)
    ]
    readout(0, "COORDINATORS UP", "u", alive, f"/{brains}")

    owners: list[tuple[str, float, float | None, str]] = []
    for index, (owner, start) in enumerate(holders):
        stop = root_kills[index] if index < len(root_kills) else None
        owners.append((owner, start, stop, GOLD))
        if stop is not None:
            owners.append(("none", stop, holders[index + 1][1], RED))
    readout(1, "ROOT HELD BY", "o", owners)

    placed: list[tuple[str, float, float | None, str]] = [
        ("0", 0.0, film_of(bookings[0]["ms"]), TEXT)
    ]
    for index, booking in enumerate(bookings):
        stop = film_of(bookings[index + 1]["ms"]) if index + 1 < len(bookings) else None
        color = MINT if stop is None else TEXT
        placed.append((str(booking["total"]), film_of(booking["ms"]), stop, color))
    readout(2, "TALKS PLACED", "t", placed, f"/{expected}")

    x, y, width = layout.bar
    gap = 6
    slot = (width - gap * (len(bookings) - 1)) / len(bookings)
    for index, booking in enumerate(bookings):
        left = x + index * (slot + gap)
        for cls, fill in (("", FAINT), (f' class="b{index}"', MINT)):
            ink.raw(
                f'<rect{cls} x="{num(left)}" y="{num(y)}" width="{num(slot)}" height="7" '
                f'rx="3.5" fill="{fill}"/>'
            )
        film.shown(f".b{index}", film_of(booking["ms"]), fade=0.1)

    # the run as it goes, three lines at a time, coming in from below
    rows: list[tuple[float, str, str]] = []
    for kill in kills:
        words = f"{kill['target']} crashes" + (", holding the root" if kill["heldRoot"] else "")
        rows.append((kill["atMs"], words, RED))
    for round_ in tree["rounds"]:
        goal = "the root" if round_["root"] else round_["goal"]
        rows.append((round_["atMs"], f"{round_['owner']} inherits {goal}", GOLD))
    for booking in bookings:
        words = f"{booking['holder']} books {booking['cells']} talks of {booking['goal']}"
        rows.append((booking["ms"], words, MINT))
    rows.sort(key=lambda row: row[0])
    rows.append((tree["durationMs"], "run completed", MINT))

    x, top, size, line = layout.ticker
    window = 3
    lines = []
    for index, (ms, words, color) in enumerate(rows):
        stamp = f"{ms / 1000:5.1f} s"
        ink.strings.append(stamp + words)
        lines.append(
            f'<text class="m" x="{num(x)}" y="{num(top + (index + 1) * line - 6)}" '
            f'font-size="{num(size)}" font-weight="500" xml:space="preserve">'
            f'<tspan style="fill:{MUTED}">{esc(stamp)}  </tspan>'
            f'<tspan style="fill:{color}">{esc(words)}</tspan></text>'
        )

    def shift(count: int) -> str:
        return f"transform:translateY({(window - count) * line:.1f}px)"

    stops = [(0.0, shift(0))]
    for index, (ms, _, _) in enumerate(rows):
        at = film_of(ms)
        stops += [(at - 0.16, shift(index)), (at, shift(index + 1))]
    film.animate(".log", stops)
    height = window * line
    ink.raw(
        f'<clipPath id="logclip"><rect x="{num(x - 4)}" y="{num(top)}" '
        f'width="{num(layout.bar[2] + 8)}" height="{num(height + 2)}"/></clipPath>'
        '<g class="running" clip-path="url(#logclip)" opacity="0">'
        f'<g class="log" style="{shift(len(rows))}">{"".join(lines)}</g></g>'
    )
    film.animate(
        ".running", [(0.0, "opacity:1"), (end + 0.35, "opacity:1"), (end + 0.6, "opacity:0")]
    )
    closing = (
        f"{finish['placed']} of {finish['expected']} talks placed · "
        f"{finish['hardViolations']} hard violations · replay MATCH"
    )
    ink.text(closing, x, top + height / 2 + 8, layout.closing, 700, MINT, cls="closing")
    film.shown(".closing", end + 0.6, fade=0.3)


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class TakeoverLayout:
    """Where things stand in one shape of the takeover."""

    width: int
    height: int
    steps: tuple[tuple[float, float], ...]  # where each step's number stands
    step_text: float
    monitor: Box
    node: tuple[float, float]
    pill: tuple[float, float]
    trace: Box
    missed: tuple[float, float]
    cards: tuple[Box, Box, Box]
    log: Box
    closing: tuple[float, float, float]  # x, baseline, size


TAKEOVER_WIDE = TakeoverLayout(
    width=1280,
    height=656,
    steps=((47, 42), (362, 42), (645, 42), (1001, 42)),
    step_text=19.5,
    monitor=Box(32, 78, 278, 330),
    node=(84, 136),
    pill=(164, 136),
    trace=Box(52, 196, 238, 104),
    missed=(56, 386),
    cards=(Box(322, 78, 300, 330), Box(634, 78, 300, 330), Box(946, 78, 302, 330)),
    log=Box(32, 424, 1216, 170),
    closing=(640, 630, 27),
)

TAKEOVER_PHONE = TakeoverLayout(
    width=720,
    height=1216,
    steps=((38, 38), (372, 38), (38, 86), (372, 86)),
    step_text=21,
    monitor=Box(20, 122, 680, 176),
    node=(76, 182),
    pill=(76, 238),
    trace=Box(150, 134, 340, 152),
    missed=(520, 238),
    cards=(Box(20, 310, 220, 332), Box(250, 310, 220, 332), Box(480, 310, 220, 332)),
    log=Box(20, 656, 680, 480),
    closing=(360, 1182, 27),
)

STEPS = (
    "A coordinator goes silent",
    "Every survivor sees it",
    "Each computes the same heir",
    "The heir adopts the work",
)
TAKEOVER_LOOP = 18.0
CRASH = 1.8
DEAD = 4.4
COMPUTE = 5.2
HEIR = 7.2
ADOPT = 8.4
CLOSE = 9.6
BEAT = 84  # the width of one heartbeat on the trace
SPEED = 105.0  # of the trace, in units a second


def takeover(run: Run, layout: TakeoverLayout) -> str:
    """The first takeover of the run, seen by the three who could inherit."""
    tree = run.tree
    first = tree["rounds"][0]
    dead, heir, goal = first["previous"], first["owner"], first["goal"]
    kill = next(row for row in tree["kills"] if row["target"] == dead)
    adoption = next(
        row for row in tree["adoptions"] if (row["dead"], row["adopter"]) == (dead, heir)
    )
    remap = next(
        event
        for event in run.events
        if event["type"] == "ownership.remapped"
        and event["payload"]["key"] == goal
        and event["payload"]["owner"] == heir
    )
    limit = tree["heartbeat"]["deadAfter"]
    film = Film(TAKEOVER_LOOP)
    ink = Ink()
    w, h = layout.width, layout.height

    ink.raw(
        "<defs>"
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#0a101d"/>'
        f'<stop offset="1" stop-color="{BG}"/></linearGradient>'
        f'<clipPath id="corners"><rect width="{w}" height="{h}" rx="22"/></clipPath>'
        f'<clipPath id="tracebox"><rect x="{layout.trace.x}" y="{layout.trace.y}" '
        f'width="{layout.trace.w}" height="{layout.trace.h}"/></clipPath>'
        "</defs>"
        '<g clip-path="url(#corners)">'
        f'<rect width="{w}" height="{h}" fill="url(#bg)"/>'
    )

    # the four steps
    moments = (0.0, DEAD, COMPUTE, ADOPT)
    for index, ((x, y), words) in enumerate(zip(layout.steps, STEPS, strict=True)):
        cls = f"s{index}"
        ink.raw(f'<g class="{cls}">')
        ink.raw(f'<circle cx="{x}" cy="{y - 7}" r="15" fill="{BLUE}"/>')
        ink.text(index + 1, x, y - 1, 17, 800, BG, "middle")
        ink.text(words, x + 26, y, layout.step_text, 650)
        ink.raw("</g>")
        start = moments[index]
        film.animate(
            f".{cls}",
            [(0.0, "opacity:.32"), (start, "opacity:.32"), (start + 0.25, "opacity:1")],
        )

    # the one that goes silent
    box = layout.monitor
    x, y = layout.node
    ink.raw(f'<rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" class="panel"/>')
    ink.raw(f'<circle class="disc" cx="{x}" cy="{y}" r="30"/>')
    ink.text(dead, x, y + 6.5, 18, 600, "#e8f0ff", "middle", mono=True)
    ink.raw(
        f'<g class="fell"><circle class="ash" cx="{x}" cy="{y}" r="30"/>'
        f'<path class="x" d="M{x - 12} {y - 12}l24 24m0-24l-24 24"/></g>'
        f'<circle class="flash" cx="{x}" cy="{y}" r="30" opacity="0"/>'
        f'<circle class="wave" cx="{x}" cy="{y}" r="30" opacity="0"/>'
    )
    film.shown(".fell", CRASH + 0.12, fade=0.1)
    film.animate(
        ".flash",
        [
            (0.0, "opacity:0"),
            (CRASH, "opacity:0"),
            (CRASH + 0.04, "opacity:1"),
            (CRASH + 0.5, "opacity:0"),
        ],
    )
    film.animate(
        ".wave",
        [
            (0.0, "opacity:0;transform:scale(1)"),
            (CRASH, "opacity:0;transform:scale(1)"),
            (CRASH + 0.04, "opacity:.9;transform:scale(1)"),
            (CRASH + 1.0, "opacity:0;transform:scale(3.4)"),
        ],
    )
    px, py = layout.pill
    ink.raw(
        f'<g class="crown" opacity=".3"><rect x="{px - 26}" y="{py - 13}" width="52" height="26" '
        f'rx="13" fill="{GOLD}"/>'
    )
    ink.text("root", px, py + 5.5, 15.5, 800, "#201500", "middle")
    ink.raw("</g>")
    film.animate(".crown", [(0.0, "opacity:1"), (CRASH, "opacity:1"), (CRASH + 0.1, "opacity:.3")])

    trace = layout.trace
    mid = trace.y + trace.h * 0.62
    last_beat = trace.x + trace.w + SPEED * CRASH
    beats = math.ceil((last_beat - trace.x) / BEAT)
    steps = "l14 0l4 -8l4 8l10 0l5 8l7 -52l7 62l5 -18l4 0l6 -7l6 7l12 0" * beats
    flat_from = trace.x + beats * BEAT
    flat_to = flat_from + SPEED * TAKEOVER_LOOP + trace.w
    travel = SPEED * TAKEOVER_LOOP
    ink.raw(
        '<g clip-path="url(#tracebox)">'
        f'<g class="trace" style="transform:translateX({-travel:.0f}px)">'
        f'<path class="ecg" d="M{num(trace.x)} {num(mid)}{steps}"/>'
        f'<path class="flat" d="M{num(flat_from)} {num(mid)}L{num(flat_to)} {num(mid)}"/>'
        "</g></g>"
    )
    film.animate(
        ".trace",
        [
            (0.0, "transform:translateX(0)"),
            (TAKEOVER_LOOP, f"transform:translateX({-travel:.0f}px)"),
        ],
    )

    x, y = layout.missed
    ink.text("HEARTBEATS MISSED", x, y - 54, 14, 650, MUTED, extra='letter-spacing=".9"')
    gap = (DEAD - CRASH) / limit
    for count in range(limit + 1):
        last = count == limit
        start = CRASH + count * gap if count else 0.0
        stop = None if last else CRASH + (count + 1) * gap
        ink.raw(f'<g class="miss{count}" opacity="{1 if last else 0}">')
        ink.text(f"{count}/{limit}", x, y, 42, 700, RED if last else TEXT, mono=True)
        ink.raw("</g>")
        film.shown(f".miss{count}", start, stop, fade=0.02)

    # the three who could inherit, each on its own, with no message between them
    scores = first["scores"]
    for column, (box, member) in enumerate(zip(layout.cards, first["pool"], strict=True)):
        takes = member == heir
        x, y = box.x + 16, box.y
        right = box.x + box.w - 16
        ink.raw(f'<rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" class="panel"/>')
        if takes:
            ink.raw(
                f'<rect class="heirbox" x="{box.x}" y="{box.y}" width="{box.w}" '
                f'height="{box.h}" rx="16"/>'
                f'<g class="landed"><rect x="{x + 92}" y="{y + box.h - 70}" width="52" height="26" '
                f'rx="13" fill="{GOLD}"/>'
            )
            ink.text("root", x + 118, y + box.h - 51.5, 15.5, 800, "#201500", "middle")
            ink.raw("</g>")
            film.shown(".heirbox", ADOPT, fade=0.3)
            film.shown(".landed", ADOPT, fade=0.2)
        ink.raw(f'<circle class="disc" cx="{x + 24}" cy="{y + 42}" r="24"/>')
        ink.text(member, x + 24, y + 48, 16, 600, "#e8f0ff", "middle", mono=True)
        ink.text(
            "computes alone",
            right,
            y + 48,
            16,
            500,
            MUTED,
            "end",
            cls=f"quiet q{column}",
            extra='opacity="0"',
        )
        ink.text(f"{dead} is dead", right, y + 48, 17, 650, RED, "end", cls=f"knows n{column}")
        film.shown(f".q{column}", 0.0, DEAD, fade=0.1)
        film.shown(f".n{column}", DEAD + 0.1, fade=0.12)
        ink.raw(f'<g class="sum{column}">')
        ink.text(f"hash({goal}, member)", x, y + 92, 15.5, 500, MUTED, mono=True)
        for row, score in enumerate(scores):
            base = y + 124 + row * 48
            wins = score["member"] == heir
            top = base + 9
            span = box.w - 32
            cls = f"v{column}{row}"
            fill = f"f{column}{row}"
            ink.text(score["member"], x, base, 17, 600, TEXT, mono=True)
            ink.text(
                f"{score['fraction']:.3f}",
                right,
                base,
                17,
                600,
                GOLD if wins else TEXT,
                "end",
                mono=True,
                cls=cls,
            )
            ink.raw(
                f'<rect x="{x}" y="{top}" width="{span}" height="10" rx="5" fill="{FAINT}"/>'
                f'<rect class="fill {fill}" x="{x}" y="{top}" '
                f'width="{num(span * score["fraction"])}" height="10" rx="5" '
                f'fill="{GOLD if wins else BLUE}"/>'
            )
            begin = COMPUTE + 0.3 + row * 0.3
            film.animate(
                f".{fill}",
                [
                    (0.0, "transform:scaleX(0)"),
                    (begin, "transform:scaleX(0)"),
                    (begin + 0.9, "transform:scaleX(1)"),
                ],
            )
            film.shown(f".{cls}", begin + 0.8, fade=0.15)
        ink.raw("</g>")
        ink.text(f"heir: {heir}", x, y + box.h - 50, 23, 750, GOLD, cls=f"names m{column}")
        film.shown(f".m{column}", HEIR, fade=0.25)
        fate = f"adopts the {goal}" if takes else f"re-attaches to {heir}"
        ink.text(fate, x, y + box.h - 22, 18, 550, TEXT if takes else MUTED, cls=f"fate z{column}")
        film.shown(f".z{column}", ADOPT + 0.2, fade=0.25)

    # the log that all of them read
    blocks = [
        (kill["seq"], RED),
        (kill["stoppedSeq"], RED),
        (kill["verdict"]["seq"], RED),
        (remap["seq"], GOLD),
        (adoption["seq"], GOLD),
    ]
    box = layout.log
    stacked = box.h > 200
    label = "THE LOG: EVERY EVENT CARRIES THE HASH OF THE ONE BEFORE"
    ink.text(
        label,
        box.x + 4,
        box.y + 18,
        14 if not stacked else 16.5,
        650,
        MUTED,
        extra='letter-spacing=".9"',
    )
    count = len(blocks)
    gap = 12
    for index, (seq, color) in enumerate(blocks):
        event = run.event(seq)
        chained = index > 0 and event["prev_hash"] == run.event(blocks[index - 1][0])["hash"]
        follows = (
            index + 1 < count and run.event(blocks[index + 1][0])["prev_hash"] == event["hash"]
        )
        if stacked:
            bw, bh = box.w, (box.h - 34 - gap * (count - 1)) / count
            bx, by = box.x, box.y + 34 + index * (bh + gap)
        else:
            bw, bh = (box.w - gap * (count - 1)) / count, box.h - 34
            bx, by = box.x + index * (bw + gap), box.y + 34
        cls = f"block l{index}"
        ink.raw(f'<g class="{cls}">')
        ink.raw(
            f'<rect x="{num(bx)}" y="{num(by)}" width="{num(bw)}" height="{num(bh)}" rx="12" '
            f'fill="{PANEL}" stroke="{LINE}"/>'
        )
        tx = bx + 14
        small = 15.0 if not stacked else 17.5
        first_line = by + (26 if not stacked else 30)
        ink.text(f"seq {seq}", tx, first_line, small, 500, MUTED, mono=True)
        ink.text(
            event["type"], tx, first_line + 26, 17.2 if not stacked else 21, 700, color, mono=True
        )
        hash_x = tx if not stacked else bx + bw - 14
        hash_anchor = "start" if not stacked else "end"
        hash_y = first_line + 50 if not stacked else first_line
        ink.text(
            f"prev {event['prev_hash'][:8]}",
            hash_x,
            hash_y,
            small,
            500,
            GOLD if chained else MUTED,
            hash_anchor,
            mono=True,
        )
        ink.text(
            f"hash {event['hash'][:8]}",
            hash_x,
            hash_y + (21 if not stacked else 26),
            small,
            500,
            GOLD if follows else MUTED,
            hash_anchor,
            mono=True,
        )
        ink.raw("</g>")
        start = (CRASH, CRASH + 0.35, DEAD, ADOPT, ADOPT + 0.35)[index]
        film.shown(f".l{index}", start, fade=0.2)

    x, y, size = layout.closing
    ink.text(
        "One rule, one log. No election, and no LLM call.",
        x,
        y,
        size,
        750,
        anchor="middle",
        cls="close",
    )
    film.shown(".close", CLOSE, fade=0.4)

    ink.raw(f'<rect class="veil" width="{w}" height="{h}" fill="url(#bg)" opacity="0"/></g>')
    film.veil(".veil", hold=0.4)

    worded = ", ".join(f"{s['member']} {s['fraction']:.3f}" for s in scores)
    alt = (
        f"One takeover from the recorded run. {dead} stops sending heartbeats while it holds the "
        f"root. After {limit} missed beats the log says it is dead. Each of the three who could "
        f"inherit computes hash({goal}, member) on its own, and all three get {worded}, so all "
        f"three name {heir}. {heir} adopts the root and the others re-attach to it. The events "
        "are in the hash-chained log. No election, and no LLM call."
    )
    css = (
        f".panel{{fill:{PANEL};stroke:{LINE};rx:16px}}"
        f".heirbox{{fill:none;stroke:{GOLD};stroke-width:2.4}}"
        f".disc{{fill:{DISC};stroke:{BLUE};stroke-width:2.4}}"
        f".ash{{fill:{RED_DARK};stroke:{RED};stroke-width:2.2}}"
        f".x{{fill:none;stroke:{RED};stroke-width:4;stroke-linecap:round}}"
        f".flash{{fill:{WHITE_HOT}}}"
        f".wave{{fill:none;stroke:{RED};stroke-width:3;transform-box:fill-box;"
        "transform-origin:center}"
        f".ecg{{fill:none;stroke:{BLUE};stroke-width:2.6;stroke-linejoin:round}}"
        f".flat{{fill:none;stroke:{RED};stroke-width:2.6}}"
        ".fill{transform-box:fill-box;transform-origin:left}"
    )
    return picture(w, h, ink, alt, css, film)


def replay(path: Path) -> list[str]:
    """What ``fractalswarm replay PATH --verify`` prints."""
    done = subprocess.run(
        [
            sys.executable,
            "-c",
            "from fractalswarm.cli import app; app()",
            "replay",
            str(path),
            "--verify",
        ],
        cwd=ROOT_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    return [line.rstrip() for line in done.stdout.splitlines()]


def tamper_output(run: Run) -> tuple[list[str], list[str], int]:
    """The replay of the run, and of a copy with one letter changed in one event."""
    honest = replay(DEMO)
    seq = next(event["seq"] for event in run.events if event["type"] == "lease.booked")
    with tempfile.TemporaryDirectory() as folder:
        copy = Path(folder) / "tampered"
        shutil.copytree(DEMO, copy)
        log = copy / "events.jsonl"
        lines = log.read_bytes().split(b"\n")
        if b"room-d" not in lines[seq - 1]:
            raise SystemExit(f"line {seq} of the log has no room-d")
        lines[seq - 1] = lines[seq - 1].replace(b"room-d", b"room-c", 1)
        log.write_bytes(b"\n".join(lines))
        tampered = replay(copy)
    return honest, tampered, seq


TERMINAL_LOOP = 24.0


def broken(words: str, room: int) -> list[str]:
    """A printed line in ``room`` letters, with its spaces as printed."""
    rows: list[str] = []
    while len(words) > room:
        cut = words.rfind(" ", 0, room + 1)
        rows.append(words[:cut].rstrip())
        words = f"  {words[cut + 1 :]}"
    return [*rows, words]


def terminal(run: Run, wide: bool) -> str:
    honest, tampered, seq = tamper_output(run)
    if not honest[0].startswith("MATCH") or not tampered[0].startswith("MISMATCH"):
        raise SystemExit(f"the replay did not print what the picture says: {honest} {tampered}")
    events = len(run.events)
    script: list[tuple[str, str]] = [
        ("$ uv run fractalswarm replay demo/final --verify", "cmd"),
        *((line, "ok") for line in honest),
        ("", "gap"),
        (f"# Move one talk to another room: one letter, one event of {events:,}", "note"),
        ("$ cp -r demo/final tampered", "cmd"),
        (f"$ sed -i.bak '{seq}s/room-d/room-c/' tampered/events.jsonl", "cmd"),
        ("$ uv run fractalswarm replay tampered --verify", "cmd"),
        *((line, "bad") for line in tampered),
    ]
    w, size, line, left = (1000, 22.5, 36, 36) if wide else (720, 23.0, 35, 22)
    width_of_letter = size * 0.6
    room = int((w - 2 * left) / width_of_letter)

    def tone(words: str, kind: str) -> tuple[str, int]:
        if kind == "ok" or words.startswith("MISMATCH"):
            return (MINT if kind == "ok" else RED), 700
        if words.startswith("the recorded log"):
            return RED, 500
        return (TEXT if kind == "cmd" else MUTED), 500

    rows = [
        (row, kind, *tone(words.strip(), kind))
        for words, kind in script
        for row in broken(words, room)
    ]
    top = 92
    h = top + line * len(rows) + 34
    ink = Ink()
    film = Film(TERMINAL_LOOP)
    ink.raw(
        f'<clipPath id="corners"><rect width="{w}" height="{h}" rx="18"/></clipPath>'
        '<g clip-path="url(#corners)">'
        f'<rect width="{w}" height="{h}" fill="#0b0f19"/>'
        f'<rect width="{w}" height="50" fill="#141b2b"/>'
    )
    for index, color in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        ink.raw(f'<circle cx="{32 + index * 24}" cy="25" r="7.5" fill="{color}"/>')
    ink.text("verify it yourself", w / 2, 32, 18, 600, MUTED, "middle")

    at = 0.9
    for index, (words, kind, fill, weight) in enumerate(rows):
        y = top + index * line
        if kind == "gap":
            at += 0.5
            continue
        cls = f"l{index}"
        ink.text(
            words, left, y, size, weight, fill, mono=True, cls=cls, extra='xml:space="preserve"'
        )
        if kind in ("cmd", "note"):
            span = len(words) * width_of_letter
            typing = min(1.5, 0.3 + len(words) * 0.022)
            cover = f"c{index}"
            ink.raw(
                f'<rect class="{cover}" x="{left - 2}" y="{y - size}" width="{num(span + 8)}" '
                f'height="{line}" fill="#0b0f19" opacity="0"/>'
            )
            film.shown(f".{cls}", at, fade=0.01)
            film.animate(
                f".{cover}",
                [
                    (0.0, "opacity:1;transform:translateX(0)"),
                    (
                        at,
                        f"opacity:1;transform:translateX(0);animation-timing-function:steps({len(words)})",
                    ),
                    (at + typing, f"opacity:1;transform:translateX({span + 8:.0f}px)"),
                    (at + typing + 0.01, f"opacity:0;transform:translateX({span + 8:.0f}px)"),
                ],
            )
            at += typing + 0.35
        else:
            film.shown(f".{cls}", at, fade=0.05)
            at += 0.5 if index and rows[index - 1][1] == "cmd" else 0.18
            continue
    if at > TERMINAL_LOOP - 4:
        raise SystemExit(f"the terminal's film runs to {at:.1f} s")
    ink.raw(f'<rect class="veil" width="{w}" height="{h}" fill="#0b0f19" opacity="0"/></g>')
    film.veil(".veil", hold=0.5)
    alt = (
        f"A terminal. fractalswarm replay demo/final --verify prints {honest[0]}. Then one letter "
        f"is changed in one event of {events:,}, moving a talk to another room, and the same "
        f"command prints {tampered[0]}, first divergence at seq {seq}: "
        f"{tampered[-1]}."
    )
    return picture(w, h, ink, alt, "", film)


def tiles(run: Run, wide: bool) -> str:
    tree = run.tree
    finish = run.story["finish"]
    killed = len(tree["kills"])
    brains = tree["counts"]["orchestrators"]
    root_deaths = sum(kill["heldRoot"] for kill in tree["kills"])
    harsh = stated("All 14 real swarm runs at C3").split()[1]
    tokens = finish["coordinationTokens"]
    if root_deaths != 3:
        raise SystemExit(f"the tile says three crashes held the root, the run has {root_deaths}")
    rows = [
        (
            f"{killed} of {brains}",
            ("coordinators crashed in the", "demo run, three of them", "while they held the root"),
            RED,
        ),
        (
            f"{harsh} of {harsh}",
            ("real runs at the harshest", "failure profile finished", "with a valid result"),
            MINT,
        ),
        (
            str(tokens),
            ("LLM tokens on takeover,", "routing and recovery, in", "every real swarm run"),
            BLUE,
        ),
        (
            f"{len(run.events):,}",
            ("events in the demo run,", "replayed bit for bit from", "a hash-verified log"),
            GOLD,
        ),
    ]
    width, tile_w, tile_h, gap, columns = (
        (1280, 302, 214, 24, 4) if wide else (720, 350, 236, 20, 2)
    )
    row_count = math.ceil(len(rows) / columns)
    height = row_count * tile_h + (row_count - 1) * gap
    ink = Ink()
    for index, (value, label, color) in enumerate(rows):
        x = (index % columns) * (tile_w + gap)
        y = (index // columns) * (tile_h + gap)
        ink.raw(
            f'<rect x="{x}" y="{y}" width="{tile_w}" height="{tile_h}" rx="18" fill="#0b111e"/>'
            f'<rect x="{x + 26}" y="{y + 24}" width="40" height="5" rx="2.5" fill="{color}"/>'
        )
        ink.text(value, x + 26, y + 92, 58 if wide else 64, 800)
        for line, words in enumerate(label):
            ink.text(words, x + 26, y + 130 + line * 26, 20 if wide else 22, 500, MUTED)
    alt = ". ".join(f"{value}: {' '.join(label)}" for value, label, _ in rows) + "."
    return picture(width, height, ink, alt)


VERDICTS = {
    "win": ("Win", "#10382b", "#1f6e52", MINT),
    "tie": ("Tie", "#151d2c", "#26334b", MUTED),
    "loss": ("Loss", "#3b1518", "#8c2f2b", RED),
}
MEASURES = {
    "Preserved work": "calls in flight at a crash, still used",
    "Extra cost": "against no failures, same seed",
    "Time to recover": "from a crash to the first decision",
    "Coordinator-dependency time": "work held up by a down coordinator",
    "Blast radius": "share of agents and goals held up",
    "Idle agent-seconds": "agents idle while ready work waits",
    "Unnecessary reassignments": "re-sent while the assignee was alive",
    "Duplicated spend": "calls already answered, paid again",
    "Stall time": "no agent call in flight anywhere",
}
RIVALS = {
    "central": ("In-process", "workers die with it"),
    "durable": ("Realistic durable", "redoes in-flight calls"),
    "durable-max": ("Ideal durable", "loses nothing"),
}


def wrapped(words: str, room: int) -> list[str]:
    left = words.split()
    lines: list[str] = []
    while left:
        line = left.pop(0)
        while left and len(line) + 1 + len(left[0]) <= room:
            line += " " + left.pop(0)
        lines.append(line)
    return lines


def scoreboard(run: Run, wide: bool) -> str:
    """Every pre-registered measure against each rival, at the headline point."""
    verdicts = run.story["verdicts"]
    rows = [row for row in verdicts["comparisons"] if row["profile"] == "C3"]
    measures = list(dict.fromkeys(row["name"] for row in rows))

    def cell(name: str, rival: str) -> dict:
        return next(row for row in rows if (row["name"], row["rival"]) == (name, rival))

    def label(name: str) -> str:
        words = name.removeprefix("Locality: ").split(" (")[0]
        return words[0].upper() + words[1:]

    rule = verdicts["rules"]["tie"]
    note = (
        f"{rule[0].upper()}{rule[1:]}, by the rules of bench/PREREG.md. "
        "Coordinator-dependency time and blast radius are per crash; stall time is reported, not "
        "a hypothesis. The swarm's unnecessary reassignments are its false deaths. Most of the "
        "gap to the "
        "in-process supervisor comes from that rival's design, so it is no evidence against a "
        "well-built supervisor."
    )
    if wide:
        width, left, first, col, gap, top, step = 1280, 36, 474, 250, 8, 158, 60
        title, sub, head, text, foot, room = 30, 18, 19, 20, 18.5, 122
    else:
        width, left, first, col, gap, top, step = 720, 22, 302, 128, 5, 196, 66
        title, sub, head, text, foot, room = 32, 21, 18.5, 20, 22, 60
    lines = wrapped(note, room)
    foot_top = top + step * len(measures) + 22
    height = int(foot_top + len(lines) * (foot + 8) + 22)
    ink = Ink()
    ink.raw(f'<rect width="{width}" height="{height}" rx="22" fill="#0a0f1a"/>')
    ink.text("Win, tie or loss, measure by measure", left, 54, title, 750)
    if wide:
        ink.text(
            "Real model · conference task · five coordinator crashes, half the agents killed · "
            "10 seeds",
            left,
            88,
            sub,
            500,
            MUTED,
        )
    else:
        ink.text("Real model · conference task · 10 seeds", left, 92, sub, 500, MUTED)
        ink.text("Five coordinator crashes, half the agents killed", left, 122, sub, 500, MUTED)
    for index, (name, what) in enumerate(RIVALS.values()):
        center = first + index * (col + gap) + col / 2
        if wide:
            ink.text(name, center, top - 36, head, 700, TEXT, "middle")
            ink.text(what, center, top - 14, 15.5, 500, MUTED, "middle")
        else:
            first_word, *rest = name.split()
            ink.text(first_word, center, top - (34 if rest else 14), head, 700, TEXT, "middle")
            if rest:
                ink.text(rest[0], center, top - 12, head, 700, TEXT, "middle")
    for row, measure in enumerate(measures):
        y = top + row * step
        ink.text(label(measure), left, y + (step - 8) / 2 - 4, text, 600)
        ink.text(MEASURES[label(measure)], left, y + (step - 8) / 2 + 18, 15.5, 500, MUTED)
        for index, rival in enumerate(RIVALS):
            verdict, fill, edge, color = VERDICTS[cell(measure, rival)["verdict"]]
            x = first + index * (col + gap)
            ink.raw(
                f'<rect x="{x}" y="{y}" width="{col}" height="{step - 8}" rx="10" fill="{fill}" '
                f'stroke="{edge}"/>'
            )
            ink.text(verdict, x + col / 2, y + (step - 8) / 2 + 7, 19, 750, color, "middle")
    for index, line in enumerate(lines):
        ink.text(line, left, foot_top + index * (foot + 8) + 14, foot, 500, NOTE)
    told = []
    for measure in measures:
        said = ", ".join(
            f"{RIVALS[rival][0]}: {cell(measure, rival)['verdict']}" for rival in RIVALS
        )
        told.append(f"{label(measure)}, {MEASURES[label(measure)]}. {said}.")
    alt = (
        "The verdict of every pre-registered measure and of stall time against three rivals, on "
        "the real model, on the conference task, with five coordinator crashes and half the "
        f"agents killed, over ten seeds. {' '.join(told)} {note}"
    )
    return picture(width, height, ink, alt)


# a workflow keeps its colour of the app's dark theme (--own-1 to --own-4)
WORKFLOWS = {
    "swarm": "#3987e5",
    "durable-max": "#d95926",
    "durable": "#199e70",
    "central": "#a846a7",
}


KILLED = {0: "None", 5: "Five"}


def page_words(name: str) -> str:
    """A sentence of the Charts page, which carries the conditions of the claims it stands by."""
    found = re.search(rf'export const {name} =\s*"(.+?)";', HERO_TEXT.read_text(encoding="utf-8"))
    if found is None:
        raise SystemExit(f"{HERO_TEXT.name} no longer has {name}")
    return found.group(1)


def seconds(value: float) -> str:
    return f"{value:.1f} s"


def percent(value: float) -> str:
    sign = "" if round(abs(value), 1) == 0 else "−" if value < 0 else "+"
    return f"{sign}{abs(value):.1f}%"


def plot(
    ink: Ink,
    hero: dict,
    box: Box,
    sizes: tuple[float, float, float],
    title: str,
    what: str,
    metric: str,
    ticks: tuple[int, ...],
    tick_words: Callable[[int], str],
    figure: Callable[[float], str],
) -> None:
    """One measure: a dot on each mean, a bar from the lowest seed to the highest."""
    head, axis, label = sizes
    ink.raw(
        f'<rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" rx="16" fill="{PANEL}" '
        f'stroke="{LINE}"/>'
    )
    ink.text(title.upper(), box.x + 20, box.y + 32, head, 700, extra='letter-spacing=".9"')
    ink.text(what, box.x + box.w - 20, box.y + 32, head, 500, MUTED, "end")
    left = box.x + axis * 3.5 + 12
    right = box.x + box.w - 18
    top = box.y + 54
    bottom = box.y + box.h - axis * 3.9
    low, high = ticks[0], ticks[-1]

    def y_of(value: float) -> float:
        return bottom - (value - low) / (high - low) * (bottom - top)

    for tick in ticks:
        y = y_of(tick)
        ink.raw(
            f'<line x1="{num(left)}" y1="{num(y)}" x2="{num(right)}" y2="{num(y)}" '
            f'stroke="{"#46587a" if tick == 0 else FAINT}"/>'
        )
        ink.text(tick_words(tick), left - 10, y + axis * 0.36, axis, 500, MUTED, "end")

    # the killed side takes more room: it carries the figures
    span = right - left
    slots = ((left, left + span * 0.34), (left + span * 0.34, right))
    ink.raw(
        f'<rect x="{num(slots[1][0])}" y="{num(top)}" width="{num(slots[1][1] - slots[1][0])}" '
        f'height="{num(bottom - top)}" rx="8" fill="#111c31" opacity=".8"/>'
    )
    points = [hero["series"][name]["points"] for name in WORKFLOWS]
    for slot, (start, stop) in enumerate(slots):
        count = len(WORKFLOWS)
        room = (stop - start) / count
        sample = points[0][slot]
        words = f"{KILLED[sample['x']]} ({sample['profile']})"
        ink.text(words, (start + stop) / 2, bottom + axis * 1.5, axis, 600, TEXT, "middle")
        for index, name in enumerate(WORKFLOWS):
            point = points[index][slot]
            x = start + room * (index + (0.16 if slot else 0.5))
            top_y, end_y = y_of(point[f"{metric}_max"]), y_of(point[f"{metric}_min"])
            mean = point[metric]
            ink.raw(
                f'<rect x="{num(x - 3)}" y="{num(top_y)}" width="6" height="{num(end_y - top_y)}" '
                f'rx="3" fill="{WORKFLOWS[name]}" opacity=".55"/>'
                f'<circle cx="{num(x)}" cy="{num(y_of(mean))}" r="7.5" fill="{WORKFLOWS[name]}" '
                f'stroke="{PANEL}" stroke-width="2.5"/>'
            )
            if slot:
                ink.text(figure(mean), x + 12, y_of(mean) + label * 0.36, label, 650, mono=True)
    ink.text(
        hero["xLabel"], (left + right) / 2, box.y + box.h - axis * 0.8, axis, 500, MUTED, "middle"
    )


def evidence(run: Run, wide: bool) -> str:
    """The app's two hero charts: stall time and extra cost, against coordinators killed."""
    hero = run.story["hero"]
    if hero["set"] != "headline-10":
        raise SystemExit(f"the chart's words are about headline-10, not {hero['set']}")
    notes = [page_words(name) for name in ("TIE_RULE", "IN_PROCESS_REASON", "COST_BASIS")]
    noise = stated("The swarm stalled more with no crash than with five", REPORT)
    notes.append(f"{noise}: no crash removes a stall, so this is what noise looks like.")
    if wide:
        width, left, panel_w, panel_h, top, room = 1280, 36, 592, 420, 150, 128
        boxes = (Box(left, top, panel_w, panel_h), Box(652, top, panel_w, panel_h))
        sizes, foot, legend = (15.0, 15.0, 15.5), 18.5, 16.5
        below = top + panel_h + 30
    else:
        width, left, panel_w, panel_h, top, room = 720, 20, 680, 440, 214, 62
        boxes = (Box(left, top, panel_w, panel_h), Box(left, top + panel_h + 14, panel_w, panel_h))
        sizes, foot, legend = (17.0, 18.0, 19.0), 22.0, 21.0
        below = top + 2 * panel_h + 14 + 34
    lines = [wrapped(note, room) for note in notes]
    step = foot + 8
    height = int(below + sum(len(block) for block in lines) * step + 12 * len(lines) + 14)
    ink = Ink()
    ink.raw(f'<rect width="{width}" height="{height}" rx="22" fill="#0a0f1a"/>')
    ink.text("When coordinators die", left, 54, 30 if wide else 34, 750)
    seeds = f"Real model · conference task · {hero['seedCount']} seeds per point"
    marks = "Dot: mean. Bar: lowest to highest seed."
    if wide:
        ink.text(f"{seeds}. {marks}", left, 88, 18, 500, MUTED)
    else:
        ink.text(seeds, left, 92, 21, 500, MUTED)
        ink.text(marks, left, 122, 21, 500, MUTED)
    x, y = left, 126 if wide else 166
    for index, (name, color) in enumerate(WORKFLOWS.items()):
        words = hero["series"][name]["label"]
        if not wide:
            x, y = left + (index % 2) * 340, 158 + (index // 2) * 32
        ink.raw(f'<circle cx="{num(x + 8)}" cy="{num(y - 6)}" r="7.5" fill="{color}"/>')
        ink.text(words, x + 24, y, legend, 600)
        x += 24 + len(words) * legend * 0.53 + 30
    plot(
        ink,
        hero,
        boxes[0],
        sizes,
        "Stall time",
        "no agent work in flight anywhere",
        "stall_s",
        (0, 25, 50, 75, 100),
        lambda tick: f"{tick} s",
        seconds,
    )
    plot(
        ink,
        hero,
        boxes[1],
        sizes,
        "Extra cost",
        "vs no failures: same workflow, task and seed",
        "extra_cost_pct",
        (-40, 0, 40, 80, 120),
        lambda tick: f"{tick:+d}%".replace("-", "−").replace("+0", "0"),
        percent,
    )
    y = below
    for block in lines:
        for line in block:
            ink.text(line, left, y + foot * 0.8, foot, 500, NOTE)
            y += step
        y += 12
    series = [hero["series"][name] for name in WORKFLOWS]
    stall = ", ".join(f"{row['label']} {seconds(row['points'][-1]['stall_s'])}" for row in series)
    cost = ", ".join(
        f"{row['label']} {percent(row['points'][-1]['extra_cost_pct'])}" for row in series
    )
    alt = (
        f"Two charts on the real model, on the conference task, with {hero['seedCount']} seeds per "
        f"point. Mean stall time with five coordinators killed: {stall}. Mean extra cost against "
        f"the same workflow with none killed: {cost}. {' '.join(notes)}"
    )
    return picture(width, height, ink, alt)


def pill(words: str, fill: str, width: int) -> str:
    ink = Ink()
    ink.raw(f'<rect width="{width}" height="26" rx="13" fill="{fill}"/>')
    ink.text(words, width / 2, 18, 14.5, 700, "#ffffff", "middle")
    return picture(width, 26, ink, words)


PILLS = {
    "verdict-ahead.svg": ("Ahead", "#15805a", 66),
    "verdict-ahead-per-crash.svg": ("Ahead per crash", "#15805a", 130),
    "verdict-tie.svg": ("Tie", "#5b6b82", 46),
    "verdict-comparable.svg": ("Comparable", "#5b6b82", 104),
    "verdict-loss.svg": ("Loss", "#d13b30", 54),
}


def main() -> None:
    run = load_run()
    OUT.mkdir(parents=True, exist_ok=True)
    pictures = {
        "hero.svg": hero(run, HERO_WIDE),
        "hero-phone.svg": hero(run, HERO_PHONE),
        "takeover.svg": takeover(run, TAKEOVER_WIDE),
        "takeover-phone.svg": takeover(run, TAKEOVER_PHONE),
        "terminal.svg": terminal(run, wide=True),
        "terminal-phone.svg": terminal(run, wide=False),
        "tiles.svg": tiles(run, wide=True),
        "tiles-phone.svg": tiles(run, wide=False),
        "scoreboard.svg": scoreboard(run, wide=True),
        "scoreboard-phone.svg": scoreboard(run, wide=False),
        "evidence.svg": evidence(run, wide=True),
        "evidence-phone.svg": evidence(run, wide=False),
        **{name: pill(*details) for name, details in PILLS.items()},
    }
    pictures |= {
        name.replace(".svg", "-still.svg"): svg.replace(NO_MOTION, STILL)
        for name, svg in pictures.items()
        if NO_MOTION in svg
    }
    for name, svg in pictures.items():
        path = OUT / name
        path.write_text(svg, encoding="utf-8", newline="\n")
        print(path.relative_to(ROOT_DIR).as_posix(), path.stat().st_size)


if __name__ == "__main__":
    main()
