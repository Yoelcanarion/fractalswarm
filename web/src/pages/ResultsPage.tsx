import { ResultsView } from "../components/ResultsView";
import { RunFrame } from "../components/RunFrame";
import { Term } from "../components/ui";
import { useRunStore } from "../store";

export function ResultsPage() {
  const view = useRunStore((s) => s.view);
  return (
    <RunFrame
      title="Results"
      lead={
        <>
          What the run reported, how each goal was checked and what it spent, as they stood at the <Term id="playhead" focusable={false}>playhead</Term>.
        </>
      }
    >
      <ResultsView view={view} />
    </RunFrame>
  );
}
