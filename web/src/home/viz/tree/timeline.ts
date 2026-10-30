// The tree's clock. The recorded run lasts 118.6 s and almost all of it is work nobody needs to
// watch; what matters happens in a few seconds around each kill. So progress (0..1) does not run
// at the speed of the log: it runs fast through the quiet stretches, slowly through the stretch
// from a kill to its takeover, and stops the run clock altogether for the instant a takeover
// happens (a *hold*), so the choice of the heir can be read before the tree is re-wired.
//
// Every time here is a time in the log. Only the speed at which we pass through them is chosen.

import type { TreeModel } from "./model";
import { clamp01 } from "../shared";

export type Pacing = "hero" | "story";

export interface PacingProfile {
  /** Seconds of the run per second of screen, away from the action. */
  coldRatio: number;
  /** ... and in the stretch from just before a kill to just after its takeover. */
  hotRatio: number;
  /** Screen seconds a takeover holds the run clock while the heir is chosen and the tree re-wired. */
  holdS: number;
  /** A hot stretch opens this long (run ms) before a kill ... */
  leadMs: number;
  /** ... and closes this long after the last duty of the dead brain has been handed over. */
  tailMs: number;
  /** Screen seconds a message dash is on its way. */
  dashS: number;
  /** Screen seconds the flash of a kill lasts. */
  flashS: number;
}

export const PACING: Record<Pacing, PacingProfile> = {
  hero: { coldRatio: 38, hotRatio: 7, holdS: 0.45, leadMs: 700, tailMs: 1200, dashS: 0.42, flashS: 0.5 },
  story: { coldRatio: 12, hotRatio: 1.8, holdS: 1.6, leadMs: 1500, tailMs: 2500, dashS: 0.9, flashS: 1.2 },
};

export interface Segment {
  /** Screen seconds from the start. */
  s0: number;
  s1: number;
  /** Run time in the log, ms. Equal at both ends of a hold. */
  t0: number;
  t1: number;
  /** Index of the takeover this segment holds the clock for, else null. */
  hold: number | null;
  hot: boolean;
}

export interface Cursor {
  p: number;
  /** Screen seconds from the start. */
  s: number;
  /** The run time shown, ms. */
  tMs: number;
  /** Which takeover is being held, and how far its choreography has got (0..1). */
  hold: { group: number; c: number } | null;
  /** Seconds of the run per second of screen right now; 0 in a hold. */
  speed: number;
  /** A clock that never stops (the run time plus the time spent in holds), for pulses only. */
  tVirtualMs: number;
}

export interface Timeline {
  pacing: Pacing;
  profile: PacingProfile;
  segments: Segment[];
  /** Screen seconds from 0 to 1 at nominal speed. */
  totalS: number;
  at(p: number): Cursor;
  /** The progress at which the run clock reads ``tMs``; at a hold, its start or its end. */
  pOf(tMs: number, when?: "start" | "end"): number;
  /** A length of screen seconds as a length of progress. */
  perS(seconds: number): number;
}

function mergeWindows(windows: [number, number][]): [number, number][] {
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([w[0], w[1]]);
  }
  return merged;
}

export function buildTimeline(model: TreeModel, pacing: Pacing): Timeline {
  const profile = PACING[pacing];
  const end = model.durationMs;
  const hotWindows = mergeWindows(
    model.kills.map((k): [number, number] => [Math.max(0, k.atMs - profile.leadMs), Math.min(end, k.buriedAt + profile.tailMs)]),
  );
  const holdAt = new Map(model.groups.map((g) => [g.atMs, g.index]));
  const cuts = [...new Set([0, end, ...hotWindows.flat(), ...holdAt.keys()])].sort((a, b) => a - b);

  const segments: Segment[] = [];
  let s = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i] as number;
    const t1 = cuts[i + 1] as number;
    const mid = (t0 + t1) / 2;
    const hot = hotWindows.some(([a, b]) => mid >= a && mid <= b);
    const length = (t1 - t0) / 1000 / (hot ? profile.hotRatio : profile.coldRatio);
    segments.push({ s0: s, s1: s + length, t0, t1, hold: null, hot });
    s += length;
    const group = holdAt.get(t1);
    if (group !== undefined) {
      segments.push({ s0: s, s1: s + profile.holdS, t0: t1, t1, hold: group, hot: true });
      s += profile.holdS;
    }
  }
  const totalS = s;

  // Screen seconds spent in holds before each segment starts: the pulses' clock keeps going through them.
  const heldBefore: number[] = [];
  let held = 0;
  for (const seg of segments) {
    heldBefore.push(held);
    if (seg.hold !== null) held += seg.s1 - seg.s0;
  }

  const find = (screen: number): number => {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((segments[mid] as Segment).s0 <= screen) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return {
    pacing,
    profile,
    segments,
    totalS,
    at(p) {
      const q = clamp01(p);
      const screen = q * totalS;
      const k = find(screen);
      const seg = segments[k] as Segment;
      const f = seg.s1 > seg.s0 ? clamp01((screen - seg.s0) / (seg.s1 - seg.s0)) : 0;
      const tMs = seg.hold !== null ? seg.t0 : seg.t0 + (seg.t1 - seg.t0) * f;
      const heldS = (heldBefore[k] ?? 0) + (seg.hold !== null ? screen - seg.s0 : 0);
      return {
        p: q,
        s: screen,
        tMs,
        hold: seg.hold !== null ? { group: seg.hold, c: f } : null,
        speed: seg.hold !== null ? 0 : seg.s1 > seg.s0 ? (seg.t1 - seg.t0) / 1000 / (seg.s1 - seg.s0) : 0,
        tVirtualMs: tMs + heldS * 1000,
      };
    },
    pOf(tMs, when = "start") {
      const held = segments.find((seg) => seg.hold !== null && seg.t0 === tMs);
      if (held) return (when === "start" ? held.s0 : held.s1) / totalS;
      for (const seg of segments) {
        if (seg.hold === null && tMs >= seg.t0 && tMs <= seg.t1) {
          const f = seg.t1 > seg.t0 ? (tMs - seg.t0) / (seg.t1 - seg.t0) : 0;
          return (seg.s0 + (seg.s1 - seg.s0) * f) / totalS;
        }
      }
      return tMs < 0 ? 0 : 1;
    },
    perS: (seconds) => seconds / totalS,
  };
}

export type KeyframeKind = "assign" | "kill" | "suspect" | "verdict" | "remap" | "result" | "end";

export interface Keyframe {
  id: string;
  kind: KeyframeKind;
  /** What happens, from the log. */
  label: string;
  tMs: number;
  /** Progress at which it happens; for a remap, where its hold begins and ends. */
  p: number;
  pEnd: number;
  node?: string;
}

/** The moments of the tree's story, as progress values, for a page that wants to line text up with them. */
export function treeKeyframes(model: TreeModel, tl: Timeline): Keyframe[] {
  const out: Keyframe[] = [];
  const add = (id: string, kind: KeyframeKind, label: string, tMs: number, node?: string, remap = false): void => {
    out.push({ id, kind, label, tMs, p: tl.pOf(tMs, "start"), pEnd: tl.pOf(tMs, remap ? "end" : "start"), ...(node ? { node } : {}) });
  };
  for (const at of [...new Set(model.messages.filter((m) => m.kind === 0).map((m) => m.tMs))]) {
    add(`assign@${at}`, "assign", "Work is assigned down the tree", at);
  }
  for (const k of model.kills) {
    add(`kill:${k.id}`, "kill", `${k.id} is killed`, k.atMs, k.id);
    add(`suspect:${k.id}`, "suspect", `${k.id} is suspected after ${model.detector.suspectAfter} missed heartbeats`, k.suspectedAtMs, k.id);
    add(`verdict:${k.id}`, "verdict", `${k.id} is declared dead after ${model.detector.deadAfter} missed heartbeats`, k.verdictAtMs, k.id);
  }
  for (const g of model.groups) {
    add(`remap:${g.index}`, "remap", `${g.adoptions.map((a) => a.goal).join(" and ")} re-owned`, g.atMs, undefined, true);
  }
  for (const at of [...new Set(model.messages.filter((m) => m.kind === 3).map((m) => m.tMs))]) {
    add(`result@${at}`, "result", "A result travels up", at);
  }
  add("end", "end", "The run completes", model.durationMs);
  return out.sort((a, b) => a.p - b.p || a.pEnd - b.pEnd);
}
