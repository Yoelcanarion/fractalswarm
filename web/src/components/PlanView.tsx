import { useState } from "react";

import { postControl, type ControlResult } from "../lib/api";
import { runCap } from "../lib/economy";
import { digest } from "../lib/generic";
import { planStatus, rootProposal, tracksOf, type PlanStatus } from "../lib/plan";
import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, money, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";

interface Props {
  runId: string;
  view: ViewState;
  live: boolean;
}

const STATUS: Record<PlanStatus, { label: string; tone: "muted" | "warn" | "good" | "bad" }> = {
  none: { label: "no plan yet", tone: "muted" },
  awaiting: { label: "awaiting approval", tone: "warn" },
  approved: { label: "approved", tone: "good" },
  rejected: { label: "rejected", tone: "bad" },
};

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The root's plan and its approval (spec §16 item 6, MVI). Approve and Reject post to the run's
 * approve endpoint, which answers 501 until the runtime waits for a human. */
export function PlanView({ runId, view, live }: Props) {
  const { plan, security, economy } = view.panels;
  const status = planStatus(plan);
  const proposal = rootProposal(plan);
  const approval = proposal ? plan.approvals[proposal.goalId] : undefined;
  const tracks = proposal ? tracksOf(proposal.plan) : [];
  const talks = tracks.reduce((sum, t) => sum + t.talks.length, 0);
  const cap = runCap(economy);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ControlResult | null>(null);
  const [reason, setReason] = useState("");
  const decidable = status === "awaiting" && live && !busy;

  const decide = async (approve: boolean) => {
    if (!proposal) return;
    setBusy(true);
    try {
      setResult(await postControl(`api/runs/${encodeURIComponent(runId)}/approve`, { goal_id: proposal.goalId, approve, reason }));
    } catch (error) {
      setResult({ ok: false, status: 0, detail: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const other = proposal ? Object.entries(proposal.plan).filter(([key]) => !["tracks", "feasibility", "limitations"].includes(key)) : [];
  const limitations = proposal && Array.isArray(proposal.plan.limitations) ? proposal.plan.limitations.map(String) : [];

  return (
    <div className="plan">
      <section className="panel plan__head">
        <div className="plan__title">
          <Pill tone={STATUS[status].tone}>
            <span className="plan__status">{STATUS[status].label}</span>
          </Pill>
          <div className="muted">
            {approval
              ? `approved by ${approval.by} at t = ${virtualSeconds(approval.ts)} · scope token ${approval.token.slice(0, 18)}`
              : proposal
                ? `proposed by ${proposal.actor} at t = ${virtualSeconds(proposal.ts)}`
                : "the root proposes a plan first (plan.proposed)"}
          </div>
          <div className="plan__buttons">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason (optional)" aria-label="reason" disabled={!decidable} />
            <button className="btn" disabled={!decidable} onClick={() => void decide(true)}>
              Approve plan
            </button>
            <button className="btn btn--danger" disabled={!decidable} onClick={() => void decide(false)}>
              Reject
            </button>
          </div>
        </div>
        <div className="pstats">
          <PStat label="tracks" value={tracks.length} />
          <PStat label="talks planned" value={talks} />
          <PStat label="scope nodes" value={approval?.nodes ?? security.scope?.nodes.length ?? 0} title="the nodes the approved plan lets a subgoal map to (Security tab)" />
          <PStat label="sub-plans" value={plan.refinements.length} title="plan.refined: an orchestrator split its subgoal" />
          <PStat label="plans rejected" value={plan.rejections.length} tone={plan.rejections.length > 0 ? "warn" : ""} />
          {proposal?.fallback && <PStat label="planner" value="fallback" tone="warn" title="the deterministic fallback plan, not the model's" />}
        </div>
        {approval?.by === "auto" && (
          <div className="pevent">
            Approved automatically: the TaskSpec has <span className="mono">auto_approve</span> (bench mode). A run that waits for a human enables the buttons above.
          </div>
        )}
        {status === "none" && !live && <div className="pevent">This run has no plan.proposed event.</div>}
        {result && <div className={`chaos__result ${result.ok ? "" : "chaos__result--bad"}`}>{result.status === 501 ? "Not wired yet — " : ""}{result.detail}</div>}
      </section>

      <div className="plan__cols">
        <Card title="The plan" hint={proposal ? `hash ${proposal.hash.slice(0, 12)}` : undefined}>
          {!proposal ? (
            <Nothing>No plan has been proposed.</Nothing>
          ) : (
            <>
              {tracks.length > 0 ? (
                <table className="ptable">
                  <thead>
                    <tr>
                      <th>track</th>
                      <th>talks</th>
                      <th>risk</th>
                      <th>priority</th>
                      <th>home room</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracks.map((track) => (
                      <tr key={track.id} title={track.acceptance}>
                        <td className="mono">{track.id}</td>
                        <td title={track.talks.join(", ")}>
                          {track.talks.length} <span className="muted mono">{clip(track.talks.slice(0, 5).join(" "), 28)}</span>
                        </td>
                        <td>{track.risk === null ? "–" : track.risk.toFixed(2)}</td>
                        <td>{track.priority ?? "–"}</td>
                        <td>{track.homeRoom}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Nothing>This plan has no tracks list: its fields are below.</Nothing>
              )}
              {other.length > 0 && (
                <table className="ptable">
                  <tbody>
                    {other.map(([key, value]) => (
                      <tr key={key}>
                        <td className="mono">{key}</td>
                        <td>{typeof value === "object" ? digest({ [key]: value }) : clip(String(value), 160)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <details className="results__raw">
                <summary>The raw plan</summary>
                <pre className="mono">{JSON.stringify(proposal.plan, null, 2)}</pre>
              </details>
            </>
          )}
        </Card>

        <Card title="Feasibility report" hint="spec §12: at plan approval">
          <div className="pstats">
            <PStat label="run budget" value={cap === null ? "none" : money(cap, 2)} />
          </div>
          {proposal && typeof proposal.plan.feasibility === "string" && (
            <>
              <Subhead>The planner's assessment</Subhead>
              <div className="plan__text">{proposal.plan.feasibility}</div>
            </>
          )}
          {limitations.length > 0 && (
            <>
              <Subhead hint="listed honestly">Limitations</Subhead>
              <ul className="blocked__reasons">
                {limitations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          {tracks.length > 0 && (
            <>
              <Subhead hint="the planner's own estimate">Risk per track</Subhead>
              <div className="spendchips">
                {tracks.map((track) => (
                  <span key={track.id} className="spendchip">
                    <b>{track.id.replace("track-", "")}</b> {track.risk === null ? "–" : track.risk.toFixed(2)}
                  </span>
                ))}
              </div>
            </>
          )}
          {!proposal && <Nothing>The report comes with the plan.</Nothing>}
          <Nothing>Cost P50/P90 against the budget, the expected duration, bottlenecks and policy flags show here as feasibility.* and risk.* events arrive.</Nothing>
          <GenericRows rows={plan.other} title="Feasibility and risk events" />
        </Card>

        <Card title="Sub-plans and rejections" hint="below the root">
          {plan.refinements.length === 0 ? (
            <Nothing>No orchestrator has split its subgoal yet.</Nothing>
          ) : (
            <table className="ptable">
              <tbody>
                {plan.refinements.slice(0, 14).map((refinement) => (
                  <tr key={refinement.seq}>
                    <td className="mono">{refinement.goalId}</td>
                    <td>{refinement.owner}</td>
                    <td>{refinement.children.length} children</td>
                    <td>{refinement.fallback && <Pill tone="warn">fallback</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {plan.rejections.map((rejection) => (
            <div key={rejection.seq} className="pevent pevent--warn">
              <Pill tone="warn">rejected</Pill> <b className="mono">{rejection.goalId}</b> attempt {rejection.attempt}: {rejection.errors[0]}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
