import { useMemo, useState } from "react";

import { launchTask, type LaunchResult } from "../lib/api";
import { buildTaskSpec, defaultForm, KNOWN_TASKS, taskLaunchBody, toYaml, type TaskForm } from "../lib/taskspec";
import { ControlButton } from "./ControlButton";

/** The New task form (spec §16 item 6, MVI). It builds a TaskSpec; "Submit for planning" posts it to
 * /api/tasks as `{spec, backend: "fake"}`, which starts a fake-LLM run on a server that has a private
 * directory (503 on one that has not). The YAML below is what ``fractalswarm run`` takes. */
export function NewTaskForm() {
  const [form, setForm] = useState<TaskForm>(defaultForm);
  const [launched, setLaunched] = useState<{ result: LaunchResult; waits: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const built = useMemo(() => buildTaskSpec(form), [form]);
  const yaml = built.spec ? toYaml(built.spec) : "";
  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => setForm((current) => ({ ...current, [key]: value }));

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
    <section className="panel newtask">
      <header className="panel__title">
        New task
        <span className="panel__hint">spec §16: a TaskSpec, then plan approval</span>
      </header>

      <label className="newtask__field">
        Goal
        <textarea value={form.goal} onChange={(e) => set("goal", e.target.value)} rows={4} placeholder="Build the two-day program of the conference from the talk submissions and the speakers' emails…" />
      </label>

      <div className="newtask__grid">
        <label className="newtask__field">
          Task
          <input list="known-tasks" value={form.task} onChange={(e) => set("task", e.target.value)} />
          <datalist id="known-tasks">
            {KNOWN_TASKS.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className="newtask__field">
          Seed
          <input value={form.seed} onChange={(e) => set("seed", e.target.value)} />
        </label>
        <label className="newtask__field">
          Budget (USD)
          <input inputMode="decimal" value={form.budgetUsd} onChange={(e) => set("budgetUsd", e.target.value)} />
        </label>
        <label className="newtask__field">
          Scaling
          <select value={form.scalingMode} onChange={(e) => set("scalingMode", e.target.value as TaskForm["scalingMode"])}>
            <option value="exact">exact</option>
            <option value="autoscale">autoscale</option>
          </select>
        </label>
        <label className="newtask__field">
          Fanout
          <input value={form.fanout} onChange={(e) => set("fanout", e.target.value)} title="orchestrators per level, e.g. 3,2: root → 3 tracks → 6 sessions" />
        </label>
        <label className="newtask__field">
          Agents per leaf
          <input inputMode="numeric" value={form.agentsPerLeaf} onChange={(e) => set("agentsPerLeaf", e.target.value)} />
        </label>
      </div>

      <label className="newtask__field">
        Task inputs <span className="muted">(one “key: value” per line; a conference task needs a fixture)</span>
        <textarea value={form.inputs} onChange={(e) => set("inputs", e.target.value)} rows={3} spellCheck={false} placeholder={"fixture: tasks/fixtures/t2/seed-1\npoison: 1"} />
      </label>

      <label className="newtask__check">
        <input type="checkbox" checked={form.autoApprove} onChange={(e) => set("autoApprove", e.target.checked)} />
        Approve the plan automatically (bench mode). Off: wait for a human on the Plan tab.
      </label>
      <label className="newtask__check">
        <input type="checkbox" checked={form.contributorOptIn} onChange={(e) => set("contributorOptIn", e.target.checked)} />
        Allow the Contributor model for content that passed the firewall.
      </label>

      {built.errors.length > 0 && (
        <ul className="newtask__errors">
          {built.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="newtask__buttons">
        <ControlButton control="tasks" className="btn btn--on" disabled={!built.spec || busy} onClick={() => void submit()}>
          Submit for planning
        </ControlButton>
        <button className="btn" disabled={!built.spec} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy YAML"}
        </button>
        <button className="btn" disabled={!built.spec} onClick={download}>
          Download task.yaml
        </button>
      </div>
      {launched && <Launched result={launched.result} waits={launched.waits} />}

      {built.spec && (
        <>
          <pre className="newtask__yaml mono">{yaml}</pre>
          <div className="muted">
            Submit starts the run on the fake LLM, the simulated clock and no failures, so it costs nothing. To run the same task yourself, save the YAML and run <code>uv run fractalswarm run task.yaml</code> (a real run needs <code>--backend real --confirm-real-spend</code>).
          </div>
        </>
      )}
    </section>
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
