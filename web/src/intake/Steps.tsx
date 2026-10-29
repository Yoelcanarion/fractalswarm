import { STEPS, type Step } from "./flow";

/** Where the person is: paste, read, review, run. */
export function Steps({ current }: { current: Step }) {
  const at = STEPS.indexOf(current);
  return (
    <ol className="steps" aria-label="Steps">
      {STEPS.map((step, i) => (
        <li key={step} className={`steps__item${i < at ? " steps__item--done" : ""}${i === at ? " steps__item--now" : ""}`} aria-current={i === at ? "step" : undefined}>
          <span className="steps__n" aria-hidden>
            {i < at ? "✓" : i + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}
