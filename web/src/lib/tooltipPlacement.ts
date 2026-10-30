// Where a tooltip bubble goes. Pure, so the flipping and the clamping are tested without a browser.
//
// The bubble is `position: fixed`: a card with `overflow: hidden` or a scrolling table around the trigger
// does not clip it. Everything here is in viewport coordinates, like `getBoundingClientRect()`.

export type Placement = "top" | "bottom" | "left" | "right" | "top-end" | "bottom-end";
export type Side = "top" | "bottom" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Between the trigger and the bubble. The bubble's CSS bridges it, so the pointer can cross it. */
export const GAP = 8;
/** The least distance the bubble keeps from the edge of the window. */
export const MARGIN = 8;

export interface Spot {
  left: number;
  top: number;
  /** The side it ended up on: the one asked for, or the opposite when that had no room. */
  side: Side;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

export function tooltipPosition(trigger: Box, bubble: Size, placement: Placement, viewport: Size): Spot {
  const right = trigger.left + trigger.width;
  const bottom = trigger.top + trigger.height;
  const above = trigger.top - GAP - bubble.height;
  const below = bottom + GAP;
  const beside = { left: trigger.left - GAP - bubble.width, right: right + GAP };
  const room = {
    top: above >= MARGIN,
    bottom: below + bubble.height <= viewport.height - MARGIN,
    left: beside.left >= MARGIN,
    right: beside.right + bubble.width <= viewport.width - MARGIN,
  };
  const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const asked = placement.split("-")[0] as Side;
  const side = !room[asked] && room[OPPOSITE[asked]] ? OPPOSITE[asked] : asked;

  let left: number;
  let top: number;
  if (side === "top" || side === "bottom") {
    top = side === "top" ? above : below;
    left = placement.endsWith("-end") ? right - bubble.width : trigger.left + trigger.width / 2 - bubble.width / 2;
  } else {
    left = side === "left" ? beside.left : beside.right;
    top = trigger.top + trigger.height / 2 - bubble.height / 2;
  }
  return {
    left: clamp(left, MARGIN, viewport.width - MARGIN - bubble.width),
    top: clamp(top, MARGIN, viewport.height - MARGIN - bubble.height),
    side,
  };
}
