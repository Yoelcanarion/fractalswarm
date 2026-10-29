// Strict readers for the bodies of the intake API: a field of the wrong kind is named by its path and refused,
// never repaired, so a person never approves a reading the page half understood.

export class ReadError extends Error {}

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Run a reader that throws `ReadError`, and turn the refusal into a value. */
export function reading<T>(read: () => T): Read<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof ReadError) return { ok: false, reason: error.message };
    throw error;
  }
}

export const bad = (where: string, what: string): never => {
  throw new ReadError(`${where}: ${what}`);
};

const shown = (value: unknown): string => {
  const text = JSON.stringify(value);
  return text === undefined ? "nothing" : text.length > 40 ? `${text.slice(0, 37)}…` : text;
};

export const record = (value: unknown, where: string): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : bad(where, `expected an object, got ${shown(value)}`);

export const list = (value: unknown, where: string): unknown[] => (Array.isArray(value) ? value : bad(where, `expected a list, got ${shown(value)}`));

export const text = (value: unknown, where: string): string => (typeof value === "string" ? value : bad(where, `expected text, got ${shown(value)}`));

/** Text that the server fills with "" when it has none. */
export const textOrEmpty = (value: unknown, where: string): string => (value === undefined || value === null ? "" : text(value, where));

export const flag = (value: unknown, where: string): boolean => (typeof value === "boolean" ? value : bad(where, `expected true or false, got ${shown(value)}`));

/** A whole number from 0 up. */
export const count = (value: unknown, where: string): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : bad(where, `expected a whole number, got ${shown(value)}`);

export const number = (value: unknown, where: string): number => (typeof value === "number" && Number.isFinite(value) ? value : bad(where, `expected a number, got ${shown(value)}`));

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : bad(where, `expected one of ${allowed.join(", ")}, got ${shown(value)}`);
}
