import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import type { Locality, RegimeSlice } from "../../data/types";
import { scaleAbout, textWidth } from "./chart";
import { fakePen, lcg, seen, type Log } from "./fakes";
import {
  REGIME_KEYFRAMES,
  cellText,
  paintRegime,
  ratioNum,
  regimeCaptions,
  regimeFrame,
  regimeLayout,
  regimeModel,
  regimeSummary,
  secondsText,
  type RegimeLayout,
  type RegimeModel,
  type RegimeRig,
} from "./regime";
import { RegimeStrip } from "./RegimeStrip";

const data = story.regime;
const model = regimeModel(data);
const captions = regimeCaptions(model);

describe("the regime strip's model", () => {
  it("has a strip for each assumption the rival was granted, the settings that were run in order", () => {
    expect(model.rows.map((r) => r.axis)).toEqual(["recovery_ms", "rival_restart_ms", "rival_recovery_ms"]);
    expect(model.rows.map((r) => r.cells.map((c) => c.value))).toEqual([
      ["0.5 s", "1 s", "2 s", "2.5 s", "5 s", "10 s", "20 s"],
      ["0 s", "1 s", "3 s"],
      ["0.5 s", "1 s"],
    ]);
    expect(model.maxCells).toBe(7);
  });

  it("takes the verdicts as the rule gave them: ties through the plausible detection times, holds when the supervisor is slower to restart, fails when it restarts at once", () => {
    expect(model.rows.map((r) => r.cells.map((c) => c.locality))).toEqual([
      ["ties", "ties", "ties", "ties", "ties", "ties", "holds"],
      ["ties", "holds", "holds"],
      ["fails", "fails"],
    ]);
  });

  it("marks the settings outside the plausible region and the default of each strip", () => {
    expect(model.rows.map((r) => r.cells.map((c) => c.plausible))).toEqual([
      [false, true, true, true, true, true, false],
      [true, true, true],
      [true, true],
    ]);
    expect(model.rows.map((r) => r.cells.map((c) => c.isDefault))).toEqual([
      [false, false, false, false, true, false, false],
      [true, false, false],
      [false, false],
    ]);
    expect(model.has).toEqual({ na: false, implausible: true, default: true });
  });

  it("tallies the plausible region as the report reads it: 2 hold, 6 tie, 2 fail", () => {
    expect(model.tally).toEqual({ holds: 2, ties: 6, fails: 2, "n/a": 0 });
    expect(model.plausibleCount).toBe(10);
  });

  it("agrees with the ratios it is drawn from: a verdict of holds has both ratios at half or below, one of fails has a ratio of two or more", () => {
    for (const row of model.rows) {
      for (const c of row.cells) {
        if (c.locality === "holds") {
          expect(c.cdt!).toBeLessThanOrEqual(model.threshold + 1e-9);
          expect(c.blast!).toBeLessThanOrEqual(model.threshold + 1e-9);
        }
        if (c.locality === "fails") expect(Math.max(c.cdt!, c.blast!)).toBeGreaterThanOrEqual(1 / model.threshold - 1e-9);
      }
    }
  });

  it("names its setting from the data: the fake model, T2, C3, 3 seeds, the ideal durable supervisor", () => {
    expect([model.model, model.task, model.profile, model.seeds, model.againstLabel]).toEqual(["fake", "t2_conference", "C3", ["1", "2", "3"], "Ideal durable supervisor"]);
    expect(captions[0]).toBe("fake model · T2 conference · failure profile C3 · 3 seeds · the swarm against the ideal durable supervisor · verdicts by the pre-registered rule");
    expect(captions[2]).toBe("fake model · T2 · C3 · 3 seeds · against the ideal durable supervisor");
  });

  it("says nothing of seeds when the data does not name them, and says real when it is real", () => {
    const bare = regimeModel({ ...data, seeds: undefined, model: "real" });
    expect(regimeCaptions(bare)[1]).toBe("real model · T2 conference · failure profile C3 · against the ideal durable supervisor");
    expect(regimeSummary(bare)).toContain("real model, T2 conference at failure profile C3, the swarm against");
  });

  it("writes seconds as people do, and the ratios as the report does", () => {
    expect([secondsText(500), secondsText(2500), secondsText(10000), secondsText(0)]).toEqual(["0.5 s", "2.5 s", "10 s", "0 s"]);
    expect([ratioNum(0.483), ratioNum(1.429), ratioNum(13.197), ratioNum(5.713)]).toEqual(["0.48", "1.43", "13.2", "5.71"]);
  });

  it("tells each setting in words, with its ratios, and what it is when it is the default or outside the region", () => {
    const row = model.rows[0]!;
    expect(cellText(model, row, row.cells[4]!)).toBe(
      "Both detect a failure in 5 s: locality ties (the default). ratios to the ideal durable supervisor's, mean of the seeds: coordinator-dependency time 0.48, blast radius 0.32, idle agent-seconds 0.62",
    );
    expect(cellText(model, row, row.cells[6]!)).toContain("locality holds (outside the plausible region, shown and deciding nothing)");
    const fast = model.rows[2]!;
    expect(cellText(model, fast, fast.cells[0]!)).toContain("coordinator-dependency time 13.2, blast radius 1.43, idle agent-seconds 25.3");
  });

  it("reads out all of it in the text alternative, and only what the data says", () => {
    const text = regimeSummary(model);
    expect(text).toContain("Both detect a failure in: 0.5 s ties (outside the plausible region), 1 s ties, 2 s ties, 2.5 s ties, 5 s ties (the default), 10 s ties, 20 s holds (outside the plausible region)");
    expect(text).toContain("The supervisor detects and restarts in (the swarm keeps 5 s): 0.5 s fails, 1 s fails");
    expect(text).toContain("Within the plausible region, 10 settings, locality holds in 2, ties in 6 and fails in 2.");
    expect(text).not.toMatch(/\b(simpler|cheaper|more reliable|better|worse)\b/i);
  });
});

const SIZES: [number, number][] = [
  [1480, 460],
  [1224, 353],
  [1000, 400],
  [820, 420],
  [760, 353],
  [700, 420],
  [600, 388],
  [390, 388],
  [375, 307],
  [320, 280],
];

const LISTED = new Set(["1480x460", "1224x353", "1000x400", "820x420", "760x353", "700x420", "600x388", "390x388"]);

function checkLayout(layout: RegimeLayout, label: string, m: RegimeModel = model, fits = true): void {
  const { width, height } = layout;
  expect(layout.pitch, label).toBeGreaterThanOrEqual(40);
  expect(layout.markR, label).toBeGreaterThanOrEqual(7);
  expect(layout.markR, label).toBeLessThanOrEqual(9);
  expect(layout.rows, label).toHaveLength(m.rows.length);
  layout.rows.forEach((row, r) => {
    const cells = m.rows[r]!.cells;
    expect(row.points, label).toHaveLength(cells.length);
    // the heading: all of the words, inside its column
    expect(row.head.lines.join(" "), label).toBe(m.rows[r]!.label);
    const right = layout.side ? layout.x0 - 16 : width - 10;
    for (const line of row.head.lines) {
      if (line.includes(" ")) expect(row.head.x + textWidth(line), `${label} heading`).toBeLessThanOrEqual(right + 0.001);
    }
    // the rail runs under its marks and stays in the box
    expect(row.rail.x1, label).toBeCloseTo(layout.x0, 6);
    expect(row.rail.x2, label).toBeLessThanOrEqual(width - 10 + 0.001);
    row.points.forEach((pt, k) => {
      expect(pt.cx, label).toBeGreaterThan(row.rail.x1);
      expect(pt.cx, label).toBeLessThan(row.rail.x2);
      expect(pt.cy, label).toBe(row.rail.y);
      expect(textWidth(pt.value), `${label} value`).toBeLessThanOrEqual(layout.pitch - 4 + 0.001);
      if (pt.ratio !== null) expect(textWidth(pt.ratio), `${label} ratio`).toBeLessThanOrEqual(layout.pitch - 4 + 0.001);
      if (k > 0) expect(pt.cx - row.points[k - 1]!.cx, label).toBeCloseTo(layout.pitch, 6);
      // a band stands behind a setting where locality fails, and nowhere else
      expect(pt.band !== null, label).toBe(cells[k]!.locality === "fails");
      if (pt.band) {
        expect(pt.band.x, label).toBeGreaterThanOrEqual(row.rail.x1 - 0.001);
        expect(pt.band.x + pt.band.w, label).toBeLessThanOrEqual(row.rail.x2 + 0.001);
        expect(pt.band.y + pt.band.h, label).toBeLessThanOrEqual(row.bottom + 0.001);
      }
    });
    if (r > 0) expect(row.top, label).toBeGreaterThanOrEqual(layout.rows[r - 1]!.bottom - 0.001);
  });
  // the key: inside the box, apart from its neighbours
  layout.key.forEach((item, i) => {
    expect(item.x + item.w, `${label} key`).toBeLessThanOrEqual(width - 10 + 0.001);
    const prev = layout.key[i - 1];
    if (prev && prev.row === item.row) expect(item.x, label).toBeGreaterThanOrEqual(prev.x + prev.w + 18 - 0.001);
  });
  if (layout.ratioNote) expect(textWidth(layout.ratioNote.text), label).toBeLessThanOrEqual(width - 20 + 0.001);
  // the setting: all its words, inside the box
  if (layout.caption.lines.length) {
    for (const line of layout.caption.lines) if (line.includes(" ")) expect(textWidth(line), `${label} caption`).toBeLessThanOrEqual(width - 20 + 0.001);
  }
  if (fits) {
    expect(layout.overflow, label).toBe(false);
    expect(layout.needed, label).toBeLessThanOrEqual(height);
    const first = layout.rows[0]!;
    expect(first.top, label).toBeGreaterThanOrEqual(10 - 0.001);
    const last = layout.rows[layout.rows.length - 1]!;
    expect(layout.keyTop, label).toBeGreaterThanOrEqual(last.bottom - 0.001);
    const keyBottom = layout.keyTop + (layout.ratioNote ? 22 : 0) + 22 * (layout.key.length ? layout.key[layout.key.length - 1]!.row + 1 : 0);
    const capTop = layout.caption.lines.length ? layout.caption.y - 8 : height - 10;
    expect(keyBottom, `${label} key vs caption`).toBeLessThanOrEqual(capTop + 0.001);
    expect(capTop + 16 * layout.caption.lines.length, label).toBeLessThanOrEqual(height - 10 + 0.001);
  }
}

describe("the regime strip's layout", () => {
  for (const [width, height] of SIZES) {
    const label = `${width}x${height}`;
    it(`${label}: everything is inside its box and nothing sits on anything else`, () => {
      checkLayout(regimeLayout(model, width, height, captions), label, model, LISTED.has(label));
    });
  }

  it("puts the headings beside the strips where there is room and above them where there is not", () => {
    const wide = regimeLayout(model, 1480, 460, captions);
    expect([wide.side, wide.ratios, wide.key.length, wide.caption.lines.length]).toEqual([true, true, 5, 1]);
    expect(wide.rows[2]!.head.lines).toEqual(["The supervisor detects and restarts in", "(the swarm keeps 5 s)"]);
    expect(wide.rows[0]!.points[0]!.ratio).toBe("0.74×");
    expect(wide.rows[2]!.points[0]!.ratio).toBe("13.2×");
    const phone = regimeLayout(model, 390, 388, captions);
    expect([phone.side, phone.ratios, phone.ratioNote]).toEqual([false, false, null]);
    expect(phone.rows[0]!.head.lines).toEqual(["Both detect a failure in"]);
    expect(phone.rows[2]!.head.lines).toHaveLength(2);
    expect(phone.key.at(-1)!.row).toBe(1);
  });

  it("leaves the numbers under the marks out where the frame is too short for them, and the number in the key with them", () => {
    const short = regimeLayout(model, 1224, 353, captions);
    expect(short.ratios).toBe(false);
    expect(short.ratioNote).toBeNull();
    expect(short.rows[0]!.points.every((p) => p.ratio === null && p.ratioY === null)).toBe(true);
  });

  it("stands each strip's marks on one line, and the failing column in a band that reaches the figures under it", () => {
    const l = regimeLayout(model, 1480, 460, captions);
    const fast = l.rows[2]!;
    expect(fast.points.map((p) => p.band !== null)).toEqual([true, true]);
    const band = fast.points[0]!.band!;
    expect(band.y).toBeLessThan(fast.points[0]!.cy);
    expect(band.y + band.h).toBeGreaterThan(fast.points[0]!.ratioY!);
  });

  it("names the key's marks with the words of the rule, and the other two only when the data has them", () => {
    const l = regimeLayout(model, 1480, 460, captions);
    expect(l.key.map((k) => k.kind)).toEqual(["holds", "ties", "fails", "implausible", "default"]);
    expect(l.key.map((k) => k.label)).toEqual(["holds", "ties", "fails", "outside the plausible region", "the default"]);
    const plain: RegimeSlice = {
      ...data,
      defaults: {},
      rows: data.rows.map((row) => ({ ...row, points: row.points.map((p) => ({ ...p, plausible: true, locality: p.locality === "holds" ? "n/a" : p.locality })) })),
    };
    const m = regimeModel(plain);
    expect(regimeLayout(m, 1480, 460, regimeCaptions(m)).key.map((k) => k.kind)).toEqual(["holds", "ties", "fails", "na"]);
  });

  it("falls to shorter words for the key before it uses a third line, and the setting wraps rather than disappears", () => {
    const tight = regimeLayout(model, 320, 400, captions);
    expect(tight.key.at(-1)!.row).toBeLessThanOrEqual(1);
    expect(tight.key.some((k) => k.label === "not plausible")).toBe(true);
    expect(tight.caption.lines.length).toBeGreaterThanOrEqual(2);
    expect(tight.caption.lines.join(" ")).toBe(captions[2]);
  });

  it("reports when a frame is too short, and draws the tightest tier anyway", () => {
    const short = regimeLayout(model, 375, 250, captions);
    expect(short.overflow).toBe(true);
    expect(short.needed).toBeGreaterThan(250);
    expect(short.lane).toBe(28);
  });

  it("holds for any strips, any settings and any size", () => {
    const next = lcg(11);
    const localities: Locality[] = ["holds", "ties", "fails", "n/a"];
    for (let round = 0; round < 80; round++) {
      const rows = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, r) => {
        const count = 1 + Math.floor(next() * 8);
        return {
          axis: (["recovery_ms", "rival_restart_ms", "rival_recovery_ms"] as const)[r]!,
          label: ["Both detect a failure in", "The supervisor needs this much longer to restart", "The supervisor detects and restarts in (the swarm keeps 5 s)"][r]!,
          points: Array.from({ length: count }, (_, k) => ({
            valueMs: (k + 1) * 500 + Math.floor(next() * 400),
            plausible: next() < 0.8,
            locality: localities[Math.floor(next() * 4)]!,
            cdtRatio: next() < 0.9 ? next() * 15 : null,
            blastRatio: next() < 0.9 ? next() * 2 : null,
            idleRatio: next() < 0.9 ? next() * 30 : null,
            source: "x",
          })),
        };
      });
      const odd = regimeModel({ ...data, rows, seeds: next() < 0.5 ? undefined : ["1", "2"], defaults: { recovery_ms: rows[0]!.points[0]!.valueMs } });
      const width = 320 + Math.floor(next() * 1200);
      const height = 280 + Math.floor(next() * 200);
      const layout = regimeLayout(odd, width, height, regimeCaptions(odd));
      checkLayout(layout, `random ${round} ${width}x${height}`, odd, !layout.overflow);
    }
  });
});

describe("the draw", () => {
  it("brings the strips in one after another, the last last, and each strip's marks from its left to its right", () => {
    const f0 = regimeFrame(0);
    const f1 = regimeFrame(1);
    for (const r of [0, 1, 2]) expect([f0.head(r, 3), f0.rail(r, 3), f0.point(r, 3, 0, 2), f1.head(r, 3), f1.rail(r, 3), f1.point(r, 3, 1, 2)]).toEqual([0, 0, 0, 1, 1, 1]);
    expect([f0.key, f1.key]).toEqual([0, 1]);
    // when the first strip has all of its marks the last has none, and a strip's marks arrive in order
    const early = regimeFrame(0.42);
    expect(early.point(0, 3, 6, 7)).toBeGreaterThan(0.5);
    expect(early.point(2, 3, 0, 2)).toBeLessThan(0.1);
    const mid = regimeFrame(0.3);
    expect(mid.point(0, 3, 0, 7)).toBeGreaterThan(mid.point(0, 3, 3, 7));
    expect(mid.point(0, 3, 3, 7)).toBeGreaterThan(mid.point(0, 3, 6, 7));
    expect(REGIME_KEYFRAMES.key[0]).toBeGreaterThan(REGIME_KEYFRAMES.rows[0]);
    expect(regimeFrame(0.8).key).toBe(0);
  });

  it("only goes forward", () => {
    let before = regimeFrame(0);
    for (let i = 1; i <= 800; i++) {
      const f = regimeFrame(i / 800);
      expect(f.key).toBeGreaterThanOrEqual(before.key - 1e-12);
      for (let r = 0; r < 3; r++) {
        expect(f.head(r, 3)).toBeGreaterThanOrEqual(before.head(r, 3) - 1e-12);
        expect(f.rail(r, 3)).toBeGreaterThanOrEqual(before.rail(r, 3) - 1e-12);
        for (let k = 0; k < 4; k++) expect(f.point(r, 3, k, 4)).toBeGreaterThanOrEqual(before.point(r, 3, k, 4) - 1e-12);
      }
      before = f;
    }
  });

  it("scales about a point, and never to nothing", () => {
    expect(scaleAbout(100, 20, 1, 1)).toBe("translate(100.00 20.00) scale(1.000 1.000) translate(-100.00 -20.00)");
    expect(scaleAbout(100, 20, 0, 1)).toContain("scale(0.001 1.000)");
  });

  const layout = regimeLayout(model, 1224, 353, captions);
  const log: Log = new Map();
  const rig: RegimeRig = {
    heads: layout.rows.map(() => fakePen<SVGGElement>(log)),
    rails: layout.rows.map(() => fakePen<SVGLineElement>(log)),
    marks: layout.rows.map((row) => row.points.map(() => fakePen<SVGGElement>(log))),
    labels: layout.rows.map((row) => row.points.map(() => fakePen<SVGGElement>(log))),
    key: [fakePen<SVGGElement>(log)],
  };

  it("draws nothing at the start and every mark where it belongs at the end", () => {
    paintRegime(rig, layout, 0);
    for (const pen of rig.heads) expect(Number(seen(log, pen)["opacity"])).toBe(0);
    expect(seen(log, rig.marks[0]![0])["opacity"]).toBe("0.00");
    expect(seen(log, rig.marks[0]![0])["transform"]).toContain("scale(0.400)");
    expect(Number(seen(log, rig.key[0])["opacity"])).toBe(0);
    paintRegime(rig, layout, 1);
    layout.rows.forEach((row, r) => {
      expect(seen(log, rig.rails[r])["transform"]).toBe(scaleAbout(row.rail.x1, row.rail.y, 1, 1));
      row.points.forEach((pt, k) => {
        expect(seen(log, rig.marks[r]![k])["transform"]).toBe(`translate(${pt.cx.toFixed(2)} ${pt.cy.toFixed(2)}) scale(1.000)`);
        expect(Number(seen(log, rig.labels[r]![k])["opacity"])).toBe(1);
      });
    });
    expect(Number(seen(log, rig.key[0])["opacity"])).toBe(1);
  });

  it("writes finite numbers all the way through", () => {
    for (let i = 0; i <= 400; i++) {
      paintRegime(rig, layout, i / 400);
      for (const store of log.values()) for (const [name, value] of Object.entries(store)) expect(value, name).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe("RegimeStrip markup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const html = renderToStaticMarkup(createElement(RegimeStrip, { progress: motionValue(0), data, still: true }));
  const count = (re: RegExp): number => (html.match(re) ?? []).length;

  it("draws a mark for each setting that was run, and a rail and a heading for each strip", () => {
    expect(count(/data-mark="true"/g)).toBe(12);
    expect(count(/data-pl="true"/g)).toBe(12);
    expect(count(/data-rail="true"/g)).toBe(3);
    expect(count(/data-head="true"/g)).toBe(3);
    expect(count(/class="hv-rg-hit"/g)).toBe(12);
  });

  it("draws holds as a filled circle, ties as a hollow one and fails as a cross, each also once in the key", () => {
    expect(count(/class="hv-rg-holds"/g)).toBe(3 + 1);
    expect(count(/class="hv-rg-ties"/g)).toBe(7 + 1);
    expect(count(/class="hv-rg-fails"/g)).toBe(2 + 1);
    expect(count(/class="hv-rg-band"/g)).toBe(2);
  });

  it("rings the settings outside the plausible region and points at the default of each strip, and says so in its key", () => {
    expect(count(/class="hv-rg-ring"/g)).toBe(2 + 1);
    expect(count(/class="hv-rg-glyph hv-rg-glyph--out"/g)).toBe(2);
    expect(count(/class="hv-rg-caret"/g)).toBe(2 + 1);
    expect(html).toContain(">outside the plausible region<");
    expect(html).toContain(">the default<");
  });

  it("puts each setting's numbers in its tooltip", () => {
    expect(html).toContain("The supervisor detects and restarts in (the swarm keeps 5 s) 0.5 s: locality fails. ratios to the ideal durable supervisor&#x27;s, mean of the seeds: coordinator-dependency time 13.2, blast radius 1.43, idle agent-seconds 25.3");
    expect(html).toContain("The supervisor needs this much longer to restart 3 s: locality holds. ratios to the ideal durable supervisor&#x27;s, mean of the seeds: coordinator-dependency time 0.19, blast radius 0.22, idle agent-seconds 0.21");
  });

  it("is an image with a text alternative, and the same numbers as a table", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain("Within the plausible region, 10 settings, locality holds in 2, ties in 6 and fails in 2.");
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(count(/<tr>/g)).toBe(1 + 12);
    expect(html).toContain("<th scope=\"row\">The supervisor detects and restarts in (the swarm keeps 5 s) 1 s</th>");
  });

  it("names its setting, the strips' words and the figures under the marks, and a page that prints the setting itself can turn it off", () => {
    expect(html).toContain("fake model");
    expect(html).toContain("T2 conference");
    expect(html).toContain("failure profile C3");
    expect(html).toContain("3 seeds");
    expect(html).toContain("ideal durable supervisor");
    expect(html).toContain(">0.74×<");
    expect(html).toContain(">13.2×<");
    const quiet = renderToStaticMarkup(createElement(RegimeStrip, { progress: motionValue(0), data, still: true, setting: false }));
    expect(quiet).not.toContain("hv-ch-caption");
  });

  it("has no number that is not a number", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});
