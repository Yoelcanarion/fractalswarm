"""The scaling sweep's agent axis (spec §15.6): from a total number of agents to a tree.

A matrix with ``agents: [1, 2, 4, 8, 16]`` runs each workflow at every total. ``tree_for``
turns a total into the TaskSpec's ``exact`` scaling (spec §7.3). The swarm and the central
baseline get the same numbers, so they differ only in who leads: the swarm's tree of
orchestrators, or one orchestrator that leads every squad (``actors/orchestrator.py``).

The tree stays at depth 2 (T2 plans root -> tracks -> sessions) and holds exactly ``agents``
agents: ``agents = fanout[0] * fanout[1] * agents_per_leaf``. The rule:
- squads of two (``agents_per_leaf``, the demo's value); an odd total gets squads of one;
- two session orchestrators per track orchestrator (T2 has two days); an odd number of
  leaves gets one.

    agents  fanout  agents_per_leaf  orchestrators (swarm)
         1  [1, 1]                1                      3
         2  [1, 1]                2                      3
         4  [1, 2]                2                      4
         8  [2, 2]                2                      7
        12  [3, 2]                2                     10   the demo configuration
        16  [4, 2]                2                     13

The swarm grows its brains with its hands, and the 12-agent demo is a member of the family.
Central at the same numbers has ``fanout[0] * fanout[1]`` squads of ``agents_per_leaf`` agents
and hands one to each session, in turn when there are fewer squads than sessions.

T2 has six sessions, each a chain of three contracts (extract, place, blurb), so at most six
agents can work at once. Past six the extra agents idle: expect the curves to flatten there.
"""

SQUAD = 2  # agents_per_leaf of the demo configuration (spec §7.3)
LEAVES_PER_TRACK = 2  # T2 plans two sessions per track, one per day


def tree_for(agents: int) -> tuple[list[int], int]:
    """``(fanout, agents_per_leaf)`` of the depth-2 ``exact`` tree with ``agents`` agents."""
    if agents < 1:
        raise ValueError(f"a tree needs at least one agent, not {agents}")
    per_leaf = SQUAD if agents % SQUAD == 0 else 1
    leaves = agents // per_leaf
    per_track = LEAVES_PER_TRACK if leaves % LEAVES_PER_TRACK == 0 else 1
    return [leaves // per_track, per_track], per_leaf
