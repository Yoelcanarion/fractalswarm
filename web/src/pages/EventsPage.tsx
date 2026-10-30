import { EventList } from "../components/EventList";
import { RunFrame } from "../components/RunFrame";
import { Term } from "../components/ui";
import { useRunStore } from "../store";

export function EventsPage() {
  const events = useRunStore((s) => s.events);
  const cursor = useRunStore((s) => s.cursor);
  const groups = useRunStore((s) => s.view.groups);
  return (
    <RunFrame
      title="Events"
      lead={
        <>
          Every event in the run's log up to the <Term id="playhead" focusable={false}>playhead</Term>, newest first. Press a row for its payload, or its number to move the
          playhead there.
        </>
      }
    >
      <EventList events={events} cursor={cursor} groups={groups} />
    </RunFrame>
  );
}
