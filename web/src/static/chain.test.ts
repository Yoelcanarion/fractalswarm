import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../lib/testing";
import { chainHash, checkChain, eventsOfPage, withOneDigitChanged } from "./chain";

// Written by the kernel's own helpers and json.dumps the way the API's answers are: floats JSON.parse would change, keys out of order, text
// that has to be escaped, characters of two and four bytes.
const FIXTURE = readFileSync(new URL("fixtures/chain-page.json", import.meta.url), "utf-8").trimEnd();
const HEAD = "f15263e306d4ba96bdff8ac42e942510";

const toy = (): string[] =>
  readFileSync(REPO_ROOT + "demo/toy/events.jsonl", "utf-8")
    .split("\n")
    .filter((line) => line.trim());
const page = (lines: string[]): string => `{"events":[${lines.join(",")}],"next_seq":1,"last_seq":1,"done":true}`;

describe("reading a page of the log", () => {
  it("gives each row the text canonical_json gives it: sorted keys, and every number as it is written", () => {
    const [first, second] = eventsOfPage(FIXTURE);
    expect(first.row).toContain('"payload":{"big":1e+22,"cost":0.47827890000000006,"float":1.0,"negative":-0.5,"plain":1,"small":1e-05,"tiny":5e-324}');
    expect(first.row.startsWith('{"actor":"o0","causation_id":null,')).toBe(true);
    expect(second.row).toContain('"payload":{"alpha":{"a":[],"z":[1,2.5,{"a":true,"b":null}]},"empty":{},"zeta":"é😀"}');
  });

  it("orders keys as Python does, by code point: past U+FFFF that is not the order of UTF-16", () => {
    const [event] = eventsOfPage('{"events":[{"seq":1,"payload":{"😀":1,"ｱ":2,"a\\u0062":3,"aa":4}}]}');
    expect(event.row).toBe('{"payload":{"aa":4,"a\\u0062":3,"ｱ":2,"😀":1},"seq":1}');
  });

  it("leaves the two hashes out of what is hashed", () => {
    const [first] = eventsOfPage(FIXTURE);
    expect(first.row).not.toContain("prev_hash");
    expect(first.row).not.toContain('"hash"');
    expect(first.prevHash).toBe("0".repeat(32));
    expect(first.hash).toHaveLength(32);
  });

  it("takes an empty page, and refuses a file that is not one", () => {
    expect(eventsOfPage('{"events":[],"next_seq":1}')).toEqual([]);
    expect(() => eventsOfPage("[]")).toThrow(/not a page/);
    expect(() => eventsOfPage('{"events":[{"a":"b')).toThrow(/not closed/);
  });
});

describe("the chain of a log", () => {
  it("holds to the head the kernel wrote, over values JSON.parse would change", async () => {
    expect(await checkChain([FIXTURE])).toEqual({ ok: true, events: 3, head: HEAD, brokenAt: null });
  });

  it("holds on a real log, to the head stored with it, across page files", async () => {
    const lines = toy();
    const whole = await checkChain([page(lines)]);
    expect(whole.ok).toBe(true);
    expect(whole.events).toBe(lines.length);
    expect(whole.head).toBe(readFileSync(REPO_ROOT + "demo/toy/HEAD", "utf-8").trim());
    expect(await checkChain([page(lines.slice(0, 7)), page(lines.slice(7))])).toEqual(whole);
  });

  it("breaks at the event that was changed, by a single digit", async () => {
    const changed = FIXTURE.replace("0.47827890000000006", "0.47827890000000007");
    expect(await checkChain([changed])).toEqual({ ok: false, events: 0, head: "0".repeat(32), brokenAt: 1 });
    const later = await checkChain([FIXTURE.replace("ñandú", "ñandu")]);
    expect(later).toMatchObject({ ok: false, events: 2, brokenAt: 3 });
  });

  it("breaks about halfway through on the copy with one digit changed, and leaves the rest as it was", async () => {
    const lines = toy();
    const pages = [page(lines.slice(0, 20)), page(lines.slice(20))];
    const copy = withOneDigitChanged(pages);
    expect(copy[0]).toBe(pages[0]);
    expect(copy[1]).toHaveLength(pages[1].length);
    expect([...copy[1]].filter((character, at) => character !== pages[1][at])).toHaveLength(1);
    const { ok, brokenAt } = await checkChain(copy);
    expect(ok).toBe(false);
    expect(brokenAt).toBeGreaterThan(20);
    expect(await checkChain(pages)).toMatchObject({ ok: true });
  });

  it("breaks where an event is missing, and where a whole page is", async () => {
    const lines = toy();
    expect(await checkChain([page([...lines.slice(0, 3), ...lines.slice(4)])])).toMatchObject({ ok: false, events: 3, brokenAt: 4 });
    expect(await checkChain([page(lines.slice(0, 3)), page(lines.slice(6))])).toMatchObject({ ok: false, events: 3, brokenAt: 4 });
  });

  it("is not fooled by an event whose hash was rewritten to fit: the next one no longer follows it", async () => {
    const [first] = eventsOfPage(FIXTURE);
    const row = first.row.replace("0.47827890000000006", "0.1");
    const rewritten = chainHash("0".repeat(32), row);
    const forged = FIXTURE.replace("0.47827890000000006", "0.1").replace(first.hash, rewritten);
    expect(await checkChain([forged])).toMatchObject({ ok: false, events: 1, brokenAt: 2 });
  });
});
