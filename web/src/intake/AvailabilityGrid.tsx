import { givenCells, toggleCell } from "./edit";
import { describeCells } from "./format";
import type { Proposal, Speaker } from "./proposal";

export interface AvailabilityGridProps {
  proposal: Pick<Proposal, "days" | "slots">;
  speaker: Speaker;
  onChange: (speaker: Speaker) => void;
  disabled: boolean;
}

/** A speaker's cells of the program's grid: a button per day and slot, pressed when they can give it. Nothing stated
 * is every cell pressed. The last cell cannot be taken back: the server would read none as "nothing stated". */
export function AvailabilityGrid({ proposal, speaker, onChange, disabled }: AvailabilityGridProps) {
  const given = new Set(givenCells(proposal, speaker).map(([day, slot]) => `${day}:${slot}`));
  return (
    <div className="avail" role="group" aria-label={`${speaker.name || speaker.id}: availability`}>
      <p className="avail__summary">{describeCells(proposal, speaker.available)}</p>
      <div className="avail__cells" style={{ gridTemplateColumns: `auto repeat(${proposal.slots.length}, minmax(0, 1fr))` }}>
        <span />
        {proposal.slots.map((slot) => (
          <span key={slot.index} className="avail__time mono">
            {slot.start}
          </span>
        ))}
        {proposal.days.map((day) => (
          <div key={day} className="avail__day">
            <span className="avail__dayname">Day {day}</span>
            {proposal.slots.map((slot) => {
              const on = given.has(`${day}:${slot.index}`);
              return (
                <button
                  key={slot.index}
                  type="button"
                  className={`avail__cell${on ? " avail__cell--on" : ""}`}
                  aria-pressed={on}
                  aria-label={`Day ${day} ${slot.start} to ${slot.end}`}
                  disabled={disabled}
                  onClick={() => onChange(toggleCell(proposal, speaker, [day, slot.index]))}
                />
              );
            })}
          </div>
        ))}
      </div>
      <button type="button" className="btn" disabled={disabled || speaker.available === null} onClick={() => onChange({ ...speaker, available: null })}>
        Any time
      </button>
    </div>
  );
}
