import { describe, expect, it } from "vitest";

import { BEATS, chapterAt, CHAPTERS, isChapterId, isTarget } from "./chapters";
import { targetHash, isHomeHash, parseHomeAddress } from "./route";

describe("the home route", () => {
  it("is the empty hash, the bare slash and the home alias", () => {
    for (const hash of ["", "#", "#/", "#//", "#/?theme=light", "#/home", "#/home/"]) expect(isHomeHash(hash)).toBe(true);
  });

  it("leaves every existing deep link to the app shell", () => {
    const links = [
      "#/run",
      "#/run/demo-backup",
      "#/run/demo-backup/plan?at=end&speed=4&play",
      "#/runs",
      "#/arena",
      "#/arena/a/b",
      "#/new",
      "#/new/review/x",
      "#/ablation",
      "#/helps",
      "#/charts",
      "#/director/s1-arena-open",
    ];
    for (const hash of links) expect(isHomeHash(hash)).toBe(false);
  });
});

describe("the home address", () => {
  it("names a chapter to open at, and asks for the still capture", () => {
    expect(parseHomeAddress("#/")).toEqual({ target: null, still: false });
    expect(parseHomeAddress("#/?at=solution")).toEqual({ target: "solution", still: false });
    expect(parseHomeAddress("#/?at=evidence&still")).toEqual({ target: "evidence", still: true });
    expect(parseHomeAddress("#/", "?still")).toEqual({ target: null, still: true });
  });

  it("ignores a chapter that does not exist", () => {
    expect(parseHomeAddress("#/?at=nowhere").target).toBeNull();
    expect(isChapterId("enter")).toBe(true);
    expect(isChapterId("hero")).toBe(false);
  });

  it("names a beat of a chapter as well as a chapter", () => {
    expect(isTarget("tie")).toBe(true);
    expect(isChapterId("tie")).toBe(false);
    expect(parseHomeAddress("#/?at=tie").target).toBe("tie");
  });

  it("round-trips: the hash of a chapter or a beat opens the home page there", () => {
    for (const id of [...CHAPTERS.map((chapter) => chapter.id), ...BEATS]) {
      expect(isHomeHash(targetHash(id))).toBe(true);
      expect(parseHomeAddress(targetHash(id)).target).toBe(id);
    }
  });
});

describe("the chapter under a probe line", () => {
  const tops = [900, 2400, 4000, 5100, 8000];
  it("is -1 above the first chapter and the last one that has started below it", () => {
    expect(chapterAt(tops, 0)).toBe(-1);
    expect(chapterAt(tops, 899)).toBe(-1);
    expect(chapterAt(tops, 900)).toBe(0);
    expect(chapterAt(tops, 3999)).toBe(1);
    expect(chapterAt(tops, 4000)).toBe(2);
    expect(chapterAt(tops, 99999)).toBe(4);
    expect(chapterAt([], 10)).toBe(-1);
  });
});
