// The recorder's frame clock (scripts/record_scenes.shim.js), run in a vm with the few browser globals it touches.

import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../lib/testing";

const SHIM = readFileSync(`${REPO_ROOT}scripts/record_scenes.shim.js`, "utf-8");

interface FakeAnimation {
  playState: string;
  currentTime: number | null;
  log: string[];
  pause(): void;
}

const animation = (): FakeAnimation => {
  const a: FakeAnimation = {
    playState: "running",
    currentTime: 0,
    log: [],
    pause() {
      a.playState = "paused";
      a.log.push("pause");
    },
  };
  return a;
};

interface Vt {
  FRAME_MS: number;
  advance(dt?: number): Promise<void>;
  settle(): Promise<void>;
  syncAnimations(): void;
  frame(dt?: number): Promise<void>;
  now(): number;
  frames(): number;
  waiting(): number;
}

function page() {
  const animations: FakeAnimation[] = [];
  const errors: unknown[] = [];
  const sandbox: Record<string, unknown> = {
    performance: { now: () => 987_654 },
    document: { getAnimations: () => animations },
    console: { error: (...args: unknown[]) => errors.push(args) },
    MessageChannel,
    setTimeout,
    Promise,
    Map,
    WeakMap,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(SHIM, context);
  const win = sandbox as unknown as {
    requestAnimationFrame(callback: (time: number) => void): number;
    cancelAnimationFrame(id: number): void;
    performance: { now(): number };
    __vt: Vt;
  };
  return { win, vt: win.__vt, animations, errors };
}

describe("the recorder's frame clock", () => {
  it("starts at zero and moves a sixtieth of a second a frame", async () => {
    const { win, vt } = page();
    expect(win.performance.now()).toBe(0);
    await vt.advance();
    expect(win.performance.now()).toBeCloseTo(1000 / 60, 9);
    await vt.advance(5);
    expect(vt.now()).toBeCloseTo(1000 / 60 + 5, 9);
    expect(vt.frames()).toBe(2);
  });

  it("holds requestAnimationFrame callbacks until a frame, runs them in the order they were asked for, all at one time", async () => {
    const { win, vt } = page();
    const seen: [string, number][] = [];
    win.requestAnimationFrame((t) => seen.push(["a", t]));
    win.requestAnimationFrame((t) => seen.push(["b", t]));
    expect(seen).toEqual([]);
    expect(vt.waiting()).toBe(2);
    await vt.advance(16);
    expect(seen).toEqual([["a", 16], ["b", 16]]);
    expect(vt.waiting()).toBe(0);
  });

  it("leaves what a callback asks for to the next frame, as a browser does", async () => {
    const { win, vt } = page();
    const seen: number[] = [];
    const loop = (t: number): void => {
      seen.push(t);
      win.requestAnimationFrame(loop);
    };
    win.requestAnimationFrame(loop);
    await vt.advance(10);
    expect(seen).toEqual([10]);
    await vt.advance(10);
    await vt.advance(10);
    expect(seen).toEqual([10, 20, 30]);
  });

  it("forgets a callback that was cancelled", async () => {
    const { win, vt } = page();
    const seen: string[] = [];
    const first = win.requestAnimationFrame(() => seen.push("first"));
    win.requestAnimationFrame(() => seen.push("second"));
    win.cancelAnimationFrame(first);
    win.cancelAnimationFrame(999); // an id that was never given is not an error
    await vt.advance();
    expect(seen).toEqual(["second"]);
  });

  it("runs the microtasks between callbacks, so what one renders is there for the next", async () => {
    const { win, vt } = page();
    const seen: string[] = [];
    win.requestAnimationFrame(() => {
      seen.push("a");
      void Promise.resolve().then(() => seen.push("a's microtask"));
    });
    win.requestAnimationFrame(() => seen.push("b"));
    await vt.advance();
    expect(seen).toEqual(["a", "a's microtask", "b"]);
  });

  it("goes on after a callback that throws, and says so", async () => {
    const { win, vt, errors } = page();
    const seen: string[] = [];
    win.requestAnimationFrame(() => {
      throw new Error("boom");
    });
    win.requestAnimationFrame(() => seen.push("after"));
    await vt.advance();
    expect(seen).toEqual(["after"]);
    expect(errors).toHaveLength(1);
  });

  it("is installed once: a second load keeps the clock and its queue", async () => {
    const sandbox = page();
    const seen: number[] = [];
    sandbox.win.requestAnimationFrame((t) => seen.push(t));
    vm.runInContext(SHIM, vm.createContext(sandbox.win as unknown as vm.Context)); // not the same context: only to be sure it does not throw
    const first = sandbox.win.__vt;
    await first.advance(4);
    expect(seen).toEqual([4]);
  });
});

describe("the animations the clock holds", () => {
  it("pauses each animation the first time it sees it and puts it at its own zero", async () => {
    const { vt, animations } = page();
    await vt.advance(100);
    const a = animation();
    animations.push(a);
    vt.syncAnimations();
    expect(a.log).toEqual(["pause"]);
    expect(a.currentTime).toBe(0);
    await vt.advance(50);
    vt.syncAnimations();
    expect(a.currentTime).toBe(50);
    expect(a.log).toEqual(["pause"]); // paused once
  });

  it("gives each animation its own time: the one that began later is behind the one that began first", async () => {
    const { vt, animations } = page();
    const early = animation();
    animations.push(early);
    vt.syncAnimations();
    await vt.advance(200);
    const late = animation();
    animations.push(late);
    vt.syncAnimations();
    await vt.advance(100);
    vt.syncAnimations();
    expect(early.currentTime).toBe(300);
    expect(late.currentTime).toBe(100);
  });

  it("moves them in a frame, after the page has had its turn", async () => {
    const { win, vt, animations } = page();
    const a = animation();
    animations.push(a);
    const order: string[] = [];
    win.requestAnimationFrame(() => order.push(`callback at ${vt.now().toFixed(0)}`));
    await vt.frame(16);
    expect(order).toEqual(["callback at 16"]);
    expect(a.currentTime).toBe(0);
    await vt.frame(16);
    expect(a.currentTime).toBe(16);
  });

  it("does not pause an animation the page is not running any more", async () => {
    const { vt, animations } = page();
    const a = animation();
    animations.push(a);
    vt.syncAnimations();
    animations.length = 0; // it finished and left the document
    await vt.advance(30);
    vt.syncAnimations();
    expect(a.currentTime).toBe(0);
  });
});
