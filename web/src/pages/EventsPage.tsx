import { EventList } from "../components/EventList";
import { RunFrame } from "../components/RunFrame";
import { useRun } from "../store";

export function EventsPage() {
  const { events, cursor, view } = useRun();
  return (
    <RunFrame>
      <EventList events={events} cursor={cursor} groups={view.groups} />
    </RunFrame>
  );
}
