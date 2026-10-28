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
import { memo, useEffect, useMemo } from "react";

import { colorOf, isLeafKind, layoutTree } from "../lib/layout";
import { rootHolder, type ActorNode, type ViewState } from "../lib/reducer";

// How long (in events) a message edge stays lit, and an adoption stays highlighted.
const MESSAGE_TAIL = 14;
const ADOPTION_GLOW = 60;

type ActorData = {
  actor: ActorNode;
  color: string;
  rootDuty: boolean;
  recentlyAdopted: boolean;
  leaf: boolean;
};

const ActorCard = memo(function ActorCard({ data }: NodeProps<Node<ActorData>>) {
  const { actor, color, rootDuty, recentlyAdopted, leaf } = data;
  const down = actor.status === "killed" || actor.status === "dead";
  const classes = [
    "actor",
    leaf ? "actor--leaf" : "",
    down ? "actor--down" : "",
    actor.status === "stopped" ? "actor--stopped" : "",
    actor.suspected ? "actor--suspected" : "",
    recentlyAdopted ? "actor--adopted" : "",
  ].join(" ");
  return (
    <div className={classes} style={{ ["--owner" as string]: color }}>
      <Handle type="target" position={Position.Top} className="actor__handle" />
      <div className="actor__id">{actor.id}</div>
      <div className="actor__meta">
        <span>{actor.kind}</span>
        {actor.llmCalls > 0 && <span>· {actor.llmCalls} {actor.llmCalls === 1 ? "call" : "calls"}</span>}
      </div>
      {rootDuty && <div className="actor__duty">ROOT</div>}
      {actor.adoptedBy && <div className="actor__adopted">adopted by {actor.adoptedBy}</div>}
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

function buildGraph(view: ViewState): { nodes: Node<ActorData>[]; edges: Edge[] } {
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
        recentlyAdopted: actor.adoptedSeq !== undefined && view.lastSeq - actor.adoptedSeq < ADOPTION_GLOW,
        leaf: isLeafKind(actor.kind),
      },
    };
  });

  const recent = view.messages.filter((m) => view.lastSeq - m.seq < MESSAGE_TAIL);
  const lit = new Set<string>();
  const edges: Edge[] = [];
  for (const id of view.order) {
    const actor = view.actors[id];
    if (!actor.parent || !view.actors[actor.parent]) continue;
    const talking = recent.some(
      (m) => (m.from === actor.parent && m.to === id) || (m.from === id && m.to === actor.parent),
    );
    if (talking) {
      lit.add(`${actor.parent}->${id}`);
      lit.add(`${id}->${actor.parent}`);
    }
    const adopted = actor.adoptedSeq !== undefined && view.lastSeq - actor.adoptedSeq < ADOPTION_GLOW;
    const down = actor.status === "killed" || actor.status === "dead";
    edges.push({
      id: `tree-${id}`,
      source: actor.parent,
      target: id,
      animated: talking || adopted,
      className: adopted ? "edge--adopted" : talking ? "edge--talking" : down ? "edge--down" : "",
      style: { stroke: colorOf(view, id) },
    });
  }
  // Messages between actors that are not parent and child get their own animated edge.
  for (const m of recent) {
    if (lit.has(`${m.from}->${m.to}`) || !view.actors[m.from] || !view.actors[m.to]) continue;
    edges.push({
      id: `msg-${m.seq}`,
      source: m.from,
      target: m.to,
      animated: true,
      className: "edge--message",
      label: m.topic,
    });
  }
  return { nodes, edges };
}

function Graph({ view }: { view: ViewState }) {
  const { nodes, edges } = useMemo(() => buildGraph(view), [view]);
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
      <Background gap={28} size={1} color="#2c2c2a" />
    </ReactFlow>
  );
}

export function TreeGraph({ view }: { view: ViewState }) {
  if (view.order.length === 0) {
    return <div className="empty">Waiting for the first actor to spawn…</div>;
  }
  return (
    <ReactFlowProvider>
      <Graph view={view} />
    </ReactFlowProvider>
  );
}
