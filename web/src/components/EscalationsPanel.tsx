import { openEscalations, type Rejection, type Step, type TrailStatus } from "../lib/escalations";
import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";

const STEP: Record<Step, string> = { retry: "retry", reassign: "reassign", lost: "agent lost" };
const STATUS: Record<TrailStatus, { label: string; tone: "good" | "warn" | "bad" }> = {
  retrying: { label: "retrying", tone: "warn" },
  recovered: { label: "recovered", tone: "good" },
  failed: { label: "gave up", tone: "bad" },
};

/** Consecutive rejections at the same step and stage read as one chip: "reassign ×5". */
function runsOf(rejections: Rejection[]): { first: Rejection; count: number }[] {
  const runs: { first: Rejection; count: number }[] = [];
  for (const rejection of rejections) {
    const last = runs.at(-1);
    if (last && last.first.step === rejection.step && last.first.stage === rejection.stage) last.count += 1;
    else runs.push({ first: rejection, count: 1 });
  }
  return runs;
}

export function EscalationsPanel({ view }: { view: ViewState }) {
  const { escalations } = view.panels;
  const { steps } = escalations;
  const trails = escalations.order.map((key) => escalations.trails[key]).sort((a, b) => b.lastSeq - a.lastSeq);
  const waiting = openEscalations(escalations);

  return (
    <Card
      title="Escalations"
      wide
      hint="the replanning ladder: retry → reassign → squad replan → parent → human (spec §5.5)"
    >
      <div className="pstats">
        <PStat label="1 · retries" value={steps.retry} title="same agent, with the verifier's feedback" />
        <PStat label="2 · reassigned" value={steps.reassign} title="a different agent, effort raised" />
        <PStat label="agent lost" value={steps.lost} title="the agent died with its contract: re-dispatched, not a failure" />
        <PStat label="recovered" value={steps.recovered} tone={steps.recovered > 0 ? "good" : ""} />
        <PStat label="gave up" value={steps.failed} tone={steps.failed > 0 ? "bad" : ""} title="attempts exhausted; the goal completes with explicit gaps" />
        <PStat label="5 · human" value={waiting.length} tone={waiting.length > 0 ? "bad" : ""} title="open escalations waiting for a decision" />
      </div>

      {waiting.map((item) => (
        <div key={item.id} className="pevent pevent--bad">
          <Pill tone="bad">needs a human</Pill> <b className="mono">{item.id}</b>
          {item.goalId ? <> · {item.goalId}</> : null} · t = {virtualSeconds(item.ts)} · raised by {item.actor}: {item.text}
        </div>
      ))}
      {escalations.human
        .filter((item) => item.status === "resolved")
        .map((item) => (
          <div key={item.id} className="pevent">
            <Pill tone="good">decided</Pill> <b className="mono">{item.id}</b> {item.resolution}
          </div>
        ))}

      {trails.length === 0 ? (
        <Nothing>No contract needed the ladder: every one was verified at its first attempt.</Nothing>
      ) : (
        <table className="ptable ptable--log">
          <thead>
            <tr>
              <th>contract</th>
              <th>rejections</th>
              <th>status</th>
              <th>last reason</th>
            </tr>
          </thead>
          <tbody>
            {trails.slice(0, 10).map((trail) => {
              const last = trail.rejections.at(-1);
              return (
                <tr key={trail.key}>
                  <td className="mono">{trail.key}</td>
                  <td>
                    {runsOf(trail.rejections).map((run) => (
                      <span key={run.first.seq} className="step" title={`attempt ${run.first.attempt} · t = ${virtualSeconds(run.first.ts)}`}>
                        {STEP[run.first.step]}
                        {run.count > 1 ? ` ×${run.count}` : ""} <span className="muted">@{run.first.stage}</span>
                      </span>
                    ))}
                  </td>
                  <td>
                    <Pill tone={STATUS[trail.status].tone}>{STATUS[trail.status].label}</Pill>
                  </td>
                  <td className="clip">{last?.reasons[0] ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {escalations.goalGaps.length > 0 && (
        <>
          <Subhead hint="the goal ended with explicit gaps">Goals that did not finish</Subhead>
          {escalations.goalGaps.map((goal) => (
            <div key={goal.seq} className="pevent pevent--bad">
              <Pill tone="bad">{goal.status}</Pill> <b className="mono">{goal.goalId}</b> by {goal.owner}: {goal.gaps.join(", ") || "no gap listed"}
            </div>
          ))}
        </>
      )}
      {escalations.planRejections.length > 0 && (
        <>
          <Subhead hint="a planner's reply failed its schema">Plans rejected</Subhead>
          {escalations.planRejections.slice(-3).map((plan) => (
            <div key={plan.seq} className="pevent pevent--warn">
              <b className="mono">{plan.goalId}</b> attempt {plan.attempt}: {plan.errors[0]}
            </div>
          ))}
        </>
      )}
      <GenericRows rows={escalations.other} title="Escalation and replan events this panel does not read yet" />
    </Card>
  );
}
