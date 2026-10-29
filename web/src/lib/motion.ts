// Small pieces of motion shared by the components: the reduced-motion preference, easings, and
// the number tween behind the count-up of ``Stat``. Pure, so they can be tested without a DOM.

// A MediaQueryList is live: ``matches`` follows the system setting, so one query serves every call
// (the tree asks once per render).
let reduceQuery: MediaQueryList | null | undefined;

/** True when the person asked the system for less motion. False on the server and in tests. */
export function prefersReducedMotion(): boolean {
  if (reduceQuery === undefined) {
    reduceQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  }
  return reduceQuery?.matches ?? false;
}

export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** CSS ``cubic-bezier(x1, y1, x2, y2)`` as a function of progress (0 to 1), for tweens made in JS
 * that must match a curve in the style sheet. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const y = (s: number): number => ((ay * s + by) * s + cy) * s;
  const slope = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;

  // The curve is x(s), y(s); progress is x, so find s for a given x: Newton first, then bisection.
  const solve = (target: number): number => {
    let s = target;
    for (let i = 0; i < 8; i++) {
      const error = x(s) - target;
      if (Math.abs(error) < 1e-7) return s;
      const d = slope(s);
      if (Math.abs(d) < 1e-6) break;
      s -= error / d;
    }
    let low = 0;
    let high = 1;
    s = target;
    for (let i = 0; i < 40; i++) {
      const value = x(s);
      if (Math.abs(value - target) < 1e-7) break;
      if (target > value) low = s;
      else high = s;
      s = (high - low) / 2 + low;
    }
    return s;
  };
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : y(solve(t)));
}

/** ``--ease-out`` in tokens.css: a strong ease-out. It starts fast (40% of the way at 10% of the
 * time) so a glide that is re-aimed mid-way keeps its momentum instead of hesitating, as an
 * easing with a flat start (``--ease-standard``) would on every re-aim. */
export const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** How long the tree takes to settle after its shape changes: nodes glide to their new places and
 * the camera follows. Long travel on the main view of the video, so longer than a control's 150 ms. */
export const GLIDE_MS = 450;

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
