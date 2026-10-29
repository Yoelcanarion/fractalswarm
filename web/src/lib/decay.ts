// Highlight lifetimes in virtual time, not in events. A message edge stays lit for about 1.2 s
// of run time and an adoption glows for about 4 s, whatever the replay speed and however many
// events the run produced in between (the old event-count windows lit a burst for a blink and a
// quiet stretch for minutes).
//
// All three are linear: 1 when it happens, 0 after its life. CSS computes the same curve per
// frame from custom properties, so a playing replay needs no React render to fade:
//
//   --glow: clamp(0, calc(1 - (var(--now) - var(--born)) / var(--life)), 1);      (styles.css)
//
// --now is the clock's virtual time in ms, written on the tree each frame (useClockFrame);
// --born and --life are set on the element from ``glowVars``, so the lifetimes live here only.

import type { CSSProperties } from "react";

import type { MessageFlash } from "./reducer";

export const MESSAGE_LIFE_MS = 1200;
export const ADOPTION_LIFE_MS = 4000;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** 1 at ``bornMs``, falling linearly to 0 at ``bornMs + lifeMs``. */
export const glow = (nowMs: number, bornMs: number, lifeMs: number): number => clamp01(1 - (nowMs - bornMs) / lifeMs);

/** The custom properties an element needs to follow a glow in CSS (``--glow`` in styles.css). */
export const glowVars = (bornMs: number, lifeMs: number): CSSProperties =>
  ({ "--born": bornMs, "--life": lifeMs }) as CSSProperties;

/** The custom properties of a restart ring: it fills from ``sinceTs`` over ``restartInMs``. */
export const ringVars = (outage: { sinceTs: number; restartInMs: number }): CSSProperties =>
  ({ "--since": outage.sinceTs, "--dur": outage.restartInMs }) as CSSProperties;

export const messageGlow = (nowMs: number, ts: number): number => glow(nowMs, ts, MESSAGE_LIFE_MS);
export const adoptionGlow = (nowMs: number, ts: number): number => glow(nowMs, ts, ADOPTION_LIFE_MS);

/** The messages still visible at ``nowMs``. */
export const litMessages = (messages: MessageFlash[], nowMs: number): MessageFlash[] =>
  messages.filter((m) => nowMs - m.ts < MESSAGE_LIFE_MS);

/** How far a restarting coordinator is through its outage: 0 at the crash, 1 at ``restartInMs``. */
export function restartProgress(nowMs: number, outage: { sinceTs: number; restartInMs: number }): number {
  return outage.restartInMs > 0 ? clamp01((nowMs - outage.sinceTs) / outage.restartInMs) : 1;
}
