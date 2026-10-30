import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import type { TokensSlice } from "../../data/types";
import { scaleAbout, textWidth } from "./chart";
import { fakePen, lcg, seen, type Log } from "./fakes";
import {
  TOKEN_KEYFRAMES,
  compact,
  guardName,
  kindOf,
  museName,
  paintTokens,
  percent,
  tokenFrame,
  tokenLayout,
  tokenModel,
  tokenSummary,
  type TokenLayout,
  type TokenModel,
  type TokenRig,
} from "./tokens";
import { TokenBar } from "./TokenBar";

const data = story.tokensByModel;
const model = tokenModel(data);

describe("the token bar's model", () => {
  it("cuts the run's tokens by model, the larger first, and counts what was read and what was written", () => {
    expect(model.rows.map((r) => [r.model, r.tokens, r.input, r.output, r.reasoning, r.calls])).toEqual([
      ["muse-spark-1.3", 274797, 196682, 78115, 50816, 78],
      ["muse-wonder-1.0", 4370, 2037, 2333, 1685, 1],
    ]);
    expect(model.total).toBe(279167);
    expect(model.rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 12);
    expect(model.rows.map((r) => percent(r.share))).toEqual(["98%", "1.6%"]);
  });

  it("names the models as people do, and the guard by the page's own name", () => {
    expect(model.rows.map((r) => [r.name, r.short, r.kind])).toEqual([
      ["Muse Spark 1.3", "Muse Spark", "spark"],
      ["Muse Wonder 1.0", "Muse Wonder", "wonder"],
    ]);
    expect(model.guard).toEqual({ name: "Llama PromptGuard 2 (22M)", short: "PromptGuard 2", count: 32, text: "32 scans, 32 allowed" });
    expect(museName("some-other-model")).toBe("some-other-model");
    expect(kindOf("some-other-model")).toBe("other");
    expect(kindOf("muse-contributor-2.0")).toBe("contributor");
    expect([guardName(null), guardName("custom-guard"), guardName("promptguard2")]).toEqual(["PromptGuard", "custom-guard", "Llama PromptGuard 2"]);
  });

  it("counts coordination and recovery tokens as the data does, which is none", () => {
    expect([model.coordination, model.recovery]).toEqual([0, 0]);
  });

  it("writes round numbers and shares without ever printing a nonzero share as nothing", () => {
    expect([compact(999), compact(1000), compact(4370), compact(99999), compact(274797), compact(1_200_000)]).toEqual(["999", "1k", "4.4k", "100k", "275k", "1.2M"]);
    expect([percent(0.9843), percent(0.0156), percent(0.1), percent(0.0004), percent(0), percent(1)]).toEqual(["98%", "1.6%", "10%", "<0.1%", "0%", "100%"]);
  });

  it("says what the guard decided in its own words, and says nothing of a guard that scanned nothing", () => {
    const odd: TokensSlice = { ...data, scans: { count: 3, backend: "promptguard2-22m", decisions: { block: 1, allow: 2 } } };
    expect(tokenModel(odd).guard!.text).toBe("3 scans, 2 allowed, 1 blocked");
    expect(tokenModel({ ...data, scans: { count: 1, backend: null, decisions: { allow: 1 } } }).guard!.text).toBe("1 scan, 1 allowed");
    expect(tokenModel({ ...data, scans: { count: 0, backend: null, decisions: {} } }).guard).toBeNull();
  });

  it("leaves out a model that spent no tokens, and has no rows for none", () => {
    const quiet: TokensSlice = { ...data, models: [...data.models, { model: "muse-idle-0.1", calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, roles: {} }] };
    expect(tokenModel(quiet).rows).toHaveLength(2);
    const none = tokenModel({ ...data, models: [] });
    expect([none.rows.length, none.total]).toEqual([0, 0]);
  });

  it("tells it all in its text alternative, reasoning as part of what was written, and the guard as spending nothing", () => {
    const text = tokenSummary(model);
    expect(text).toContain("279,167 in all");
    expect(text).toContain("Muse Spark 1.3 274,797 tokens, 98% (196,682 read and 78,115 written, 50,816 of those written while reasoning; 78 calls)");
    expect(text).toContain("Muse Wonder 1.0 4,370 tokens, 1.6% (2,037 read and 2,333 written, 1,685 of those written while reasoning; 1 call)");
    expect(text).toContain("Llama PromptGuard 2 (22M) read the inputs before any model did: 32 scans, 32 allowed, and spent no tokens.");
    expect(text).toContain("Coordination tokens 0, recovery tokens 0.");
    expect(text).not.toMatch(/\b(simpler|cheaper|more reliable|better|worse)\b/i);
  });
});

const SIZES: [number, number][] = [
  [1480, 56],
  [1100, 56],
  [900, 56],
  [700, 56],
  [560, 56],
  [390, 56],
  [340, 56],
  [300, 56],
  [900, 40],
  [900, 90],
];

function checkLayout(layout: TokenLayout, label: string, m: TokenModel = model, fits = true): void {
  const { width, height } = layout;
  // the segments are as long as the tokens they stand for, and fill the width between their gaps
  const gaps = Math.max(0, layout.segments.length - 1) * 2;
  if (layout.segments.length) {
    const last = layout.segments[layout.segments.length - 1]!;
    expect(last.x + last.w, label).toBeCloseTo(width, 6);
    layout.segments.forEach((seg, i) => {
      expect(seg.w, label).toBeGreaterThanOrEqual(1 - 1e-9);
      if (seg.w > 1 + 1e-9) expect(seg.w / (width - gaps), label).toBeCloseTo(m.rows[i]!.share, 9);
      const prev = layout.segments[i - 1];
      if (prev) expect(seg.x - (prev.x + prev.w), label).toBeCloseTo(2, 9);
    });
  }
  expect(layout.barH, label).toBeGreaterThanOrEqual(10);
  expect(layout.barH, label).toBeLessThanOrEqual(22);
  expect(layout.barY, label).toBeGreaterThanOrEqual(0);
  // the legend: inside the width, apart from its neighbours, below the bar
  layout.legend.forEach((item, i) => {
    expect(item.x + item.w, `${label} legend`).toBeLessThanOrEqual(width + 0.001);
    expect(item.w, label).toBeCloseTo(16 + textWidth(item.text), 9);
    expect(item.y, label).toBeGreaterThan(layout.barY + layout.barH);
    const prev = layout.legend[i - 1];
    if (prev && prev.row === item.row) expect(item.x, label).toBeGreaterThanOrEqual(prev.x + prev.w + 24 - 0.001);
  });
  if (fits) {
    const used = layout.barH + (layout.legendRows ? 8 + 16 * layout.legendRows : 0);
    expect(layout.barY + used, label).toBeLessThanOrEqual(height + 0.001);
    for (const item of layout.legend) expect(item.y + 8, label).toBeLessThanOrEqual(height + 0.001);
  }
}

describe("the token bar's layout", () => {
  for (const [width, height] of SIZES) {
    it(`${width}x${height}: everything is inside its box and the legend is under the bar`, () => {
      checkLayout(tokenLayout(model, width, height), `${width}x${height}`, model, width >= 300);
    });
  }

  it("names the models in full, with their totals, where the words fit in two rows, and shortens them where they do not", () => {
    const wide = tokenLayout(model, 1480, 56);
    expect([wide.tier, wide.legendRows, wide.barH]).toEqual(["full", 1, 22]);
    expect(wide.legend.map((l) => l.text)).toEqual([
      "Muse Spark 1.3 · 274,797 tokens, 98%",
      "Muse Wonder 1.0 · 4,370 tokens, 1.6%",
      "Llama PromptGuard 2 (22M) · 32 scans, 32 allowed",
    ]);
    const mid = tokenLayout(model, 900, 56);
    expect([mid.tier, mid.legendRows, mid.barH]).toEqual(["full", 2, 16]);
    const phone = tokenLayout(model, 390, 56);
    expect([phone.tier, phone.legendRows]).toEqual(["short", 2]);
    expect(phone.legend.map((l) => l.text)).toEqual(["Muse Spark 275k", "Muse Wonder 4.4k", "PromptGuard 2 32 scans"]);
  });

  it("gives the guard a mark of its own and no part of the bar", () => {
    const l = tokenLayout(model, 1480, 56);
    expect(l.legend.map((i) => i.kind)).toEqual(["spark", "wonder", "guard"]);
    expect(l.segments.map((s) => s.kind)).toEqual(["spark", "wonder"]);
  });

  it("keeps a model that spent next to nothing in sight, as long as its share says", () => {
    const l = tokenLayout(model, 340, 56);
    const wonder = l.segments[1]!;
    expect(wonder.w).toBeCloseTo(model.rows[1]!.share * (340 - 2), 9);
    expect(wonder.w).toBeGreaterThan(4);
  });

  it("holds for any models and any size", () => {
    const next = lcg(23);
    for (let round = 0; round < 60; round++) {
      const count = Math.floor(next() * 4);
      const odd = tokenModel({
        models: Array.from({ length: count }, (_, i) => ({
          model: ["muse-spark-1.3", "muse-wonder-1.0", "muse-contributor-2.0", "other-model"][i]!,
          calls: 1 + Math.floor(next() * 90),
          inputTokens: Math.floor(next() * 400_000),
          outputTokens: Math.floor(next() * 100_000),
          reasoningTokens: Math.floor(next() * 50_000),
          costUsd: next(),
          roles: {},
        })),
        coordinationTokens: 0,
        recoveryTokens: 0,
        scans: next() < 0.7 ? { count: 1 + Math.floor(next() * 90), backend: "promptguard2-22m", decisions: { allow: 1 } } : { count: 0, backend: null, decisions: {} },
      });
      const width = 300 + Math.floor(next() * 1200);
      const height = 56 + Math.floor(next() * 40);
      checkLayout(tokenLayout(odd, width, height), `random ${round} ${width}x${height}`, odd);
    }
  });
});

describe("the draw", () => {
  it("opens the bar from its left end and brings the words in after it has started", () => {
    const k = TOKEN_KEYFRAMES;
    expect([tokenFrame(0).bar, tokenFrame(0).legend, tokenFrame(1).bar, tokenFrame(1).legend]).toEqual([0, 0, 1, 1]);
    expect(tokenFrame(k.legend[0]).legend).toBe(0);
    expect(tokenFrame(k.legend[0]).bar).toBeGreaterThan(0.3);
    let before = tokenFrame(0);
    for (let i = 1; i <= 600; i++) {
      const f = tokenFrame(i / 600);
      expect(f.bar).toBeGreaterThanOrEqual(before.bar - 1e-12);
      expect(f.legend).toBeGreaterThanOrEqual(before.legend - 1e-12);
      before = f;
    }
  });

  const log: Log = new Map();
  const rig: TokenRig = { wipe: fakePen<SVGRectElement>(log), legend: fakePen<SVGGElement>(log) };

  it("scales the window about the bar's left end, and shows the whole of it at the end", () => {
    paintTokens(rig, 0);
    expect(seen(log, rig.wipe)["transform"]).toBe(scaleAbout(0, 0, 0, 1));
    expect(Number(seen(log, rig.legend)["opacity"])).toBe(0);
    paintTokens(rig, 1);
    expect(seen(log, rig.wipe)["transform"]).toBe(scaleAbout(0, 0, 1, 1));
    expect(Number(seen(log, rig.legend)["opacity"])).toBe(1);
  });

  it("writes finite numbers all the way through, and does nothing without its parts", () => {
    for (let i = 0; i <= 200; i++) {
      paintTokens(rig, i / 200);
      for (const store of log.values()) for (const [name, value] of Object.entries(store)) expect(value, name).not.toMatch(/NaN|undefined|Infinity/);
    }
    expect(() => paintTokens({ wipe: null, legend: null }, 0.5)).not.toThrow();
  });
});

describe("TokenBar markup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const html = renderToStaticMarkup(createElement(TokenBar, { progress: motionValue(0), data, still: true }));

  it("draws a segment for each model, with the model's numbers in its tooltip, and a legend with the guard in it", () => {
    expect(html.match(/class="hv-tk-seg hv-tk-seg--/g)).toHaveLength(2);
    expect(html).toContain("Muse Spark 1.3: 274,797 tokens, 98% of the run&#x27;s tokens. 196,682 read, 78,115 written, 50,816 of those written while reasoning; 78 calls.");
    expect(html).toContain(">Muse Wonder 1.0 · 4,370 tokens, 1.6%<");
    expect(html).toContain(">Llama PromptGuard 2 (22M) · 32 scans, 32 allowed<");
    expect(html.match(/class="hv-tk-dot hv-tk-dot--guard"/g)).toHaveLength(1);
  });

  it("is an image with a text alternative, and the same numbers as a table", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain("Tokens by model in the recorded run, 279,167 in all");
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('<th scope="row">Muse Spark 1.3</th>');
    expect(html).toContain("<td>32 scans, 32 allowed</td>");
  });

  it("clips its bar through a window of its own that no other bar's id can be mistaken for", () => {
    const id = /<clipPath id="(tk[a-zA-Z0-9]+)"/.exec(html)![1]!;
    expect(html).toContain(`clip-path="url(#${id})"`);
    expect(html).toContain('data-wipe=""'.replace('=""', '="true"'));
    const other = renderToStaticMarkup(createElement("div", null, createElement(TokenBar, { progress: motionValue(0), data, still: true }), createElement(TokenBar, { progress: motionValue(0), data, still: true })));
    const ids = [...other.matchAll(/<clipPath id="(tk[a-zA-Z0-9]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it("is not as tall as a chart: it takes the 56 px the page gives it, not the minimum of a chart", () => {
    expect(html).toContain('class="hv hv-tk"');
    expect(html).not.toContain("hv-chart");
  });

  it("has no number that is not a number", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});
