import { Fragment } from "react";

import { profileTerm } from "../../lib/glossary";
import type { HeroSet } from "../../lib/hero";
import { captionOf, settingNote, taskOf } from "../../lib/heroText";
import { Term } from "../ui";

export interface SetPickerProps {
  sets: readonly HeroSet[];
  value: string;
  onChange: (name: string) => void;
}

/** Which recorded set to draw. Each says its setting on the button, so a choice is never made blind. */
export function SetPicker({ sets, value, onChange }: SetPickerProps) {
  if (sets.length < 2) return null;
  return (
    <div className="setpicker" role="group" aria-label="Recorded results">
      {sets.map((set) => {
        const caption = captionOf(set);
        return (
          <button
            key={set.name}
            type="button"
            className="setpicker__item"
            aria-pressed={set.name === value}
            onClick={() => onChange(set.name)}
          >
            <span className="setpicker__name">{set.heading}</span>
            <span className="setpicker__meta">
              {caption.backend.label} · {caption.seeds}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What a set is made of, always on screen next to its charts: the model, the task, the seeds, the runs, the file.
 * No chart of the page is shown without it. */
export function SetCaption({ set }: { set: HeroSet }) {
  const caption = captionOf(set);
  const task = taskOf(set.hero.task);
  const note = settingNote(set);
  const levels = [...new Set(set.hero.series.flatMap((s) => s.points.map((p) => profileTerm(p.profile))))].filter(
    (id): id is NonNullable<typeof id> => id !== null,
  );
  return (
    <div className="setcaption">
      <div className="setcaption__line">
        <span className={`badge ${caption.backend.tone === "warn" ? "badge--warn" : ""}`}>{caption.backend.label}</span>
        <span>
          {task.term ? <Term id={task.term}>{task.short}</Term> : task.short}
          {task.name && ` ${task.name}`} · {caption.seeds}
          {caption.runs && ` · ${caption.runs}`}
        </span>
        <span className="mono setcaption__source">{set.source}</span>
      </div>
      {levels.length > 0 && (
        <div className="setcaption__line setcaption__levels">
          <span>Failure levels:</span>
          {levels.map((id, index) => (
            <Fragment key={id}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <Term id={id} />
            </Fragment>
          ))}
        </div>
      )}
      {note && <p className="setcaption__note">{note}</p>}
    </div>
  );
}
