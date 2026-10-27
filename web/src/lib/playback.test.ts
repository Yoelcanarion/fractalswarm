import { describe, expect, it } from "vitest";

import { advancePlayhead, countAtTime, Folder, MAX_IDLE_GAP_MS, SNAPSHOT_EVERY } from "./playback";
import { foldEvents } from "./reducer";
import { loadJsonl, Stream } from "./testing";

const toy = loadJsonl("tests/golden/toy/events.jsonl");

describe("playback", () => {
  it("counts the events at or before a virtual time", () => {
    expect(countAtTime(toy, -1)).toBe(0);
    expect(countAtTime(toy, 0)).toBe(14); // seqs 1–14 all happen at t=0
    expect(countAtTime(toy, 577)).toBe(20);
    expect(countAtTime(toy, 10_000)).toBe(56);
  });

  it("advances at the chosen speed and stops at the end", () => {
    expect(advancePlayhead(toy, 0, 100, 1)).toBe(100);
    expect(advancePlayhead(toy, 0, 100, 20)).toBe(1692);
  });

  it("skips idle gaps longer than the real-time cap", () => {
    const s = new Stream().at(0).emit("a", "x").at(60_000).emit("b", "x");
    const next = advancePlayhead(s.events, 0, 16, 1);
    expect(next).toBe(60_000 - MAX_IDLE_GAP_MS);
  });

  it("seeks to any position, forwards and backwards, and agrees with a plain fold", () => {
    const s = new Stream().spawn("root", "root", null);
    for (let i = 0; i < SNAPSHOT_EVERY * 2 + 17; i++) s.emit("msg.sent", "root", { to: "root", topic: `m${i}` });
    const folder = new Folder(s.events);
    for (const target of [s.events.length, 3, SNAPSHOT_EVERY + 1, SNAPSHOT_EVERY * 2, 0, 400]) {
      expect(folder.seek(target)).toEqual(foldEvents(s.events.slice(0, target)));
      expect(folder.count).toBe(target);
    }
  });

  it("extends with tailed events", () => {
    const folder = new Folder(toy.slice(0, 10));
    expect(folder.seek(100).lastSeq).toBe(10);
    folder.extend(toy.slice(10));
    expect(folder.seek(100).lastSeq).toBe(56);
  });
});
