import { describe, expect, it } from "vitest";
import { dodge, grouped, linear, niceTicks, polyline, signed, textWidth, tickLabel, withSign, wrapText } from "./chart";

describe("linear", () => {
  it("maps the ends of the domain to the ends of the range, in either direction", () => {
    const up = linear(0, 10, 100, 200);
    expect([up(0), up(5), up(10)]).toEqual([100, 150, 200]);
    const down = linear(0, 10, 200, 100);
    expect([down(0), down(5), down(10)]).toEqual([200, 150, 100]);
    expect(up.domain).toEqual([0, 10]);
    expect(up.range).toEqual([100, 200]);
  });

  it("puts everything in the middle of the range when the domain is a single value", () => {
    expect(linear(3, 3, 0, 100)(3)).toBe(50);
  });
});

describe("niceTicks", () => {
  it("steps by 1, 2 or 5 times a power of ten and covers the data", () => {
    expect(niceTicks(0, 188.3)).toMatchObject({ min: 0, max: 200, step: 50, values: [0, 50, 100, 150, 200] });
    expect(niceTicks(-16.28, 75.62)).toMatchObject({ min: -20, max: 80, step: 20, values: [-20, 0, 20, 40, 60, 80] });
    expect(niceTicks(0, 1)).toMatchObject({ min: 0, max: 1, step: 0.2 });
    expect(niceTicks(0, 1).values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("always covers lo..hi with ticks that are whole steps apart", () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 400; i++) {
      const lo = (next() - 0.5) * 400;
      const hi = lo + 0.01 + next() * 500;
      const t = niceTicks(lo, hi, 3 + Math.floor(next() * 5));
      expect(t.min).toBeLessThanOrEqual(lo + 1e-9);
      expect(t.max).toBeGreaterThanOrEqual(hi - 1e-9);
      expect(t.values.length).toBeGreaterThanOrEqual(2);
      expect(t.values.length).toBeLessThanOrEqual(13);
      t.values.slice(1).forEach((v, k) => expect(v - t.values[k]!).toBeCloseTo(t.step, 6));
    }
  });

  it("survives a flat domain", () => {
    expect(niceTicks(5, 5).values).toEqual([5, 6]);
  });
});

describe("number formats", () => {
  it("writes a real minus sign and never minus zero", () => {
    expect(signed(-6.84, 1)).toBe("−6.8");
    expect(signed(-0.04, 1)).toBe("0.0");
    expect(signed(0, 0)).toBe("0");
    expect(withSign(6.56, 1)).toBe("+6.6");
    expect(withSign(-6.81, 1)).toBe("−6.8");
    expect(withSign(0.01, 1)).toBe("0.0");
  });

  it("gives a tick as many decimals as its step needs", () => {
    expect(tickLabel(50, 50)).toBe("50");
    expect(tickLabel(-20, 20)).toBe("−20");
    expect(tickLabel(0.4, 0.2)).toBe("0.4");
    expect(tickLabel(2.5, 0.5)).toBe("2.5");
    expect(tickLabel(0.25, 0.05)).toBe("0.25");
  });

  it("groups thousands", () => {
    expect(grouped(274797)).toBe("274,797");
    expect(grouped(4370)).toBe("4,370");
    expect(grouped(12)).toBe("12");
    expect(grouped(1234567.4)).toBe("1,234,567");
  });

  it("draws a polyline as an SVG path, open or closed", () => {
    expect(polyline([])).toBe("");
    expect(polyline([[0, 0], [10, 5.5]])).toBe("M0.00 0.00L10.00 5.50");
    expect(polyline([[0, 0], [10, 0], [10, 10]], true)).toBe("M0.00 0.00L10.00 0.00L10.00 10.00Z");
  });
});

describe("dodge", () => {
  const gapsOk = (ys: number[], sizes: number[], pad: number): boolean => {
    const order = ys.map((_, i) => i).sort((a, b) => ys[a]! - ys[b]!);
    return order.slice(1).every((i, k) => ys[i]! - ys[order[k]!]! >= (sizes[i]! + sizes[order[k]!]!) / 2 + pad - 1e-9);
  };

  it("leaves labels that already have room where they are", () => {
    expect(dodge([20, 60, 100], [14, 14, 14], 0, 200)).toEqual([20, 60, 100]);
  });

  it("splits the move evenly between two labels that want the same place", () => {
    const [a, b] = dodge([100, 100], [14, 14], 0, 200, 2);
    expect(b! - a!).toBeCloseTo(16, 9);
    expect((a! + b!) / 2).toBeCloseTo(100, 9);
  });

  it("keeps a cluster together and moves its middle the least, as the labels of the hero chart cluster", () => {
    // three labels within a few pixels of each other, two lines each
    const ys = dodge([200, 205, 212], [30, 30, 15], 0, 400, 2);
    expect(gapsOk(ys, [30, 30, 15], 2)).toBe(true);
    const mean = ys.reduce((s, y) => s + y, 0) / 3;
    expect(mean).toBeCloseTo((200 + 205 + 212) / 3 + 0, 0);
  });

  it("keeps the order of the wants, and gives the answer in the order it was asked", () => {
    const wants = [90, 10, 50, 52];
    const ys = dodge(wants, [14, 14, 14, 14], 0, 200, 2);
    const order = wants.map((_, i) => i).sort((a, b) => wants[a]! - wants[b]!);
    order.slice(1).forEach((i, k) => expect(ys[i]!).toBeGreaterThan(ys[order[k]!]!));
    expect(gapsOk(ys, [14, 14, 14, 14], 2)).toBe(true);
  });

  it("stays inside the area while the stack fits in it", () => {
    const ys = dodge([2, 3, 4], [14, 14, 14], 0, 100, 2);
    expect(ys[0]! - 7).toBeGreaterThanOrEqual(0);
    expect(gapsOk(ys, [14, 14, 14], 2)).toBe(true);
    const low = dodge([98, 99, 100], [14, 14, 14], 0, 100, 2);
    expect(low[2]! + 7).toBeLessThanOrEqual(100 + 1e-9);
    expect(gapsOk(low, [14, 14, 14], 2)).toBe(true);
  });

  it("never lets two labels touch, wherever they want to be", () => {
    let seed = 11;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 300; round++) {
      const n = 1 + Math.floor(next() * 6);
      const wants = Array.from({ length: n }, () => next() * 300);
      const sizes = Array.from({ length: n }, () => (next() < 0.5 ? 15 : 30));
      const ys = dodge(wants, sizes, 0, 400, 2);
      expect(ys).toHaveLength(n);
      expect(gapsOk(ys, sizes, 2)).toBe(true);
      ys.forEach((y, i) => {
        expect(y - sizes[i]! / 2).toBeGreaterThanOrEqual(-1e-9);
        expect(y + sizes[i]! / 2).toBeLessThanOrEqual(400 + 1e-9);
      });
    }
  });

  it("is empty for nothing", () => {
    expect(dodge([], [], 0, 10)).toEqual([]);
  });
});

describe("wrapText", () => {
  const sentence = "The supervisor detects and restarts in (the swarm keeps 5 s)";

  it("keeps a text that fits on one line, and says nothing of nothing", () => {
    expect(wrapText(sentence, 1000)).toEqual([sentence]);
    expect(wrapText("", 100)).toEqual([]);
    expect(wrapText("   ", 100)).toEqual([]);
  });

  it("breaks at spaces, loses no word, and fills each line while it can", () => {
    for (const width of [120, 180, 240, 300, 420]) {
      const lines = wrapText(sentence, width);
      expect(lines.join(" ")).toBe(sentence);
      for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(width);
      lines.slice(0, -1).forEach((line, i) => {
        const word = lines[i + 1]!.split(" ")[0]!;
        expect(textWidth(`${line} ${word}`)).toBeGreaterThan(width);
      });
    }
  });

  it("gives a word wider than the line a line of its own", () => {
    expect(wrapText("a incomprehensibilities b", 60)).toEqual(["a", "incomprehensibilities", "b"]);
  });
});
