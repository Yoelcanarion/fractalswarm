import type { ReactNode } from "react";

import { Skeleton, SkeletonGroup } from "../../components/ui";
import { useHonesty, type HonestyState } from "./load";
import { WhereItHelps } from "./WhereItHelps";

const Empty = ({ bad = false, children }: { bad?: boolean; children: ReactNode }) => (
  <div className="helps">
    <div className={bad ? "empty empty--bad" : "empty"}>{children}</div>
  </div>
);

/** The panel for each state of the file: loading, not there, unreachable, unreadable (said in words, nothing half shown) or there. */
export function HelpsView({ state }: { state: HonestyState }) {
  switch (state.status) {
    case "loading":
      return (
        <SkeletonGroup label="Loading the verdicts">
          <div className="helps">
            <Skeleton height={72} />
            <Skeleton height={360} />
          </div>
        </SkeletonGroup>
      );
    case "missing":
      return (
        <Empty>
          No verdicts yet: the server has no <code>bench/results/honesty.json</code> (<code>GET /api/bench/honesty</code> answered 404). <code>fractalswarm bench verdicts &lt;results dirs&gt; --prereg</code> writes it.
        </Empty>
      );
    case "unreachable":
      return <Empty bad>The verdicts could not be loaded: {state.reason}.</Empty>;
    case "invalid":
      return <Empty bad>The verdicts could not be read: {state.reason}. The panel shows nothing rather than part of the numbers.</Empty>;
    case "ready":
      return <WhereItHelps honesty={state.honesty} />;
  }
}

/** `#/helps`: the panel on its own page. */
export function HelpsPage() {
  return <HelpsView state={useHonesty()} />;
}
