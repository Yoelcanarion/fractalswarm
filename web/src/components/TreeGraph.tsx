import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";

import { useClock, useClockFrame } from "../lib/clockHooks";
import { ADOPTION_LIFE_MS, glowVars, litMessages, MESSAGE_LIFE_MS, ringVars } from "../lib/decay";
import { colorOf, isInfraKind, isLeafKind, layoutTree } from "../lib/layout";
import { rootHolder, type ActorNode, type ViewState } from "../lib/reducer";

// What a node is glowing from, if anything: an adoption or a restart within ADOPTION_LIFE_MS of
// virtual time. The fade itself is CSS (--glow in styles.css), driven by --now.
type Glow = { kind: "adopted" | "restarted"; born: number };

type ActorData = {
  actor: ActorNode;
  color: string;
  rootDuty: boolean;
  glow: Glow | null;
  leaf: boolean;
};

const ActorCard = memo(function ActorCard({ data }: NodeProps<Node<ActorData>>) {
  const { actor, color, rootDuty, glow, leaf } = data;
  const down = actor.status === "killed" || actor.status === "dead";
  const outage = actor.status === "restarting" ? actor.outage : undefined;
  const classes = [
    "actor",
    leaf ? "actor--leaf" : "",
    down ? "actor--down" : "",
    outage ? "actor--restarting" : "",
    actor.status === "stopped" ? "actor--stopped" : "",
    actor.suspected ? "actor--suspected" : "",
    glow ? `actor--${glow.kind}` : "",
  ].join(" ");
  const style = { "--owner": color, ...(glow ? glowVars(glow.born, ADOPTION_LIFE_MS) : {}) } as CSSProperties;
  return (
    <div className={classes} style={style}>
      <Handle type="target" position={Position.Top} className="actor__handle" />
      <div className="actor__id">{actor.id}</div>
      <div className="actor__meta">
        <span>{actor.kind}</span>
        {actor.llmCalls > 0 && <span>· {actor.llmCalls} {actor.llmCalls === 1 ? "call" : "calls"}</span>}
      </div>
      {rootDuty && <div className="actor__duty">ROOT</div>}
      {actor.adoptedBy && <div className="actor__adopted">adopted by {actor.adoptedBy}</div>}
      {outage && (
        <>
          <div className="actor__state">restarting</div>
          <div className="actor__ring" role="img" aria-label="restarting" style={ringVars(outage)} />
        </>
      )}
      {down && (
        <div className="actor__x" title={actor.status === "dead" ? "detected dead" : "killed"}>
          ✕
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="actor__handle" />
    </div>
  );
});

const nodeTypes = { actor: ActorCard };

function glowOf(actor: ActorNode, now: number): Glow | null {
  const adopted = actor.adoptedTs !== undefined && now - actor.adoptedTs < ADOPTION_LIFE_MS ? actor.adoptedTs : -Infinity;
  const restarted = actor.restartedTs !== undefined && now - actor.restartedTs < ADOPTION_LIFE_MS ? actor.restartedTs : -Infinity;
  if (adopted === -Infinity && restarted === -Infinity) return null;
  return restarted > adopted ? { kind: "restarted", born: restarted } : { kind: "adopted", born: adopted };
}

function buildGraph(view: ViewState, now: number): { nodes: Node<ActorData>[]; edges: Edge[] } {
  const holder = rootHolder(view);
  const nodes: Node<ActorData>[] = layoutTree(view).map(({ id, x, y }) => {
    const actor = view.actors[id];
    return {
      id,
      type: "actor",
      position: { x, y },
      draggable: false,
      data: {
        actor,
        color: colorOf(view, id),
        rootDuty: holder === id,
        glow: glowOf(actor, now),
        leaf: isLeafKind(actor.kind),
      },
    };
  });

  const recent = litMessages(view.messages, now);
  const lit = new Set<string>();
  const edges: Edge[] = [];
  const inTree = (id: string): boolean => view.actors[id] !== undefined && !isInfraKind(view.actors[id].kind);
  for (const id of view.order) {
    const actor = view.actors[id];
    if (!inTree(id) || !actor.parent || !inTree(actor.parent)) continue;
    let talkingTs = -Infinity;
    for (const m of recent) {
      if ((m.from === actor.parent && m.to === id) || (m.from === id && m.to === actor.parent)) {
        talkingTs = Math.max(talkingTs, m.ts);
      }
    }
    const talking = talkingTs > -Infinity;
    if (talking) {
      lit.add(`${actor.parent}->${id}`);
      lit.add(`${id}->${actor.parent}`);
    }
    const adopted = actor.adoptedTs !== undefined && now - actor.adoptedTs < ADOPTION_LIFE_MS;
    const down = actor.status === "killed" || actor.status === "dead" || actor.status === "restarting";
    edges.push({
      id: `tree-${id}`,
      source: actor.parent,
      target: id,
      animated: talking || adopted,
      className: adopted ? "edge--adopted" : talking ? "edge--talking" : down ? "edge--down" : "",
      style: { stroke: colorOf(view, id), ...(talking ? glowVars(talkingTs, MESSAGE_LIFE_MS) : {}) },
    });
  }
  // Messages between actors that are not parent and child get their own animated edge.
  for (const m of recent) {
    if (lit.has(`${m.from}->${m.to}`) || !inTree(m.from) || !inTree(m.to)) continue;
    const fade = glowVars(m.ts, MESSAGE_LIFE_MS);
    edges.push({
      id: `msg-${m.seq}`,
      source: m.from,
      target: m.to,
      animated: true,
      className: "edge--message",
      label: m.topic,
      style: fade,
      labelStyle: fade,
      labelBgStyle: fade,
    });
  }
  return { nodes, edges };
}

function Graph({ view }: { view: ViewState }) {
  // The committed playhead (at most ~20 writes a second) decides which edges and glows exist;
  // how bright they are comes from --now, frame by frame, in CSS.
  const now = useClock((s) => s.playhead);
  const { nodes, edges } = useMemo(() => buildGraph(view, now), [view, now]);
  const flow = useReactFlow();
  const shape = nodes.map((n) => `${n.id}:${n.position.x}`).join(",");
  useEffect(() => {
    const handle = window.setTimeout(() => flow.fitView({ padding: 0.18, duration: 500, maxZoom: 1.3 }), 60);
    return () => window.clearTimeout(handle);
  }, [shape, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      fitView
      minZoom={0.2}
    >
      <Background gap={28} size={1} color="var(--grid)" />
    </ReactFlow>
  );
}

export function TreeGraph({ view }: { view: ViewState }) {
  // --now is the virtual time in ms, written straight to the DOM every frame; the fades and the
  // restart ring in styles.css read it, so a playing replay re-renders nothing between events.
  const root = useRef<HTMLDivElement>(null);
  useClockFrame((t) => root.current?.style.setProperty("--now", String(Math.round(t))));
  if (view.order.length === 0) {
    return <div className="empty">Waiting for the first actor to spawn…</div>;
  }
  return (
    <div ref={root} className="tree">
      <ReactFlowProvider>
        <Graph view={view} />
      </ReactFlowProvider>
    </div>
  );
}
