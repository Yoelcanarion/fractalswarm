import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { Pen } from "../tree/paint";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import { CANVAS, DOOR_LABELS, GEOM, WIDE_CANVAS, WIDE_FROM, arenaShape, doorFrame, hasWide, isDoor, liveShape, type DoorFrame, type Pt } from "./doors";

type Part = (name: string, children: ReactNode) => ReactNode;

const node = (cx: number, cy: number, className: string, r = 5) => <circle key={`${cx}-${cy}`} className={className} cx={cx} cy={cy} r={r} />;
const edge = (x1: number, y1: number, x2: number, y2: number) => <line key={`${x1}-${y1}-${x2}-${y2}`} className="hv-dg-edge" x1={x1} y1={y1} x2={x2} y2={y2} />;
const cross = (s = 6.5) => <path className="hv-dg-x" d={`M${-s} ${-s}L${s} ${s}M${s} ${-s}L${-s} ${s}`} />;

const link = (a: Pt, b: Pt) => edge(a[0], a[1], b[0], b[1]);

/** Two systems, hit by the same failure at the same moment: a swarm of coordinators, and a supervisor over its workers. */
function Arena({ part, wide }: { part: Part; wide: boolean }) {
  const { divider, swarm, deadTrack, supervisor, workers, deadWorker } = arenaShape(wide);
  const { root, tracks, leaves } = swarm;
  const under = (t: number): Pt[] => [leaves[2 * t]!, leaves[2 * t + 1]!];
  const alive = tracks.map((t, i) => ({ t, i })).filter(({ i }) => i !== deadTrack);
  const livingWorkers = workers.filter((_, i) => i !== deadWorker);
  return (
    <>
      <line className="hv-dg-divider" x1={divider} y1="8" x2={divider} y2="102" />
      {alive.map(({ t }) => link(root, t))}
      {alive.flatMap(({ t, i }) => under(i).map((leaf) => link(t, leaf)))}
      {part("dead-left", [link(root, tracks[deadTrack]!), ...under(deadTrack).map((leaf) => link(tracks[deadTrack]!, leaf)), node(tracks[deadTrack]![0], tracks[deadTrack]![1], "hv-dg-node")])}
      {node(root[0], root[1], "hv-dg-node")}
      {alive.map(({ t }) => node(t[0], t[1], "hv-dg-node"))}
      {leaves.map(([x, y]) => node(x, y, "hv-dg-node"))}
      {livingWorkers.map((w) => link(supervisor, w))}
      {part("dead-right", [link(supervisor, workers[deadWorker]!), node(workers[deadWorker]![0], workers[deadWorker]![1], "hv-dg-node hv-dg-node--rival")])}
      <rect className="hv-dg-node hv-dg-node--rival" x={supervisor[0] - 7} y="12" width="14" height="14" rx="2.5" />
      {livingWorkers.map(([x, y]) => node(x, y, "hv-dg-node hv-dg-node--rival"))}
      {part("x-left", cross())}
      {part("x-right", cross())}
    </>
  );
}

/** A pasted text, a run, and a crosshair on one of its coordinators. */
function Live({ part, wide }: { part: Part; wide: boolean }) {
  const { box, lines, arrow, tree } = liveShape(wide);
  const { root, tracks, leaves } = tree;
  const all: Pt[] = [root, ...tracks, ...leaves];
  return (
    <>
      <rect className="hv-dg-box" x={box[0]} y={box[1]} width={box[2]} height={box[3]} rx="7" />
      {lines.map(([y, x2]) => (
        <line key={y} className="hv-dg-ink" x1={box[0] + 11} y1={y} x2={x2} y2={y} />
      ))}
      <path className="hv-dg-edge" d={`M${arrow[0]} 55H${arrow[1] - 1}M${arrow[1] - 7} 49L${arrow[1]} 55L${arrow[1] - 7} 61`} />
      {tracks.map((t) => link(root, t))}
      {tracks.flatMap((t, i) => [leaves[2 * i]!, leaves[2 * i + 1]!].map((leaf) => link(t, leaf)))}
      {all.map(([x, y]) => node(x, y, "hv-dg-node hv-dg-node--ring"))}
      {part("tree-fill", all.map(([x, y]) => node(x, y, "hv-dg-node")))}
      {[0, 1, 2].map((i) => part(`stream-${i}`, <circle className="hv-dg-dot" cx={arrow[0]} cy="55" r="2.5" />))}
      {part(
        "crosshair",
        <>
          <circle className="hv-dg-x" r="11" />
          <path className="hv-dg-x" d="M-17 0H-8M8 0H17M0 -17V-8M0 8V17" />
        </>,
      )}
    </>
  );
}

/** The table the door opens on: a row for each recorded run, with its name, its REPLAY chip and its head, and a check once it is verified. */
function Replays({ part }: { part: Part }) {
  const names = [30, 38, 26, 34] as const;
  const heads = [22, 18, 24, 20] as const;
  const { rows } = GEOM.replays;
  return (
    <>
      <rect className="hv-dg-box" x="8" y="6" width="204" height="98" rx="7" />
      <path className="hv-dg-ink hv-dg-ink--fine" d="M20 18H40M90 18H112M142 18H160M184 18H198" />
      <path className="hv-dg-soft" d="M8 28H212" />
      {rows.map((y, i) => (
        <g key={y}>
          <line className="hv-dg-ink" x1="20" y1={y} x2={20 + names[i]!} y2={y} />
          <rect className="hv-dg-chip" x="90" y={y - 5} width="34" height="10" rx="3" />
          <line className="hv-dg-ink hv-dg-ink--fine" x1="142" y1={y} x2={142 + heads[i]!} y2={y} />
          {i < rows.length - 1 && <path className="hv-dg-soft" d={`M8 ${y + 8.5}H212`} />}
        </g>
      ))}
      {rows.map((_, i) => part(`check-${i}`, <path className="hv-dg-ok" d="M-7 0L-2.5 4.5L7 -6" />))}
    </>
  );
}

/** A clapperboard, its clapper open at rest and shut when the pointer is on it. */
function Director({ part }: { part: Part }) {
  const [x0, hy] = GEOM.director.hinge;
  const { width, bar, bottom } = GEOM.director;
  // diagonal stripes on a bar: `count` of them from `from`, a step apart; the clapper's fall between the stick's
  const stripes = (top: number, base: number, from: number, count: number): string =>
    Array.from({ length: count }, (_, i) => {
      const x = from + 24 * i;
      return `M${x} ${base}L${x + 8} ${top}H${x + 16}L${x + 8} ${base}Z`;
    }).join("");
  const lines = [0, 1, 2].map((i) => hy + 19 + 10 * i);
  return (
    <>
      <rect className="hv-dg-box" x={x0} y={hy + 6} width={width} height={bottom - hy - 6} rx="4" />
      <rect className="hv-dg-box" x={x0} y={hy} width={width} height="8" rx="2" />
      <path className="hv-dg-stripe" d={stripes(hy, hy + 8, x0 + 6, 6)} />
      {part(
        "board-lines",
        <path className="hv-dg-ink hv-dg-ink--fine" d={`M${x0 + 12} ${lines[0]}H${x0 + 64}M${x0 + 12} ${lines[1]}H${x0 + 88}M${x0 + 12} ${lines[2]}H${x0 + 52}`} />,
      )}
      {part(
        "clapper",
        <>
          <rect className="hv-dg-box" x={x0} y={hy - bar} width={width} height={bar} rx="2" />
          <path className="hv-dg-stripe" d={stripes(hy - bar, hy, x0 + 18, 5)} />
          <circle className="hv-dg-hinge" cx={x0} cy={hy} r="3" />
        </>,
      )}
    </>
  );
}

/** A chart with two lines, and a marker that runs along it. */
function Numbers({ part }: { part: Part }) {
  const { from, to } = GEOM.numbers;
  const a: [number, number][] = [[from, 78], [54, 70], [99, 52], [143, 48], [210, 30]];
  const b: [number, number][] = [[from, 60], [54, 62], [99, 66], [143, 54], [210, 70]];
  const line = (points: [number, number][]): string => `M${points.map(([x, y]) => `${x} ${y}`).join("L")}`;
  return (
    <>
      <path className="hv-dg-soft" d={`M${from} 36H${to}M${from} 64H${to}`} />
      <path className="hv-dg-edge" d={`M${from} 12V92H${to}`} />
      <path className="hv-dg-chart hv-dg-chart--a" d={line(a)} />
      <path className="hv-dg-chart hv-dg-chart--b" d={line(b)} />
      {GEOM.numbers.marks.map((x, j) => {
        const pa = a.find(([px]) => px === x)!;
        const pb = b.find(([px]) => px === x)!;
        return part(`pt-${j}`, [<circle key="a" className="hv-dg-pt hv-dg-pt--a" cx={pa[0]} cy={pa[1]} r="3.5" />, <circle key="b" className="hv-dg-pt hv-dg-pt--b" cx={pb[0]} cy={pb[1]} r="3.5" />]);
      })}
      {part("scrub", <line className="hv-dg-scrub" x1="0" y1="12" x2="0" y2="92" />)}
    </>
  );
}

/** A hand-written parser and Muse, both reading the same notes. No outcome is drawn. */
function Ablation({ part }: { part: Part }) {
  return (
    <>
      <rect className="hv-dg-box" x="14" y="12" width="64" height="40" rx="6" />
      <path className="hv-dg-ink" d="M24 24H52M32 32H66M24 40H46" />
      <rect className="hv-dg-box" x="142" y="12" width="64" height="40" rx="6" />
      <path className="hv-dg-spark" d="M174 20Q175.5 30.5 186 32Q175.5 33.5 174 44Q172.5 33.5 162 32Q172.5 30.5 174 20Z" />
      <rect className="hv-dg-box" x="78" y="66" width="64" height="38" rx="5" />
      <path className="hv-dg-ink hv-dg-ink--fine" d="M88 78H130M88 87H122M88 96H110" />
      {part("notes-glow", <rect className="hv-dg-glow" x="78" y="66" width="64" height="38" rx="5" />)}
      {part("arrow-left", <path className="hv-dg-edge" d="M46 54Q46 70 76 82M69.2 83.2L77 82.5L71.8 76.7" />)}
      {part("arrow-right", <path className="hv-dg-edge" d="M174 54Q174 70 144 82M150.8 83.2L143 82.5L148.2 76.7" />)}
      {part("dot-left", <circle className="hv-dg-dot hv-dg-dot--parser" r="2.75" />)}
      {part("dot-right", <circle className="hv-dg-dot hv-dg-dot--muse" r="2.75" />)}
    </>
  );
}

const GLYPHS = { arena: Arena, live: Live, replays: Replays, director: Director, numbers: Numbers, ablation: Ablation } as const;

/** The glyph's parts as the painter finds them. */
export function collectDoor(svg: SVGSVGElement | null): Map<string, Pen<SVGGElement>> {
  const pens = new Map<string, Pen<SVGGElement>>();
  if (svg) for (const el of Array.from(svg.querySelectorAll<SVGGElement>("[data-part]"))) pens.set(el.getAttribute("data-part")!, new Pen(el));
  return pens;
}

export function paintDoor(pens: Map<string, Pen<SVGGElement>>, frame: DoorFrame): void {
  for (const [name, state] of Object.entries(frame)) {
    const pen = pens.get(name);
    if (!pen) continue;
    if (state.opacity !== undefined) pen.set("opacity", state.opacity);
    if (state.transform !== undefined) pen.set("transform", state.transform);
  }
}

/**
 * The door's drawing in one frame: 220 by 110, or 480 by 110 for the wide drawing of the two doors that have one, kept to the
 * left of its box as the door's words are. A drawing that does not fit its box is made smaller, never cropped.
 */
export function DoorDrawing({ id, wide, frame, className, svgRef }: { id: string; wide: boolean; frame: DoorFrame; className?: string; svgRef?: Ref<SVGSVGElement> }) {
  const part: Part = (name, children) => {
    const state = frame[name] ?? {};
    return (
      <g key={name} data-part={name} opacity={state.opacity === undefined ? undefined : fx(state.opacity)} transform={state.transform}>
        {children}
      </g>
    );
  };
  const Glyph = isDoor(id) ? GLYPHS[id] : null;
  const canvas = wide ? WIDE_CANVAS : CANVAS;
  return (
    <svg
      ref={svgRef}
      className={className ? `hv hv-dg ${className}` : "hv hv-dg"}
      viewBox={`0 0 ${canvas.width} ${canvas.height}`}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={isDoor(id) ? DOOR_LABELS[id] : "A door"}
      data-door={id}
      data-wide={wide ? "" : undefined}
    >
      {Glyph ? <Glyph part={part} wide={wide} /> : null}
    </svg>
  );
}

/**
 * Whether the glyph's box has the shape of the door's wide drawing. The shape of the box decides, not the width of the window: the
 * page may give the doors another number of columns, and the drawing still fits what it is given. It is settled before the first
 * paint, so the door is never seen in the wrong drawing.
 */
function useWide(id: string, svg: RefObject<SVGSVGElement | null>): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el || !hasWide(id) || typeof ResizeObserver === "undefined") {
      setWide(false);
      return undefined;
    }
    const measure = () => {
      const box = el.getBoundingClientRect();
      setWide(box.height > 0 && box.width / box.height >= WIDE_FROM);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [id, svg]);
  return wide;
}

/** The door's pictogram, kept to the left of its box as the door's words are. `data` is the door's id. */
export function DoorGlyph({ progress, data: id, still, stillAt, className }: VizProps<string>) {
  const svg = useRef<SVGSVGElement>(null);
  const pens = useRef<Map<string, Pen<SVGGElement>>>(new Map());
  const wide = useWide(id, svg);
  const apply = useCallback(
    (p: number) => {
      paintDoor(pens.current, doorFrame(id, p, wide));
    },
    [id, wide],
  );
  useLayoutEffect(() => {
    pens.current = collectDoor(svg.current);
  }, [id, wide]);
  useProgress(progress, apply, still, stillAt);

  // What the markup says before anything is drawn is the picture the first frame will be.
  return <DoorDrawing id={id} wide={wide} frame={doorFrame(id, still ? (stillAt ?? 1) : progress.get(), wide)} className={className} svgRef={svg} />;
}
