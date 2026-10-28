import type { ReactNode } from "react";

import { asRecord, compact, digest } from "../lib/generic";
import { money, percent, Pill } from "./PanelParts";

const SKIPPED = new Set(["fence", "idem_key"]);
const VERDICTS: Record<string, "good" | "warn" | "bad" | "muted"> = {
  fits: "good",
  pass: "good",
  ok: "good",
  tight: "warn",
  skipped: "warn",
  over: "bad",
  fail: "bad",
  failed: "bad",
  unbudgeted: "muted",
};

const clip = (text: string, max = 220): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// A number's unit comes from its key: ``cost_p90_usd`` is money, ``duration_p50_s`` is seconds.
function number(key: string, value: number): string {
  if (/usd|cost|price/i.test(key)) return money(value, 3);
  if (/(^|_)ms$/.test(key)) return `${(value / 1000).toFixed(1)} s`;
  if (/(^|_)(s|seconds)$|duration/i.test(key)) return `${value.toFixed(1)} s`;
  if (/share|fraction|rate|ratio|pct/i.test(key) && value >= 0 && value <= 1) return percent(value);
  return compact(value);
}

function cell(key: string, value: unknown, depth: number): ReactNode {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return number(key, value);
  if (typeof value === "string") {
    const tone = /verdict|status|decision/i.test(key) ? VERDICTS[value] : undefined;
    return tone ? <Pill tone={tone}>{value}</Pill> : clip(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">none</span>;
    if (value.every((item) => item === null || typeof item !== "object")) return clip(value.map(String).join(", "));
    return (
      <ul className="kv__list">
        {value.slice(0, 8).map((item, i) => (
          <li key={i}>{typeof item === "object" && item !== null ? digest(asRecord(item), 160) : String(item)}</li>
        ))}
        {value.length > 8 && <li className="muted">+{value.length - 8} more</li>}
      </ul>
    );
  }
  if (value !== null && typeof value === "object") {
    return depth < 2 ? <KeyValues data={asRecord(value)} depth={depth + 1} /> : digest(asRecord(value), 160);
  }
  return <span className="muted">–</span>;
}

// The answer first: a verdict is what the reader came for.
const FIRST = ["verdict", "status", "decision"];
const rank = (key: string): number => {
  const at = FIRST.indexOf(key);
  return at < 0 ? FIRST.length : at;
};

/** The fields of a payload as a table, whatever they are: the unit of a number comes from its key,
 * a verdict is a pill (and comes first), a list is a list and an object is a nested table. */
export function KeyValues({ data, depth = 0 }: { data: Record<string, unknown>; depth?: number }) {
  const rows = Object.entries(data)
    .filter(([key, value]) => !SKIPPED.has(key) && value !== null && value !== undefined)
    .sort(([a], [b]) => rank(a) - rank(b));
  return (
    <table className={`ptable kv ${depth > 0 ? "kv--nested" : ""}`}>
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key}>
            <td className="mono kv__key">{key}</td>
            <td>{cell(key, value, depth)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
