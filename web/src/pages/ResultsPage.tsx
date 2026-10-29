import { ResultsView } from "../components/ResultsView";
import { RunFrame } from "../components/RunFrame";
import { useRunStore } from "../store";

export function ResultsPage() {
  const view = useRunStore((s) => s.view);
  return (
    <RunFrame>
      <ResultsView view={view} />
    </RunFrame>
  );
}
