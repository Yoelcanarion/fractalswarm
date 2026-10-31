import { useMemo, useState } from "react";

import type { IntakeApi } from "./api";
import { chaosLabel, DEFAULT_CHOICE, launchBody, PAIR_CHAOS, requestFor, RIVALS, RUN_CHAOS, RUN_SCENARIOS, scenarioLabel, startedRuns, untilRunsListed, watchHash, type Choice } from "./launch";
import { SpendPanel } from "./SpendPanel";
import { useSpend } from "./useSpend";

export interface RunPanelProps {
  api: IntakeApi;
  intakeId: string;
  /** The server lets a launch be billed. */
  realAllowed: boolean;
  /** The server starts runs from the API at all. */
  canStart: boolean;
  /** Where the person goes once it has started. */
  onStarted: (hash: string) => void;
  /** The choices it opens on: the arena pair on the default failure plan, free, unless told otherwise. */
  initial?: Choice;
}

const SPEEDS = [1, 2, 5, 10, 20] as const;

function Seg<T extends string | number>({ label, value, options, words, onChange, disabled }: { label: string; value: T; options: readonly T[]; words: (value: T) => string; onChange: (value: T) => void; disabled?: (value: T) => boolean }) {
  return (
    <div className="runit__field" role="radiogroup" aria-label={label}>
      <span className="runit__label">{label}</span>
      <div className="runit__seg">
        {options.map((option) => (
          <button key={String(option)} type="button" role="radio" aria-checked={option === value} className={`btn btn--seg${option === value ? " btn--on" : ""}`} disabled={disabled?.(option) ?? false} onClick={() => onChange(option)}>
            {words(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What to run on the approved reading: the arena pair (the swarm against a rival on one failure plan) or one run, on the
 * simulated clock and the practice LLM at no cost, or billed: then the worst case and the caps first, and the typed word. */
export function RunPanel({ api, intakeId, realAllowed, canStart, onStarted, initial = DEFAULT_CHOICE }: RunPanelProps) {
  const [choice, setChoice] = useState<Choice>(initial);
  const set = <K extends keyof Choice>(key: K, value: Choice[K]) => setChoice((current) => ({ ...current, [key]: value }));
  const body = useMemo(() => launchBody(intakeId, choice), [intakeId, choice]);
  const billed = choice.backend === "real";
  const spend = useSpend(api, choice.mode === "pair" ? "arena" : "task", body);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chaos = choice.mode === "pair" ? choice.pairChaos : choice.runChaos;

  const launch = async () => {
    const request = requestFor(body, spend.gateNow(), spend.typed);
    if ("refused" in request) return;
    setLaunching(true);
    setError(null);
    const outcome = await (choice.mode === "pair" ? api.launchArena(request.send) : api.launchTask(request.send));
    if (billed) spend.spent(); // the token is used up, whatever came of it
    // accepted is not started: the page that watches it finds no run until the server has made it, so it is not opened before
    if (outcome.ok) await untilRunsListed(api.listedRuns, startedRuns(outcome.body));
    setLaunching(false);
    if (outcome.ok) onStarted(watchHash(outcome.body));
    else setError(outcome.error);
  };

  return (
    <section className="panel runit" aria-label="Run the approved reading">
      <h3 className="panel__title">Run it</h3>
      {!canStart && <p className="runit__off">This server does not start runs from the API, so nothing can be started from here.</p>}
      <Seg label="What to run" value={choice.mode} options={["pair", "run"] as const} words={(mode) => (mode === "pair" ? "Arena pair" : "One run")} onChange={(mode) => set("mode", mode)} />
      {choice.mode === "pair" ? (
        <Seg label="Against" value={choice.rival} options={RIVALS} words={scenarioLabel} onChange={(rival) => set("rival", rival)} />
      ) : (
        <Seg label="System" value={choice.scenario} options={RUN_SCENARIOS} words={scenarioLabel} onChange={(scenario) => set("scenario", scenario)} />
      )}
      {choice.mode === "pair" ? (
        <Seg label="Failures" value={choice.pairChaos} options={PAIR_CHAOS} words={(plan) => (plan === "half-the-brains" ? "Half the brains" : plan)} onChange={(plan) => set("pairChaos", plan)} />
      ) : (
        <Seg label="Failures" value={choice.runChaos} options={RUN_CHAOS} words={(plan) => (plan === "kill-half" ? "Kill half" : plan)} onChange={(plan) => set("runChaos", plan)} />
      )}
      <p className="runit__says">{chaosLabel(chaos)}</p>
      <Seg label="Clock" value={choice.clock} options={["sim", "live"] as const} words={(clock) => (clock === "sim" ? "Simulated" : "Live")} onChange={(clock) => set("clock", clock)} />
      {choice.clock === "live" && <Seg label="Speed" value={choice.speed} options={SPEEDS} words={(speed) => `${speed}×`} onChange={(speed) => set("speed", speed)} />}
      <Seg
        label="Model"
        value={choice.backend}
        options={["fake", "real"] as const}
        words={(backend) => (backend === "fake" ? "Practice LLM · free" : "Meta Model API · billed")}
        onChange={(backend) => set("backend", backend)}
        disabled={(backend) => backend === "real" && !realAllowed}
      />
      {!realAllowed && <p className="runit__says">Billed launches are off on this server.</p>}

      {billed ? (
        <SpendPanel
          what={choice.mode === "pair" ? "the arena pair" : "the run"}
          checked={spend.checked}
          checking={spend.checking}
          error={spend.error}
          gate={spend.gate}
          typed={spend.typed}
          onTyped={spend.setTyped}
          onCheck={spend.check}
          onLaunch={() => void launch()}
          launching={launching}
          launchLabel={choice.mode === "pair" ? "Start the arena pair (billed)" : "Start the run (billed)"}
        />
      ) : (
        <button type="button" className="btn btn--big btn--on" disabled={!canStart || launching} onClick={() => void launch()}>
          {launching ? "Starting…" : choice.mode === "pair" ? "Start the arena pair" : "Start the run"}
        </button>
      )}
      {error !== null && (
        <p className="runit__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
