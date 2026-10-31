import { Background, Handle, Panel, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";

import { useLens, useLensStoreApi } from "../lensStore";
import { useClock } from "../lib/clockHooks";
import { ADOPTION_LIFE_MS, fadeLife, glowVars, litMessages, MESSAGE_LIFE_MS, ringVars } from "../lib/decay";
import { ACROSS, boundsOf, colorOf, isInfraKind, isLeafKind, layoutTree, structureKey } from "../lib/layout";
import { prefersReducedMotion } from "../lib/motion";
import { usePhone } from "../lib/phone";
import { rootHolder, type ActorNode, type ViewState } from "../lib/reducer";
import { useRunStoreApi, useRunStoreShallow } from "../store";
import { ClockScope } from "./ClockScope";
import { EmptyState } from "./ui";
import { bringRunIntoView, keepFocusOnPause, useFirstCrashStart, watchFirstCrash } from "./PlayAction";
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
  /** A dead brain that handed over everything it held: it stands in the row of the fallen under the tree. */
  fallen: boolean;
  /** The tree is on its side (a phone): the cards join from the left to the right, and are smaller (lib/layout.ts ``ACROSS``). */
  across: boolean;
  /** The one card the Tab key lands on: the cards are a single stop, and the arrow keys move between them. */
  tabbable: boolean;
};

type ActorProps = NodeProps<Node<ActorData>>;

function ActorCardView({ data }: ActorProps) {
  const { actor, color, rootDuty, glow, leaf, fallen, across, tabbable } = data;
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
    fallen ? "actor--fallen" : "",
    across ? "actor--across" : "",
    down ? "actor--down" : "",
    outage ? "actor--restarting" : "",
    actor.status === "stopped" ? "actor--stopped" : "",
    actor.suspected ? "actor--suspected" : "",
    glow ? `actor--${glow.kind}` : "",
    inLens ? "actor--lens" : "",
  ].join(" ");
  const style = { "--owner": color, ...(glow ? glowVars(glow.born, glow.life) : {}) } as CSSProperties;
  const calls = `${actor.llmCalls} ${actor.llmCalls === 1 ? "model call" : "model calls"}`;
  return (
    <div
      className={classes}
      style={style}
      title={`${actor.id}: ${actor.kind}${down ? (actor.status === "dead" ? ", detected dead" : ", killed") : ""}, ${calls}${actor.adoptedBy ? `, adopted by ${actor.adoptedBy}` : ""}`}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={inLens}
      aria-label={`${actor.id}, ${actor.kind}${down ? `, ${actor.status === "dead" ? "detected dead" : "killed"}` : ""}, ${calls}. Open in the Muse lens.`}
      onClick={toggleLens}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleLens();
        }
      }}
    >
      <Handle type="target" position={across ? Position.Left : Position.Top} className="actor__handle" />
      <div className="actor__id">
        {down && (
          <span className="actor__x" title={actor.status === "dead" ? "detected dead" : "killed"}>
            ✕
          </span>
        )}
        {actor.id}
      </div>
      {rootDuty && <div className="actor__duty">ROOT</div>}
      {/* said while the takeover is fresh, under the card so that the card keeps its size and the lines stay where they are; always in the title */}
      {glow?.kind === "adopted" && actor.adoptedBy && <div className="actor__adopted">adopted by {actor.adoptedBy}</div>}
      {outage && (
        <>
          <div className="actor__state">restarting</div>
          <div className="actor__ring" role="img" aria-label="restarting" style={ringVars(outage)} />
        </>
      )}
      <Handle type="source" position={across ? Position.Right : Position.Bottom} className="actor__handle" />
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

function buildGraph(view: ViewState, now: number, active: string | null, across: boolean): TreeFrame {
  const reduced = prefersReducedMotion();
  const messageLife = fadeLife(MESSAGE_LIFE_MS, reduced);
  const adoptionLife = fadeLife(ADOPTION_LIFE_MS, reduced);
  const holder = rootHolder(view);
  const placed = layoutTree(view, across);
  // Tab lands on the card last focused, or on the first one
  const stop = placed.some(({ id }) => id === active) ? active : (placed[0]?.id ?? null);
  const nodes: Node<ActorData>[] = placed.map(({ id, x, y, fallen }) => {
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
        fallen,
        across,
        tabbable: id === stop,
      },
    };
  });

  const recent = litMessages(view.messages, now, messageLife);
  const lit = new Set<string>();
  const edges: Edge[] = [];
  const inTree = (id: string): boolean => view.actors[id] !== undefined && !isInfraKind(view.actors[id].kind);
  for (const { id, parent } of placed) {
    const actor = view.actors[id];
    if (parent === null || !inTree(id) || !inTree(parent)) continue;
    let talkingTs = -Infinity;
    for (const m of recent) {
      if ((m.from === parent && m.to === id) || (m.from === id && m.to === parent)) {
        talkingTs = Math.max(talkingTs, m.ts);
      }
    }
    const talking = talkingTs > -Infinity;
    if (talking) {
      lit.add(`${parent}->${id}`);
      lit.add(`${id}->${parent}`);
    }
    const adopted = actor.adoptedTs !== undefined && now - actor.adoptedTs < adoptionLife;
    const down = actor.status === "killed" || actor.status === "dead" || actor.status === "restarting";
    edges.push({
      id: `tree-${id}`,
      source: parent,
      target: id,
      animated: talking || adopted,
      className: adopted ? "edge--adopted" : talking ? "edge--talking" : down ? "edge--down" : "",
      style: { stroke: colorOf(view, id), ...(talking ? glowVars(talkingTs, messageLife) : {}) },
    });
  }
  // Messages between actors that are not parent and child get their own animated edge.
  for (const m of recent) {
    if (m.from === m.to || lit.has(`${m.from}->${m.to}`) || !inTree(m.from) || !inTree(m.to)) continue;
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
    parents: new Map(placed.map(({ id, parent }) => [id, parent])),
    bounds: boundsOf(view, placed),
    structure: structureKey(view, placed),
    across,
    cards: placed.map(({ x, y, width, height }) => ({ x, y, width, height })),
  };
  return { nodes, edges, shape };
}

/** The arrow keys, Home and End move between the cards of the tree; Tab leaves it. */
function moveBetweenCards(event: KeyboardEvent<HTMLDivElement>): void {
  const card = (event.target as HTMLElement).closest<HTMLElement>(".actor");
  if (card === null) return;
  const cards = [...event.currentTarget.querySelectorAll<HTMLElement>(".actor")];
  const at = cards.indexOf(card);
  const towards: Record<string, number> = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: cards.length - 1 };
  const to = towards[event.key];
  if (to === undefined || to < 0 || to >= cards.length) return;
  event.preventDefault();
  cards[to].focus();
}

// On a phone the tree is as tall as it is, and the page scrolls past it: a touch on it is not a pan or a pinch of the picture.
const ON_A_PHONE = { panOnDrag: false, zoomOnScroll: false, zoomOnPinch: false, zoomOnDoubleClick: false } as const;

function Graph({ view }: { view: ViewState }) {
  // The committed playhead (at most ~20 writes a second) decides which edges and glows exist;
  // how bright they are comes from --now, frame by frame, in CSS.
  const now = useClock((s) => s.playhead);
  const [active, setActive] = useState<string | null>(null);
  const across = usePhone();
  const frame = useMemo(() => buildGraph(view, now, active, across), [view, now, active, across]);
  const { nodes, onInit } = useTreeMotion(frame.nodes, frame.shape);
  const { bounds } = frame.shape;

  return (
    <div className={across ? "run__fill run__fill--across" : "run__fill"} style={across && bounds ? { height: Math.ceil(bounds.height) + 2 * ACROSS.pad } : undefined}>
      <ReactFlow
        nodes={nodes}
        edges={frame.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // the cards are one tab stop together (each a button that opens the lens, the arrow keys between them): the library's wrappers and
        // every edge would add two more per node
        nodesFocusable={false}
        edgesFocusable={false}
        onKeyDown={moveBetweenCards}
        onFocus={(event: FocusEvent<HTMLDivElement>) => {
          const id = (event.target as HTMLElement).closest(".actor")?.querySelector(".actor__id")?.textContent;
          if (id) setActive(id);
        }}
        proOptions={{ hideAttribution: true }}
        onInit={onInit}
        minZoom={0.2}
        // the tree is most of the page, so a plain wheel over it scrolls the page, not the picture; a pinch, or Ctrl and the wheel, still zooms
        preventScrolling={false}
        {...(across ? ON_A_PHONE : undefined)}
      >
        <Background gap={28} size={1} color="var(--grid)" />
        <Panel position="top-left" className="run__legend">
          colour = the branch of the tree a card belongs to · ✕ killed · a moving line is a message
        </Panel>
      </ReactFlow>
    </div>
  );
}

/** The tree before its first orchestrator. A live run is waiting for one. A recorded run is at its start, which is where it opens, and
 * says how to go on; or its log ends without one. */
function NoTreeYet() {
  const { live, cursor, total } = useRunStoreShallow((s) => ({ live: s.live, cursor: s.cursor, total: s.events.length }));
  const store = useRunStoreApi();
  const crashAt = useFirstCrashStart();
  if (live) return <div className="empty">Waiting for the first actor to spawn…</div>;
  if (total > 0 && cursor >= total) {
    return (
      <EmptyState title="This run created no coordinator">
        Its log ends without one, so there is no tree to draw. The counters and the events show what did happen.
      </EmptyState>
    );
  }
  const { seek, setPlaying } = store.getState();
  return (
    <EmptyState
      title={cursor === 0 ? "The run is at its start" : "No coordinator exists yet at this point"}
      actions={
        <>
          {crashAt !== null && (
            <button
              type="button"
              className="btn btn--on"
              onClick={(event) => {
                keepFocusOnPause(event);
                watchFirstCrash(store, crashAt);
                bringRunIntoView();
              }}
            >
              Watch the first crash
            </button>
          )}
          <button
            type="button"
            className={crashAt === null ? "btn btn--on" : "btn"}
            onClick={(event) => {
              keepFocusOnPause(event);
              setPlaying(true);
              bringRunIntoView();
            }}
          >
            {cursor === 0 ? "Play from the start" : "Play"}
          </button>
          <button type="button" className="btn" onClick={() => seek(total)}>
            Jump to the end
          </button>
        </>
      }
    >
      Press play, or drag the playhead along the bar below: each coordinator appears when it starts.
    </EmptyState>
  );
}

export function TreeGraph({ view }: { view: ViewState }) {
  if (view.order.length === 0) return <NoTreeYet />;
  return (
    <ClockScope>
      <ReactFlowProvider>
        <Graph view={view} />
      </ReactFlowProvider>
    </ClockScope>
  );
}
