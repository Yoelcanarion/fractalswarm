import { useId, useMemo, useState, type ReactNode } from "react";

import { launchTask, type LaunchResult } from "../lib/api";
import { taskOf } from "../lib/heroText";
import { buildTaskSpec, defaultForm, KNOWN_TASKS, taskLaunchBody, toYaml, type TaskForm } from "../lib/taskspec";
import { ControlButton } from "./ControlButton";
import { Term } from "./ui";

const SCALING_HELP: Record<TaskForm["scalingMode"], string> = {
  exact: "Builds the tree the fanout describes.",
  autoscale: "Sizes the groups and squads while the run goes, from the plan and the budget, within caps.",
};

interface FieldProps {
  label: ReactNode;
  /** A sentence under the control, read with it by a screen reader. */
  help?: ReactNode;
  children: (aria: { id: string; "aria-describedby"?: string }) => ReactNode;
}

/** A label, the control and what to know about it. The help is text on the page, not a hover hint. */
function Field({ label, help, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="newtask__field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": help ? helpId : undefined })}
      {help && (
        <span id={helpId} className="newtask__help">
          {help}
        </span>
      )}
    </div>
  );
}

const taskHelp = (
  <>
    The task the agents work on:{" "}
    {KNOWN_TASKS.map((id, index) => {
      const task = taskOf(id);
      return (
        <span key={id}>
          {index > 0 && "; "}
          <code>{id}</code> is {task.term ? <Term id={task.term}>{task.short}</Term> : task.short}, the {task.name}
        </span>
      );
    })}
    .
  </>
);

/** The task spec as YAML, as a region a keyboard can scroll, and how to run the same file from the command line. */
export function SpecPreview({ yaml }: { yaml: string }) {
  const label = useId();
  return (
    <>
      <span id={label} className="newtask__caption">
        The task spec as YAML
      </span>
      <pre className="newtask__yaml mono" aria-labelledby={label} tabIndex={0}>
        {yaml}
      </pre>
      <div className="muted">
        To run the same task yourself, save the YAML and run <code>uv run fractalswarm run task.yaml</code>. A real run needs{" "}
        <code>--backend real --confirm-real-spend</code>.
      </div>
    </>
  );
}

/** Starts a run from a form. It builds a task spec; "Start the run" posts it to /api/tasks as `{spec, backend: "fake"}`,
 * which starts a fake-LLM run on a server that has a private directory (503 on one that has not). The YAML below is what
 * ``fractalswarm run`` takes. */
export function NewTaskForm() {
  const [form, setForm] = useState<TaskForm>(defaultForm);
  const [launched, setLaunched] = useState<{ result: LaunchResult; waits: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [touched, setTouched] = useState(false);
  const built = useMemo(() => buildTaskSpec(form), [form]);
  const yaml = built.spec ? toYaml(built.spec) : "";
  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => {
    setTouched(true);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    if (!built.spec) return;
    setBusy(true);
    const waits = !form.autoApprove;
    try {
      setLaunched({ result: await launchTask(taskLaunchBody(built.spec)), waits });
    } catch (error) {
      setLaunched({ result: { ok: false, status: 0, detail: String(error), runId: null, jobId: null, warnings: [] }, waits });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`${yaml}\n`], { type: "text/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "task.yaml";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="newtask">
      <p className="newtask__lead">
        Describe the job and start it. The run uses the fake model, a simulated clock and no failures, so it costs nothing. What you fill in is a{" "}
        <Term id="taskSpec">task spec</Term>.
      </p>

      <Field label="Goal" help="Say what the swarm should produce. The run cannot start without one.">
        {(aria) => (
          <textarea
            {...aria}
            value={form.goal}
            onChange={(e) => set("goal", e.target.value)}
            rows={4}
            placeholder="Build the two-day program of the conference from the talk submissions and the speakers' emails…"
          />
        )}
      </Field>

      <div className="newtask__grid">
        <Field label="Task" help={taskHelp}>
          {(aria) => (
            <>
              <input {...aria} list="known-tasks" value={form.task} onChange={(e) => set("task", e.target.value)} />
              <datalist id="known-tasks">
                {KNOWN_TASKS.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Seed" help="Seeds the run's randomness.">
          {(aria) => <input {...aria} value={form.seed} onChange={(e) => set("seed", e.target.value)} />}
        </Field>
        <Field label="Budget (USD)" help="The most the run may spend. On the fake model nothing is charged.">
          {(aria) => <input {...aria} inputMode="decimal" value={form.budgetUsd} onChange={(e) => set("budgetUsd", e.target.value)} />}
        </Field>
        <Field label="Scaling" help={SCALING_HELP[form.scalingMode]}>
          {(aria) => (
            <select {...aria} value={form.scalingMode} onChange={(e) => set("scalingMode", e.target.value as TaskForm["scalingMode"])}>
              <option value="exact">exact</option>
              <option value="autoscale">autoscale</option>
            </select>
          )}
        </Field>
        <Field label="Fanout" help="Orchestrators per level. 3,2 is a root with 3 tracks, each with 2 sessions: 6 sessions in all.">
          {(aria) => <input {...aria} value={form.fanout} onChange={(e) => set("fanout", e.target.value)} />}
        </Field>
        <Field label="Agents per session" help="The agents that work in each session.">
          {(aria) => <input {...aria} inputMode="numeric" value={form.agentsPerLeaf} onChange={(e) => set("agentsPerLeaf", e.target.value)} />}
        </Field>
      </div>

      <Field
        label="Task inputs"
        help={
          <>
            One “key: value” per line. A conference task needs a fixture, as in the example. <code>poison: 1</code> puts one poisoned speaker email in the data,
            as in the security demo.
          </>
        }
      >
        {(aria) => (
          <textarea
            {...aria}
            value={form.inputs}
            onChange={(e) => set("inputs", e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={"fixture: tasks/fixtures/t2/seed-1\npoison: 1"}
          />
        )}
      </Field>

      <label className="newtask__check">
        <input type="checkbox" checked={form.autoApprove} onChange={(e) => set("autoApprove", e.target.checked)} />
        Approve the plan automatically. Turn it off to read the plan and approve it yourself on the Plan tab.
      </label>
      <label className="newtask__check">
        <input type="checkbox" checked={form.contributorOptIn} onChange={(e) => set("contributorOptIn", e.target.checked)} />
        Allow the Contributor model for content that passed the firewall.
      </label>

      {touched && built.errors.length > 0 && (
        <ul className="newtask__errors" role="alert">
          {built.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="newtask__buttons">
        <ControlButton control="tasks" className="btn btn--on" disabled={!built.spec || busy} onClick={() => void submit()}>
          {busy ? "Starting…" : "Start the run"}
        </ControlButton>
        <button type="button" className="btn" disabled={!built.spec} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy YAML"}
        </button>
        <button type="button" className="btn" disabled={!built.spec} onClick={download}>
          Download task.yaml
        </button>
      </div>
      {launched && <Launched result={launched.result} waits={launched.waits} />}

      {built.spec && <SpecPreview yaml={yaml} />}
    </div>
  );
}

/** What the server said to a launch: the run it started, linked, or its reason for refusing. */
export function Launched({ result, waits }: { result: LaunchResult; waits: boolean }) {
  if (result.runId === null) {
    return (
      <div className="chaos__result chaos__result--bad" role="alert">
        {result.detail}
      </div>
    );
  }
  const href = `#/run/${encodeURIComponent(result.runId)}${waits ? "/plan" : ""}`;
  return (
    <div className="chaos__result" role="status">
      Started run <a href={href}>{result.runId}</a>. {waits ? "Its plan waits for your approval on the Plan tab." : "Its plan is approved automatically."}
      {result.warnings.map((warning) => (
        <div key={warning}>{warning}</div>
      ))}
    </div>
  );
}
