"""The scaling sweep's agent axis (spec §15.6): the total-agents -> tree mapping, the matrix
axis, and central's squad handout when it has fewer squads than sessions."""

from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from fractalswarm.actors.orchestrator import _squad, orchestrator_init
from fractalswarm.bench.harness import Matrix
from fractalswarm.bench.profiles import profile
from fractalswarm.bench.registry import Cell
from fractalswarm.bench.scaling import tree_for
from fractalswarm.bench.workflows import t2_params, t2_spec

REPO = Path(__file__).resolve().parents[2]
BENCH = REPO / "bench"
SWEEP = [1, 2, 4, 8, 16]
DEFAULTS = ["matrix.yaml", "matrix-gate.yaml", "matrix-smoke.yaml"]


@given(st.integers(min_value=1, max_value=1024))
def test_a_tree_holds_exactly_the_agents_asked_for(agents: int) -> None:
    fanout, per_leaf = tree_for(agents)
    assert len(fanout) == 2 and min(fanout) >= 1 and per_leaf in (1, 2)
    assert fanout[0] * fanout[1] * per_leaf == agents


def test_the_sweep_trees_and_the_demo_configuration() -> None:
    assert [tree_for(n) for n in SWEEP] == [
        ([1, 1], 1),
        ([1, 1], 2),
        ([1, 2], 2),
        ([2, 2], 2),
        ([4, 2], 2),
    ]
    assert tree_for(12) == ([3, 2], 2)  # the demo: 10 orchestrators, 12 agents (spec §7.3)
    with pytest.raises(ValueError, match="at least one agent"):
        tree_for(0)


def test_the_agents_axis_multiplies_the_cells_and_names_them() -> None:
    matrix = Matrix.load(BENCH / "matrix-scaling.yaml")
    cells = matrix.cells()
    assert len(cells) == 2 * len(SWEEP) * 2  # workflows x totals x seeds, at C0 only
    assert {cell.profile.name for cell in cells} == {"C0"}
    assert cells[0].id == "swarm__t2_conference__C0__s1__n1"
    assert len({cell.id for cell in cells}) == len(cells)
    assert matrix.contributor is True and matrix.budget.run_cap_usd == 0.5
    assert matrix.budget.matrix_cap_usd == pytest.approx(len(cells) * 0.5)
    others = {Matrix.load(BENCH / name).out_dir for name in DEFAULTS}
    assert matrix.out_dir not in others  # its own results dir


@pytest.mark.parametrize("name", DEFAULTS)
def test_the_default_matrices_have_no_agents_axis(name: str) -> None:
    matrix = Matrix.load(BENCH / name)
    assert matrix.agents is None
    ids = [cell.id for cell in matrix.cells()]
    expected = [
        f"{w}__{t}__{p}__s{s}"
        for w in matrix.workflows
        for t in matrix.tasks
        for p in matrix.profiles
        for s in matrix.seeds
    ]
    assert ids == expected  # the ids of recorded results (and their resume) do not move


def test_a_cell_without_agents_keeps_the_taskspecs_tree() -> None:
    cell = Cell("swarm", "t2_conference", profile("C0"), "1")
    scaling = t2_params(cell, False)["spec"]["scaling"]
    assert (scaling["fanout"], scaling["agents_per_leaf"]) == ([3, 2], 2)
    sweep = Cell("swarm", "t2_conference", profile("C0"), "1", agents=8)
    scaling = t2_params(sweep, False)["spec"]["scaling"]
    assert scaling == {"mode": "exact", "fanout": [2, 2], "agents_per_leaf": 2}
    assert t2_spec("1").scaling.fanout == [3, 2]  # the axis never leaks into the shared spec


@pytest.mark.parametrize("agents", [[], [0, 2], [2, 2], [-1]])
def test_the_agents_axis_needs_distinct_positive_totals(agents: list[int]) -> None:
    base = Matrix.load(BENCH / "matrix-scaling.yaml").model_dump()
    with pytest.raises(ValidationError, match="distinct totals"):
        Matrix.model_validate(base | {"agents": agents})


def central_state(agents: int) -> dict:
    fanout, per_leaf = tree_for(agents)
    args = {"level": 0, "fanout": fanout, "agents_per_leaf": per_leaf, "task": "t2_conference"}
    return orchestrator_init("o0", args | {"mode": "central"})


def squads_handed_out(agents: int, sessions: int = 6) -> list[list[str]]:
    state = central_state(agents)
    handed = []
    for turn in range(sessions):
        handed.append(_squad({**state, "squads": turn}))
    return handed


def test_central_at_the_demo_size_hands_each_session_its_own_squad() -> None:
    # What it did before the sweep existed: squad k is agents 2k+1 and 2k+2.
    assert squads_handed_out(12) == [[f"o0.a{2 * k + 1}", f"o0.a{2 * k + 2}"] for k in range(6)]


@pytest.mark.parametrize("agents", SWEEP)
def test_central_never_hands_out_an_agent_it_does_not_have(agents: int) -> None:
    state = central_state(agents)
    assert len(state["children"]) == agents
    handed = squads_handed_out(agents)
    assert all(squad and set(squad) <= set(state["children"]) for squad in handed)
    fanout, per_leaf = tree_for(agents)
    squads = fanout[0] * fanout[1]
    assert len({agent for squad in handed for agent in squad}) == min(squads, 6) * per_leaf


def test_central_shares_squads_in_turns_when_it_has_fewer_than_sessions() -> None:
    assert squads_handed_out(1) == [["o0.a1"]] * 6
    assert squads_handed_out(2) == [["o0.a1", "o0.a2"]] * 6
    four = squads_handed_out(4)
    assert four[0] == four[2] == four[4] and four[1] == four[3] == four[5] and four[0] != four[1]
    eight = squads_handed_out(8)
    assert eight[4] == eight[0] and eight[5] == eight[1]
    assert len({tuple(squad) for squad in eight}) == 4
