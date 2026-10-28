// Small helpers shared by the panel folds: tolerant readers for payload fields, and the generic
// row that shows an event no panel interprets yet (spec §16: the UI is a pure projection of the
// event stream, and new event families land while the panels are being written).

import type { RunEvent } from "./types";

export interface GenericEntry {
  seq: number;
  ts: number;
  type: string;
  actor: string;
  text: string;
}

export const GENERIC_CAP = 60;

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export const asString = (value: unknown, fallback = ""): string =>
  value === undefined || value === null ? fallback : String(value);

export const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)];

/** Append to a list that keeps only its newest ``cap`` items. */
export function appendCapped<T>(list: T[], item: T, cap: number): T[] {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export const compact = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : Math.abs(n) >= 10_000
      ? `${(n / 1000).toFixed(0)}k`
      : Math.abs(n) >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : Number.isInteger(n)
          ? String(n)
          : String(Number(n.toFixed(3)));

const SKIPPED_KEYS = new Set(["fence", "idem_key"]);

/** One line that summarizes a payload of unknown shape: its scalar fields, and the size of
 * its lists and objects. */
export function digest(payload: Record<string, unknown>, max = 140): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (SKIPPED_KEYS.has(key) || value === null || value === undefined) continue;
    if (typeof value === "string") parts.push(`${key}=${value.length > 28 ? `${value.slice(0, 27)}…` : value}`);
    else if (typeof value === "number") parts.push(`${key}=${compact(value)}`);
    else if (typeof value === "boolean") parts.push(`${key}=${value}`);
    else if (Array.isArray(value)) parts.push(`${key}[${value.length}]`);
    else parts.push(`${key}{${Object.keys(value as object).length}}`);
  }
  const line = parts.join("  ");
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const genericEntry = (event: RunEvent): GenericEntry => ({
  seq: event.seq,
  ts: event.ts_virtual,
  type: event.type,
  actor: event.actor,
  text: digest(event.payload),
});
