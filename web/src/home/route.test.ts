import { describe, expect, it } from "vitest";

import { chapterAt, CHAPTERS, isChapterId } from "./chapters";
import { chapterHash, isHomeHash, parseHomeAddress } from "./route";

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
    expect(parseHomeAddress("#/")).toEqual({ chapter: null, still: false });
    expect(parseHomeAddress("#/?at=solution")).toEqual({ chapter: "solution", still: false });
    expect(parseHomeAddress("#/?at=evidence&still")).toEqual({ chapter: "evidence", still: true });
    expect(parseHomeAddress("#/", "?still")).toEqual({ chapter: null, still: true });
  });

  it("ignores a chapter that does not exist", () => {
    expect(parseHomeAddress("#/?at=nowhere").chapter).toBeNull();
    expect(isChapterId("enter")).toBe(true);
    expect(isChapterId("hero")).toBe(false);
  });

  it("round-trips: the hash of a chapter opens the home page at that chapter", () => {
    for (const { id } of CHAPTERS) {
      expect(isHomeHash(chapterHash(id))).toBe(true);
      expect(parseHomeAddress(chapterHash(id)).chapter).toBe(id);
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
