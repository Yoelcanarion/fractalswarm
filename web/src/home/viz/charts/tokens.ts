// The token bar's model, layout and frames, with no DOM in them. One bar, as long as the tokens the
// recorded run spent, cut by model; under it the models by name with their totals, and the guard that
// read the inputs before any of them (it spends no tokens, so it has no part of the bar). The page
// prints the setting and the coordination and recovery tokens around it.

import type { TokensSlice } from "../../data/types";
import { Pen } from "../tree/paint";
import { easeInOutCubic, smoothstep, span } from "../shared";
import { grouped, scaleAbout, textWidth } from "./chart";

export type ModelKind = "spark" | "wonder" | "contributor" | "other";

/** `muse-spark-1.3` is "Muse Spark 1.3": the model as a person says it. Anything else keeps its id. */
export function museName(id: string, version = true): string {
  const m = /^muse-([a-z]+)-([\d.]+)$/.exec(id);
  if (!m) return id;
  const family = `Muse ${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)}`;
  return version ? `${family} ${m[2]}` : family;
}

export const kindOf = (id: string): ModelKind => (id.includes("spark") ? "spark" : id.includes("wonder") ? "wonder" : id.includes("contributor") ? "contributor" : "other");

/** `promptguard2-22m` is "Llama PromptGuard 2 (22M)"; the page's own name for the role is "Llama PromptGuard 2". */
export function guardName(backend: string | null, version = true): string {
  const m = /^promptguard(\d+)(?:-(\d+m))?$/i.exec(backend ?? "");
  if (!m) return backend ?? "PromptGuard";
  const base = `Llama PromptGuard ${m[1]}`;
  return version && m[2] ? `${base} (${m[2].toUpperCase()})` : base;
}

/** 4370 is "4.4k", 274797 is "275k", 1.2 million is "1.2M". */
export function compact(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e5) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export const percent = (share: number): string => {
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct >= 10 ? Math.round(pct) : +pct.toFixed(1)}%`;
};

const DECISION: Record<string, string> = { allow: "allowed", block: "blocked", flag: "flagged", warn: "warned" };

export interface TokenRow {
  model: string;
  name: string;
  short: string;
  kind: ModelKind;
  /** What the bar is cut by: tokens read plus tokens written. Reasoning tokens are part of the written ones. */
  tokens: number;
  input: number;
  output: number;
  reasoning: number;
  calls: number;
  costUsd: number;
  share: number;
}

export interface TokenModel {
  rows: TokenRow[];
  total: number;
  guard: { name: string; short: string; count: number; text: string } | null;
  coordination: number;
  recovery: number;
}

export function tokenModel(data: TokensSlice): TokenModel {
  const total = data.models.reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0);
  const rows: TokenRow[] = data.models
    .map((m) => {
      const tokens = m.inputTokens + m.outputTokens;
      return {
        model: m.model,
        name: museName(m.model),
        short: museName(m.model, false),
        kind: kindOf(m.model),
        tokens,
        input: m.inputTokens,
        output: m.outputTokens,
        reasoning: m.reasoningTokens,
        calls: m.calls,
        costUsd: m.costUsd,
        share: total > 0 ? tokens / total : 0,
      };
    })
    .filter((row) => row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || (a.model < b.model ? -1 : 1));
  const scans = data.scans;
  const decisions = Object.keys(scans.decisions)
    .sort()
    .map((k) => `${scans.decisions[k]} ${DECISION[k] ?? k}`);
  return {
    rows,
    total,
    guard:
      scans.count > 0
        ? { name: guardName(scans.backend), short: guardName(scans.backend, false).replace(/^Llama /, ""), count: scans.count, text: `${scans.count} ${scans.count === 1 ? "scan" : "scans"}, ${decisions.join(", ")}` }
        : null,
    coordination: data.coordinationTokens,
    recovery: data.recoveryTokens,
  };
}

export function tokenSummary(m: TokenModel): string {
  const models = m.rows.map((r) => `${r.name} ${grouped(r.tokens)} tokens, ${percent(r.share)} (${grouped(r.input)} read and ${grouped(r.output)} written, ${grouped(r.reasoning)} of those written while reasoning; ${r.calls} ${r.calls === 1 ? "call" : "calls"})`);
  const guard = m.guard ? ` ${m.guard.name} read the inputs before any model did: ${m.guard.text}, and spent no tokens.` : "";
  return `Tokens by model in the recorded run, ${grouped(m.total)} in all: ${models.join("; ")}.${guard} Coordination tokens ${grouped(m.coordination)}, recovery tokens ${grouped(m.recovery)}.`;
}

// -- layout -------------------------------------------------------------------------------------

const LINE = 16;
const GAP = 8;
const SEP = 24;
const MIN_BAR = 10;
const MAX_BAR = 22;
const SEG_GAP = 2;

export interface TokenLegendItem {
  /** The bar's colour: a model's, or the guard's, which has no part of the bar. */
  kind: ModelKind | "guard";
  text: string;
  x: number;
  y: number;
  w: number;
  row: number;
}

export interface TokenSegment {
  model: string;
  kind: ModelKind;
  x: number;
  w: number;
}

export interface TokenLayout {
  width: number;
  height: number;
  barY: number;
  barH: number;
  radius: number;
  segments: TokenSegment[];
  legend: TokenLegendItem[];
  legendRows: number;
  /** Which wording of the legend was used: the full one, or the one with the short names and the round numbers. */
  tier: "full" | "short";
}

function legendTexts(m: TokenModel, tier: "full" | "short"): { kind: ModelKind | "guard"; text: string }[] {
  const items: { kind: ModelKind | "guard"; text: string }[] = m.rows.map((r) => ({
    kind: r.kind,
    text: tier === "full" ? `${r.name} · ${grouped(r.tokens)} tokens, ${percent(r.share)}` : `${r.short} ${compact(r.tokens)}`,
  }));
  if (m.guard) items.push({ kind: "guard", text: tier === "full" ? `${m.guard.name} · ${m.guard.text}` : `${m.guard.short} ${m.guard.count} ${m.guard.count === 1 ? "scan" : "scans"}` });
  return items;
}

function flow(items: { kind: ModelKind | "guard"; text: string }[], width: number): TokenLegendItem[] {
  let x = 0;
  let row = 0;
  return items.map((item) => {
    const w = 16 + textWidth(item.text);
    if (x > 0 && x + w > width) {
      row += 1;
      x = 0;
    }
    const out: TokenLegendItem = { ...item, x, y: 0, w, row };
    x += w + SEP;
    return out;
  });
}

export function tokenLayout(model: TokenModel, width: number, height: number): TokenLayout {
  // The legend takes as few rows as the words allow, in the full wording if that fits in two rows.
  const full = flow(legendTexts(model, "full"), width);
  const fullRows = full.length ? full[full.length - 1]!.row + 1 : 0;
  const roomy = full.every((item) => item.x + item.w <= width) && height - fullRows * LINE - GAP >= MIN_BAR;
  const tier = fullRows <= 2 && roomy ? "full" : "short";
  const legend = tier === "full" ? full : flow(legendTexts(model, "short"), width);
  const legendRows = legend.length ? legend[legend.length - 1]!.row + 1 : 0;

  const barH = Math.max(MIN_BAR, Math.min(MAX_BAR, height - GAP - legendRows * LINE));
  const used = barH + (legendRows ? GAP + legendRows * LINE : 0);
  const barY = Math.max(0, (height - used) / 2);
  for (const item of legend) item.y = barY + barH + GAP + item.row * LINE + LINE / 2;

  const gaps = Math.max(0, model.rows.length - 1) * SEG_GAP;
  let x = 0;
  const segments: TokenSegment[] = model.rows.map((r) => {
    const w = Math.max(1, r.share * (width - gaps));
    const seg: TokenSegment = { model: r.model, kind: r.kind, x, w };
    x += w + SEG_GAP;
    return seg;
  });
  return { width, height, barY, barH, radius: Math.min(5, barH / 2), segments, legend, legendRows, tier };
}

// -- the draw ----------------------------------------------------------------------------------

export const TOKEN_KEYFRAMES = { bar: [0, 0.72], legend: [0.5, 1] } as const;

export interface TokenFrame {
  bar: number;
  legend: number;
}

export function tokenFrame(p: number): TokenFrame {
  const k = TOKEN_KEYFRAMES;
  return { bar: easeInOutCubic(span(p, k.bar[0], k.bar[1])), legend: smoothstep(span(p, k.legend[0], k.legend[1])) };
}

export interface TokenRig {
  wipe: Pen<SVGRectElement> | null;
  legend: Pen<SVGGElement> | null;
}

export function collectTokens(svg: SVGSVGElement): TokenRig {
  const wipe = svg.querySelector<SVGRectElement>("[data-wipe]");
  const legend = svg.querySelector<SVGGElement>('[data-part="legend"]');
  return { wipe: wipe ? new Pen(wipe) : null, legend: legend ? new Pen(legend) : null };
}

export function paintTokens(rig: TokenRig, p: number): void {
  const f = tokenFrame(p);
  // the bar is shown through a window that opens from its left end
  rig.wipe?.set("transform", scaleAbout(0, 0, f.bar, 1));
  rig.legend?.set("opacity", f.legend);
}
