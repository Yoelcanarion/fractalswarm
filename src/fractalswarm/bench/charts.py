"""The hero chart (spec §15.5), written as PNG for the README and JSON for the UI.

Layout, one task per chart, one line per workflow, x = coordinators killed (0, 1, 3, 5):
- top row, the claim: stall time (s) and extra cost vs C0 (%);
- bottom row, the honest context: completion rate, validity rate, coordination tokens.

Each point is the mean over seeds; the whisker spans the lowest and highest seed. Color
follows the workflow (fixed slot per name) and every line also has its own marker and dash
pattern, so no series depends on color alone. Axes are honest: rates run 0-100%, stall time
and tokens start at 0, and extra cost always shows the 0% line.

The scaling chart (``scaling_chart``, the agents axis of ``bench/scaling.py``) is a row of
three panels, makespan, cost and stall against total agents on a log2 axis, drawn the same way.

The recovery chart (``recovery_chart``) draws the recovery metrics of ``bench/recovery.py`` the
same way, against the coordinators killed or against one sweep axis (a knob, or the agents).
The regime chart (``regime_chart``) draws the swarm's locality against each rival at every
regime point of ``bench/verdicts.py``, which is also where ``honesty.json`` is written.
"""

import json
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402

from fractalswarm.bench.verdicts import DECIDING_TASK, parse_knobs  # noqa: E402

X_TICKS = (0, 1, 3, 5)
# Colorblind-validated categorical slots, in fixed order (light surface).
PALETTE = ("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948")
MARKERS = ("o", "s", "^", "D", "v", "P", "X", "*")
DASHES = ("-", "--", "-.", ":", (0, (5, 1, 1, 1)), (0, (3, 1)), (0, (1, 1)), (0, (8, 2)))
# Fixed slots, so a workflow keeps its color whatever else is plotted.
KNOWN_WORKFLOWS = (
    "swarm",
    "central",
    "single",
    "pipeline",
    "langgraph",
    "durable-max",
    "durable",
)
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


# -- the scaling chart -----------------------------------------------------------------------

SCALING_PANELS = (
    ("makespan_s", "Makespan (s)", "run start to run end"),
    ("cost_usd", "Cost per run ($)", "all LLM calls of the run"),
    ("stall_s", "Stall time (s)", "no agent work in flight anywhere"),
)
SCALING_METRICS = tuple(metric for metric, _, _ in SCALING_PANELS)
DODGE_OCTAVES = 0.08  # sideways nudge between workflows, in log2 units


def scaling_series(rows: list[dict[str, Any]], task: str, profile: str = "C0") -> dict[str, Any]:
    """Per workflow and total agents: mean, min and max of each metric over seeds, plus the
    run dirs. Only the rows of the agents axis, at one chaos profile."""
    groups: dict[str, dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row["task"] == task and row["profile"] == profile and row.get("agents") is not None:
            groups[row["workflow"]][int(row["agents"])].append(row)
    out: dict[str, Any] = {}
    for workflow in sorted(groups):
        points = []
        for x in sorted(groups[workflow]):
            cell_rows = sorted(groups[workflow][x], key=lambda r: str(r["seed"]))
            point: dict[str, Any] = {
                "x": x,
                "seeds": [str(r["seed"]) for r in cell_rows],
                "runs": [r["run_dir"] for r in cell_rows],
                "completion_rate": _rate([r["completed"] for r in cell_rows]),
                "validity_rate": _rate([r["valid"] for r in cell_rows]),
            }
            for key in SCALING_METRICS:
                values = [float(r[key]) for r in cell_rows if r.get(key) is not None]
                point[key] = mean(values) if values else None
                point[f"{key}_min"] = min(values) if values else None
                point[f"{key}_max"] = max(values) if values else None
            points.append(point)
        out[workflow] = points
    return out


def scaling_chart(
    rows: list[dict[str, Any]],
    out_base: Path,
    *,
    task: str,
    title: str = "",
    profile: str = "C0",
    limit: int | None = None,
) -> tuple[Path, Path]:
    """Write ``<out_base>.png`` and ``<out_base>.json``; return both paths. ``limit`` is the
    most agent contracts the task can have in flight (``TaskDef.parallelism``): a dotted line
    marks it, because agents beyond it have nothing to do."""
    data = scaling_series(rows, task, profile)
    order = sorted(data, key=lambda name: (style_slot(name, sorted(data)), name))
    ticks = sorted({point["x"] for points in data.values() for point in points})
    out_base.parent.mkdir(parents=True, exist_ok=True)
    png, js = out_base.with_suffix(".png"), out_base.with_suffix(".json")
    payload = {
        "task": task,
        "title": title,
        "profile": profile,
        "x_label": "Total agents",
        "x": ticks,
        "limit": limit,
        "panels": [{"metric": m, "label": lab, "note": note} for m, lab, note in SCALING_PANELS],
        "series": {
            workflow: {"color": PALETTE[style_slot(workflow, order)], "points": points}
            for workflow, points in data.items()
        },
    }
    js.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    plt.rcParams.update({"font.size": 10, "axes.edgecolor": MUTED, "text.color": INK})
    fig, axes = plt.subplots(1, 3, figsize=(13, 5.0), dpi=150, facecolor="white")
    fig.subplots_adjust(top=0.74, bottom=0.2, left=0.06, right=0.985, wspace=0.28)
    for ax, (metric, label, note) in zip(axes, SCALING_PANELS, strict=True):
        _scaling_panel(ax, data, order, ticks, limit, metric, label, note)

    handles, labels = axes[0].get_legend_handles_labels()
    if handles:
        fig.legend(
            handles,
            labels,
            loc="upper center",
            ncol=len(labels),
            frameon=False,
            bbox_to_anchor=(0.5, 0.925),
        )
    heading = f"{title} — {task}" if title else task
    fig.suptitle(
        f"{heading}: makespan, cost and stall vs total agents ({profile})",
        x=0.5,
        y=0.985,
        fontsize=13,
        fontweight="bold",
    )
    footnote = (
        "Points: mean over seeds; whiskers: min-max; points are nudged sideways so equal "
        "values stay visible."
    )
    if limit is not None:
        footnote += (
            f"\nDotted line: the task keeps at most {limit} agent contracts in flight, "
            "so agents beyond it have nothing to do."
        )
    fig.text(0.5, 0.012, footnote, ha="center", color=MUTED, fontsize=8.5)
    fig.savefig(png, facecolor="white", bbox_inches="tight")
    plt.close(fig)
    return png, js


def _scaling_panel(ax, data, order, ticks, limit, metric: str, label: str, note: str) -> None:
    ax.set_facecolor("white")
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_xscale("log", base=2)
    if ticks:
        ax.set_xticks(ticks, labels=[str(tick) for tick in ticks])
        ax.set_xlim(min(ticks) / 1.4, max(ticks) * 1.4)
    ax.minorticks_off()
    ax.set_xlabel("Total agents", color=MUTED)
    ax.set_title(label, loc="left", fontsize=11, fontweight="bold", color=INK, pad=16)
    ax.text(0, 1.015, note, transform=ax.transAxes, fontsize=8, color=MUTED, va="bottom")
    if limit is not None and ticks and min(ticks) <= limit <= max(ticks):
        ax.axvline(limit, color=MUTED, linestyle=":", linewidth=1.2, zorder=1)
    plotted: list[float] = []
    for workflow in order:
        slot = style_slot(workflow, order)
        points = [p for p in data[workflow] if p.get(metric) is not None]
        if not points:
            continue
        nudge = (order.index(workflow) - (len(order) - 1) / 2) * DODGE_OCTAVES
        xs = [p["x"] * 2**nudge for p in points]
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
        lows = [p[metric] - p[f"{metric}_min"] for p in points]
        highs = [p[f"{metric}_max"] - p[metric] for p in points]
        ax.errorbar(
            xs, ys, yerr=[lows, highs], fmt="none", ecolor=PALETTE[slot], alpha=0.6, zorder=2
        )
        plotted += [p[f"{metric}_min"] for p in points] + [p[f"{metric}_max"] for p in points]
    top = max(plotted) * 1.1 if plotted and max(plotted) > 0 else 1.0
    ax.set_ylim(0, top)
    ax.yaxis.set_major_locator(MaxNLocator(nbins=5, steps=[1, 2, 5, 10]))  # round steps only
    if metric == "cost_usd":
        ax.yaxis.set_major_formatter(lambda value, _: f"${value:.2f}")
    if limit is not None and ticks and min(ticks) <= limit <= max(ticks) and metric == "makespan_s":
        ax.text(
            limit * 1.04,
            top,
            f"at most {limit} contracts in flight",
            rotation=90,
            va="top",
            ha="left",
            fontsize=8,
            color=MUTED,
        )
    if not plotted:
        ax.text(0.5, 0.5, "no data", transform=ax.transAxes, ha="center", color=MUTED)


# -- the recovery chart ----------------------------------------------------------------------

RECOVERY_PANELS = (
    ("ttr_own_mean_s", "Time to recover (s)", "crash to the heir or the restart"),
    (
        "cdt_s",
        "Coordinator-dependency time (contract-s)",
        "work that waited for a dead coordinator",
    ),
    ("blast_sessions_mean_pct", "Blast radius (% of sessions)", "held up by one crash"),
    ("idle_agent_s", "Idle agent-seconds", "free agents whose session was waiting"),
    ("preserved_pct", "Preserved work (%)", "calls in flight at a crash that were used"),
    ("dup_usd", "Duplicated spend ($)", "work paid twice, by every cause"),
)
RECOVERY_METRICS = tuple(metric for metric, _, _ in RECOVERY_PANELS)
CHAOS_AXIS = "coordinators_killed"
AXIS_LABELS = {
    CHAOS_AXIS: "Coordinators killed",
    "agents": "Total agents",
    "recovery_ms": "Detection and restart time (s), the same for both",
    "rival_recovery_ms": "Supervisors' detection and restart (s); the swarm keeps 5 s",
    "rival_restart_ms": "Supervisors' extra restart time (s), on top of 5 s detection",
    "agent_latency_scale": "Agents' latency scale",
}
SECONDS_AXES = ("recovery_ms", "rival_recovery_ms", "rival_restart_ms")


def axis_value(row: dict[str, Any], axis: str) -> float | None:
    """Where a result row sits on an axis: the coordinators killed (rows with no sweep setting
    only), the agents, or a knob's setting. ``None`` if the row is not on that axis."""
    knobs = parse_knobs(row.get("knobs"))
    if axis == CHAOS_AXIS:
        return None if knobs or row.get("agents") is not None else int(row[CHAOS_AXIS])
    if axis == "agents":
        return None if row.get("agents") is None else int(row["agents"])
    return knobs.get(axis)


def axis_label(axis: str, x: float) -> str:
    if axis in SECONDS_AXES:
        return f"{x / 1000:g}"
    if axis == "agent_latency_scale":
        return f"{x:g}x"
    return f"{x:g}"


def axis_series(
    rows: list[dict[str, Any]], task: str, axis: str = CHAOS_AXIS, profile: str | None = None
) -> dict[str, Any]:
    """Per workflow and axis value: mean, min and max of each recovery metric over seeds, plus
    the run dirs. A sweep axis is read at one chaos ``profile``."""
    groups: dict[str, dict[float, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        x = axis_value(row, axis)
        if row["task"] != task or x is None:
            continue
        if axis == CHAOS_AXIS or row["profile"] == profile:
            groups[row["workflow"]][x].append(row)
    out: dict[str, Any] = {}
    for workflow in sorted(groups):
        points = []
        for x in sorted(groups[workflow]):
            cell_rows = sorted(groups[workflow][x], key=lambda r: str(r["seed"]))
            point: dict[str, Any] = {
                "x": x,
                "seeds": [str(r["seed"]) for r in cell_rows],
                "runs": [r["run_dir"] for r in cell_rows],
            }
            for key in RECOVERY_METRICS:
                values = [float(r[key]) for r in cell_rows if r.get(key) is not None]
                point[key] = mean(values) if values else None
                point[f"{key}_min"] = min(values) if values else None
                point[f"{key}_max"] = max(values) if values else None
            points.append(point)
        out[workflow] = points
    return out


def recovery_chart(
    rows: list[dict[str, Any]],
    out_base: Path,
    *,
    task: str,
    title: str = "",
    axis: str = CHAOS_AXIS,
    profile: str = "C3",
) -> tuple[Path, Path]:
    """Write ``<out_base>.png`` and ``<out_base>.json``; return both paths. Six panels, one line
    per workflow: against the coordinators killed, or against a sweep ``axis`` at ``profile``."""
    data = axis_series(rows, task, axis, profile)
    order = sorted(data, key=lambda name: (style_slot(name, sorted(data)), name))
    ticks = sorted({point["x"] for points in data.values() for point in points})
    out_base.parent.mkdir(parents=True, exist_ok=True)
    png, js = out_base.with_suffix(".png"), out_base.with_suffix(".json")
    payload = {
        "task": task,
        "title": title,
        "axis": axis,
        "profile": None if axis == CHAOS_AXIS else profile,
        "x_label": AXIS_LABELS.get(axis, axis),
        "x": ticks,
        "x_labels": [axis_label(axis, x) for x in ticks],
        "panels": [{"metric": m, "label": lab, "note": note} for m, lab, note in RECOVERY_PANELS],
        "series": {
            workflow: {"color": PALETTE[style_slot(workflow, order)], "points": points}
            for workflow, points in data.items()
        },
    }
    js.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    plt.rcParams.update({"font.size": 10, "axes.edgecolor": MUTED, "text.color": INK})
    fig, axes = plt.subplots(2, 3, figsize=(13, 7.8), dpi=150, facecolor="white")
    fig.subplots_adjust(top=0.84, bottom=0.12, left=0.06, right=0.985, wspace=0.28, hspace=0.62)
    for ax, (metric, label, note) in zip(axes.flat, RECOVERY_PANELS, strict=True):
        _recovery_panel(ax, data, order, ticks, axis, metric, label, note)
    handles, labels = axes.flat[0].get_legend_handles_labels()
    if handles:
        fig.legend(
            handles,
            labels,
            loc="upper center",
            ncol=len(labels),
            frameon=False,
            bbox_to_anchor=(0.5, 0.945),
        )
    heading = f"{title} — {task}" if title else task
    where = "" if axis == CHAOS_AXIS else f" at {profile}"
    fig.suptitle(
        f"{heading}: recovery metrics vs {AXIS_LABELS.get(axis, axis).lower()}{where}",
        x=0.5,
        y=0.995,
        fontsize=13,
        fontweight="bold",
    )
    fig.text(
        0.5,
        0.012,
        "Points: mean over seeds; whiskers: min-max. Per-crash figures are means over a run's "
        "crashes; idle and spend are per run.\nThe same crashes at the same progress points "
        "for every workflow.",
        ha="center",
        color=MUTED,
        fontsize=8.5,
    )
    fig.savefig(png, facecolor="white", bbox_inches="tight")
    plt.close(fig)
    return png, js


def _recovery_panel(ax, data, order, ticks, axis: str, metric: str, label: str, note: str) -> None:
    ax.set_facecolor("white")
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    place = {x: i for i, x in enumerate(ticks)}  # a category per setting: the grids are uneven
    ax.set_xticks(list(place.values()), labels=[axis_label(axis, x) for x in ticks])
    ax.set_xlim(-0.4, max(len(ticks) - 1, 0) + 0.4)
    ax.set_xlabel(AXIS_LABELS.get(axis, axis), color=MUTED, fontsize=8.5)
    ax.set_title(label, loc="left", fontsize=10.5, fontweight="bold", color=INK, pad=16)
    ax.text(0, 1.015, note, transform=ax.transAxes, fontsize=8, color=MUTED, va="bottom")
    plotted: list[float] = []
    for workflow in order:
        slot = style_slot(workflow, order)
        points = [p for p in data[workflow] if p.get(metric) is not None]
        if not points:
            continue
        dodge = (order.index(workflow) - (len(order) - 1) / 2) * 0.05
        xs = [place[p["x"]] + dodge for p in points]
        ys = [p[metric] for p in points]
        plotted += ys
        ax.plot(
            xs,
            ys,
            color=PALETTE[slot],
            linestyle=DASHES[slot],
            marker=MARKERS[slot],
            markersize=6.5,
            linewidth=2,
            markeredgecolor="white",
            markeredgewidth=1,
            label=workflow,
            zorder=3 + len(order) - order.index(workflow),
        )
        lows = [p[metric] - p[f"{metric}_min"] for p in points]
        highs = [p[f"{metric}_max"] - p[metric] for p in points]
        ax.errorbar(
            xs, ys, yerr=[lows, highs], fmt="none", ecolor=PALETTE[slot], alpha=0.6, zorder=2
        )
        plotted += [p[f"{metric}_min"] for p in points] + [p[f"{metric}_max"] for p in points]
    if metric == "preserved_pct":
        ax.set_ylim(0, 105)
    else:
        ax.set_ylim(0, max(plotted) * 1.1 if plotted and max(plotted) > 0 else 1.0)
    if metric == "dup_usd":
        ax.yaxis.set_major_formatter(lambda value, _: f"${value:.2f}")
    ax.yaxis.set_major_locator(MaxNLocator(nbins=5, steps=[1, 2, 5, 10]))
    if not plotted:
        ax.text(0.5, 0.5, "no data", transform=ax.transAxes, ha="center", color=MUTED)


# -- the regime chart ------------------------------------------------------------------------

REGIME_ROWS = (
    ("cdt_ratio", "CDT, swarm / rival", "H4a"),
    ("blast_ratio", "blast radius, swarm / rival", "H4b"),
)
REGIME_COLUMNS = (
    "gate",
    "recovery_ms",
    "rival_restart_ms",
    "rival_recovery_ms",
    "agent_latency_scale",
    "agents",
)
REGIME_TITLES = {
    "gate": "chaos profile",
    "recovery_ms": "detection = restart (s)",
    "rival_restart_ms": "rival restart, extra (s)",
    "rival_recovery_ms": "rival detection (s)",
    "agent_latency_scale": "agent latency",
    "agents": "total agents",
}
LOCALITY_MARKS = {
    "holds": ("o", True),
    "ties": ("o", False),
    "fails": ("X", True),
    "n/a": ("x", True),
}
LOCALITY_RATIO = 0.5  # PREREG §3: the ratio at or under which the swarm wins on locality


def regime_series(regimes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The regime map as columns: for each axis present, its settings in order and, per rival
    and task, the ratios and the locality at each setting (the gate's settings are the chaos
    profiles)."""
    columns = []
    for name in REGIME_COLUMNS:
        mine = [r for r in regimes if (r["axis"] or "gate") == name]
        if not mine:
            continue

        def setting(r: dict[str, Any], name: str = name) -> Any:
            return r["profile"] if name == "gate" else r["value"]

        settings = sorted({setting(r) for r in mine}, key=lambda v: (v is None, v))
        series: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in sorted(mine, key=lambda r: (r["rival"], r["task"], settings.index(setting(r)))):
            series[f"{r['rival']}|{r['task']}"].append(
                {
                    "x": setting(r),
                    "plausible": r["plausible"],
                    "locality": r["locality"],
                    "cdt_ratio": r["cdt_ratio"],
                    "blast_ratio": r["blast_ratio"],
                    "idle_ratio": r["idle_ratio"],
                }
            )
        columns.append({"axis": name, "x": settings, "series": dict(series)})
    return columns


def regime_chart(honesty: dict[str, Any], out_base: Path, *, title: str = "") -> tuple[Path, Path]:
    """Write ``<out_base>.png`` and ``<out_base>.json`` from a verdicts result (``Honesty`` as a
    dict): the swarm's locality against each rival at every regime point. A ratio at or under 0.5
    is a win for the swarm; a filled marker is a point where locality holds, a hollow one where it
    ties and a cross where it fails; the shading is the plausible region."""
    columns = regime_series(honesty["regimes"])
    out_base.parent.mkdir(parents=True, exist_ok=True)
    png, js = out_base.with_suffix(".png"), out_base.with_suffix(".json")
    outcome = honesty["outcome"]
    prereg = honesty.get("prereg") or {}
    payload = {
        "title": title,
        "outcome": outcome["label"],
        "against": outcome["against"],
        "prereg": prereg,
        "threshold": LOCALITY_RATIO,
        "rows": [{"metric": m, "label": lab, "hypothesis": h} for m, lab, h in REGIME_ROWS],
        "columns": columns,
    }
    js.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    plt.rcParams.update({"font.size": 10, "axes.edgecolor": MUTED, "text.color": INK})
    count = max(len(columns), 1)
    fig, axes = plt.subplots(
        len(REGIME_ROWS),
        count,
        figsize=(max(3.1 * count, 6.4), 7.0),
        dpi=150,
        facecolor="white",
        squeeze=False,
    )
    fig.subplots_adjust(top=0.8, bottom=0.14, left=0.07, right=0.99, wspace=0.28, hspace=0.5)
    rivals = sorted({key.split("|")[0] for c in columns for key in c["series"]})
    for r, (metric, label, _) in enumerate(REGIME_ROWS):
        for c in range(count):
            column = columns[c] if c < len(columns) else None
            _regime_panel(axes[r][c], column, rivals, metric, label if c == 0 else "", r == 0)
    handles = [
        plt.Line2D(
            [],
            [],
            color=PALETTE[style_slot(rival, rivals)],
            linestyle=DASHES[style_slot(rival, rivals)],
            marker=MARKERS[style_slot(rival, rivals)],
            label=f"vs {rival}",
        )
        for rival in rivals
    ]
    handles += [
        plt.Line2D([], [], color=MUTED, marker="o", linestyle="", label="locality holds"),
        plt.Line2D(
            [], [], color=MUTED, marker="o", markerfacecolor="white", linestyle="", label="ties"
        ),
        plt.Line2D([], [], color=MUTED, marker="X", linestyle="", label="fails"),
    ]
    fig.legend(
        handles=handles,
        loc="upper center",
        ncol=len(handles),
        frameon=False,
        bbox_to_anchor=(0.5, 0.925),
        fontsize=8.5,
    )
    heading = f"{title} — " if title else ""
    fig.suptitle(
        f"{heading}where the swarm's recovery stays local "
        f"(outcome {payload['outcome'].upper()}, read against {payload['against']})",
        x=0.5,
        y=0.99,
        fontsize=12.5,
        fontweight="bold",
    )
    fig.text(
        0.5,
        0.012,
        "A ratio at or under 0.5 (dotted) is a win for the swarm under bench/PREREG.md; 1 "
        "(solid) is equal. Shaded: the plausible region.\n"
        "Solid lines: T2; dashed: T1. The per-process view is in honesty.json, not here."
        + (f" Rules: {prereg['path']}, sha {prereg['sha']}." if prereg.get("sha") else ""),
        ha="center",
        color=MUTED,
        fontsize=8,
    )
    fig.savefig(png, facecolor="white", bbox_inches="tight")
    plt.close(fig)
    return png, js


def _regime_panel(ax, column, rivals, metric: str, label: str, top_row: bool) -> None:
    ax.set_facecolor("white")
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    if label:
        ax.set_ylabel(label, color=MUTED, fontsize=8)
    if column is None:
        ax.axis("off")
        return
    axis, settings = column["axis"], column["x"]
    place = {x: i for i, x in enumerate(settings)}
    names = [str(x) if axis == "gate" else axis_label(axis, x) for x in settings]
    ax.set_xticks(list(place.values()), labels=names)
    ax.set_xlim(-0.5, len(settings) - 0.5)
    if top_row:
        ax.set_title(
            REGIME_TITLES.get(axis, axis),
            loc="left",
            fontsize=8.5,
            fontweight="bold",
            color=INK,
            pad=8,
        )
    ax.axhline(1.0, color=MUTED, linewidth=1, zorder=1)
    ax.axhline(LOCALITY_RATIO, color=MUTED, linewidth=1, linestyle=":", zorder=1)
    plausible = {p["x"] for points in column["series"].values() for p in points if p["plausible"]}
    for x in sorted(plausible):
        ax.axvspan(place[x] - 0.5, place[x] + 0.5, color=GRID, alpha=0.55, zorder=0)
    top = 1.2
    for key, points in column["series"].items():
        rival, task = key.split("|")
        slot = style_slot(rival, rivals)
        known = [p for p in points if p.get(metric) is not None]
        if not known:
            continue
        top = max(top, *(p[metric] for p in known))
        ax.plot(
            [place[p["x"]] for p in known],
            [p[metric] for p in known],
            color=PALETTE[slot],
            linestyle="-" if task == DECIDING_TASK else "--",
            linewidth=1.6,
            zorder=3,
        )
        for p in known:
            marker, filled = LOCALITY_MARKS[p["locality"]]
            ax.plot(
                place[p["x"]],
                p[metric],
                marker=marker,
                markersize=7,
                markerfacecolor=PALETTE[slot] if filled else "white",
                markeredgecolor=PALETTE[slot],
                markeredgewidth=1.4,
                zorder=4,
                linestyle="",
            )
    ax.set_ylim(0, top * 1.1)
    ax.yaxis.set_major_locator(MaxNLocator(nbins=5, steps=[1, 2, 5, 10]))
