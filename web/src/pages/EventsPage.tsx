import { EventList } from "../components/EventList";
import { RunFrame } from "../components/RunFrame";
import { useRunStore } from "../store";

export function EventsPage() {
  const events = useRunStore((s) => s.events);
  const cursor = useRunStore((s) => s.cursor);
  const groups = useRunStore((s) => s.view.groups);
  return (
    <RunFrame>
      <EventList events={events} cursor={cursor} groups={groups} />
    </RunFrame>
  );
}
