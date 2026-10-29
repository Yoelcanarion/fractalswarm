import { PlanView } from "../components/PlanView";
import { RunFrame } from "../components/RunFrame";
import { useRunStore, useRunStoreShallow } from "../store";

export function PlanPage() {
  const { runId, live } = useRunStoreShallow((s) => ({ runId: s.runId, live: s.live }));
  const view = useRunStore((s) => s.view);
  return (
    <RunFrame>
      <PlanView runId={runId!} view={view} live={live} />
    </RunFrame>
  );
}
