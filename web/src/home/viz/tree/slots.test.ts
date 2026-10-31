// The hero draws the memorial row from its first frame: the rule, the label and, for each brain the run kills, an empty place that the
// brain fills as it lands. The click demo has its own shelf and does not draw the places.

import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { KillDemo } from "../demo/KillDemo";
import { treePlayer } from "./frame";
import { Pen, paintTree, U, type TreeRig } from "./paint";
import { SwarmTree } from "./SwarmTree";

const player = treePlayer(story.tree, "hero");
const ids = Object.keys(player.model.memorial);

describe("the empty places of the memorial row, in the markup", () => {
  beforeEach(() => {
    // React warns that useLayoutEffect does nothing on the server; the markup is what is under test.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const markup = (slots: boolean): string =>
    renderToStaticMarkup(createElement(SwarmTree, { progress: motionValue(0), data: story.tree, still: true, pacing: "hero", slots }));
  const places = (html: string) =>
    [...html.matchAll(/<circle class="hv-slot" data-slot="([^"]+)" cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)" opacity="0">/g)].map((m) => ({
      id: m[1] as string,
      cx: Number(m[2]),
      cy: Number(m[3]),
      r: Number(m[4]),
    }));

  it("are one for each brain the run kills, where that brain will lie and the size of its ring", () => {
    const found = places(markup(true));
    expect(ids).toHaveLength(story.tree.kills.length);
    expect(found.map((p) => p.id)).toEqual(ids);
    for (const p of found) {
      const slot = player.model.memorial[p.id]!;
      expect(p.cx).toBeCloseTo(slot.x * U, 1);
      expect(p.cy).toBeCloseTo(slot.y * U, 1);
      expect(p.r).toBeCloseTo((player.model.node[p.id]?.size ?? 0) * U, 1);
    }
  });

  it("lie in the group of the rule and the label, under the edges and the nodes, so that a brain that lands covers its place", () => {
    const html = markup(true);
    const group = /<g class="hv-memorial"[^>]*>([\s\S]*?)<\/g>/.exec(html)?.[1] ?? "";
    expect(group).toContain("hv-memorial-rule");
    expect(group).toContain("KILLED");
    expect(group.match(/class="hv-slot"/g)).toHaveLength(ids.length);
    expect(html.indexOf("hv-slot")).toBeLessThan(html.indexOf('data-edge="'));
    expect(html.indexOf("hv-slot")).toBeLessThan(html.indexOf('data-node="'));
  });

  it("are not drawn unless the tree is asked for them: not for the story's tree, and not in the click demo", () => {
    expect(markup(false)).not.toContain("hv-slot");
    expect(renderToStaticMarkup(createElement(KillDemo, { still: true }))).not.toContain("hv-slot");
  });
});

describe("the empty places of the memorial row, painted", () => {
  const rigOf = (): { rig: TreeRig; memorial: Record<string, string>; slot: Record<string, Record<string, string>> } => {
    const fake = <E extends Element>(log: Record<string, string>): Pen<E> => new Pen({ setAttribute: (name: string, value: string) => void (log[name] = value) } as unknown as E);
    const memorial: Record<string, string> = {};
    const slot: Record<string, Record<string, string>> = Object.fromEntries(ids.map((id) => [id, {}]));
    const rig: TreeRig = {
      nodes: {},
      edges: {},
      dashes: [],
      clock: null,
      memorial: fake(memorial),
      slots: Object.fromEntries(ids.map((id) => [id, fake<SVGCircleElement>(slot[id] as Record<string, string>)])),
    };
    return { rig, memorial, slot };
  };
  const hero = (p: number, appear: number) => ({ ...player.frame(p, appear), shelf: 1 });

  it("are all open, with the rule and the label in full, on the first frame of the loop, when only the root is drawn", () => {
    const { rig, memorial, slot } = rigOf();
    paintTree(rig, hero(0, 0));
    expect(Number(memorial.opacity)).toBe(1);
    for (const id of ids) expect(Number(slot[id]?.opacity), id).toBe(1);
  });

  it("are taken one at a time, each as its own brain lands in it and no other, and all of them are taken when the run ends", () => {
    const { rig, slot } = rigOf();
    let someTaken = 0;
    let someOpenWhileOneIsTaken = 0;
    for (let i = 0; i <= 1500; i++) {
      const frame = hero(i / 1500, 1);
      paintTree(rig, frame);
      const opacities = ids.map((id) => Number(slot[id]?.opacity));
      for (const id of ids) {
        const node = frame.nodes.find((n) => n.id === id)!;
        expect(Number(slot[id]?.opacity), `${id} at ${i}`).toBeCloseTo(1 - node.buried, 2);
      }
      if (opacities.some((o) => o === 0)) someTaken++;
      if (opacities.some((o) => o === 0) && opacities.some((o) => o === 1)) someOpenWhileOneIsTaken++;
    }
    expect(someTaken).toBeGreaterThan(0);
    expect(someOpenWhileOneIsTaken).toBeGreaterThan(0);
    paintTree(rig, hero(1, 1));
    for (const id of ids) expect(Number(slot[id]?.opacity), id).toBe(0);
  });

  it("are open again as the settled tree folds back into its root, never before the graves have begun to fade, and all open at the end", () => {
    const { rig, slot } = rigOf();
    let before = ids.map(() => 0);
    for (let i = 20; i >= 0; i--) {
      paintTree(rig, hero(1, i / 20));
      const now = ids.map((id) => Number(slot[id]?.opacity));
      now.forEach((o, k) => expect(o, `${ids[k]} at appear ${i / 20}`).toBeGreaterThanOrEqual((before[k] ?? 0) - 1e-9));
      before = now;
    }
    for (const id of ids) expect(Number(slot[id]?.opacity), id).toBe(1);
  });

  it("show the shelf from the start only when the frame says so: the story's own frames wait for the first dead brain", () => {
    const { rig, memorial } = rigOf();
    paintTree(rig, player.frame(0, 0));
    expect(Number(memorial.opacity)).toBe(0);
  });
});
