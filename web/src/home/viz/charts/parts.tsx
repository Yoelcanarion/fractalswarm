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

/**
 * The mark of a system, centred on the origin: a circle for the swarm, a square for the in-process
 * supervisor, a diamond for the ideal durable one and a small dot for the rest, so that two systems
 * are never told apart by shade alone. Its colours come from the group around it (`data-emph`, `data-id`).
 */
export function SystemMark({ id, emphasis, r = 4.5 }: { id: string; emphasis: string; r?: number }) {
  if (emphasis === "swarm") return <circle className="hv-mk" r={r} />;
  if (id === "central") return <rect className="hv-mk" x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} rx="1" />;
  if (id === "durable-max") return <path className="hv-mk" d={`M0 ${-r * 1.2}L${r * 1.2} 0L0 ${r * 1.2}L${-r * 1.2} 0Z`} />;
  return <circle className="hv-mk" r={r * 0.55} />;
}
