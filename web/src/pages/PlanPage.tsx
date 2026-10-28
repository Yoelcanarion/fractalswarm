import { PlanView } from "../components/PlanView";
import { RunFrame } from "../components/RunFrame";
import { useRun } from "../store";

export function PlanPage() {
  const { runId, view, live } = useRun();
  return (
    <RunFrame>
      <PlanView runId={runId!} view={view} live={live} />
    </RunFrame>
  );
}
