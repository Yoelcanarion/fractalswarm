import { RunFrame } from "../components/RunFrame";
import { SecurityView } from "../components/SecurityView";
import { useRunStore } from "../store";

export function SecurityPage() {
  const view = useRunStore((s) => s.view);
  return (
    <RunFrame
      title="Security"
      lead="Emails are scanned before any agent reads them, and every subgoal has to be a node of the approved plan. This is what was stopped, and why."
    >
      <SecurityView view={view} />
    </RunFrame>
  );
}
