import { describe, expect, it } from "vitest";

import { createDriver, type DriverState, type FrameLoop } from "./driver";
import { createTake, type Take } from "./take";
import { fakeReplay, fakeSurface, sceneOf } from "./testing";

/** A frame loop the test turns by hand: each `frame()` calls what was asked for since the last one. */
function handLoop() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const loop: FrameLoop = {
    request(callback) {
      pending.set(next, callback);
      return next++;
    },
    cancel: (handle) => void pending.delete(handle),
  };
  return {
    loop,
    frame() {
      const due = [...pending.values()];
      pending.clear();
      due.forEach((callback) => callback());
    },
    asked: () => pending.size,
  };
}

function driven(options: { hold?: boolean; preroll?: number; duration?: number; defer?: (task: () => void) => void } = {}) {
  const hand = handLoop();
  const replay = fakeReplay();
  const take = createTake(sceneOf({ duration_ms: options.duration ?? 1000, steps: [{ do: "play" }] }), replay, fakeSurface({}));
  const seen: DriverState[] = [];
  const driver = createDriver(take, { hold: options.hold ?? false, preroll: options.preroll ?? 3, loop: hand.loop, defer: options.defer ?? ((task) => task()), onChange: (state) => seen.push(state) });
  return { hand, take, replay, driver, seen };
}

const frames = (hand: ReturnType<typeof handLoop>, count: number): void => {
  for (let i = 0; i < count; i++) hand.frame();
};

describe("what draws a take's frames", () => {
  it("asks for no frame while the page is loading", () => {
    const { hand, driver } = driven();
    expect(driver.state()).toBe("loading");
    expect(hand.asked()).toBe(0);
    driver.go();
    driver.pause();
    expect(driver.state()).toBe("loading");
  });

  it("lets the pre-roll go by with the take held, then plays one frame of the take a frame", () => {
    const { hand, take, replay, driver } = driven({ preroll: 3 });
    driver.ready();
    expect(driver.state()).toBe("preroll");
    frames(hand, 2);
    expect(driver.state()).toBe("preroll");
    hand.frame();
    expect(driver.state()).toBe("playing");
    expect(take.state.getState().frame).toBe(0);
    expect(replay.playing()).toBe(false);
    hand.frame();
    expect(take.state.getState().frame).toBe(1);
    expect(replay.playing()).toBe(true);
    frames(hand, 9);
    expect(take.state.getState().frame).toBe(10);
  });

  it("stops asking for frames when the last one is drawn", () => {
    const { hand, take, driver, seen } = driven({ preroll: 1 });
    driver.ready();
    frames(hand, 1 + 59);
    expect(take.state.getState().frame).toBe(59);
    expect(driver.state()).toBe("playing");
    hand.frame();
    expect(take.state.getState()).toMatchObject({ frame: 60, done: true });
    expect(driver.state()).toBe("done");
    expect(hand.asked()).toBe(0);
    expect(seen).toEqual(["preroll", "playing", "done"]);
  });

  it("waits for go() after the pre-roll when the address said hold", () => {
    const { hand, take, driver } = driven({ hold: true, preroll: 2 });
    driver.ready();
    frames(hand, 2);
    expect(driver.state()).toBe("waiting");
    expect(hand.asked()).toBe(0);
    expect(take.state.getState().frame).toBe(0);
    driver.go();
    expect(driver.state()).toBe("playing");
    hand.frame();
    expect(take.state.getState().frame).toBe(1);
  });

  it("does not start twice and cannot be started before it is ready", () => {
    const { hand, driver } = driven({ preroll: 2 });
    driver.ready();
    driver.ready();
    expect(hand.asked()).toBe(1);
    driver.go(); // not waiting: nothing happens
    expect(driver.state()).toBe("preroll");
  });

  it("pauses, steps one frame at a time, and resumes", () => {
    const { hand, take, driver } = driven({ preroll: 1 });
    driver.ready();
    frames(hand, 1 + 5);
    expect(take.state.getState().frame).toBe(5);
    driver.pause();
    expect(driver.state()).toBe("paused");
    hand.frame(); // a frame already asked for finds the driver paused and does nothing
    expect(take.state.getState().frame).toBe(5);
    expect(hand.asked()).toBe(0);
    driver.step();
    driver.step();
    expect(take.state.getState().frame).toBe(7);
    driver.resume();
    hand.frame();
    expect(take.state.getState().frame).toBe(8);
  });

  it("does not step a take that is playing", () => {
    const { hand, take, driver } = driven({ preroll: 1 });
    driver.ready();
    frames(hand, 3);
    driver.step();
    expect(take.state.getState().frame).toBe(2);
  });

  it("starts the take again from its first frame, whether it is playing, paused or done", () => {
    const { hand, take, replay, driver } = driven({ preroll: 1, duration: 1000 });
    driver.ready();
    frames(hand, 1 + 60);
    expect(driver.state()).toBe("done");
    expect(replay.playhead()).toBeGreaterThan(0);
    driver.restart();
    expect(take.state.getState()).toMatchObject({ frame: 0, done: false });
    expect(replay.playhead()).toBe(0);
    expect(driver.state()).toBe("playing");
    frames(hand, 3);
    expect(take.state.getState().frame).toBe(3);
  });

  it("cannot be restarted before the take is on", () => {
    const { driver } = driven();
    driver.restart();
    expect(driver.state()).toBe("loading");
    driver.ready();
    driver.restart();
    expect(driver.state()).toBe("preroll");
  });

  it("places the rings again once React has rendered, one frame behind each tick, and not before", () => {
    const later: (() => void)[] = [];
    const calls: string[] = [];
    const hand = handLoop();
    const inner = createTake(sceneOf({ duration_ms: 1000 }), fakeReplay(), fakeSurface({}));
    const spy: Take = {
      ...inner,
      tick: () => {
        calls.push("tick");
        inner.tick();
      },
      refresh: () => {
        calls.push("refresh");
        inner.refresh();
      },
    };
    const driver = createDriver(spy, { hold: false, preroll: 1, loop: hand.loop, defer: (task) => void later.push(task) });
    driver.ready();
    hand.frame(); // the pre-roll ends
    calls.length = 0; // (it places the rings once as it goes on)
    hand.frame();
    expect(calls).toEqual(["tick"]);
    later.splice(0).forEach((task) => task());
    expect(calls).toEqual(["tick", "refresh"]);
  });

  it("asks for nothing once disposed, even for a frame already asked for", () => {
    const { hand, take, driver } = driven({ preroll: 1 });
    driver.ready();
    frames(hand, 3);
    driver.dispose();
    expect(hand.asked()).toBe(0);
    hand.frame();
    expect(take.state.getState().frame).toBe(2);
    expect(hand.asked()).toBe(0);
  });
});
