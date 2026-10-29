import { useEffect, useRef, useState } from "react";

import { answerEscalation, fetchDisputes } from "../lib/api";
import { sendAnswer, type Sent } from "../lib/disputes";
import type { HumanEscalation } from "../lib/escalations";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the server said about the last answer: its own words for the request (200 "answer to ... requested", 409 a run that
 * takes no controls, 422 a choice or id it cannot take), then the owner's verdict read back from the log. */
export function AnswerStatus({ sent }: { sent: Sent }) {
  const { request, verdict } = sent;
  return (
    <div role="status" className={`chaos__result ${request.ok ? "" : "chaos__result--bad"}`}>
      <b className="mono">{sent.choice}</b>: {request.detail}
      {request.ok && <> · {verdict === "pending" ? "asking the server how the owner took it…" : verdict ? verdict.text : "no verdict in the log yet"}</>}
    </div>
  );
}

/** The way a person answers an escalation that waits for one: a button per option while it waits, and what the server said
 * about the answer (`AnswerStatus`). The box stays after the escalation closes, to say how the last answer went. */
export function AnswerBox({ runId, item, waiting }: { runId: string; item: HumanEscalation; waiting: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function answer(choice: string) {
    const seen = item.answers.reduce((last, a) => Math.max(last, a.seq), 0); // the answers already in the log are not this one
    setBusy(choice);
    setSent(null);
    const how = { post: (picked: string) => answerEscalation(runId, item.id, picked), read: () => fetchDisputes(runId), wait, alive: () => alive.current };
    await sendAnswer(how, item.id, choice, seen, setSent);
    if (alive.current) setBusy(null); // one answer at a time: the verdict on this one is read before another can be sent
  }

  if (!waiting && !sent) return null;
  return (
    <div className="answer">
      {waiting &&
        (item.options.length === 0 ? (
          <span className="muted">no options to choose from</span>
        ) : (
          <div className="answer__choices" role="group" aria-label={`Answer ${item.id}`}>
            <span className="answer__label">Your answer</span>
            {item.options.map((option) => (
              <button key={option} type="button" className="btn" disabled={busy !== null} title={option} onClick={() => void answer(option)}>
                {option}
                {option === item.fallback ? " (ruled)" : ""}
              </button>
            ))}
          </div>
        ))}
      {sent && <AnswerStatus sent={sent} />}
    </div>
  );
}
