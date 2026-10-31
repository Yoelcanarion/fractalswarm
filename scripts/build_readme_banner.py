"""Write the README's banners, ``docs/assets/banner-dark.svg`` and ``banner-light.svg``.

They hold no fact of their own. Who dies, who inherits and in what order are read from the log of
``demo/final``, and the last line from ``web/src/home/data/story.json``. The timing is the film's,
not the run's: the kills are evenly spaced so that a reader can follow them.

    uv run python scripts/build_readme_banner.py

CSS keyframes only: no script and no web font, because GitHub shows an SVG inside an <img>.
"""

import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
LOG = ROOT_DIR / "demo" / "final" / "events.jsonl"
STORY = ROOT_DIR / "web" / "src" / "home" / "data" / "story.json"
OUT = ROOT_DIR / "docs" / "assets"

LOOP = 15.0  # seconds
FIRST_KILL = 2.2
BETWEEN_KILLS = 1.8
END_AT = 11.4

TRACKS = {"o1": (760, 150), "o2": (920, 150), "o3": (1080, 150)}
SESSIONS = {
    "o1.1": (705, 238),
    "o1.2": (815, 238),
    "o2.1": (865, 238),
    "o2.2": (975, 238),
    "o3.1": (1025, 238),
    "o3.2": (1135, 238),
}
NODES = {"o0": (920, 62), **TRACKS, **SESSIONS}
EDGES = [
    ("o0", "o1"),
    ("o0", "o2"),
    ("o0", "o3"),
    ("o1", "o1.1"),
    ("o1", "o1.2"),
    ("o2", "o2.1"),
    ("o2", "o2.2"),
    ("o3", "o3.1"),
    ("o3", "o3.2"),
]

COLORS = {
    "dark": {
        "bg": "#111110",
        "text": "#f3f2ee",
        "muted": "#a3a29c",
        "faint": "#2f2f2c",
        "edge": "#54534e",
        "node": "#1f2a3a",
        "ring": "#6aa7ff",
        "dead": "#ff6b5e",
        "ok": "#5fd7a1",
        "heir": "#ffc964",
    },
    "light": {
        "bg": "#fcfcfb",
        "text": "#191917",
        "muted": "#5f5e58",
        "faint": "#dddcd5",
        "edge": "#b0afa8",
        "node": "#e4edfb",
        "ring": "#2563c9",
        "dead": "#c9352a",
        "ok": "#17855a",
        "heir": "#a36a00",
    },
}


def recorded() -> tuple[list[tuple[str, str]], list[str], str]:
    """The kills with each one's first heir, the root's owners in order, and the closing line."""
    events = [json.loads(line) for line in LOG.read_text(encoding="utf-8").splitlines()]
    kills: list[tuple[str, str]] = []
    roots = ["o0"]
    for event in events:
        payload = event["payload"]
        if event["type"] == "chaos.injected" and payload.get("fault") == "kill_coordinator":
            target = payload["target"]
            remaps = [
                other["payload"]
                for other in events
                if other["type"] == "ownership.remapped"
                and other["seq"] > event["seq"]
                and other["payload"]["previous"] == target
            ]
            kills.append((target, remaps[0]["owner"]))
            roots += [remap["owner"] for remap in remaps if remap["key"] == "root"]
    finish = json.loads(STORY.read_text(encoding="utf-8"))["finish"]
    line = (
        f"{finish['placed']} of {finish['expected']} talks placed · "
        f"{finish['hardViolations']} hard violations · replay MATCH"
    )
    return kills, roots, line


def pct(at: float) -> str:
    return f"{100 * at / LOOP:.2f}%"


def keyframes(name: str, stops: list[tuple[float, str]]) -> str:
    body = " ".join(f"{pct(at)}{{{css}}}" for at, css in stops)
    return f"@keyframes {name}{{{body}}}"


def looped(selector: str, name: str, stops: list[tuple[float, str]]) -> str:
    return keyframes(name, stops) + f"{selector}{{animation:{name} {LOOP}s linear infinite}}"


def safe(name: str) -> str:
    return name.replace(".", "_")


def build(theme: str, kills: list[tuple[str, str]], roots: list[str], closing: str) -> str:
    c = COLORS[theme]
    kill_at = [FIRST_KILL + index * BETWEEN_KILLS for index in range(len(kills))]
    back = LOOP - 0.6  # everything returns together at the end of the loop
    css = [
        "text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"
        f"fill:{c['text']}}}",
        f".edge{{fill:none;stroke:{c['edge']};stroke-width:1.6}}",
        f".pulse{{fill:none;stroke:{c['ring']};stroke-width:2;stroke-dasharray:6 90;"
        "animation:flow 2.4s linear infinite}",
        "@keyframes flow{to{stroke-dashoffset:-96}}",
        f".node{{fill:{c['node']};stroke:{c['ring']};stroke-width:2}}",
        f".agent{{fill:{c['ring']};opacity:.75}}",
        f".pass{{fill:none;stroke:{c['heir']};stroke-width:2.4;stroke-linecap:round}}",
        f".root{{font-size:13px;font-weight:700;text-anchor:middle;fill:{c['heir']}}}",
    ]
    shapes: list[str] = []

    for a, b in EDGES:
        (x1, y1), (x2, y2) = NODES[a], NODES[b]
        middle = (y1 + y2) / 2
        d = f"M{x1} {y1}C{x1} {middle} {x2} {middle} {x2} {y2}"
        shapes.append(
            f'<g class="e{safe(a + b)}"><path class="edge" d="{d}"/>'
            f'<path class="pulse" d="{d}"/></g>'
        )
    for (dead, _), at in zip(kills, kill_at, strict=True):
        for a, b in EDGES:
            if dead in (a, b):
                name = safe(a + b)
                css.append(
                    looped(
                        f".e{name}",
                        f"fade{name}",
                        [
                            (0, "opacity:1"),
                            (at, "opacity:1"),
                            (at + 0.5, "opacity:.14"),
                            (back, "opacity:.14"),
                            (LOOP, "opacity:1"),
                        ],
                    )
                )

    for x, y in SESSIONS.values():
        for dx in (-9, 9):
            shapes.append(f'<circle class="agent" cx="{x + dx}" cy="{y + 42}" r="5.5"/>')
            shapes.append(
                f'<line class="edge" x1="{x}" y1="{y + 16}" x2="{x + dx}" y2="{y + 36}" '
                'opacity=".5"/>'
            )
    for name, (x, y) in NODES.items():
        radius = 22 if name == "o0" else 18 if name in TRACKS else 15
        shapes.append(f'<circle class="node n{safe(name)}" cx="{x}" cy="{y}" r="{radius}"/>')
        shapes.append(
            f'<path class="x{safe(name)}" d="M{x - 7} {y - 7}l14 14m0-14l-14 14" '
            f'stroke="{c["dead"]}" stroke-width="3" stroke-linecap="round" fill="none" '
            'opacity="0"/>'
        )

    for index, ((dead, heir), at) in enumerate(zip(kills, kill_at, strict=True)):
        name = safe(dead)
        alive = f"fill:{c['node']};stroke:{c['ring']};opacity:1"
        gone = f"fill:{c['bg']};stroke:{c['dead']};opacity:.65"
        css.append(
            looped(
                f".n{name}",
                f"die{name}",
                [
                    (0, alive),
                    (at, alive),
                    (at + 0.15, f"fill:{c['dead']};stroke:{c['dead']};opacity:1"),
                    (at + 0.8, gone),
                    (back, gone),
                    (LOOP, alive),
                ],
            )
        )
        css.append(
            looped(
                f".x{name}",
                f"cross{name}",
                [
                    (0, "opacity:0"),
                    (at + 0.1, "opacity:0"),
                    (at + 0.3, "opacity:1"),
                    (back, "opacity:1"),
                    (LOOP, "opacity:0"),
                ],
            )
        )
        (x1, y1), (x2, y2) = NODES[dead], NODES[heir]
        lift = 30 + abs(x1 - x2) * 0.25
        d = f"M{x1} {y1}Q{(x1 + x2) / 2} {min(y1, y2) - lift} {x2} {y2}"
        length = 420
        css.append(
            f".p{index}{{stroke-dasharray:{length}}}"
            + looped(
                f".p{index}",
                f"pass{index}",
                [
                    (0, f"stroke-dashoffset:{length};opacity:0"),
                    (at + 0.5, f"stroke-dashoffset:{length};opacity:0"),
                    (at + 0.55, f"stroke-dashoffset:{length};opacity:1"),
                    (at + 1.1, "stroke-dashoffset:0;opacity:1"),
                    (at + 1.5, "stroke-dashoffset:0;opacity:0"),
                    (LOOP, "stroke-dashoffset:0;opacity:0"),
                ],
            )
        )
        shapes.append(f'<path class="pass p{index}" d="{d}"/>')

    # the word "root" moves with the role: the point of the design
    passes = [at + 1.1 for (dead, _), at in zip(kills, kill_at, strict=True) if dead in roots]
    for index, owner in enumerate(roots):
        x, y = NODES[owner]
        above = y - (32 if owner == "o0" else 28)
        start = 0 if index == 0 else passes[index - 1]
        stops = [(0, "opacity:1" if index == 0 else "opacity:0")]
        if index > 0:
            stops += [(start, "opacity:0"), (start + 0.2, "opacity:1")]
        if index + 1 < len(roots):
            stops += [(passes[index], "opacity:1"), (passes[index] + 0.1, "opacity:0")]
            stops += [(back, "opacity:0")]
        else:
            stops += [(back, "opacity:1")]
        stops += [(LOOP, "opacity:1" if index == 0 else "opacity:0")]
        css.append(looped(f".r{index}", f"root{index}", stops))
        shapes.append(f'<text class="root r{index}" x="{x}" y="{above}">root</text>')

    left, top, width = 705, 318, 430
    css.append(
        ".fill{transform-box:fill-box;transform-origin:left}"
        + looped(
            ".fill",
            "fill",
            [
                (0, "transform:scaleX(0)"),
                (0.6, "transform:scaleX(0)"),
                (END_AT, "transform:scaleX(1)"),
                (back, "transform:scaleX(1)"),
                (LOOP, "transform:scaleX(0)"),
            ],
        )
    )
    css.append(
        looped(
            ".done",
            "done",
            [
                (0, "opacity:0"),
                (END_AT, "opacity:0"),
                (END_AT + 0.4, "opacity:1"),
                (back, "opacity:1"),
                (LOOP, "opacity:0"),
            ],
        )
    )
    css.append(
        looped(
            ".going",
            "going",
            [
                (0, "opacity:1"),
                (END_AT, "opacity:1"),
                (END_AT + 0.3, "opacity:0"),
                (back, "opacity:0"),
                (LOOP, "opacity:1"),
            ],
        )
    )
    shapes.append(
        f'<rect x="{left}" y="{top}" width="{width}" height="6" rx="3" fill="{c["faint"]}"/>'
    )
    shapes.append(
        f'<rect class="fill" x="{left}" y="{top}" width="{width}" height="6" rx="3" '
        f'fill="{c["ok"]}"/>'
    )
    shapes.append(
        f'<text class="going" x="{left}" y="{top + 28}" font-size="15" '
        f'style="fill:{c["muted"]}">Five of ten coordinators crash, the root among them</text>'
    )
    shapes.append(
        f'<text class="done" x="{left}" y="{top + 28}" font-size="15" font-weight="600" '
        f'style="fill:{c["ok"]}">{closing}</text>'
    )

    words = (
        '<text x="64" y="134" font-size="64" font-weight="750" letter-spacing="-1.5">'
        "FractalSwarm</text>"
        '<text x="66" y="192" font-size="29" font-weight="600">Kill half the brains.</text>'
        '<text x="66" y="232" font-size="29" font-weight="600">It still finishes.</text>'
        f'<text x="66" y="284" font-size="17" style="fill:{c["muted"]}">'
        "Coordinators die mid-run, the root included.</text>"
        f'<text x="66" y="310" font-size="17" style="fill:{c["muted"]}">'
        "The survivors take over with no election.</text>"
    )
    still = (
        "@media (prefers-reduced-motion:reduce){*{animation:none!important}"
        ".done{opacity:1}.going{opacity:0}.fill{transform:scaleX(1)}}"
    )
    label = (
        "FractalSwarm. Kill half the brains. It still finishes. A tree of ten coordinators loses "
        "five of them, the root among them, each one handing its work to a survivor, and the "
        f"recorded run ends with {closing}."
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 380" width="1280" height="380" '
        f'role="img" aria-label="{label}">'
        f"<style>{''.join(css)}{still}</style>"
        f'<rect width="1280" height="380" rx="20" fill="{c["bg"]}"/>'
        f"{words}{''.join(shapes)}</svg>\n"
    )


def main() -> None:
    kills, roots, closing = recorded()
    OUT.mkdir(parents=True, exist_ok=True)
    for theme in COLORS:
        path = OUT / f"banner-{theme}.svg"
        path.write_text(build(theme, kills, roots, closing), encoding="utf-8", newline="\n")
        print(path.relative_to(ROOT_DIR), path.stat().st_size)
    print("kills", kills, "root", roots)


if __name__ == "__main__":
    main()
