import { STEPS, type Step } from "./flow";
import { intakeHash } from "./route";

/** Where the person is: paste, read, review, run. Past the first step, it leads back to the form, which still holds the text. */
export function Steps({ current }: { current: Step }) {
  const at = STEPS.indexOf(current);
  return (
    <ol className="steps" aria-label="Steps">
      {STEPS.map((step, i) => {
        const name = (
          <>
            <span className="steps__n" aria-hidden>
              {i < at ? "✓" : i + 1}
            </span>
            {step}
          </>
        );
        return (
          <li key={step} className={`steps__item${i < at ? " steps__item--done" : ""}${i === at ? " steps__item--now" : ""}`} aria-current={i === at ? "step" : undefined}>
            {i === 0 && i < at ? (
              <a className="steps__back" href={intakeHash(null)} aria-label="Back to the text you pasted">
                {name}
              </a>
            ) : (
              name
            )}
          </li>
        );
      })}
    </ol>
  );
}
