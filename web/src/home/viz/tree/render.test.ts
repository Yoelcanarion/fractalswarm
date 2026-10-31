import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { treePlayer } from "./frame";
import { Pen, paintTree, MAX_DASHES, type NodeRig, type TreeRig } from "./paint";
import { SwarmTree } from "./SwarmTree";

describe("SwarmTree markup", () => {
  beforeEach(() => {
    // React warns that useLayoutEffect does nothing on the server; the markup is what is under test.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const html = renderToStaticMarkup(createElement(SwarmTree, { progress: motionValue(0), data: story.tree, still: true }));

  it("draws every brain and agent of the bundle, an edge slot for each, and a pool of dashes", () => {
    expect(html.match(/data-node="/g)).toHaveLength(story.tree.counts.orchestrators + story.tree.counts.agents);
    expect(html.match(/data-kind="brain"/g)).toHaveLength(story.tree.counts.orchestrators);
    expect(html.match(/data-edge="/g)).toHaveLength(story.tree.nodes.length);
    expect(html.match(/data-dash="/g)).toHaveLength(MAX_DASHES);
  });

  it("has a text alternative built from the data, and no number that is not a number", () => {
    expect(html).toContain("<title");
    expect(html).toContain(`${story.takeover.killed} of the ${story.tree.counts.orchestrators} orchestrators are killed`);
    expect(html).toContain(`${story.finish.talksPlaced} of ${story.finish.talksTotal} talks`);
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("names each killed brain's time of death", () => {
    for (const k of story.tree.kills) expect(html).toContain(`† ${(k.atMs / 1000).toFixed(1)} s`);
  });
});

/** An element that only records what is set on it. */
function fake<E extends Element>(log: Map<object, Record<string, string>>): Pen<E> {
  const store: Record<string, string> = {};
  const el = {
    setAttribute: (name: string, value: string) => {
      store[name] = value;
    },
    set textContent(v: string) {
      store["#text"] = v;
    },
  } as unknown as E;
  log.set(el, store);
  return new Pen(el);
}

describe("paintTree", () => {
  const player = treePlayer(story.tree, "story");
  const log = new Map<object, Record<string, string>>();
  const nodes: Record<string, NodeRig> = {};
  for (const id of player.model.ids) {
    const info = player.model.node[id];
    const brain = info?.kind === "brain";
    nodes[id] = {
      size: (info?.size ?? 0.2) * 64,
      brain,
      g: fake(log),
      pulse: brain ? fake(log) : null,
      flash: brain ? fake(log) : null,
      crown: brain ? fake(log) : null,
      tag: brain ? fake(log) : null,
      cand: brain ? fake(log) : null,
      heir: brain ? fake(log) : null,
      ticks: brain ? Array.from({ length: 5 }, () => fake<SVGCircleElement>(log)) : [],
      ticksG: brain ? fake(log) : null,
      stamp: brain ? fake(log) : null,
      sub: brain ? fake(log) : null,
      score: brain ? fake(log) : null,
      scoreBar: brain ? fake(log) : null,
      scoreText: brain ? fake(log) : null,
    };
  }
  const rig: TreeRig = {
    nodes,
    edges: Object.fromEntries(player.model.ids.map((id) => [id, fake<SVGPathElement>(log)])),
    dashes: Array.from({ length: MAX_DASHES }, () => fake<SVGLineElement>(log)),
    clock: fake(log),
    memorial: fake(log),
  };

  it("writes finite numbers for the whole run and the states the frame says", () => {
    for (let i = 0; i <= 1500; i++) {
      const frame = player.frame(i / 1500);
      paintTree(rig, frame);
      for (const store of log.values()) {
        for (const [name, value] of Object.entries(store)) {
          expect(value, name).not.toMatch(/NaN|undefined|Infinity/);
        }
      }
      for (const n of frame.nodes) expect(log.get(nodes[n.id]!.g.el)?.["data-state"]).toBe(n.state);
    }
  }, 20_000); // 1,500 painted frames: about 5 s alone, more on a busy machine

  it("ends on the run clock at the end of the log and the memorial shown", () => {
    paintTree(rig, player.frame(1));
    expect(log.get(rig.clock!.el)?.["#text"]).toBe(`${(story.tree.durationMs / 1000).toFixed(1)} s`);
    expect(log.get(rig.memorial!.el)?.opacity).toBe("1.00");
  });

  it("shows the KILLED label once a dead brain has set off for the memorial, never over an empty row", () => {
    let shownEmpty = 0;
    let firstSetOff = Infinity;
    for (let i = 0; i <= 3000; i++) {
      const frame = player.frame(i / 3000);
      paintTree(rig, frame);
      const opacity = Number(log.get(rig.memorial!.el)?.opacity);
      const someoneThere = frame.nodes.some((n) => n.state === "dead" && n.buried > 0);
      if (someoneThere) firstSetOff = Math.min(firstSetOff, i);
      if (!someoneThere && opacity > 0) shownEmpty++;
      expect(opacity, `label at ${i}`).toBeGreaterThanOrEqual(0);
      expect(opacity, `label at ${i}`).toBeLessThanOrEqual(1);
    }
    expect(firstSetOff).toBeLessThan(Infinity);
    expect(shownEmpty).toBe(0);
  });
});

describe("Pen", () => {
  type Text = { nodeType: number; nodeValue: string };
  const stand = (text: string | null) => {
    const node: Text | null = text === null ? null : { nodeType: 3, nodeValue: text };
    const el = { firstChild: node, lastChild: node, sets: 0 };
    Object.defineProperty(el, "textContent", {
      get: () => el.firstChild?.nodeValue ?? "",
      set: (v: string) => {
        el.sets++;
        el.firstChild = el.lastChild = { nodeType: 3, nodeValue: v };
      },
    });
    return { el: el as typeof el & { textContent: string }, node };
  };

  it("changes the one text node where it stands, writes the text of an empty element once, and writes nothing for the same text", () => {
    const { el, node } = stand("a");
    const pen = new Pen(el as unknown as Element);
    pen.text("b");
    expect(node!.nodeValue).toBe("b");
    expect(el.sets).toBe(0);
    pen.text("b");
    pen.text("c");
    expect(node!.nodeValue).toBe("c");
    expect(el.sets).toBe(0);
    const empty = stand(null);
    const fresh = new Pen(empty.el as unknown as Element);
    fresh.text("x");
    expect(empty.el.sets).toBe(1);
    expect(empty.el.textContent).toBe("x");
    fresh.text("y");
    expect(empty.el.sets).toBe(1);
    expect(empty.el.textContent).toBe("y");
  });
});
