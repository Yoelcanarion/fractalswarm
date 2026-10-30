import { PlanView } from "../components/PlanView";
import { RunFrame } from "../components/RunFrame";
import { useRunStore, useRunStoreShallow } from "../store";

export function PlanPage() {
  const { runId, live } = useRunStoreShallow((s) => ({ runId: s.runId, live: s.live }));
  const view = useRunStore((s) => s.view);
  return (
    <RunFrame title="Plan" lead="The plan the root proposed for this task, who approved it, and what the approved plan lets a subgoal do.">
      <PlanView runId={runId!} view={view} live={live} />
    </RunFrame>
  );
}
