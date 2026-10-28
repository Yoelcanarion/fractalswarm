"""The report of ``verify/takeover.py``: one model per finding, all JSON-ready."""

from pydantic import BaseModel


class Violation(BaseModel):
    check: str
    kind: str
    seq: int | None = None
    detail: str


class Kill(BaseModel):
    fault: str
    target: str | None
    progress: float | None
    seq: int
    ts_virtual: int
    remaining_work: int | None = None
    stopped_seq: int | None = None
    stopped_reason: str | None = None
    cancelled_effects: dict[str, int] = {}  # kind -> count, cancelled with the victim
    events_after_stop: int = 0  # authored by the victim after it stopped: must be 0
    after_stop: list[str] = []
    completions_after_stop: int = 0  # calls of the victim completing after it stopped: must be 0


class Rejoin(BaseModel):
    seq: int
    ts_virtual: int
    member: str
    incarnation: int


class Verdict(BaseModel):
    seq: int
    ts_virtual: int
    member_epoch: int
    subject: str
    incarnation: int
    by: str
    missed: int
    last_heard_ms: int
    truth: str  # true: the subject had stopped | false: it was still alive
    stopped_seq: int | None = None
    stop_reason: str | None = None
    kill_seq: int | None = None
    delay_ms: int | None = None  # since the kill
    rejoins: list[Rejoin] = []


class HrwScore(BaseModel):
    member: str
    score: str  # blake2b HRW score of (goal, member), 16 hex digits, best first


class Succession(BaseModel):
    seq: int
    ts_virtual: int
    goal: str
    root: bool
    previous: str
    owner: str
    group: str | None
    kind: str  # takeover | reclaim (a member back from a false death took its own goal back)
    works: list[str]
    adopted_results: int
    fence_epoch: int | None
    verdict_seq: int | None  # the first member.dead of the previous owner
    verdict_epoch: int | None
    basis_seq: int | None  # the log was folded through this seq: what the heir saw
    pool: list[str] = []  # the live candidates, from the members view
    scores: list[HrwScore] = []
    heir: str | None = None  # recomputed
    expected_works: list[str] = []
    expected_adopted: int = 0
    skew: str | None = None  # the heir at the append point, when it differs from the decision
    ok: bool = True
    problems: list[str] = []


class Adoption(BaseModel):
    seq: int
    ts_virtual: int
    dead: str
    adopter: str
    goal: str
    children: list[str]
    duties: list[str]
    expected_duties: list[str] | None = None
    remap_seq: int | None = None
    ok: bool = True
    problems: list[str] = []


class OrphanResult(BaseModel):
    seq: int
    ts_virtual: int
    sender: str
    to: str
    goal: str
    contract: str
    attempt: int
    status: str
    owner_stopped_seq: int
    sent_after_death: bool
    fate: str  # adopted | retried | failed | redispatched | unfinished | unconsumed
    consumer: str | None = None
    consumed_seq: int | None = None
    verified_seq: int | None = None
    ok: bool = True


class FencedWrite(BaseModel):
    seq: int
    ts_virtual: int
    refused: str
    writer: str
    reason: str
    member: str | None
    resource: str | None
    epoch: int | None
    justified: bool | None  # re-derived from the members view; None: not re-derivable


class Fencing(BaseModel):
    fenced: list[FencedWrite] = []
    owner_writes_checked: int = 0  # fenced writes whose writer is the goal's owner at that point
    owner_writes_unchecked: int = 0  # for a goal the tree does not know


class ContractOutcome(BaseModel):
    work: str
    status: str  # verified | failed | unfinished
    dispatches: int
    verified_by: str | None = None
    seq: int | None = None
    why: str = ""


class GoalOutcome(BaseModel):
    goal: str
    status: str  # ok | partial | failed | missing
    seq: int | None = None
    writer: str | None = None
    gaps: list[str] = []


class TaskOutcome(BaseModel):
    results: int = 0
    status: str | None = None
    placed: int | None = None
    expected: int | None = None
    hard_violations: int | None = None
    gaps: list[str] = []
    writer: str | None = None
    seq: int | None = None


class LostWork(BaseModel):
    contracts: list[ContractOutcome] = []
    goals: list[GoalOutcome] = []
    task: TaskOutcome = TaskOutcome()


class CallRef(BaseModel):
    effect_id: str
    seq: int
    actor: str
    tag: str | None
    cost_usd: float


class DuplicateCall(BaseModel):
    request: str  # digest of the request body
    role: str
    calls: list[CallRef]
    wasted_usd: float  # every call after the first


class CancelledCall(BaseModel):
    effect_id: str
    actor: str
    role: str
    tag: str | None
    started_seq: int
    cancelled_seq: int
    cause: str  # kill | halt | cancel | stop:<reason>
    worst_case_usd: float  # the reservation released at the cancellation
    estimated_usd: float  # what the provider probably billed (bench/scoring.py)
    redone: list[str]  # completed calls with the same request started afterwards
    work: str | None = None  # an agent call: the contract it served (gid/cid)
    work_dispatched_again: int = 0  # that contract's dispatches after the cancellation


class CassetteReport(BaseModel):
    checked: bool = False
    entries: int = 0
    duplicated: list[str] = []  # effect ids that appear on more than one line
    orphans: list[str] = []  # entries of effects that never started
    missing: list[str] = []  # completed calls without an entry
    recorded_but_cancelled: list[str] = []  # the call ran to its end; the effect was cancelled
    foreign: int = 0  # entries of another run


class Duplicates(BaseModel):
    llm_started: int = 0
    llm_paid: int = 0
    llm_failed: int = 0  # completed with an error or a refusal: not billed
    groups: list[DuplicateCall] = []
    cancelled: list[CancelledCall] = []
    idem_key_reuse: list[str] = []
    effect_id_reuse: list[str] = []
    contract_redispatched: list[str] = []  # one contract attempt dispatched more than once
    cassette: CassetteReport = CassetteReport()


class Invariants(BaseModel):
    chain_checked: bool = False
    chain_ok: bool | None = None
    head_file_ok: bool | None = None
    audit_ok: bool | None = None
    audit_problems: list[str] = []
    replay_checked: bool = False
    replay_ok: bool | None = None
    replay_detail: str = ""


class OpenReservation(BaseModel):
    effect_id: str
    usd: float
    actor: str | None
    role: str | None
    seq: int


class Costs(BaseModel):
    settled_usd: float = 0.0
    by_role: dict[str, float] = {}
    by_actor: dict[str, float] = {}
    peak_committed_usd: float = 0.0
    peak_seq: int | None = None
    run_cap_usd: float | None = None
    open_reservations: list[OpenReservation] = []
    open_reserved_usd: float = 0.0
    cancelled_llm_calls: int = 0
    cancelled_worst_case_usd: float = 0.0
    cancelled_estimated_usd: float = 0.0


class TakeoverReport(BaseModel):
    run_id: str
    events: int
    head: str
    ok: bool = True
    violations: list[Violation] = []
    kills: list[Kill] = []
    verdicts: list[Verdict] = []
    successions: list[Succession] = []
    chains: dict[str, list[str]] = {}  # goal -> owners in order, the dead first
    adoptions: list[Adoption] = []
    orphan_results: list[OrphanResult] = []
    fencing: Fencing = Fencing()
    lost_work: LostWork = LostWork()
    duplicates: Duplicates = Duplicates()
    invariants: Invariants = Invariants()
    costs: Costs = Costs()
    limits: list[str] = []  # what the log cannot show, said plainly

    def of_kind(self, kind: str) -> list[Violation]:
        return [v for v in self.violations if v.kind == kind]
