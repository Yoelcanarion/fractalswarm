import { useEffect, useRef, useState } from "react";

import type { IntakeApi } from "./api";
import { canonicalBody, gateFor, type Checked, type Gate, type Kind } from "./spend";

export interface Spend {
  checked: Checked | null;
  checking: boolean;
  /** The check itself failed: the server refused the request, or could not be reached. */
  error: string | null;
  gate: Gate;
  typed: string;
  setTyped: (word: string) => void;
  check: () => void;
  /** The token works once: after a launch, whatever came of it, a new check is needed. */
  spent: () => void;
  /** Whether the launch may go right now: asked again at the moment of the click, not trusted from the last render. */
  gateNow: () => Gate;
}

/** The check-then-confirm of one billed launch (W2's preflight): price it at its worst case, and open the gate only for
 * a check that still fits the settings, has not run out, and the word typed exactly. The body is what would be sent. */
export function useSpend(api: IntakeApi, kind: Kind, body: Record<string, unknown>): Spend {
  const priced = canonicalBody(body);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);

  // tick only while a check with a token is open, to tell when it has run out
  const expiring = checked !== null && checked.preflight.expires_in_s !== null;
  useEffect(() => {
    if (!expiring) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiring]);

  const check = () => {
    const mine = ++latest.current;
    setChecking(true);
    setError(null);
    void api.preflight(kind, body).then((outcome) => {
      if (mine !== latest.current) return; // an older answer, after a newer question
      setChecking(false);
      if (outcome.ok) setChecked({ preflight: outcome.body, priced, at: Date.now() });
      else {
        setChecked(null);
        setError(outcome.error);
      }
      setNow(Date.now());
    });
  };

  return {
    checked,
    checking,
    error,
    gate: gateFor(checked, priced, typed, now),
    typed,
    setTyped,
    check,
    spent: () => {
      latest.current++;
      setChecked(null);
      setTyped("");
      setChecking(false);
    },
    gateNow: () => gateFor(checked, priced, typed, Date.now()),
  };
}
