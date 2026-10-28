import { RunFrame } from "../components/RunFrame";
import { SecurityView } from "../components/SecurityView";
import { useRun } from "../store";

export function SecurityPage() {
  const view = useRun((s) => s.view);
  return (
    <RunFrame>
      <SecurityView view={view} />
    </RunFrame>
  );
}
