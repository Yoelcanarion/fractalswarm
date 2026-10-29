import { describe, expect, it } from "vitest";

import { arenaHash, parseArenaRoute } from "./route";

describe("the arena route", () => {
  it("reads the two run ids, the swarm first", () => {
    expect(parseArenaRoute("#/arena/pair1-swarm/pair1-durable-max")).toEqual({
      left: "pair1-swarm",
      right: "pair1-durable-max",
      playback: { atMs: null, speed: null, play: false },
    });
  });

  it("opens at a time in seconds, at a speed, playing", () => {
    expect(parseArenaRoute("#/arena/a/b?t=31.5&speed=5&play")?.playback).toEqual({ atMs: 31_500, speed: 5, play: true });
  });

  it("opens at the end of the longer run", () => {
    expect(parseArenaRoute("#/arena/a/b?at=end")?.playback.atMs).toBe("end");
  });

  it("drops what it cannot use: a speed that is not offered, a time that is not a number, a negative time", () => {
    expect(parseArenaRoute("#/arena/a/b?speed=3&t=soon")?.playback).toEqual({ atMs: null, speed: null, play: false });
    expect(parseArenaRoute("#/arena/a/b?t=-4")?.playback.atMs).toBe(0);
    expect(parseArenaRoute("#/arena/a/b?t=")?.playback.atMs).toBeNull();
  });

  it("is the arena's alone: another hash is not it", () => {
    expect(parseArenaRoute("#/run/x")).toBeNull();
    expect(parseArenaRoute("#/")).toBeNull();
    expect(parseArenaRoute("")).toBeNull();
  });

  it("opens the picker when no pair is named", () => {
    expect(parseArenaRoute("#/arena")).toMatchObject({ left: null, right: null });
    expect(parseArenaRoute("#/arena/only-one")).toMatchObject({ left: "only-one", right: null });
  });

  it("round-trips ids that need escaping", () => {
    const hash = arenaHash("my run/1", "rival #2");
    expect(hash).toBe("#/arena/my%20run%2F1/rival%20%232");
    expect(parseArenaRoute(hash)).toMatchObject({ left: "my run/1", right: "rival #2" });
  });
});
