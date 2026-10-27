import { describe, expect, it } from "vitest";

import { colorOf, layoutTree, ownerOf } from "./layout";
import { emptyView, foldEvent, foldEvents, MESSAGE_WINDOW, rootHolder } from "./reducer";
import { depthTwoTree, loadJsonl, Stream } from "./testing";

describe("the golden toy run", () => {
  const events = loadJsonl("tests/golden/toy/events.jsonl");
  const view = foldEvents(events);

  it("builds the hub and its two workers", () => {
    expect(view.order).toEqual(["hub", "worker-a", "worker-b"]);
    expect(view.actors["worker-a"].parent).toBe("hub");
    expect(view.actors.hub.duties).toEqual(["root"]);
  });

  it("ends with every actor stopped normally (no ✕)", () => {
    expect(view.completed).toBe(true);
    for (const id of view.order) expect(view.actors[id].status).toBe("stopped");
    expect(view.counters.kills).toBe(0);
  });

  it("counts calls, spend and messages, and spends zero coordination tokens", () => {
    expect(view.counters.llmCalls).toBe(5);
    expect(view.counters.spentUsd).toBeCloseTo(0.00101375, 8);
    expect(view.counters.messages).toBe(12);
    expect(view.counters.coordinationTokens).toBe(0);
    expect(view.counters.llmTokens).toBeGreaterThan(0);
    expect(view.lastSeq).toBe(56);
    expect(view.headHash).toBe(events[55].hash);
  });

  it("is a pure fold: folding twice gives equal views and never mutates the input", () => {
    const before = JSON.stringify(emptyView());
    const start = emptyView();
    expect(foldEvents(events, start)).toEqual(view);
    expect(JSON.stringify(start)).toBe(before);
  });

  it("keeps a bounded window of messages for the animated edges", () => {
    const s = new Stream().spawn("a", "hub", null).spawn("b", "worker", "a");
    for (let i = 0; i < MESSAGE_WINDOW + 10; i++) s.emit("msg.sent", "a", { to: "b", topic: "task" });
    const v = foldEvents(s.events);
    expect(v.messages).toHaveLength(MESSAGE_WINDOW);
    expect(v.messages.at(-1)!.seq).toBe(s.events.length);
  });
});

describe("takeover (spec §5.2–5.3), against synthetic events", () => {
  it("marks a chaos kill with ✕ and keeps it through the detected death", () => {
    const s = depthTwoTree().at(5000).emit("chaos.injected", "@env", { kind: "kill_coordinator", target: "t1" });
    let v = foldEvents(s.events);
    expect(v.actors.t1.status).toBe("killed");
    expect(v.counters.kills).toBe(1);
    v = foldEvent(v, s.at(10000).emit("member.dead", "t2", { member: "t1", incarnation: 0 }).events.at(-1)!);
    expect(v.actors.t1.status).toBe("killed");
    expect(v.counters.deaths).toBe(1);
    expect(v.memberEpoch).toBe(1);
  });

  it("suspicion shows before death, and clears once dead", () => {
    const s = depthTwoTree().emit("member.suspected", "t2", { member: "t3" });
    expect(foldEvents(s.events).actors.t3.suspected).toBe(true);
    s.emit("member.dead", "t2", { member: "t3" });
    const v = foldEvents(s.events);
    expect(v.actors.t3.status).toBe("dead");
    expect(v.actors.t3.suspected).toBe(false);
  });

  it("re-wires an orphaned child group under its adopter and recolours it", () => {
    const s = depthTwoTree();
    const before = foldEvents(s.events);
    expect(ownerOf(before, "t1-d1-a")).toBe("t1");
    s.emit("chaos.injected", "@env", { kind: "kill_coordinator", target: "t1" })
      .emit("member.dead", "t2", { member: "t1" })
      .emit("tree.adopted", "t2", { dead: "t1", adopter: "t2" });
    const v = foldEvents(s.events);
    expect(v.actors["t1-d1"].parent).toBe("t2");
    expect(v.actors["t1-d2"].parent).toBe("t2");
    expect(v.actors["t1-d1"].originalParent).toBe("t1");
    expect(v.actors["t1-d1"].adoptedBy).toBe("t2");
    // Grandchildren follow their session: the whole subtree now has t2's colour.
    expect(ownerOf(v, "t1-d1-a")).toBe("t2");
    expect(colorOf(v, "t1-d1-a")).toBe(colorOf(v, "t2"));
    expect(colorOf(before, "t1-d1-a")).not.toBe(colorOf(v, "t1-d1-a"));
    // t2's own colour never changes.
    expect(colorOf(v, "t2")).toBe(colorOf(before, "t2"));
    expect(v.counters.adoptions).toBe(1);
    // The layout puts the adopted sessions under t2.
    const xs = Object.fromEntries(layoutTree(v).map((p) => [p.id, p]));
    expect(xs["t1-d1"].y).toBe(xs["t2-d1"].y);
    expect(Math.min(xs["t1-d1"].x, xs["t2-d1"].x)).toBeLessThan(xs.t2.x);
  });

  it("accepts an explicit children list and alternative field names", () => {
    const s = depthTwoTree().emit("tree.adopted", "t3", { from: "t1", new_parent: "t3", children: ["t1-d2"] });
    const v = foldEvents(s.events);
    expect(v.actors["t1-d2"].parent).toBe("t3");
    expect(v.actors["t1-d1"].parent).toBe("t1");
  });

  it("hands root duties to the successor (root succession)", () => {
    const s = depthTwoTree();
    expect(rootHolder(foldEvents(s.events))).toBe("root");
    s.emit("chaos.injected", "@env", { kind: "kill_coordinator", targets: ["root", "t1"] })
      .emit("member.dead", "t2", { member: "root" })
      .emit("ownership.remapped", "t2", { from: "root", to: "t3", keys: ["final-integration"], duties: ["root"] });
    const v = foldEvents(s.events);
    expect(v.actors.root.status).toBe("killed");
    expect(v.actors.t1.status).toBe("killed");
    expect(rootHolder(v)).toBe("t3");
    expect(v.ownership["final-integration"]).toBe("t3");
    expect(v.counters.remappedKeys).toBe(1);
    expect(v.counters.kills).toBe(2);
  });

  it("kill half the brains: 5 of 10 orchestrators down, the tree still holds every session", () => {
    const s = depthTwoTree();
    const killed = ["root", "t1", "t2-d1", "t3-d2", "t1-d1"];
    s.emit("chaos.injected", "@env", { kind: "kill_coordinator", targets: killed });
    for (const id of killed) s.emit("member.dead", "t3", { member: id });
    s.emit("tree.adopted", "t2", { dead: "t1", adopter: "t2", children: ["t1-d2"] })
      .emit("tree.adopted", "t1-d2", { dead: "t1-d1", adopter: "t1-d2", children: ["t1-d1-a"] })
      .emit("ownership.remapped", "t2", { from: "root", to: "t2", duties: ["root"] });
    const v = foldEvents(s.events);
    const orchestrators = v.order.filter((id) => v.actors[id].kind !== "agent");
    expect(orchestrators).toHaveLength(10);
    expect(orchestrators.filter((id) => v.actors[id].status === "alive")).toHaveLength(5);
    expect(v.actors["t1-d1-a"].parent).toBe("t1-d2");
    expect(ownerOf(v, "t1-d1-a")).toBe("t2");
    expect(rootHolder(v)).toBe("t2");
    expect(v.memberEpoch).toBe(5);
    expect(v.counters.coordinationTokens).toBe(0);
  });

  it("counts tokens of LLM calls tagged as coordination (a baseline supervisor would)", () => {
    const s = new Stream()
      .spawn("sup", "supervisor", null)
      .emit("effect.started", "sup", { effect_id: "e1", kind: "llm", request: { role: "agent" }, tag: "coord:replan" })
      .emit("effect.completed", "@env", {
        effect_id: "e1",
        kind: "llm",
        status: "ok",
        result: { usage: { input_tokens: 100, output_tokens: 20 } },
      });
    expect(foldEvents(s.events).counters.coordinationTokens).toBe(120);
  });

  it("ignores events about unknown actors instead of crashing", () => {
    const s = new Stream()
      .emit("member.dead", "x", { member: "ghost" })
      .emit("tree.adopted", "x", { dead: "ghost", adopter: "nobody" })
      .emit("actor.stopped", "x", { actor_id: "ghost" });
    expect(foldEvents(s.events).order).toEqual([]);
  });
});
