import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useProgress, type VizProps } from "../shared";
import "../viz.css";
import { Pen } from "../tree/paint";
import { offsetFor, shortHash, stripItems, stripState } from "./state";

export type HashStripProps = VizProps;

export function HashStrip({ progress, data, still, stillAt, className }: HashStripProps) {
  const { hashes } = data;
  const items = useMemo(() => stripItems(hashes), [hashes]);
  const view = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const stamp = useRef<HTMLDivElement>(null);
  const size = useRef({ view: 0, track: 0 });
  const pens = useRef<{ track: Pen<HTMLElement>; stamp: Pen<HTMLElement> } | null>(null);
  const last = useRef(0);

  const apply = useCallback((p: number) => {
    last.current = p;
    const r = pens.current;
    if (!r) return;
    const s = stripState(p);
    r.track.set("style", `transform:translateX(${offsetFor(s.shift, size.current.track, size.current.view).toFixed(1)}px)`);
    r.stamp.set("style", `opacity:${s.stamp.toFixed(3)};transform:scale(${(1.12 - 0.12 * s.stamp).toFixed(4)}) rotate(-3deg)`);
  }, []);

  // The widths are measured when the layout changes, never while the strip moves.
  useLayoutEffect(() => {
    if (!view.current || !track.current || !stamp.current) return undefined;
    pens.current = { track: new Pen(track.current), stamp: new Pen(stamp.current) };
    const measure = (): void => {
      size.current = { view: view.current?.clientWidth ?? 0, track: track.current?.scrollWidth ?? 0 };
      apply(last.current);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(view.current);
    return () => watch.disconnect();
  }, [items, apply]);
  useProgress(progress, apply, still, stillAt);

  const matched = hashes.replay.matches === true;
  const summary =
    `A strip of ${hashes.events.length} of the run's ${hashes.count.toLocaleString("en-US")} events. Each one carries the hash of the one before it. ` +
    (hashes.chainOk ? "The chain is intact. " : "") +
    (matched ? `Replaying the log gives the same head hash, ${hashes.head}.` : "");

  return (
    <div className={className ? `hv hv-hash ${className}` : "hv hv-hash"} role="img" aria-label={summary}>
      <div ref={view} className="hv-hash-view" aria-hidden="true">
        <div ref={track} className="hv-hash-track">
          {items.map((item, i) =>
            item.type === "gap" ? (
              <div key={`gap-${i}`} className="hv-hash-gap">
                <span>{item.skipped.toLocaleString("en-US")} events</span>
              </div>
            ) : (
              <article key={item.seq} className="hv-hash-card" data-linked={item.linked} data-kind={item.mark?.kind ?? "none"}>
                {item.mark && <div className="hv-hash-mark">{item.mark.label}</div>}
                <header>
                  <span className="hv-hash-seq">{`#${item.seq}`}</span>
                  <span className="hv-hash-time">{(item.tMs / 1000).toFixed(1)} s</span>
                </header>
                <div className="hv-hash-type">{item.kind}</div>
                <div className="hv-hash-actor">{item.actor}</div>
                <dl>
                  <dt>hash</dt>
                  <dd>{shortHash(item.hash)}</dd>
                  <dt>prev</dt>
                  <dd className="hv-hash-prev">{/^0+$/.test(item.prev) ? "genesis" : shortHash(item.prev)}</dd>
                </dl>
              </article>
            ),
          )}
        </div>
      </div>
      <div className="hv-hash-end" aria-hidden="true">
        <div className="hv-hash-head">
          <span className="hv-hash-label">head hash</span>
          <code>{hashes.head}</code>
        </div>
        <div ref={stamp} className="hv-hash-stamp" data-ok={matched} style={{ opacity: 0 }}>
          <b>{matched ? "MATCH" : "NO MATCH"}</b>
          <span>{matched ? `${hashes.count.toLocaleString("en-US")} events replayed, same head` : "the replayed head differs"}</span>
        </div>
      </div>
    </div>
  );
}
