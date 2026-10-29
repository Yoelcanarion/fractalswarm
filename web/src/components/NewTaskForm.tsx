import { useMemo, useState } from "react";

import { postControl, type ControlResult } from "../lib/api";
import { buildTaskSpec, defaultForm, KNOWN_TASKS, toYaml, type TaskForm } from "../lib/taskspec";
import { ControlButton } from "./ControlButton";

/** The New task form (spec §16 item 6, MVI). It builds a TaskSpec; "Submit for planning" posts it to
 * /api/tasks, which starts a run on a server that has a private directory (503 on one that has not).
 * The YAML below is what ``fractalswarm run`` takes. */
export function NewTaskForm() {
  const [form, setForm] = useState<TaskForm>(defaultForm);
  const [result, setResult] = useState<ControlResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const built = useMemo(() => buildTaskSpec(form), [form]);
  const yaml = built.spec ? toYaml(built.spec) : "";
  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!built.spec) return;
    setBusy(true);
    try {
      setResult(await postControl("api/tasks", built.spec));
    } catch (error) {
      setResult({ ok: false, status: 0, detail: String(error) });
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
        Task inputs <span className="muted">(one “key: value” per line, optional)</span>
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
      {result && <div className={`chaos__result ${result.ok ? "" : "chaos__result--bad"}`}>{result.detail}</div>}

      {built.spec && (
        <>
          <pre className="newtask__yaml mono">{yaml}</pre>
          <div className="muted">
            Until runs start from here, save it and run <code>uv run fractalswarm run task.yaml</code>: the fake LLM costs nothing; a real run needs <code>--backend real --confirm-real-spend</code>.
          </div>
        </>
      )}

      <details className="results__raw">
        <summary>Or upload a TaskSpec YAML</summary>
        <YamlUpload />
      </details>
    </section>
  );
}

// The Day 7 fallback: send a TaskSpec YAML as text, for a server that parses it.
function YamlUpload() {
  const [yaml, setYaml] = useState("");
  const [result, setResult] = useState<ControlResult | null>(null);
  return (
    <div className="newtask">
      <input
        type="file"
        accept=".yaml,.yml"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setYaml(await file.text());
        }}
      />
      <textarea value={yaml} onChange={(e) => setYaml(e.target.value)} placeholder="goal: ..." rows={6} spellCheck={false} />
      <button className="btn" disabled={!yaml.trim()} onClick={async () => setResult(await postControl("api/tasks", { yaml }))}>
        Submit the YAML for planning
      </button>
      {result && <div className={`chaos__result ${result.ok ? "" : "chaos__result--bad"}`}>{result.detail}</div>}
    </div>
  );
}
