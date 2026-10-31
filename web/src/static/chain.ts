// The one check a page with no server can make for itself: recompute the hash chain of a run's log (kernel/store.py `verify_chain`), event by
// event, from the files the page shows. `hash = blake2b(prev_hash ‖ canonical_json(row))`, where the row is every field but `prev_hash` and
// `hash`. It is not a replay, which re-runs the handlers and needs the code.
//
// `JSON.parse` would lose what the hash is taken over: 1.0 becomes 1, and 1e-05 is written back as 0.00001. So a page file is read as text, and
// each value keeps the very characters it has there. They are those of `canonical_json`, which is the same `json.dumps` as the API's answers
// but for the order of the keys, which is put right here.

import { blake2bHex } from "../lib/blake2b";

const GENESIS = "0".repeat(32);

/** The number of events hashed between two looks at the page, so it stays alive through a long log. */
const STRETCH = 512;

export interface ChainEvent {
  seq: number;
  prevHash: string;
  hash: string;
  /** `canonical_json(row)`. */
  row: string;
}

export interface ChainCheck {
  ok: boolean;
  events: number;
  /** The last hash that held. */
  head: string;
  /** The first event that does not follow from the one before it. */
  brokenAt: number | null;
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const BRACE = 0x7b;
const BRACKET = 0x5b;

/** A reader of one JSON text that gives back each value in canonical form. It trusts the text to be JSON: the app has read the same file. */
class Reader {
  private at: number;

  constructor(
    private readonly text: string,
    at = 0,
  ) {
    this.at = at;
  }

  private skip(): void {
    while (this.text.charCodeAt(this.at) <= 0x20) this.at += 1;
  }

  /** Steps over `,` and says that the list goes on, or over the `]` or `}` that ends it. */
  more(): boolean {
    this.skip();
    const on = this.text[this.at] === ",";
    this.at += 1;
    return on;
  }

  /** At the first element of a list or object: steps over its closing mark if it has none. */
  empty(close: string): boolean {
    this.skip();
    if (this.text[this.at] !== close) return false;
    this.at += 1;
    return true;
  }

  private string(): string {
    const start = this.at;
    this.at += 1;
    while (this.at < this.text.length) {
      const code = this.text.charCodeAt(this.at);
      this.at += code === BACKSLASH ? 2 : 1;
      if (code === QUOTE) return this.text.slice(start, this.at);
    }
    throw new Error("a string is not closed");
  }

  private bare(): string {
    const start = this.at;
    while (this.at < this.text.length && !",]} \n\r\t".includes(this.text[this.at])) this.at += 1;
    return this.text.slice(start, this.at);
  }

  /** The keys and values of the object at the cursor, unsorted. */
  entries(): [string, string][] {
    this.skip();
    this.at += 1; // the {
    const entries: [string, string][] = [];
    if (this.empty("}")) return entries;
    do {
      this.skip();
      const key = this.string();
      this.skip();
      this.at += 1; // the :
      entries.push([key, this.value()]);
    } while (this.more());
    return entries;
  }

  value(): string {
    this.skip();
    const code = this.text.charCodeAt(this.at);
    if (code === QUOTE) return this.string();
    if (code === BRACE) return sorted(this.entries());
    if (code !== BRACKET) return this.bare();
    this.at += 1;
    const items: string[] = [];
    if (this.empty("]")) return "[]";
    do items.push(this.value());
    while (this.more());
    return `[${items.join(",")}]`;
  }
}

const keyOf = (raw: string): string => (raw.includes("\\") ? (JSON.parse(raw) as string) : raw.slice(1, -1));

/** Python orders text by code point and JavaScript by UTF-16 unit, which part ways past U+FFFF. */
function byCodePoint(a: string, b: string): number {
  const shared = Math.min(a.length, b.length);
  for (let at = 0; at < shared; at += 1) {
    const difference = (a.codePointAt(at) ?? 0) - (b.codePointAt(at) ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function sorted(entries: [string, string][]): string {
  const order = entries.map(([key, value]) => [keyOf(key), key, value] as const).sort(([a], [b]) => byCodePoint(a, b));
  return `{${order.map(([, key, value]) => `${key}:${value}`).join(",")}}`;
}

/** The events of a page file of the log: `{"events":[…],…}`, the API's own answer. */
export function eventsOfPage(text: string): ChainEvent[] {
  const head = '{"events":[';
  if (!text.startsWith(head)) throw new Error("not a page of events");
  const reader = new Reader(text, head.length);
  const events: ChainEvent[] = [];
  if (reader.empty("]")) return events;
  do {
    const entries = reader.entries();
    const field = (name: string): string => entries.find(([key]) => key === `"${name}"`)?.[1] ?? "";
    events.push({
      seq: Number(field("seq")),
      prevHash: field("prev_hash").slice(1, -1),
      hash: field("hash").slice(1, -1),
      row: sorted(entries.filter(([key]) => key !== '"prev_hash"' && key !== '"hash"')),
    });
  } while (reader.more());
  return events;
}

const encoder = new TextEncoder();

/** `chain_hash` of kernel/ids.py. */
export const chainHash = (prevHash: string, row: string): string => blake2bHex(encoder.encode(prevHash + row));

/** The chain of a log, from its page files in order, stopping at the first event that does not follow. */
export async function checkChain(pages: readonly string[]): Promise<ChainCheck> {
  let head = GENESIS;
  let events = 0;
  for (const page of pages) {
    for (const event of eventsOfPage(page)) {
      events += 1;
      if (event.seq !== events || event.prevHash !== head || chainHash(head, event.row) !== event.hash) return { ok: false, events: events - 1, head, brokenAt: events };
      head = event.hash;
      if (events % STRETCH === 0) await new Promise((resume) => setTimeout(resume));
    }
  }
  return { ok: true, events, head, brokenAt: null };
}
