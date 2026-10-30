// Copies a TreeFrame onto the SVG. The only place the tree touches the DOM per frame: every write
// goes through a Pen, which skips attributes whose value has not changed.

import { fx } from "../shared";
import { edgePath, type DashFrame, type EdgeFrame, type NodeFrame, type TreeFrame } from "./frame";

/** Layout units to viewBox units: about a pixel each at the width of the home page's hero. */
export const U = 64;
export const MAX_DASHES = 20;
export const SCORE_WIDTH = 40;

export class Pen<E extends Element> {
  private last: Record<string, string> = {};
  constructor(readonly el: E) {}
  set(name: string, value: string | number): void {
    const v = typeof value === "number" ? fx(value) : value;
    if (this.last[name] !== v) {
      this.last[name] = v;
      this.el.setAttribute(name, v);
    }
  }
  text(value: string): void {
    if (this.last["#text"] !== value) {
      this.last["#text"] = value;
      this.el.textContent = value;
    }
  }
}

export interface NodeRig {
  size: number;
  brain: boolean;
  g: Pen<SVGGElement>;
  pulse: Pen<SVGCircleElement> | null;
  flash: Pen<SVGCircleElement> | null;
  crown: Pen<SVGCircleElement> | null;
  tag: Pen<SVGTextElement> | null;
  cand: Pen<SVGCircleElement> | null;
  heir: Pen<SVGCircleElement> | null;
  ticks: Pen<SVGCircleElement>[];
  ticksG: Pen<SVGGElement> | null;
  stamp: Pen<SVGTextElement> | null;
  sub: Pen<SVGTextElement> | null;
  score: Pen<SVGGElement> | null;
  scoreBar: Pen<SVGRectElement> | null;
  scoreText: Pen<SVGTextElement> | null;
}

export interface TreeRig {
  nodes: Record<string, NodeRig>;
  edges: Record<string, Pen<SVGPathElement>>;
  dashes: Pen<SVGLineElement>[];
  clock: Pen<SVGTextElement> | null;
  memorial: Pen<SVGGElement> | null;
}

const pen = <E extends Element>(root: Element, selector: string): Pen<E> | null => {
  const el = root.querySelector<E>(selector);
  return el ? new Pen(el) : null;
};

/** Finds the parts of the markup SwarmTree renders; run once after mount. */
export function collectTree(svg: SVGSVGElement, sizes: Record<string, { size: number; brain: boolean }>): TreeRig {
  const nodes: Record<string, NodeRig> = {};
  for (const g of svg.querySelectorAll<SVGGElement>("[data-node]")) {
    const id = g.dataset["node"] ?? "";
    const info = sizes[id];
    if (!info) continue;
    nodes[id] = {
      size: info.size * U,
      brain: info.brain,
      g: new Pen(g),
      pulse: pen(g, ".hv-pulse"),
      flash: pen(g, ".hv-flash"),
      crown: pen(g, ".hv-crown"),
      tag: pen(g, ".hv-tag"),
      cand: pen(g, ".hv-cand"),
      heir: pen(g, ".hv-heir"),
      ticks: [...g.querySelectorAll<SVGCircleElement>(".hv-tick")].map((el) => new Pen(el)),
      ticksG: pen(g, ".hv-ticks"),
      stamp: pen(g, ".hv-stamp"),
      sub: pen(g, ".hv-sub"),
      score: pen(g, ".hv-score"),
      scoreBar: pen(g, ".hv-score-bar"),
      scoreText: pen(g, ".hv-score-text"),
    };
  }
  const edges: Record<string, Pen<SVGPathElement>> = {};
  for (const el of svg.querySelectorAll<SVGPathElement>("[data-edge]")) edges[el.dataset["edge"] ?? ""] = new Pen(el);
  return {
    nodes,
    edges,
    dashes: [...svg.querySelectorAll<SVGLineElement>("[data-dash]")].map((el) => new Pen(el)),
    clock: pen(svg, ".hv-clock"),
    memorial: pen(svg, ".hv-memorial"),
  };
}

function paintNode(rig: NodeRig, f: NodeFrame): void {
  rig.g.set("transform", `translate(${fx(f.x * U)} ${fx(f.y * U)})`);
  rig.g.set("opacity", f.opacity);
  rig.g.set("data-state", f.state);
  rig.g.set("data-busy", f.busy ? "true" : "false");
  rig.g.set("data-waiting", f.waiting ? "true" : "false");
  if (!rig.brain) return;

  const R = rig.size;
  if (rig.pulse) {
    rig.pulse.set("r", R * (1 + 0.85 * f.pulse));
    rig.pulse.set("opacity", f.pulseAmp * (1 - f.pulse) ** 2 * 0.6);
  }
  if (rig.flash) {
    rig.flash.set("r", R * (1 + 1.7 * (1 - f.flash)));
    rig.flash.set("opacity", f.flash * 0.9);
  }
  if (rig.crown) {
    rig.crown.set("r", R + 3 + 4 * f.crown);
    rig.crown.set("opacity", f.crown);
  }
  rig.tag?.set("opacity", f.crown);
  rig.cand?.set("opacity", f.candidate * (1 - 0.7 * f.heir));
  rig.heir?.set("opacity", f.heir);
  rig.ticksG?.set("opacity", f.state === "alive" ? 0 : 1);
  rig.ticks.forEach((t, i) => t.set("data-on", i < f.missed ? "true" : "false"));
  rig.stamp?.set("opacity", f.stamp);
  rig.sub?.set("opacity", f.state === "alive" ? 0 : 1);
  if (rig.score) {
    rig.score.set("opacity", f.score === null ? 0 : f.candidate);
    if (f.score !== null) {
      rig.scoreBar?.set("width", Math.max(1, f.score * SCORE_WIDTH * f.candidate));
      rig.scoreText?.text(f.score.toFixed(3));
    }
  }
}

function paintEdge(pen: Pen<SVGPathElement>, e: EdgeFrame | undefined): void {
  if (!e || e.opacity <= 0.002) {
    pen.set("opacity", 0);
    return;
  }
  pen.set("d", edgePath(e.x1 * U, e.y1 * U, e.x2 * U, e.y2 * U, 2));
  pen.set("opacity", e.opacity);
  pen.set("data-broken", e.broken > 0.5 ? "1" : "0");
}

function paintDash(pen: Pen<SVGLineElement>, d: DashFrame | undefined): void {
  if (!d) {
    pen.set("opacity", 0);
    return;
  }
  pen.set("transform", `translate(${fx(d.x * U)} ${fx(d.y * U)}) rotate(${fx(d.angle, 1)})`);
  pen.set("opacity", d.opacity);
}

export function paintTree(rig: TreeRig, frame: TreeFrame): void {
  for (const n of frame.nodes) {
    const r = rig.nodes[n.id];
    if (r) paintNode(r, n);
  }
  const byChild = new Map(frame.edges.map((e) => [e.child, e]));
  for (const [id, pen] of Object.entries(rig.edges)) paintEdge(pen, byChild.get(id));
  rig.dashes.forEach((pen, i) => paintDash(pen, frame.dashes[i]));
  rig.clock?.text(`${(frame.tMs / 1000).toFixed(1)} s`);
  rig.memorial?.set("opacity", frame.killed > 0 ? 1 : 0);
}
