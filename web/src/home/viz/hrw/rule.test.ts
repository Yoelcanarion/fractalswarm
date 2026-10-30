// The TypeScript port of the heir rule against Python: BLAKE2b with an 8-byte digest, the scores, the ranking and the remap, with
// the values `coord/hrw.py` and `kernel/ids.py` give, and every score of the recorded run (`story.hrw.rounds`).

import { describe, expect, it } from "vitest";

import { story } from "../../data/story";
import { blake2b8 } from "./blake2b";
import { capacity, fractionOf, rank, remap, scoreHex } from "./rule";

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("BLAKE2b with an 8-byte digest", () => {
  // from hashlib.blake2b(data, digest_size=8).hexdigest(), the data being (i * 7 + 3) % 256 for i below the length
  const BY_LENGTH: [number, string][] = [
    [0, "e4a6a0577479b2b4"],
    [3, "66dca9ec9fcd9a2c"],
    [127, "5c7a95645fba062c"],
    [128, "5a0875a570ceb2ae"],
    [129, "79f7ec8e27e1f993"],
    [255, "0382ae4bfbfb3aa2"],
    [256, "27cc63362e6b95a6"],
    [257, "553ab6c320fc7b98"],
    [300, "f64b7f6931ef8d17"],
  ];
  for (const [n, want] of BY_LENGTH) {
    it(`gives Python's digest for ${n} bytes${n === 0 ? " (nothing)" : n % 128 === 0 ? " (whole blocks)" : ""}`, () => {
      expect(hex(blake2b8(bytes(n)))).toBe(want);
    });
  }

  it("gives Python's digest for texts, UTF-8 included", () => {
    expect(hex(blake2b8(utf8("abc")))).toBe("d8bb14d833d59559");
    expect(hex(blake2b8(utf8('["hrw","root","o1"]')))).toBe("e5ec11ecd2057b7e");
    expect(hex(blake2b8(utf8("héllo ✓ wörld")))).toBe("2d4d74f01e191224");
  });
});

describe("the score of a member for a key", () => {
  it("is stable_hash('hrw', key, member) in 16 hex digits, as Python gives it", () => {
    expect(scoreHex("root", "o1")).toBe("e5ec11ecd2057b7e");
    expect(scoreHex("root", "o2")).toBe("40644f4adc41ea7c");
    expect(scoreHex("root", "o3")).toBe("3dea08728f5da819");
    expect(scoreHex("track-ai", "o3")).toBe("03e10a4fcb070fd8");
    expect(scoreHex("x", "y")).toBe("f754be22f2fb5298");
    expect(scoreHex("k".repeat(40), "m".repeat(40))).toBe("74945a1b932fb4b7");
  });

  it("is every score the recorded run keeps, for every candidate of every round", () => {
    let seen = 0;
    for (const round of story.hrw.rounds) {
      for (const s of round.scores) {
        expect(scoreHex(round.goal, s.member), `${round.goal} for ${s.member}`).toBe(s.score);
        expect(fractionOf(s.score)).toBeCloseTo(s.fraction, 4);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(11);
  });

  it("ranks the pool of every round as the run did, the heir first", () => {
    for (const round of story.hrw.rounds) {
      const ranked = rank(round.goal, round.pool);
      expect(ranked[0], `${round.goal} after ${round.previous}`).toBe(round.heir);
      expect(ranked, round.goal).toEqual(round.scores.map((s) => s.member));
    }
  });
});

describe("the ranking and the load bound", () => {
  it("ranks as Python does, and ties go to the member id", () => {
    expect(rank("a", ["m0", "m1", "m2", "m3"])).toEqual(["m2", "m0", "m3", "m1"]);
    expect(rank("k0/a", ["m0", "m1", "m2", "m3"])).toEqual(["m1", "m0", "m3", "m2"]);
    expect(rank("root", ["m3", "m3", "m1", "m0", "m2"])).toEqual(["m1", "m0", "m3", "m2"]);
  });

  it("bounds the load at ceil(1.25 * keys / members), and at least one", () => {
    expect([[1, 3], [3, 2], [4, 2], [10, 3], [7, 7], [1, 1]].map(([k, m]) => capacity(k!, m!))).toEqual([1, 2, 3, 5, 2, 2]);
    expect(() => capacity(3, 0)).toThrow();
  });
});

describe("the remap", () => {
  // each case from coord.hrw.remap in Python, with a seeded random set of keys, owners (some gone), survivors and priorities
  const CASES: { owners: Record<string, string>; alive: string[]; priorities: Record<string, number>; result: Record<string, string> }[] = [
    { owners: { "k0/b": "m0", "k1/c": "gone1", "k2/a": "m0" }, alive: ["m0", "m2", "m3"], priorities: { "k0/b": 1, "k2/a": 2 }, result: { "k0/b": "m0", "k1/c": "m3", "k2/a": "m0" } },
    { owners: { "k0/c": "m0" }, alive: ["m0", "m4"], priorities: {}, result: { "k0/c": "m0" } },
    { owners: { "k0/a": "m3", "k1/c": "m5", "k2/c": "m1" }, alive: ["m0", "m2", "m3", "m4", "m5"], priorities: {}, result: { "k0/a": "m3", "k1/c": "m5", "k2/c": "m4" } },
    {
      owners: { "k0/b": "m2", "k1/b": "m4", "k2/a": "m3", "k3/a": "m2", "k4/c": "gone1", "k5/a": "m3", "k6/a": "m2", "k7/c": "m4" },
      alive: ["m0"],
      priorities: { "k1/b": 1, "k2/a": 1, "k5/a": 2 },
      result: { "k0/b": "m0", "k1/b": "m0", "k2/a": "m0", "k3/a": "m0", "k4/c": "m0", "k5/a": "m0", "k6/a": "m0", "k7/c": "m0" },
    },
    {
      owners: { "k0/c": "m0", "k1/b": "m0", "k2/c": "m2", "k3/b": "m3", "k4/c": "gone2", "k5/b": "gone2" },
      alive: ["m0"],
      priorities: { "k1/b": 2, "k4/c": 1 },
      result: { "k0/c": "m0", "k1/b": "m0", "k2/c": "m0", "k3/b": "m0", "k4/c": "m0", "k5/b": "m0" },
    },
    { owners: { "k0/b": "m2" }, alive: ["m0", "m1"], priorities: { "k0/b": 1 }, result: { "k0/b": "m0" } },
    {
      owners: { "k0/b": "m1", "k1/b": "gone1", "k2/b": "gone1", "k3/a": "gone2" },
      alive: ["m0", "m1"],
      priorities: { "k1/b": 1 },
      result: { "k0/b": "m1", "k1/b": "m1", "k2/b": "m1", "k3/a": "m0" },
    },
  ];
  CASES.forEach((c, i) => {
    it(`gives Python's answer, case ${i + 1}`, () => {
      expect(remap(c.owners, c.alive, c.priorities)).toEqual(c.result);
    });
  });

  it("keeps what survivors own, and moves only the orphans", () => {
    const out = remap({ a: "m1", b: "m2", c: "gone" }, ["m1", "m2", "m3"]);
    expect([out["a"], out["b"]]).toEqual(["m1", "m2"]);
    expect(["m1", "m2", "m3"]).toContain(out["c"]);
  });

  it("refuses an empty pool, as Python does", () => {
    expect(() => remap({ a: "x" }, [])).toThrow();
  });
});
