import type { ReactNode } from "react";

import { EmptyState, Skeleton, SkeletonGroup } from "../../components/ui";
import { useHonesty, type HonestyState } from "./load";
import { HelpsHead, WhereItHelps } from "./WhereItHelps";

/** The page around a state of the file. The head is the same whether or not the verdicts are there. */
const Frame = ({ children }: { children: ReactNode }) => (
  <div className="helps">
    <HelpsHead />
    {children}
  </div>
);

const again = (label: string, onRetry?: () => void) =>
  onRetry && (
    <button type="button" className="btn btn--on" onClick={onRetry}>
      {label}
    </button>
  );

export interface HelpsViewProps {
  state: HonestyState;
  /** Ask the server for the file again. Without it a state offers no button for that. */
  onRetry?: () => void;
  /** Show the full count (the table under Details) open from the start: for a frame that points at it and has no address of its own. */
  unfold?: boolean;
}

/** The panel for each state of the file: loading, not there, unreachable, unreadable (said in words, nothing half shown) or there.
 * None of the states without verdicts is a dead end: each says what happened and offers the next step. */
export function HelpsView({ state, onRetry, unfold = false }: HelpsViewProps) {
  switch (state.status) {
    case "loading":
      return (
        <Frame>
          <SkeletonGroup label="Loading the verdicts" className="skeleton-group--stack">
            <Skeleton height={72} />
            <Skeleton height={360} />
          </SkeletonGroup>
        </Frame>
      );
    case "missing":
      return (
        <Frame>
          <EmptyState
            title="No verdicts yet"
            actions={
              <>
                {again("Check again", onRetry)}
                <a className="btn" href="#/charts">
                  Open the charts
                </a>
              </>
            }
          >
            The server has no <code>bench/results/honesty.json</code> (<code>GET /api/bench/honesty</code> answered 404). <code>fractalswarm bench verdicts &lt;results dirs&gt; --prereg</code> writes it.
          </EmptyState>
        </Frame>
      );
    case "unreachable":
      return (
        <Frame>
          <EmptyState tone="bad" title="The verdicts could not be loaded" actions={again("Try again", onRetry)}>
            {state.reason}. The page asks the server for the file, so check that <code>fractalswarm serve</code> is running.
          </EmptyState>
        </Frame>
      );
    case "invalid":
      return (
        <Frame>
          <EmptyState tone="bad" title="The verdicts could not be read" actions={again("Check again", onRetry)}>
            {state.reason}. The panel shows nothing rather than part of the numbers.
          </EmptyState>
        </Frame>
      );
    case "ready":
      return <WhereItHelps honesty={state.honesty} unfold={unfold} />;
  }
}

/** `#/helps`: the panel on its own page. `unfold` opens the full count, which is under Details (`?details=table` does the same). */
export function HelpsPage({ unfold = false }: { unfold?: boolean }) {
  const { state, reload } = useHonesty();
  return <HelpsView state={state} onRetry={reload} unfold={unfold} />;
}
