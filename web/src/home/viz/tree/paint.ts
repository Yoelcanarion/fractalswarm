// Copies a TreeFrame onto the SVG. The only place the tree touches the DOM per frame: every write
// goes through a Pen, which skips attributes whose value has not changed.

import { fx, smoothstep, span } from "../shared";
import { COMET, type Ambient } from "./ambient";
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
      // The text node is changed where it stands: replacing it (what textContent does) rebuilds the element's text, which costs
      // several times more in a browser that paints in software.
      const only = this.el.firstChild;
      if (only && only.nodeType === 3 && only === this.el.lastChild) only.nodeValue = value;
      else this.el.textContent = value;
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
  /** The ambient layer's parts, when the tree is drawn with one: a brain's halo, an agent's ring. */
  halo?: Pen<SVGCircleElement> | null;
  ping?: Pen<SVGRectElement> | null;
}

export interface TreeRig {
  nodes: Record<string, NodeRig>;
  edges: Record<string, Pen<SVGPathElement>>;
  dashes: Pen<SVGLineElement>[];
  clock: Pen<SVGTextElement> | null;
  memorial: Pen<SVGGElement> | null;
  /** The ambient layer's pulse on each node's edge, by the id of the node: its group, and its four circles (glow, tail, tail, head). */
  dots?: Record<string, { group: Pen<SVGGElement>; parts: Pen<SVGCircleElement>[] }>;
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
      halo: pen(g, ".hv-amb-halo"),
      ping: pen(g, ".hv-amb-ping"),
    };
  }
  const edges: Record<string, Pen<SVGPathElement>> = {};
  for (const el of svg.querySelectorAll<SVGPathElement>("[data-edge]")) edges[el.dataset["edge"] ?? ""] = new Pen(el);
  const dots: NonNullable<TreeRig["dots"]> = {};
  for (const el of svg.querySelectorAll<SVGGElement>("[data-amb-dot]")) {
    dots[el.dataset["ambDot"] ?? ""] = { group: new Pen(el), parts: [...el.querySelectorAll<SVGCircleElement>("circle")].map((c) => new Pen(c)) };
  }
  return {
    nodes,
    edges,
    dashes: [...svg.querySelectorAll<SVGLineElement>("[data-dash]")].map((el) => new Pen(el)),
    clock: pen(svg, ".hv-clock"),
    memorial: pen(svg, ".hv-memorial"),
    dots,
  };
}

function paintNode(rig: NodeRig, f: NodeFrame): void {
  const place = `translate(${fx(f.x * U)} ${fx(f.y * U)})`;
  // A node that is growing (or folding back) is a little smaller than it will be.
  rig.g.set("transform", f.appear < 1 ? `${place} scale(${fx(0.78 + 0.22 * f.appear, 3)})` : place);
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
  // The label names the brains in the memorial row, so it comes in as the first dead one sets off for it, not when the first one
  // dies: the hero shows a killed brain for a while, stamped, in its place in the tree, and a label over an empty row says nothing.
  const gone = frame.nodes.reduce((far, n) => (n.state === "dead" ? Math.max(far, n.buried) : far), 0);
  rig.memorial?.set("opacity", Math.max(frame.shelf ?? 0, smoothstep(span(gone, 0, 0.3)) * smoothstep(span(frame.appear, 0.7, 1))));
}

/** Copies the ambient layer onto the SVG: a pulse on each edge, a halo on each brain, a ring on each working agent. */
export function paintAmbient(rig: TreeRig, layer: Ambient): void {
  if (rig.dots) {
    for (const id in rig.dots) {
      const dot = rig.dots[id];
      const i = layer.indexOf(id);
      if (!dot) continue;
      const opacity = i < 0 ? 0 : (layer.dot.opacity[i] ?? 0);
      if (opacity > 0.01) {
        // glow and head ride together; the two tails trail them
        const at = (k: number): string => `translate(${fx((layer.dot.x[i * COMET + k] ?? 0) * U)} ${fx((layer.dot.y[i * COMET + k] ?? 0) * U)})`;
        const [glow, far, near, head] = dot.parts;
        glow?.set("transform", at(0));
        far?.set("transform", at(2));
        near?.set("transform", at(1));
        head?.set("transform", at(0));
        dot.group.set("opacity", opacity);
      } else {
        dot.group.set("opacity", 0);
      }
    }
  }
  for (const id in rig.nodes) {
    const node = rig.nodes[id];
    const i = layer.indexOf(id);
    if (!node || i < 0) continue;
    node.halo?.set("opacity", layer.halo[i] ?? 0);
    if (node.ping) {
      const opacity = layer.ping.opacity[i] ?? 0;
      if (opacity > 0.01) node.ping.set("transform", `scale(${fx(layer.ping.scale[i] ?? 1, 3)})`);
      node.ping.set("opacity", opacity > 0.01 ? opacity : 0);
    }
  }
}
