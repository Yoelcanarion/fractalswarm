import { RunFrame } from "../components/RunFrame";
import { SecurityView } from "../components/SecurityView";
import { useRunStore } from "../store";

export function SecurityPage() {
  const view = useRunStore((s) => s.view);
  return (
    <RunFrame>
      <SecurityView view={view} />
    </RunFrame>
  );
}
