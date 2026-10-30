import { CircleHelp } from "lucide-react";
import { useCallback, useState } from "react";

import { GUIDE_STEPS, guideSeen, rememberGuide } from "../../lib/guide";

export interface GuideState {
  open: boolean;
  /** Show or hide it by hand. */
  toggle: () => void;
  /** "Got it": hide it and do not open it by itself again. */
  dismiss: () => void;
}

/** Open the first time this browser meets the app, closed once it is dismissed, and the button in the top bar brings it back. */
export function useGuide(): GuideState {
  const [open, setOpen] = useState(() => !guideSeen());
  const toggle = useCallback(() => setOpen((now) => !now), []);
  const dismiss = useCallback(() => {
    rememberGuide();
    setOpen(false);
  }, []);
  return { open, toggle, dismiss };
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

/** Three steps for someone who has never seen the app. It sits in the flow under the bars, so it blocks nothing: the page is there
 * under it, and it can be closed at any time. */
export function Guide({ guide }: { guide: GuideState }) {
  if (!guide.open) return null;
  return (
    <section id="guide" className="guide" aria-label="How to use the app, in three steps">
      <ol className="guide__steps">
        {GUIDE_STEPS.map((step, index) => (
          <li key={step.id} className="guide__step">
            <span className="guide__n" aria-hidden="true">
              {index + 1}
            </span>
            <div className="guide__text">
              <strong>{step.title}</strong>
              <span>{step.says}</span>
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
