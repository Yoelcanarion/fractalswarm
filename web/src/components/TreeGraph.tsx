import { Background, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { memo, useMemo, type CSSProperties } from "react";

import { useLens, useLensStoreApi } from "../lensStore";
import { useClock } from "../lib/clockHooks";
import { ADOPTION_LIFE_MS, fadeLife, glowVars, litMessages, MESSAGE_LIFE_MS, ringVars } from "../lib/decay";
import { boundsOf, colorOf, isInfraKind, isLeafKind, layoutTree, structureKey } from "../lib/layout";
import { prefersReducedMotion } from "../lib/motion";
import { rootHolder, type ActorNode, type ViewState } from "../lib/reducer";
import { ClockScope } from "./ClockScope";
import { useTreeMotion, type TreeShape } from "./useTreeMotion";

// What a node is glowing from, if anything: an adoption or a restart within `life` ms of virtual
// time. The fade itself is CSS (--glow in styles.css), driven by --now.
type Glow = { kind: "adopted" | "restarted"; born: number; life: number };

type ActorData = {
  actor: ActorNode;
  color: string;
  rootDuty: boolean;
  glow: Glow | null;
  leaf: boolean;
};

type ActorProps = NodeProps<Node<ActorData>>;

function ActorCardView({ data }: ActorProps) {
  const { actor, color, rootDuty, glow, leaf } = data;
  // A click (or Enter) opens the actor's calls in the Muse lens; a second one closes it.
  const lens = useLensStoreApi();
  const inLens = useLens((s) => s.open && s.scope.kind === "actor" && s.scope.actor === actor.id);
  const toggleLens = () => {
    if (inLens) lens.getState().close();
    else lens.getState().openActor(actor.id);
  };
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
    inLens ? "actor--lens" : "",
  ].join(" ");
  const style = { "--owner": color, ...(glow ? glowVars(glow.born, glow.life) : {}) } as CSSProperties;
  return (
    <div
      className={classes}
      style={style}
      role="button"
      tabIndex={0}
      aria-pressed={inLens}
      aria-label={`${actor.id}, ${actor.kind}${down ? `, ${actor.status === "dead" ? "detected dead" : "killed"}` : ""}, ${actor.llmCalls} ${actor.llmCalls === 1 ? "model call" : "model calls"}. Open in the Muse lens.`}
      onClick={toggleLens}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleLens();
        }
      }}
    >
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
}

// The card draws from `data` alone. React Flow also passes the node's position, which changes on
// every frame of a glide, so a plain memo would re-render every moving card on every frame.
const ActorCard = memo(ActorCardView, (a, b) => a.data === b.data);

const nodeTypes = { actor: ActorCard };

function glowOf(actor: ActorNode, now: number, life: number): Glow | null {
  const adopted = actor.adoptedTs !== undefined && now - actor.adoptedTs < life ? actor.adoptedTs : -Infinity;
  const restarted = actor.restartedTs !== undefined && now - actor.restartedTs < life ? actor.restartedTs : -Infinity;
  if (adopted === -Infinity && restarted === -Infinity) return null;
  return restarted > adopted ? { kind: "restarted", born: restarted, life } : { kind: "adopted", born: adopted, life };
}

interface TreeFrame {
  nodes: Node<ActorData>[];
  edges: Edge[];
  shape: TreeShape;
}

function buildGraph(view: ViewState, now: number): TreeFrame {
  const reduced = prefersReducedMotion();
  const messageLife = fadeLife(MESSAGE_LIFE_MS, reduced);
  const adoptionLife = fadeLife(ADOPTION_LIFE_MS, reduced);
  const holder = rootHolder(view);
  const placed = layoutTree(view);
  const nodes: Node<ActorData>[] = placed.map(({ id, x, y }) => {
    const actor = view.actors[id];
    return {
      id,
      type: "actor",
      position: { x, y },
      draggable: false,
      focusable: false, // the card inside is the tab stop
      data: {
        actor,
        color: colorOf(view, id),
        rootDuty: holder === id,
        glow: glowOf(actor, now, adoptionLife),
        leaf: isLeafKind(actor.kind),
      },
    };
  });

  const recent = litMessages(view.messages, now, messageLife);
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
    const adopted = actor.adoptedTs !== undefined && now - actor.adoptedTs < adoptionLife;
    const down = actor.status === "killed" || actor.status === "dead" || actor.status === "restarting";
    edges.push({
      id: `tree-${id}`,
      source: actor.parent,
      target: id,
      animated: talking || adopted,
      className: adopted ? "edge--adopted" : talking ? "edge--talking" : down ? "edge--down" : "",
      style: { stroke: colorOf(view, id), ...(talking ? glowVars(talkingTs, messageLife) : {}) },
    });
  }
  // Messages between actors that are not parent and child get their own animated edge.
  for (const m of recent) {
    if (lit.has(`${m.from}->${m.to}`) || !inTree(m.from) || !inTree(m.to)) continue;
    const fade = glowVars(m.ts, messageLife);
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

  const shape: TreeShape = {
    parents: new Map(placed.map(({ id }) => [id, view.actors[id].parent])),
    bounds: boundsOf(view, placed),
    structure: structureKey(view, placed),
  };
  return { nodes, edges, shape };
}

function Graph({ view }: { view: ViewState }) {
  // The committed playhead (at most ~20 writes a second) decides which edges and glows exist;
  // how bright they are comes from --now, frame by frame, in CSS.
  const now = useClock((s) => s.playhead);
  const frame = useMemo(() => buildGraph(view, now), [view, now]);
  const { nodes, onInit } = useTreeMotion(frame.nodes, frame.shape);

  return (
    <ReactFlow
      nodes={nodes}
      edges={frame.edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      // each card is its own tab stop (a button that opens the lens): the library's wrappers and every edge would add two more per node
      nodesFocusable={false}
      edgesFocusable={false}
      proOptions={{ hideAttribution: true }}
      onInit={onInit}
      minZoom={0.2}
    >
      <Background gap={28} size={1} color="var(--grid)" />
    </ReactFlow>
  );
}

export function TreeGraph({ view }: { view: ViewState }) {
  if (view.order.length === 0) {
    return <div className="empty">Waiting for the first actor to spawn…</div>;
  }
  return (
    <ClockScope>
      <ReactFlowProvider>
        <Graph view={view} />
      </ReactFlowProvider>
    </ClockScope>
  );
}
