import { Skeleton, SkeletonGroup } from "../../components/ui";
import { useHonesty } from "./load";
import { WhereItHelps } from "./WhereItHelps";

/** `#/helps`: the panel on its own page, with the file's state spelled out when it is not there to show. */
export function HelpsPage() {
  const state = useHonesty();
  if (state.status === "loading") {
    return (
      <SkeletonGroup label="Loading the verdicts">
        <div className="helps">
          <Skeleton height={72} />
          <Skeleton height={360} />
        </div>
      </SkeletonGroup>
    );
  }
  if (state.status === "invalid") {
    return (
      <div className="helps">
        <div className="empty empty--bad">
          The verdicts could not be read ({state.source === "api" ? "the server's honesty.json" : "the bundled sample"}): {state.reason}. The panel shows nothing rather than part of the numbers.
        </div>
      </div>
    );
  }
  return <WhereItHelps honesty={state.honesty} source={state.source} />;
}
