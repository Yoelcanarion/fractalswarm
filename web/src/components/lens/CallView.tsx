// One call in full: who made it and with which model, what it cost, what it was given and what it
// said. On a replay it shows the call as the playhead sees it, so a call still in flight shows its
// prompt and no answer: nothing is revealed before it happened.

import { Info, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  describeCall,
  formatDuration,
  formatPercent,
  formatUsd,
  phaseAt,
  purposeLabel,
  type CallDetail,
  type CallPhase,
  type CallRow,
} from "../../lib/lens";
import { formatNumber } from "../../lib/motion";
import type { DetailEntry } from "../../lensStore";
import { ModelBadge, SkeletonText, Tooltip } from "../ui";
import { Output } from "./Output";

const CLIP = 6000;

const clip = (text: string, max = CLIP): string =>
  text.length > max ? `${text.slice(0, max)}\n… ${formatNumber(text.length - max)} more characters` : text;

const pretty = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

function Figure({ label, value, sub, hint }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string }) {
  const body = (
    <div className="figure">
      <div className="figure__label">{label}</div>
      <div className="figure__value">{value}</div>
      {sub && <div className="figure__sub">{sub}</div>}
    </div>
  );
  return hint ? (
    <Tooltip label={hint} focusable>
      {body}
    </Tooltip>
  ) : (
    body
  );
}

function Figures({ row, detail }: { row: CallRow; detail: CallDetail | null }) {
  const u = row.usage;
  const breakdown = detail?.cost_breakdown;
  const cost = breakdown
    ? `Paid: input ${formatUsd(breakdown.input_usd)}, cached input ${formatUsd(breakdown.cached_input_usd)}, output ${formatUsd(breakdown.output_usd)} (reasoning is ${formatUsd(breakdown.reasoning_usd)} of the output).`
    : row.estimated
      ? "The call was cut off before it completed, so it is billed the benchmark's estimate."
      : undefined;
  // A call cut off before it completed has no measured usage: its tokens are the benchmark's estimate,
  // and the cached and reasoning shares are not known, so they are not shown as zero.
  const estimated = row.estimated;
  return (
    <div className="figures">
      <Figure
        label="Input tokens"
        value={formatNumber(u.input_tokens)}
        sub={estimated ? "estimated" : u.input_tokens > 0 ? `${formatNumber(u.cached_tokens)} cached · ${formatPercent(u.cached_tokens / u.input_tokens)}` : undefined}
        hint="Tokens the model read. Cached tokens were served from the prompt cache at a lower price."
      />
      <Figure
        label="Reasoning tokens"
        value={estimated ? "—" : formatNumber(u.reasoning_tokens)}
        sub={estimated ? "not known" : "part of the output"}
        hint="Tokens the model spent thinking. They are billed as output; their content stays with the provider."
      />
      <Figure label="Output tokens" value={formatNumber(u.output_tokens)} sub={estimated ? "estimated" : u.searches > 0 ? `${u.searches} searches` : undefined} />
      <Figure label="Cost" value={formatUsd(row.cost_usd)} sub={estimated ? "estimated" : undefined} hint={cost} />
      <Figure
        label="Latency"
        value={formatDuration(row.latency_ms)}
        sub={row.attempts && row.attempts > 1 ? `${row.attempts} attempts` : undefined}
        hint="Time the provider took to answer, on the run's clock."
      />
    </div>
  );
}

function Notices({ row }: { row: CallRow }) {
  const notices: { tone: "bad" | "warn" | "info"; text: string }[] = [];
  if (row.cancel) {
    notices.push({ tone: "bad", text: `${row.cancel.detail}. It never completed${row.estimated ? `, so it is billed the benchmark's estimate (${formatUsd(row.cost_usd)}).` : "."}` });
  } else if (row.status === "inflight") {
    notices.push({ tone: "warn", text: "This call started and the log never records how it ended." });
  } else if (row.estimated) {
    notices.push({ tone: "warn", text: "Cut off before it completed: the cost and tokens are the benchmark's estimate." });
  }
  if (row.error) notices.push({ tone: "bad", text: `Error: ${row.error}` });
  if (row.incomplete_reason) notices.push({ tone: "warn", text: `The answer was cut short: ${row.incomplete_reason}.` });
  if (row.reissued) notices.push({ tone: "warn", text: `Asked again${row.reissued.reason ? `: ${row.reissued.reason}` : ""}.` });
  if (row.routing?.contributor) {
    const categories = [...new Set(row.routing.findings.map((f) => f.category || f.kind))];
    notices.push({
      tone: "info",
      text: `Routed to the Contributor model: ${row.routing.reason || "the PII check allowed it"}${categories.length ? ` (found: ${categories.join(", ")})` : ""}.`,
    });
  } else if (row.routing && row.routing.reason) {
    notices.push({ tone: "info", text: `Kept off the Contributor model: ${row.routing.reason}.` });
  }
  if (notices.length === 0) return null;
  return (
    <ul className="notices">
      {notices.map((notice, i) => (
        <li key={i} className={`notice notice--${notice.tone}`}>
          {notice.tone === "info" ? <Info size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
          <span>{notice.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Given({ detail }: { detail: CallDetail }) {
  const { prompt } = detail;
  const data = Object.entries(prompt.data);
  const untrusted = Object.entries(prompt.untrusted);
  return (
    <details className="lens-fold">
      <summary>What the model was given</summary>
      {prompt.text && <pre className="lens-pre">{clip(prompt.text)}</pre>}
      {data.map(([name, value]) => (
        <details key={name} className="lens-fold lens-fold--inner">
          <summary>
            <span className="mono">{name}</span> <span className="muted">data</span>
          </summary>
          <pre className="lens-pre mono">{clip(pretty(value))}</pre>
        </details>
      ))}
      {untrusted.map(([name, value]) => (
        <details key={name} className="lens-fold lens-fold--inner">
          <summary>
            <span className="mono">{name}</span> <span className="lens-untrusted">untrusted data</span>
          </summary>
          <p className="muted">Text from outside, shown as the model saw it. The model is told to treat it as data, never as instructions.</p>
          <pre className="lens-pre mono">{clip(pretty(value))}</pre>
        </details>
      ))}
      {prompt.tools.length > 0 && (
        <p className="muted">
          Tools offered: <span className="mono">{prompt.tools.join(", ")}</span>
          {prompt.schema && (
            <>
              {" "}
              · answer schema <span className="mono">{prompt.schema}</span>
            </>
          )}
        </p>
      )}
      {prompt.instructions && (
        <details className="lens-fold lens-fold--inner">
          <summary>Role instructions</summary>
          <pre className="lens-pre">{clip(prompt.instructions)}</pre>
        </details>
      )}
    </details>
  );
}

function Caused({ detail }: { detail: CallDetail }) {
  const [bookkeeping, setBookkeeping] = useState(false);
  const events = detail.decision.events.filter((event) => bookkeeping || !event.bookkeeping);
  if (detail.decision.events.length === 0) return null;
  return (
    <details className="lens-fold">
      <summary>
        What the answer caused <span className="lens-count">{events.length}</span>
      </summary>
      <label className="lens-check">
        <input type="checkbox" checked={bookkeeping} onChange={(e) => setBookkeeping(e.target.checked)} /> show the budget bookkeeping
      </label>
      <ol className="caused">
        {events.map((event) => (
          <li key={event.seq} className="caused__row">
            <span className="mono caused__seq">{event.seq}</span>
            <span className="caused__type">{event.type}</span>
            <span className="caused__text">{event.summary}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Attempts({ detail }: { detail: CallDetail }) {
  const log = detail.attempt_log ?? [];
  if (log.length <= 1) return null;
  return (
    <details className="lens-fold">
      <summary>
        Attempts <span className="lens-count">{log.length}</span>
      </summary>
      <ol className="caused">
        {log.map((attempt, i) => (
          <li key={i} className="caused__row">
            <span className="mono caused__seq">{i + 1}</span>
            <span className="caused__type">{attempt.status ?? "no answer"}</span>
            <span className="caused__text">
              {formatDuration(attempt.latency_ms)}
              {attempt.error ? ` · ${attempt.error}` : ""}
              {attempt.retry_after_ms ? ` · retry after ${formatDuration(attempt.retry_after_ms)}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export interface CallViewProps {
  row: CallRow;
  /** The call read in full, or how far reading it got. */
  entry: DetailEntry | undefined;
  /** The playhead, in virtual ms. */
  playhead: number;
  onRetry(): void;
}

export function CallView({ row, entry, playhead, onRetry }: CallViewProps) {
  const phase: CallPhase = phaseAt(row, playhead);
  const { title, where } = describeCall(row);
  const detail = entry?.state === "ready" ? entry.detail : null;
  return (
    <article className="call" aria-label={`${title} ${where}`}>
      <header className="call__head">
        <ModelBadge model={row.model ?? "unknown"} version />
        {row.effort && <span className="tag">effort {row.effort}</span>}
        <span className="tag">{purposeLabel(row.purpose)}</span>
        {row.badge === "contributor" && <span className="tag">routed through the PII gate</span>}
      </header>
      <h3 className="call__title">
        {title} <span className="call__where mono">{where}</span>
      </h3>
      <p className="call__who muted">
        Made by <span className="mono">{row.actor}</span> ({row.role}) · started at {seconds(row.started_ts)}
        {phase === "done" && row.ended_ts !== null ? ` · ended at ${seconds(row.ended_ts)}` : ""}
      </p>

      {phase === "future" && <p className="lens-empty">This call starts at {seconds(row.started_ts)}, after the playhead.</p>}

      {phase === "inflight" && (
        <p className="lens-wait" role="status">
          <span className="lens-wait__dot" aria-hidden /> Waiting for the model: {seconds(Math.max(0, playhead - row.started_ts))} so far.
        </p>
      )}

      {phase === "done" && (
        <>
          <Figures row={row} detail={detail} />
          <Notices row={row} />
        </>
      )}

      {phase !== "future" && entry?.state === "loading" && <SkeletonText lines={6} />}
      {phase !== "future" && entry === undefined && <SkeletonText lines={6} />}
      {entry?.state === "error" && (
        <div className="notice notice--bad">
          <TriangleAlert size={16} aria-hidden />
          <span>Could not read this call: {entry.error}</span>
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {detail && phase !== "future" && (
        <>
          {phase === "done" && <Output detail={detail} />}
          <Given detail={detail} />
          {phase === "done" && (
            <>
              <details className="lens-fold">
                <summary>The answer, as the model wrote it</summary>
                <pre className="lens-pre">{clip(detail.output.text || pretty(detail.output.parsed ?? "(no text)"))}</pre>
              </details>
              <Caused detail={detail} />
              <Attempts detail={detail} />
            </>
          )}
        </>
      )}
    </article>
  );
}
