import { CircleHelp } from "lucide-react";
import { useCallback, useState } from "react";

import type { Site } from "../../lib/controls";
import { afterGuideButton, guideSeen, guideShows, guideSteps, rememberGuide, type GuideMode } from "../../lib/guide";

export interface GuideState {
  open: boolean;
  /** What each step says is showing too: the Guide button asked for it, where a first visit gets the short band. */
  full: boolean;
  /** The Guide button: the sentences, or closed again. */
  toggle: () => void;
  /** "Got it": hide it and do not open it by itself again. */
  dismiss: () => void;
}

/** Short the first time this browser meets the app, closed once it is dismissed, and the button in the top bar brings it back, in full.
 * ``stepped``: the page has numbered steps of its own. */
export function useGuide(stepped = false): GuideState {
  const [mode, setMode] = useState<GuideMode>(() => (guideSeen() ? "closed" : "short"));
  const toggle = useCallback(() => setMode(afterGuideButton), []);
  const dismiss = useCallback(() => {
    rememberGuide();
    setMode("closed");
  }, []);
  return { open: guideShows(mode, stepped), full: mode === "full", toggle, dismiss };
}

/** The button that opens and closes the guide: it sits in the top bar, so it is on every page. */
export function GuideButton({ guide }: { guide: GuideState }) {
  return (
    <button type="button" className="btn btn--seg guide__toggle" aria-expanded={guide.open} aria-controls="guide" onClick={guide.toggle}>
      <CircleHelp size={16} aria-hidden="true" />
      Guide
    </button>
  );
}

/** Three steps for someone who has never seen the app: a heading and where it is done, a row for each, and the Guide button adds what each one
 * says. It sits in the flow under the bars, so it blocks nothing: the page is there under it, and it can be closed at any time. */
export function Guide({ guide, site = "server" }: { guide: GuideState; site?: Site }) {
  if (!guide.open) return null;
  return (
    <section id="guide" className={guide.full ? "guide guide--full" : "guide"} aria-label="How to use the app, in three steps">
      <ol className="guide__steps">
        {guideSteps(site).map((step, index) => (
          <li key={step.id} className="guide__step">
            <span className="guide__n" aria-hidden="true">
              {index + 1}
            </span>
            <div className="guide__text">
              <strong>{step.title}</strong>
              {guide.full && <span>{step.says}</span>}
              {step.action && (
                <a className="guide__go" href={step.action.href}>
                  {step.action.label}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn guide__done" onClick={guide.dismiss}>
        Got it
      </button>
    </section>
  );
}
