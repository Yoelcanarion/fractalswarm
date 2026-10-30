// For the charts' tests: an element that only records what is set on it, so a painter can be run without a DOM.

import { Pen } from "../tree/paint";

export type Log = Map<object, Record<string, string>>;

export function fakePen<E extends Element>(log: Log): Pen<E> {
  const store: Record<string, string> = {};
  const el = {
    setAttribute: (name: string, value: string) => {
      store[name] = value;
    },
    set textContent(v: string) {
      store["#text"] = v;
    },
  } as unknown as E;
  log.set(el, store);
  return new Pen(el);
}

/** What was set on the element behind a pen. */
export const seen = (log: Log, pen: Pen<Element> | null | undefined): Record<string, string> => (pen ? (log.get(pen.el) ?? {}) : {});

/** A tiny deterministic generator, for tests that try many inputs. */
export function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
