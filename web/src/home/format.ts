// How the page writes a number. A missing number is an em dash, never a guess.

import { formatNumber } from "../lib/motion";

export const MINUS = "−";
export const MISSING = "—";

const known = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** `14.6 s` */
export function seconds(value: number | null | undefined, decimals = 1): string {
  return known(value) ? `${formatNumber(value, decimals)} s` : MISSING;
}

/** `+6.6%` and `−6.6%`, with a true minus sign; pass `signed: false` for a share. */
export function percent(value: number | null | undefined, decimals = 1, signed = true): string {
  if (!known(value)) return MISSING;
  const sign = !signed ? "" : value > 0 ? "+" : value < 0 ? MINUS : "";
  return `${sign}${formatNumber(Math.abs(value), decimals)}%`;
}

/** `$0.50` */
export function usd(value: number | null | undefined, decimals = 2): string {
  return known(value) ? `$${formatNumber(value, decimals)}` : MISSING;
}

export function count(value: number | null | undefined): string {
  return known(value) ? formatNumber(value, 0) : MISSING;
}

/** A figure as its source writes it: `decimals` digits if given, else as few as it needs, up to two (13.2, 1.25, 0.9). */
export function figure(value: number, decimals?: number): string {
  if (decimals !== undefined) return formatNumber(value, decimals);
  for (const digits of [0, 1, 2]) {
    const scaled = value * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return formatNumber(value, digits);
  }
  return formatNumber(value, 2);
}

/** `13.2 times`, for a ratio read as "times the supervisor's". */
export function times(value: number | null | undefined, decimals = 1): string {
  return known(value) ? `${formatNumber(value, decimals)} times` : MISSING;
}
