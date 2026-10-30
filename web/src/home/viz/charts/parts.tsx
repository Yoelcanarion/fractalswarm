import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface Box {
  width: number;
  height: number;
}

/**
 * Measures the frame a chart fills, when it is mounted and whenever it changes size, never while the
 * chart moves. Until it is measured (and on the server) the box is `fallback`.
 */
export function useBox(fallback: Box, min = 120): [RefObject<HTMLDivElement>, Box] {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      if (width < min || height < Math.min(min, 40)) return;
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [min]);
  return [ref, box];
}

/** The numbers of a chart as a table, for a screen reader: the drawing says it, the table proves it. */
export function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="hv-sr">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={j}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
