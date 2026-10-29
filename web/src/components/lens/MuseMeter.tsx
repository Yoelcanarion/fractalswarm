// The Muse meter: what the models of this run cost and how they were used, at the playhead. $ and
// tokens by model, the share of input tokens served from the prompt cache, and the tokens spent on
// coordination and on recovery, which the swarm keeps at zero. Click it to open every call.
//
// Where the playhead is before the end of the run the figures are folded from the calls that had
// ended by then (lib/lens.ts foldMeter); at the end they are the server's own /models, which the
// fold agrees with (lens.test.ts checks it on two recorded runs).

import { Check, ChevronRight, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { foldMeter, formatPercent, formatTokens, formatUsd, type ModelRow } from "../../lib/lens";
import { formatNumber } from "../../lib/motion";
import { useLens, useLensStoreApi } from "../../lensStore";
import { useRunStore } from "../../store";
import { ModelBadge, Skeleton, Tooltip } from "../ui";

const COORDINATION = "Input and output tokens of calls whose role is coordinator, supervisor, router or recovery, or whose tag starts with coord:";
const RECOVERY = "Input and output tokens of calls whose role is recovery or whose tag starts with recovery:";

function modelHint(row: ModelRow): string {
  return `${row.model}: ${row.calls} calls · input ${formatNumber(row.input_tokens)} (cached ${formatNumber(row.cached_tokens)}) · output ${formatNumber(row.output_tokens)} (reasoning ${formatNumber(row.reasoning_tokens)})`;
}

export function MuseMeter() {
  const lens = useLensStoreApi();
  const status = useLens((s) => s.status);
  const error = useLens((s) => s.error);
  const calls = useLens((s) => s.calls);
  const server = useLens((s) => s.meter);
  const playhead = useRunStore((s) => s.playhead);
  const atEnd = useRunStore((s) => s.events.length > 0 && s.cursor >= s.events.length);

  // The models of the whole run, so the chips stay put while the replay fills them in.
  const whole = useMemo(() => foldMeter(calls), [calls]);
  const now = useMemo(() => (atEnd && server ? server : foldMeter(calls, playhead)), [atEnd, server, calls, playhead]);

  if (status === "idle" || status === "unavailable") return null;
  if (status === "loading") {
    return (
      <div className="meter" aria-busy>
        <Skeleton width={460} height={30} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="meter meter--quiet" title={error ?? undefined}>
        Muse meter unavailable
      </div>
    );
  }
  if (whole.totals.calls === 0) {
    return <div className="meter meter--quiet">Muse meter: this run made no model calls</div>;
  }

  const { totals } = now;
  const zero = totals.coordination_tokens === 0 && totals.recovery_tokens === 0;
  const lost = totals.lost_to_cancellation;
  const byModel = new Map(now.models.map((row) => [row.model, row]));
  return (
    <div className="meter" role="group" aria-label="Muse meter">
      <button type="button" className="meter__open" onClick={() => lens.getState().openRun()} title="Open every LLM call of this run">
        Muse meter <ChevronRight size={16} aria-hidden />
      </button>
      {whole.models.map((model) => {
        const row = byModel.get(model.model);
        return (
          <Tooltip key={model.model} placement="bottom" label={modelHint(row ?? { ...model, calls: 0, cost_usd: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })}>
            <span className="meter__model">
              <ModelBadge model={model.model} />
              <span className="meter__usd mono">{formatUsd(row?.cost_usd ?? 0)}</span>
              <span className="meter__tok mono">{formatTokens((row?.input_tokens ?? 0) + (row?.output_tokens ?? 0))} tok</span>
            </span>
          </Tooltip>
        );
      })}
      <span className="meter__sep" aria-hidden />
      <Tooltip placement="bottom" label="Cached input tokens over input tokens, of the calls that completed. Cached tokens are billed at a lower price.">
        <span className="meter__cache">
          <span className="meter__num mono">{formatPercent(totals.cache_hit_share)}</span> of input tokens served from cache
        </span>
      </Tooltip>
      <span className="meter__sep" aria-hidden />
      <Tooltip placement="bottom-end" label={`${COORDINATION}. ${RECOVERY}.`}>
        <span className={`meter__claim ${zero ? "meter__claim--zero" : "meter__claim--some"}`}>
          {zero ? <Check size={16} strokeWidth={2.5} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
          coordination tokens <span className="mono">{formatNumber(totals.coordination_tokens)}</span> · recovery tokens{" "}
          <span className="mono">{formatNumber(totals.recovery_tokens)}</span>
        </span>
      </Tooltip>
      {lost.calls > 0 && (
        <Tooltip placement="bottom-end" label="Calls that were cut off before they completed. They are billed the benchmark's estimate.">
          <span className="meter__lost">
            <span className="mono">{formatNumber(lost.calls)}</span> calls lost · <span className="mono">{formatUsd(lost.cost_usd)}</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
