import { stateLine } from "../lib/runstate";
import type { ViewState } from "../lib/reducer";
import { useRunStoreShallow } from "../store";
import { Counters } from "./Counters";
import { PlayAction } from "./PlayAction";

/** What a run page says before it shows anything: the state of the run in one sentence, the one main action beside it, and the three
 * numbers that are the run's claim (coordination tokens, hand-overs, what it cost). Every other counter is under the page's Details. */
export function RunState({ view }: { view: ViewState }) {
  const { live, playing, cursor, events, runStatus, verify } = useRunStoreShallow((s) => ({
    live: s.live,
    playing: s.playing,
    cursor: s.cursor,
    events: s.events,
    runStatus: s.runStatus,
    verify: s.verify,
  }));
  const line = stateLine(view, {
    live,
    playing,
    cursor,
    total: events.length,
    status: runStatus,
    endMs: events.at(-1)?.ts_virtual ?? 0,
    verified: verify.state === "done" && verify.report.ok && verify.report.bundle_head_ok,
  });
  return (
    <div className="runstate">
      <p className={`runstate__line runstate__line--${line.tone}`}>
        <span className="runstate__dot" aria-hidden />
        <span>
          <strong className="runstate__head">{line.headline}</strong> {line.rest}.
        </span>
      </p>
      <PlayAction />
      <Counters view={view} headline />
    </div>
  );
}
