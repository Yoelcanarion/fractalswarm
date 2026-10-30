// The text of a number that counts up, with no DOM in it: the same progress always gives the same
// text, so a number can be scrubbed both ways, and the end of the count is exactly the number.

import { easeOutCubic, lerp } from "../shared";

export interface CountSpec {
  value: number;
  /** Places after the point. Left out, a whole number has none and any other has the places it was written with, up to three. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Where the count starts. 0 unless told otherwise. */
  from?: number;
}

/** A bare number is a count of that number, from nothing. */
export type CountData = number | CountSpec;

export interface Count {
  value: number;
  decimals: number;
  prefix: string;
  suffix: string;
  from: number;
}

const placesOf = (n: number): number => {
  const text = String(n);
  if (/e/i.test(text)) return 3;
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : Math.min(3, text.length - dot - 1);
};

export function countSpec(data: CountData): Count {
  const spec: CountSpec = typeof data === "number" ? { value: data } : data;
  const decimals = Math.max(0, Math.min(6, Math.floor(spec.decimals ?? (Number.isFinite(spec.value) ? placesOf(spec.value) : 0))));
  return { value: spec.value, decimals, prefix: spec.prefix ?? "", suffix: spec.suffix ?? "", from: spec.from ?? 0 };
}

/** 1234.5 is "1,234.5", and a negative number has the minus sign the charts use. */
export function formatCount(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return "–";
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, rest] = fixed.split(".") as [string, string | undefined];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const negative = n < 0 && Number(fixed) !== 0;
  return `${negative ? "−" : ""}${grouped}${rest !== undefined ? `.${rest}` : ""}`;
}

/** The text at progress p: prefix, the number the count has reached, suffix. At 1 it is the number itself. */
export function countText(count: Count, p: number): string {
  const { value, from, decimals, prefix, suffix } = count;
  if (!Number.isFinite(value)) return "–";
  const shown = p >= 1 ? value : p <= 0 ? from : lerp(from, value, easeOutCubic(p));
  return `${prefix}${formatCount(shown, decimals)}${suffix}`;
}
