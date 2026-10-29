// Recharts chrome as design tokens, so every chart follows the theme and none repeats a colour.
// Recharts writes these straight into SVG attributes and inline styles, where var() resolves.

export const GRID = "var(--grid)";

/** Axis line and tick labels; ``fontSize`` is the tick size in px. */
export const axis = (fontSize: number) => ({
  stroke: "var(--border-strong)",
  tick: { fill: "var(--text-secondary)", fontSize },
});

export const TOOLTIP_STYLE = {
  background: "var(--surface-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-2)",
  boxShadow: "var(--shadow-overlay)",
};

export const TOOLTIP_LABEL_STYLE = { color: "var(--text-primary)" };
export const TOOLTIP_CURSOR = { fill: "var(--hover-wash)" };
export const LEGEND_STYLE = { color: "var(--text-secondary)", fontSize: 14 };
