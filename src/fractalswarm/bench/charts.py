"""The hero chart (spec §15.5), written as PNG for the README and JSON for the UI.

Layout, one task per chart, one line per workflow, x = coordinators killed (0, 1, 3, 5):
- top row, the claim: stall time (s) and extra cost vs C0 (%);
- bottom row, the honest context: completion rate, validity rate, coordination tokens.

Each point is the mean over seeds; the whisker spans the lowest and highest seed. Color
follows the workflow (fixed slot per name) and every line also has its own marker and dash
pattern, so no series depends on color alone. Axes are honest: rates run 0-100%, stall time
and tokens start at 0, and extra cost always shows the 0% line.
"""

import json
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

X_TICKS = (0, 1, 3, 5)
# Colorblind-validated categorical slots, in fixed order (light surface).
PALETTE = ("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948")
MARKERS = ("o", "s", "^", "D", "v", "P", "X", "*")
DASHES = ("-", "--", "-.", ":", (0, (5, 1, 1, 1)), (0, (3, 1)), (0, (1, 1)), (0, (8, 2)))
# Fixed slots, so a workflow keeps its color whatever else is plotted.
KNOWN_WORKFLOWS = ("swarm", "central", "single", "pipeline", "langgraph")
RATES = ("completion_rate", "validity_rate")
INK, MUTED, GRID = "#1f1f1e", "#6b6a64", "#e4e3dd"

PANELS = (
    ("stall_s", "Stall time (s)", "no agent work in flight anywhere"),
    ("extra_cost_pct", "Extra cost vs C0 (%)", "same workflow, task and seed"),
    ("completion_rate", "Completion (%)", ""),
    ("validity_rate", "Validity (%)", ""),
    ("coordination_tokens", "Coordination tokens / run", "LLM tokens spent on coordination"),
)


def style_slot(workflow: str, order: list[str]) -> int:
    if workflow in KNOWN_WORKFLOWS:
        return KNOWN_WORKFLOWS.index(workflow)
    extras = [name for name in order if name not in KNOWN_WORKFLOWS]
    return (len(KNOWN_WORKFLOWS) + extras.index(workflow)) % len(PALETTE)


def _rate(values: list[Any]) -> float | None:
    known = [bool(v) for v in values if v is not None]
    return 100 * sum(known) / len(known) if known else None


def series(rows: list[dict[str, Any]], task: str) -> dict[str, Any]:
    """Per workflow and x: mean, min and max of each metric over seeds, plus the run dirs."""
    groups: dict[str, dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row["task"] == task:
            groups[row["workflow"]][int(row["coordinators_killed"])].append(row)
    out: dict[str, Any] = {}
    for workflow in sorted(groups):
        points = []
        for x in sorted(groups[workflow]):
            cell_rows = sorted(groups[workflow][x], key=lambda r: str(r["seed"]))
            point: dict[str, Any] = {
                "x": x,
                "profile": cell_rows[0]["profile"],
                "seeds": [str(r["seed"]) for r in cell_rows],
                "runs": [r["run_dir"] for r in cell_rows],
                "completion_rate": _rate([r["completed"] for r in cell_rows]),
                "validity_rate": _rate([r["valid"] for r in cell_rows]),
            }
            for key in ("stall_s", "extra_cost_pct", "coordination_tokens", "cost_usd"):
                values = [float(r[key]) for r in cell_rows if r.get(key) is not None]
                point[key] = mean(values) if values else None
                point[f"{key}_min"] = min(values) if values else None
                point[f"{key}_max"] = max(values) if values else None
            points.append(point)
        out[workflow] = points
    return out


def hero_chart(
    rows: list[dict[str, Any]], out_base: Path, *, task: str, title: str = ""
) -> tuple[Path, Path]:
    """Write ``<out_base>.png`` and ``<out_base>.json``; return both paths."""
    data = series(rows, task)
    order = sorted(data, key=lambda name: (style_slot(name, sorted(data)), name))
    out_base.parent.mkdir(parents=True, exist_ok=True)
    png, js = out_base.with_suffix(".png"), out_base.with_suffix(".json")
    payload = {
        "task": task,
        "title": title,
        "x_label": "Coordinators killed",
        "x": list(X_TICKS),
        "panels": [{"metric": m, "label": label, "note": note} for m, label, note in PANELS],
        "series": {
            workflow: {"color": PALETTE[style_slot(workflow, order)], "points": points}
            for workflow, points in data.items()
        },
    }
    js.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    plt.rcParams.update({"font.size": 10, "axes.edgecolor": MUTED, "text.color": INK})
    fig = plt.figure(figsize=(13, 8.2), dpi=150, facecolor="white")
    grid = fig.add_gridspec(2, 6, height_ratios=(1.35, 1), hspace=0.42, wspace=0.9, top=0.83)
    axes = [
        fig.add_subplot(grid[0, 0:3]),
        fig.add_subplot(grid[0, 3:6]),
        fig.add_subplot(grid[1, 0:2]),
        fig.add_subplot(grid[1, 2:4]),
        fig.add_subplot(grid[1, 4:6]),
    ]
    for ax, (metric, label, note) in zip(axes, PANELS, strict=True):
        _panel(ax, data, order, metric, label, note)

    handles, labels = axes[0].get_legend_handles_labels()
    if handles:
        fig.legend(
            handles,
            labels,
            loc="upper center",
            ncol=len(labels),
            frameon=False,
            bbox_to_anchor=(0.5, 0.965),
        )
    heading = f"{title} — {task}" if title else task
    fig.suptitle(
        f"{heading}: stall time and extra cost vs coordinators killed",
        x=0.5,
        y=0.995,
        fontsize=13,
        fontweight="bold",
    )
    fig.text(
        0.5,
        0.012,
        "Points: mean over seeds; whiskers: min-max; rate points are nudged sideways so equal "
        "values stay visible.\nSame crashes at the same progress points "
        "for every workflow; baselines restart 5 s after each crash (best case).",
        ha="center",
        color=MUTED,
        fontsize=8.5,
    )
    fig.savefig(png, facecolor="white", bbox_inches="tight")
    plt.close(fig)
    return png, js


def _panel(ax, data, order, metric: str, label: str, note: str) -> None:
    ax.set_facecolor("white")
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_xticks(X_TICKS)
    ax.set_xlim(-0.4, 5.4)
    ax.set_xlabel("Coordinators killed", color=MUTED)
    pad = 16 if note else 6
    ax.set_title(label, loc="left", fontsize=11, fontweight="bold", color=INK, pad=pad)
    if note:
        ax.text(0, 1.015, note, transform=ax.transAxes, fontsize=8, color=MUTED, va="bottom")
    plotted: list[float] = []
    for workflow in order:
        slot = style_slot(workflow, order)
        points = [p for p in data[workflow] if p.get(metric) is not None]
        if not points:
            continue
        # Rates often coincide (everyone at 100%): dodge each series a little so none hides.
        dodge = (order.index(workflow) - (len(order) - 1) / 2) * 0.09 if metric in RATES else 0
        xs = [p["x"] + dodge for p in points]
        ys = [p[metric] for p in points]
        plotted += ys
        ax.plot(
            xs,
            ys,
            color=PALETTE[slot],
            linestyle=DASHES[slot],
            marker=MARKERS[slot],
            markersize=7,
            linewidth=2,
            markeredgecolor="white",
            markeredgewidth=1,
            label=workflow,
            zorder=3 + len(order) - order.index(workflow),  # the first slot on top
        )
        if f"{metric}_min" in points[0]:
            lows = [p[metric] - p[f"{metric}_min"] for p in points]
            highs = [p[f"{metric}_max"] - p[metric] for p in points]
            ax.errorbar(
                xs, ys, yerr=[lows, highs], fmt="none", ecolor=PALETTE[slot], alpha=0.6, zorder=2
            )
            plotted += [p[f"{metric}_min"] for p in points] + [p[f"{metric}_max"] for p in points]
    if metric in RATES:
        ax.set_ylim(0, 105)
    elif metric == "extra_cost_pct":
        ax.axhline(0, color=MUTED, linewidth=1, zorder=1)
        low = min([0.0, *plotted])
        high = max([10.0, *plotted])
        pad = (high - low) * 0.08
        ax.set_ylim(low - (pad if low < 0 else 0), high + pad)
    else:
        ax.set_ylim(0, max([1.0, *plotted]) * 1.1)
    if not plotted:
        ax.text(0.5, 0.5, "no data", transform=ax.transAxes, ha="center", color=MUTED)
