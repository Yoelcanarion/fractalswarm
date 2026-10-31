import { useEffect, useMemo, useState } from "react";

import { PageHeader, Term } from "../components/ui";
import { siteOf } from "../lib/controls";
import { useRunStore } from "../store";
import "./intake.css";
import { createIntakeApi, type Approval, type IntakeApi, type IntakeState } from "./api";
import { isWorking, phaseFor, phaseOf, POLL_MS, startingReading, stepOf } from "./flow";
import { boxOf, placeFacts, type Box, type Selection, type Texts } from "./highlight";
import { IntakeForm } from "./IntakeForm";
import { formProblems, readingBody, requestFor, type Backend, type ReadingForm } from "./launch";
import { forget, remember, rememberedForm } from "./memory";
import type { Proposal } from "./proposal";
import { diffProposal } from "./provenance";
import { LoadingReading, Reading, Stopped } from "./ReadingView";
import { ReviewScreen } from "./ReviewScreen";
import { rowId } from "./ReviewTables";
import { intakeHash, type IntakeRoute } from "./route";
import { RunPanel } from "./RunPanel";
import { SpendPanel } from "./SpendPanel";
import { StaticIntake } from "./StaticIntake";
import { Steps } from "./Steps";
import { useSpend } from "./useSpend";
import { checkProposal } from "./validate";

const NO_TEXTS: Texts = {};
const RETRIES = 20;
const RETRY_MS = 2000;

const go = (hash: string) => {
  window.location.hash = hash;
};

const calm = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface IntakeFlowProps {
  api: IntakeApi;
  intakeId: string | null;
  /** The server lets a launch be billed. */
  realAllowed: boolean;
  /** The server starts runs from the API. */
  canStart: boolean;
}

/** The whole flow on one address: paste, read, review, approve, run. What the server knows (the reading and its state) is
 * asked of it; what only the person has (the text in the form, the rows as they have corrected them) is kept here, in
 * memory, and nowhere else. */
export function IntakeFlow({ api, intakeId, realAllowed, canStart }: IntakeFlowProps) {
  const [form, setFormState] = useState<ReadingForm>(rememberedForm);
  const setForm = (next: ReadingForm) => {
    remember(next);
    setFormState(next);
  };
  const [backend, setBackend] = useState<Backend>("fake");
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [state, setState] = useState<IntakeState | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; retrying: boolean } | null>(null);
  // bumped to ask the server again by hand, which starts the asking over
  const [attempt, setAttempt] = useState(0);
  const [original, setOriginal] = useState<Proposal | null>(null);
  const [working, setWorking] = useState<Proposal | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [box, setBox] = useState<Box>("talks");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);

  // A new address is a new reading: forget what was held of the last one, then ask the server, and keep asking while it reads.
  useEffect(() => {
    setState(null);
    setLoadError(null);
    setOriginal(null);
    setWorking(null);
    setSelection(null);
    setBox("talks");
    setApproveError(null);
    setApproval(null);
    if (intakeId === null) return;
    let stopped = false;
    let timer: number | undefined;
    let failures = 0;
    const ask = async () => {
      const outcome = await api.intake(intakeId);
      if (stopped) return;
      if (outcome.ok) {
        failures = 0;
        setLoadError(null);
        setState(outcome.body);
        if (isWorking(phaseOf(outcome.body))) timer = window.setTimeout(() => void ask(), POLL_MS);
        return;
      }
      // a server that does not know the reading will not learn it; one that cannot be reached may be restarting
      const again = (outcome.status === 0 || outcome.status >= 500) && ++failures < RETRIES;
      setLoadError({ message: outcome.error, retrying: again });
      if (again) timer = window.setTimeout(() => void ask(), RETRY_MS);
    };
    void ask();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [api, intakeId, attempt]);

  // The reading, the first time it is there: it is both what the rows are compared against and where the person starts.
  useEffect(() => {
    if (original !== null || state === null || state.intake_id !== intakeId) return;
    const start = startingReading(state);
    if (start === null) return;
    setOriginal(start.original);
    setWorking(start.working);
  }, [state, intakeId, original]);

  const phase = phaseFor(intakeId, state);
  const texts = state?.texts ?? NO_TEXTS;
  const issues = useMemo(() => (working === null ? [] : checkProposal(working)), [working]);
  const edits = useMemo(() => (original === null || working === null ? [] : diffProposal(original, working)), [original, working]);

  const select = (next: Selection | null) => {
    setSelection(next);
    if (next === null || working === null) return;
    const where = boxOf(placeFacts(working, texts), next);
    if (where !== null) setBox(where);
    // a sentence picked in the text brings its row into view
    document.getElementById(rowId(next.kind, next.id))?.scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
  };

  const approve = async () => {
    if (state === null || working === null) return;
    setApproving(true);
    setApproveError(null);
    const outcome = await api.approve(state.intake_id, working);
    // already approved (in another tab, or before a reload): the server's word is the one to show
    if (outcome.ok) setApproval(outcome.body);
    else if (outcome.status !== 409) setApproveError(outcome.error);
    if (outcome.ok || outcome.status === 409) {
      const fresh = await api.intake(state.intake_id);
      if (fresh.ok) setState(fresh.body);
      else setApproveError(fresh.error);
    }
    setApproving(false);
  };

  // ---- the form ----
  const readBody = useMemo(() => readingBody(form, "real"), [form]);
  const readSpend = useSpend(api, "intake", readBody);

  const read = async () => {
    const request = requestFor(readingBody(form, backend), readSpend.gateNow(), readSpend.typed);
    if ("refused" in request) return;
    setBusy(true);
    setFormError(null);
    const outcome = await api.startReading(request.send);
    setBusy(false);
    if (backend === "real") readSpend.spent(); // the token is used up, whatever came of it
    if (outcome.ok) go(intakeHash(outcome.body.intake_id));
    else setFormError(outcome.error);
  };

  const useSample = async () => {
    setSampling(true);
    setFormError(null);
    const outcome = await api.sample(1);
    setSampling(false);
    if (!outcome.ok) return setFormError(outcome.error);
    const { conference, talks, notes, rooms } = outcome.body;
    setForm({ conference, talks, notes, rooms: rooms.map((room) => ({ name: room.name, capacity: String(room.capacity) })), names: form.names });
  };

  const costly = backend === "real";
  const problems = formProblems(form, backend);

  return (
    <div className="intake">
      <PageHeader
        className="intake__head"
        title="New task"
        lead={
          <>
            Paste the talks and the emails or notes. <Term id="muse">Muse</Term>, or the free practice reader, fits them to the program’s shape. You check each row against the text it came from, and only then does anything run. By default the run kills half the brains, and you get its program: each talk with its time and room, with any gap named.
          </>
        }
        actions={<Steps current={stepOf(phase)} />}
      />
      {!canStart && (
        <p className="intake__notice" role="status">
          This server does not start runs from the API, so reading and running live text needs <code>fractalswarm serve</code>.
        </p>
      )}

      {phase.name === "form" && (
        <IntakeForm
          form={form}
          onForm={setForm}
          backend={backend}
          onBackend={setBackend}
          realAllowed={realAllowed}
          busy={busy}
          error={formError}
          onRead={() => void read()}
          onSample={() => void useSample()}
          sampling={sampling}
          onClear={() => {
            setFormState(forget());
            setFormError(null);
          }}
          spend={
            costly && problems.length === 0 ? (
              <SpendPanel
                what="the reading"
                checked={readSpend.checked}
                checking={readSpend.checking}
                error={readSpend.error}
                gate={readSpend.gate}
                typed={readSpend.typed}
                onTyped={readSpend.setTyped}
                onCheck={readSpend.check}
                onLaunch={() => void read()}
                launching={busy}
                launchLabel="Read with Muse (billed)"
              />
            ) : null
          }
        />
      )}

      {phase.name === "loading" && loadError === null && <LoadingReading />}
      {phase.name === "reading" && loadError === null && <Reading state={phase.state} />}
      {(phase.name === "loading" || phase.name === "reading") && loadError !== null && (
        <Stopped
          headline="The reading could not be fetched."
          details={[loadError.message, ...(loadError.retrying ? [`Asking again every ${RETRY_MS / 1000} seconds.`] : [])]}
          scans={[]}
          onStartOver={() => go(intakeHash(null))}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {phase.name === "stopped" && <Stopped headline={phase.headline} details={phase.details} scans={phase.state.scans} onStartOver={() => go(intakeHash(null))} />}

      {(phase.name === "review" || phase.name === "approved") && original !== null && working !== null && (
        <ReviewScreen
          original={original}
          working={working}
          reader={phase.state.reader}
          texts={texts}
          scans={phase.state.scans}
          selection={selection}
          box={box}
          locked={phase.name === "approved"}
          issues={issues}
          edits={edits}
          approving={approving}
          approveError={approveError}
          approved={phase.state.approved}
          approvalWarnings={approval?.warnings ?? []}
          runPanel={<RunPanel api={api} intakeId={phase.state.intake_id} realAllowed={realAllowed} canStart={canStart} onStarted={go} />}
          onSelect={select}
          onBox={setBox}
          onChange={setWorking}
          onApprove={() => void approve()}
        />
      )}
    </div>
  );
}

/** `#/new` and `#/new/<reading>`: the live-text flow, on this server's API. */
export function IntakePage({ route }: { route: IntakeRoute }) {
  const capabilities = useRunStore((s) => s.capabilities);
  const api = useMemo(() => createIntakeApi(), []);
  if (siteOf(capabilities) === "static") return <StaticIntake />;
  return <IntakeFlow api={api} intakeId={route.intakeId} realAllowed={capabilities.real === true} canStart={capabilities.tasks} />;
}
