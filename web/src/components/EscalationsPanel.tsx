import { escalationState, timeLeftMs, type EscalationState, type HumanEscalation, type Rejection, type Step, type TrailStatus } from "../lib/escalations";
import type { ViewState } from "../lib/reducer";
import { AnswerBox } from "./AnswerBox";
import { Card, GenericRows, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";
import { Hint } from "./ui";

const STEP: Record<Step, string> = { retry: "retry", reassign: "reassign", lost: "agent lost" };
const STATUS: Record<TrailStatus, { label: string; tone: "good" | "warn" | "bad" }> = {
  retrying: { label: "retrying", tone: "warn" },
  recovered: { label: "recovered", tone: "good" },
  failed: { label: "gave up", tone: "bad" },
};
const HUMAN: Record<EscalationState, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  waiting: { label: "needs a human", tone: "bad" },
  answered: { label: "confirmed", tone: "good" },
  overruled: { label: "overruled", tone: "warn" },
  expired: { label: "expired", tone: "muted" },
  closed: { label: "closed", tone: "muted" },
};

/** What a human escalation says about itself, by where it stands at the virtual time the log has reached. */
function humanLine(item: HumanEscalation, state: EscalationState, nowTs: number): string {
  const accepted = item.answers.find((a) => a.accepted);
  const stands = item.fallback ?? "the ruling";
  switch (state) {
    case "answered":
      return `a person confirmed ${accepted?.choice || stands}`;
    case "overruled":
      return `a person chose ${accepted?.choice} over ${stands}`;
    case "expired":
      return `nobody answered in time; ${stands} stands`;
    case "closed":
      return item.resolution ? `closed: ${item.resolution}` : `the run ended before anyone answered; ${stands} stands`;
    case "waiting": {
      const left = timeLeftMs(item, nowTs);
      const options = item.options.length > 0 ? ` · options ${item.options.join(", ")}${item.fallback ? ` (ruled: ${item.fallback})` : ""}` : "";
      return `raised by ${item.actor}: ${item.text}${options}${left === null ? "" : ` · ${virtualSeconds(left)} left`}`;
    }
  }
}

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

/** ``runId`` lets a person answer a waiting escalation; without it (a view with no run behind it) the panel only shows. */
export function EscalationsPanel({ view, runId }: { view: ViewState; runId?: string }) {
  const { escalations } = view.panels;
  const { steps } = escalations;
  const trails = escalations.order.map((key) => escalations.trails[key]).sort((a, b) => b.lastSeq - a.lastSeq);
  // Where each one stands is read at the virtual time the log has reached, so dragging the scrubber moves it.
  const humans = escalations.human.map((item) => ({ item, state: escalationState(item, view.lastTs, view.completed) }));
  const waiting = humans.filter((h) => h.state === "waiting");

  return (
    <Card
      title="Escalations"
      wide
      hint="the ladder a failing contract climbs: retry → reassign → squad replan → parent → human"
    >
      <div className="pstats">
        <PStat label="1 · retries" value={steps.retry} title="same agent, with the verifier's feedback" />
        <PStat label="2 · reassigned" value={steps.reassign} title="a different agent, effort raised" />
        <PStat label="agent lost" value={steps.lost} title="the agent died with its contract: re-dispatched, not a failure" />
        <PStat label="recovered" value={steps.recovered} tone={steps.recovered > 0 ? "good" : ""} />
        <PStat label="gave up" value={steps.failed} tone={steps.failed > 0 ? "bad" : ""} title="attempts exhausted; the goal completes with explicit gaps" />
        <PStat label="5 · human" value={waiting.length} tone={waiting.length > 0 ? "bad" : ""} title="open escalations waiting for a decision" />
      </div>

      {humans.map(({ item, state }) => (
        <div key={item.id}>
          <div className={state === "waiting" ? "pevent pevent--bad" : "pevent"}>
            <Pill tone={HUMAN[state].tone}>{HUMAN[state].label}</Pill> <b className="mono">{item.id}</b>
            {item.goalId ? <> · {item.goalId}</> : null} · t = {virtualSeconds(item.ts)} · {humanLine(item, state, view.lastTs)}
          </div>
          {item.answers
            .filter((answer) => !answer.accepted)
            .map((answer) => (
              <div key={answer.seq} className="pevent pevent--warn">
                ignored answer <b className="mono">{answer.choice}</b> at t = {virtualSeconds(answer.ts)}: {answer.reason || "the owner did not accept it"}
              </div>
            ))}
          {runId && <AnswerBox runId={runId} item={item} waiting={state === "waiting"} />}
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
                      <Hint key={run.first.seq} label={`attempt ${run.first.attempt} · t = ${virtualSeconds(run.first.ts)}`}>
                        <span className="step">
                          {STEP[run.first.step]}
                          {run.count > 1 ? ` ×${run.count}` : ""} <span className="muted">@{run.first.stage}</span>
                        </span>
                      </Hint>
                    ))}
                  </td>
                  <td>
                    <Pill tone={STATUS[trail.status].tone}>{STATUS[trail.status].label}</Pill>
                  </td>
                  <td>{last?.reasons[0] ?? ""}</td>
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
