import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Pen } from "../tree/paint";
import { fx, useProgress, type VizProps } from "../shared";
import "../viz.css";
import { DOOR_LABELS, GEOM, doorFrame, isDoor, type DoorFrame } from "./doors";

type Part = (name: string, children: ReactNode) => ReactNode;

const node = (cx: number, cy: number, className: string, r = 5) => <circle key={`${cx}-${cy}`} className={className} cx={cx} cy={cy} r={r} />;
const edge = (x1: number, y1: number, x2: number, y2: number) => <line key={`${x1}-${y1}-${x2}-${y2}`} className="hv-dg-edge" x1={x1} y1={y1} x2={x2} y2={y2} />;
const cross = (s = 6.5) => <path className="hv-dg-x" d={`M${-s} ${-s}L${s} ${s}M${s} ${-s}L${-s} ${s}`} />;

/** Two systems, hit by the same failure at the same moment: a swarm of coordinators, and a supervisor over its workers. */
function Arena({ part }: { part: Part }) {
  const left = [[17, 82], [43, 82], [67, 82], [93, 82]] as const;
  const workers = [130, 153, 177, 200] as const;
  return (
    <>
      <line className="hv-dg-divider" x1="110" y1="8" x2="110" y2="102" />
      {edge(55, 18, 80, 50)}
      {edge(80, 50, 67, 82)}
      {edge(80, 50, 93, 82)}
      {part("dead-left", [edge(55, 18, 30, 50), edge(30, 50, 17, 82), edge(30, 50, 43, 82), node(30, 50, "hv-dg-node")])}
      {node(55, 18, "hv-dg-node")}
      {node(80, 50, "hv-dg-node")}
      {left.map(([x, y]) => node(x, y, "hv-dg-node"))}
      {workers.filter((x) => x !== GEOM.arena.deadRight[0]).map((x) => edge(165, 24, x, 82))}
      {part("dead-right", [edge(165, 24, GEOM.arena.deadRight[0], 82), node(GEOM.arena.deadRight[0], 82, "hv-dg-node hv-dg-node--rival")])}
      <rect className="hv-dg-node hv-dg-node--rival" x="158" y="12" width="14" height="14" rx="2.5" />
      {workers.filter((x) => x !== GEOM.arena.deadRight[0]).map((x) => node(x, 82, "hv-dg-node hv-dg-node--rival"))}
      {part("x-left", cross())}
      {part("x-right", cross())}
    </>
  );
}

/** A pasted text, a run, and a crosshair on one of its coordinators. */
function Live({ part }: { part: Part }) {
  const leaves = [[127, 82], [153, 82], [177, 82], [203, 82]] as const;
  const all: (readonly [number, number])[] = [[165, 18], [140, 50], [190, 50], ...leaves];
  return (
    <>
      <rect className="hv-dg-box" x="6" y="18" width="78" height="74" rx="7" />
      {[
        [33, 65],
        [45, 71],
        [57, 47],
        [69, 68],
        [80, 55],
      ].map(([y, x2]) => (
        <line key={y} className="hv-dg-ink" x1="17" y1={y} x2={x2} y2={y} />
      ))}
      <path className="hv-dg-edge" d="M92 55H112M106 49L113 55L106 61" />
      {edge(165, 18, 140, 50)}
      {edge(165, 18, 190, 50)}
      {edge(140, 50, 127, 82)}
      {edge(140, 50, 153, 82)}
      {edge(190, 50, 177, 82)}
      {edge(190, 50, 203, 82)}
      {all.map(([x, y]) => node(x, y, "hv-dg-node hv-dg-node--ring"))}
      {part("tree-fill", all.map(([x, y]) => node(x, y, "hv-dg-node")))}
      {[0, 1, 2].map((i) => part(`stream-${i}`, <circle className="hv-dg-dot" cx="92" cy="55" r="2.5" />))}
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

/** A chain of recorded steps, each linked to the one before it and checked. */
function Replays({ part }: { part: Part }) {
  const xs = [12, 64, 116, 168] as const;
  return (
    <>
      {xs.map((x) => (
        <g key={x}>
          <rect className="hv-dg-box" x={x} y="24" width="40" height="44" rx="5" />
          <path className="hv-dg-ink hv-dg-ink--fine" d={`M${x + 8} 36H${x + 32}M${x + 8} 46H${x + 24}M${x + 8} 56H${x + 32}`} />
        </g>
      ))}
      {[0, 1, 2].map((i) => (
        <line key={i} className="hv-dg-edge" x1={xs[i]! + 40} y1="46" x2={xs[i + 1]!} y2="46" />
      ))}
      {[0, 1, 2].map((i) => part(`link-${i}`, <line className="hv-dg-ok hv-dg-ok--thin" x1={xs[i]! + 40} y1="46" x2={xs[i + 1]!} y2="46" />))}
      {xs.map((_, i) => part(`check-${i}`, <path className="hv-dg-ok" d="M-7 0L-2.5 4.5L7 -6" />))}
    </>
  );
}

/** A clapperboard, its clapper open at rest and shut when the pointer is on it. */
function Director({ part }: { part: Part }) {
  const stripes = (top: number, bottom: number, shift: number): string =>
    [0, 1, 2, 3, 4].map((i) => `M${46 + shift + 28 * i} ${bottom}L${54 + shift + 28 * i} ${top}H${62 + shift + 28 * i}L${54 + shift + 28 * i} ${bottom}Z`).join("");
  return (
    <>
      <rect className="hv-dg-box" x="36" y="52" width="148" height="48" rx="4" />
      <rect className="hv-dg-box" x="36" y="46" width="148" height="8" rx="2" />
      <path className="hv-dg-stripe" d={stripes(46, 54, 0)} />
      {part(
        "board-lines",
        <path className="hv-dg-ink hv-dg-ink--fine" d="M48 68H100M48 80H124M48 92H88" />,
      )}
      {part(
        "clapper",
        <>
          <rect className="hv-dg-box" x="36" y="32" width="148" height="14" rx="2" />
          <path className="hv-dg-stripe" d={stripes(32, 46, 14)} />
          <circle className="hv-dg-hinge" cx="36" cy="46" r="3" />
        </>,
      )}
    </>
  );
}

/** A chart with two lines, and a marker that runs along it. */
function Numbers({ part }: { part: Part }) {
  const a: [number, number][] = [[24, 78], [64, 70], [104, 52], [144, 48], [204, 30]];
  const b: [number, number][] = [[24, 60], [64, 62], [104, 66], [144, 54], [204, 70]];
  const line = (points: [number, number][]): string => `M${points.map(([x, y]) => `${x} ${y}`).join("L")}`;
  return (
    <>
      <path className="hv-dg-soft" d="M24 36H206M24 64H206" />
      <path className="hv-dg-edge" d="M24 12V92H206" />
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

/** The door's pictogram, 220 by 110, kept to the left of its frame as the door's words are. `data` is the door's id. */
export function DoorGlyph({ progress, data: id, still, stillAt, className }: VizProps<string>) {
  const svg = useRef<SVGSVGElement>(null);
  const pens = useRef<Map<string, Pen<SVGGElement>>>(new Map());
  const apply = useCallback(
    (p: number) => {
      paintDoor(pens.current, doorFrame(id, p));
    },
    [id],
  );
  useLayoutEffect(() => {
    pens.current = collectDoor(svg.current);
  }, [id]);
  useProgress(progress, apply, still, stillAt);

  // What the markup says before anything is drawn is the picture the first frame will be.
  const frame = doorFrame(id, still ? (stillAt ?? 1) : progress.get());
  const part: Part = (name, children) => {
    const state = frame[name] ?? {};
    return (
      <g key={name} data-part={name} opacity={state.opacity === undefined ? undefined : fx(state.opacity)} transform={state.transform}>
        {children}
      </g>
    );
  };
  const Glyph = isDoor(id) ? GLYPHS[id] : null;

  return (
    <svg
      ref={svg}
      className={className ? `hv hv-dg ${className}` : "hv hv-dg"}
      viewBox="0 0 220 110"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={isDoor(id) ? DOOR_LABELS[id] : "A door"}
      data-door={id}
    >
      {Glyph ? <Glyph part={part} /> : null}
    </svg>
  );
}
