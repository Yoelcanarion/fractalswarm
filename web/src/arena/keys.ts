// The arena's keys, as a decision on the key alone, so it can be tested without a page: space plays and pauses, the
// arrows step a second (five with shift), Home goes to the start and End to the end. Anything but play stops the clock,
// as a person who moves the playhead by hand means to look at where it landed.

export const STEP_MS = 1000;

export type KeyAction = { toggle: true } | { seek: number };

export function keyAction(key: string, shift: boolean, now: number, end: number): KeyAction | null {
  switch (key) {
    case " ":
      return { toggle: true };
    case "Home":
      return { seek: 0 };
    case "End":
      return { seek: end };
    case "ArrowRight":
    case "ArrowLeft": {
      const step = (shift ? 5 : 1) * STEP_MS * (key === "ArrowRight" ? 1 : -1);
      return { seek: Math.min(end, Math.max(0, now + step)) };
    }
    default:
      return null;
  }
}
