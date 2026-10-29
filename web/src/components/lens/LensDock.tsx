// The Muse lens panel: a drawer over the right of the run page, above the timeline, so the scrubber
// stays in reach while a call is open. A person opens it by clicking a node of the tree (that
// actor's calls), the Muse meter (every call), or an LLM call in the event log; it follows the
// playhead, so scrubbing back shows a call in flight and then not yet started.

import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { useEffect, useMemo } from "react";

import { startedBy } from "../../lib/lens";
import { useLens, useLensStoreApi } from "../../lensStore";
import { useRunStore } from "../../store";
import { Skeleton, SkeletonGroup } from "../ui";
import { CallList } from "./CallList";
import { CallView } from "./CallView";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function Panel() {
  const lens = useLensStoreApi();
  const reduced = useReducedMotion();
  const scope = useLens((s) => s.scope);
  const selected = useLens((s) => s.selected);
  const calls = useLens((s) => s.calls);
  const details = useLens((s) => s.details);
  const status = useLens((s) => s.status);
  const error = useLens((s) => s.error);
  const playhead = useRunStore((s) => s.playhead);
  const actorKind = useRunStore((s) => (scope.kind === "actor" ? s.view.actors[scope.actor]?.kind : undefined));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) lens.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lens]);

  const started = useMemo(() => startedBy(calls, playhead), [calls, playhead]);
  const own = useMemo(
    () => (scope.kind === "actor" ? started.filter((c) => c.actor === scope.actor) : started),
    [started, scope],
  );
  const ownTotal = useMemo(() => (scope.kind === "actor" ? calls.filter((c) => c.actor === scope.actor).length : calls.length), [calls, scope]);
  const row = selected === null ? undefined : calls.find((c) => c.effect_id === selected);

  const slide = reduced ? {} : { x: 36 };
  return (
    <m.aside
      className="lens"
      role="complementary"
      aria-label="Muse lens"
      initial={{ opacity: 0, ...slide }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, ...(reduced ? {} : { x: 24 }) }}
      transition={{ duration: reduced ? 0.01 : 0.24, ease: EASE_OUT }}
    >
      <header className="lens__head">
        <h2 className="lens__title">
          <Sparkles size={18} aria-hidden /> Muse lens
        </h2>
        <div className="lens__scope" role="group" aria-label="Which calls to list">
          {scope.kind === "actor" && (
            <button type="button" className="chip chip--on" aria-pressed="true">
              <span className="mono">{scope.actor}</span>
              {actorKind && <span className="muted"> {actorKind}</span>}
              <span className="mono"> {own.length}</span>
            </button>
          )}
          <button
            type="button"
            className={scope.kind === "run" ? "chip chip--on" : "chip"}
            aria-pressed={scope.kind === "run"}
            onClick={() => lens.getState().openRun()}
          >
            Every call <span className="mono">{started.length}</span>
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label="Close the lens" title="Close (Esc)" onClick={() => lens.getState().close()}>
          <X size={18} aria-hidden />
        </button>
      </header>

      {status === "loading" && (
        <SkeletonGroup label="Loading the calls of this run">
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </SkeletonGroup>
      )}
      {status === "error" && <p className="lens-empty">Could not read the calls of this run: {error}</p>}
      {status === "unavailable" && <p className="lens-empty">This server does not offer the Muse lens.</p>}

      {status === "ready" && (
        <>
          <div className="lens__list">
            {own.length === 0 ? (
              <p className="lens-empty">
                {scope.kind === "actor"
                  ? ownTotal === 0
                    ? `${scope.actor} makes no LLM calls: it does not call a model.`
                    : `${scope.actor} has not called a model yet at this point of the replay.`
                  : "No model has been called yet at this point of the replay."}
              </p>
            ) : (
              <CallList
                calls={own}
                selected={selected}
                playhead={playhead}
                showActor={scope.kind === "run"}
                filterable={scope.kind === "run"}
                onSelect={(id) => lens.getState().select(id)}
              />
            )}
          </div>
          <div className="lens__body">
            {row ? (
              <CallView key={row.effect_id} row={row} entry={details[row.effect_id]} playhead={playhead} onRetry={() => void lens.getState().loadDetail(row.effect_id)} />
            ) : (
              own.length > 0 && <p className="lens-empty">Pick a call to see what the model read and what it said.</p>
            )}
          </div>
        </>
      )}
    </m.aside>
  );
}

/** Mount inside the run page's `.run`, before the timeline. It draws nothing while closed. */
export function LensDock() {
  const open = useLens((s) => s.open);
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>{open && <Panel key="lens" />}</AnimatePresence>
    </LazyMotion>
  );
}
