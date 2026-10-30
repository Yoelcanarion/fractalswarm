import { describe, expect, it } from "vitest";

import {
  evidenceHash,
  isEvidenceHash,
  isHomeHash,
  isLabHash,
  pageOf,
  parseEvidenceAddress,
  parseHomeAddress,
  targetHash,
} from "./route";
import { EVIDENCE_IDS, isEvidenceId, isSectionId, isTarget, SECTION_IDS, SPOTS } from "./sections";

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
    for (const hash of links) {
      expect(isHomeHash(hash)).toBe(false);
      expect(pageOf(hash), hash).toBe("app");
    }
  });
});

describe("the page an address opens", () => {
  it("is the lab at #/home-lab, the evidence page at #/evidence, the home page for its own hashes, and the app shell for the rest", () => {
    expect(pageOf("#/home-lab")).toBe("lab");
    expect(pageOf("#/home-lab?x=1")).toBe("lab");
    expect(isLabHash("#/home-lab/")).toBe(true);
    expect(pageOf("#/evidence")).toBe("evidence");
    expect(pageOf("#/evidence/")).toBe("evidence");
    expect(pageOf("#/evidence?at=tie")).toBe("evidence");
    expect(isEvidenceHash("#/evidence?still")).toBe(true);
    expect(pageOf("")).toBe("home");
    expect(pageOf("#/home")).toBe("home");
    expect(pageOf("#/arena")).toBe("app");
    expect(isHomeHash("#/home-lab")).toBe(false);
    expect(isHomeHash("#/evidence")).toBe(false);
    expect(isLabHash("#/home")).toBe(false);
    expect(isEvidenceHash("#/evidence-of-nothing")).toBe(false);
  });
});

describe("the home address", () => {
  it("names a section to open at, and asks for the still capture", () => {
    expect(parseHomeAddress("#/")).toEqual({ target: null, still: false });
    expect(parseHomeAddress("#/?at=solution")).toEqual({ target: "solution", still: false });
    expect(parseHomeAddress("#/?at=proof&still")).toEqual({ target: "proof", still: true });
    expect(parseHomeAddress("#/", "?still")).toEqual({ target: null, still: true });
  });

  it("has the five sections, in reading order, and the click demo as a place of its own", () => {
    expect([...SECTION_IDS]).toEqual(["hero", "problem", "solution", "proof", "enter"]);
    expect([...SPOTS]).toEqual(["demo"]);
    expect(parseHomeAddress("#/?at=demo").target).toBe("demo");
    expect(parseHomeAddress("#/?at=hero").target).toBe("hero");
  });

  it("ignores a place that does not exist, and the places of the evidence page, which are not on the home page", () => {
    expect(parseHomeAddress("#/?at=nowhere").target).toBeNull();
    expect(parseHomeAddress("#/?at=models").target).toBeNull();
    expect(parseHomeAddress("#/?at=tie").target).toBeNull();
    expect(isSectionId("enter")).toBe(true);
    expect(isSectionId("demo")).toBe(false);
    expect(isTarget("demo")).toBe(true);
    expect(isTarget("tie")).toBe(false);
  });

  it("round-trips: the hash of a section or the demo opens the home page there", () => {
    for (const id of [...SECTION_IDS, ...SPOTS]) {
      expect(isHomeHash(targetHash(id))).toBe(true);
      expect(parseHomeAddress(targetHash(id)).target).toBe(id);
    }
  });
});

describe("the evidence address", () => {
  it("names a place on the page, and ignores one that does not exist", () => {
    expect(parseEvidenceAddress("#/evidence")).toEqual({ target: null });
    expect(parseEvidenceAddress("#/evidence?at=tie")).toEqual({ target: "tie" });
    expect(parseEvidenceAddress("#/evidence?at=enter")).toEqual({ target: null });
    expect(isEvidenceId("fair")).toBe(true);
    expect(isEvidenceId("problem")).toBe(false);
  });

  it("round-trips: the hash of a place opens the evidence page there", () => {
    expect(evidenceHash()).toBe("#/evidence");
    for (const id of EVIDENCE_IDS) {
      expect(pageOf(evidenceHash(id))).toBe("evidence");
      expect(parseEvidenceAddress(evidenceHash(id)).target).toBe(id);
    }
  });
});
