import { ResultsView } from "../components/ResultsView";
import { RunFrame } from "../components/RunFrame";
import { useRun } from "../store";

export function ResultsPage() {
  const view = useRun((s) => s.view);
  return (
    <RunFrame>
      <ResultsView view={view} />
    </RunFrame>
  );
}
