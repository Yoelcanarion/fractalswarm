// Small pieces of motion shared by the components: the reduced-motion preference, an easing, and
// the number tween behind the count-up of ``Stat``. Pure, so they can be tested without a DOM.

/** True when the person asked the system for less motion. False on the server and in tests. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** The value ``elapsedMs`` into a tween from ``from`` to ``to`` that lasts ``durationMs``. */
export function tween(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  return from + (to - from) * easeOutCubic(elapsedMs / durationMs);
}

const formatters = new Map<number, Intl.NumberFormat>();

/** ``1234.5`` -> ``"1,234.5"`` with a fixed number of decimals; ``"—"`` for NaN and infinities. */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  let format = formatters.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, format);
  }
  return format.format(value);
}
